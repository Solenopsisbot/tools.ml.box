/**
 * Finetuning memory, time and cost.
 *
 * Calibrated against Unsloth's published memory and throughput figures, which
 * are the numbers most people are actually comparing against. The headline
 * result they report — Llama 3.1 8B, QLoRA r=16, 2048 tokens, batch 2, fits in
 * roughly 8 GB — falls out of the model below at ~7.5 GB.
 *
 * The four terms that decide whether a finetune fits, in the order they
 * usually bite:
 *
 *   1. Base weights. Frozen, but resident. QLoRA's whole trick is storing them
 *      in NF4 so an 8B costs 4.4 GB instead of 16.
 *   2. Logits. seq x batch x vocab x 4 bytes, and vocabularies are 128k+ now.
 *      At 2048 tokens and batch 2 that is 2.1 GB for a tensor nobody thinks
 *      about — larger than the LoRA adapter by a factor of twenty-five. Fused
 *      cross-entropy is the single biggest memory win available.
 *   3. Activations. Gradient checkpointing turns these from "layers x
 *      everything" into "one boundary tensor per layer, recomputed on the way
 *      back", trading ~30% throughput for most of the memory.
 *   4. Optimizer state. Enormous for a full finetune, near-free for LoRA —
 *      Adam keeps two moments per TRAINABLE parameter, and LoRA has 0.5% of
 *      them.
 */

import { GB } from './calc.js';

/** Bytes per frozen base parameter, by method. */
const BASE_BYTES = {
	// Mixed-precision training keeps the working copy in bf16.
	full: 2,
	lora: 2,
	// NF4 plus double-quantised block constants. Not 0.5 — the constants are
	// real and they are why a "4-bit" 8B loads as 4.4 GB, not 4.0.
	qlora: 0.55,
};

/** Bytes of optimizer state per trainable parameter. */
export const OPTIMIZERS = [
	{ id: 'adamw8', name: 'AdamW 8-bit (bitsandbytes)', bytes: 2, note: 'The default for LoRA work. Two 8-bit moments per trainable parameter.' },
	{ id: 'adamw32', name: 'AdamW fp32', bytes: 8, note: 'Two fp32 moments. Four times the state of the 8-bit version for no measurable quality gain on LoRA.' },
	{ id: 'adafactor', name: 'Adafactor', bytes: 0.5, note: 'Factorises the second moment, so state is roughly sqrt-sized. Slower to converge; worth it only when memory is the binding constraint.' },
	{ id: 'sgd', name: 'SGD + momentum', bytes: 4, note: 'One fp32 momentum buffer. Rarely used for LLM finetuning.' },
];

export const OPT_MAP = new Map(OPTIMIZERS.map((o) => [o.id, o]));

export const METHODS = [
	{ id: 'qlora', name: 'QLoRA (4-bit base)', note: 'Base weights frozen in NF4. Roughly a third of the memory of LoRA and about 35% slower per step, because every matmul dequantises first.' },
	{ id: 'lora', name: 'LoRA (bf16 base)', note: 'Base weights frozen in bf16. Faster per step than QLoRA; needs the full bf16 model resident.' },
	{ id: 'full', name: 'Full finetune', note: 'Every parameter trains. Needs bf16 weights, bf16 gradients, an fp32 master copy and optimizer state for all of them — budget roughly 10x the model size.' },
];

export const TARGETS = [
	{ id: 'all', name: 'All linear layers', note: 'q, k, v, o, gate, up, down. The usual recommendation.' },
	{ id: 'attn', name: 'Attention only', note: 'q, k, v, o. Fewer parameters, less memory, and the standard choice for MoE models where per-expert adapters are impractical.' },
];

/** Cross-entropy loss materialises logits at fp32. Vocabularies are big now. */
const VOCAB = 128256;

/** PyTorch + CUDA kernels + allocator slack, before any tensor you asked for. */
const RUNTIME_BASE = 1.2 * GB;

/** Allocator fragmentation. Training allocates and frees in a ragged pattern. */
const FRAGMENTATION = 1.05;

/**
 * Achieved fraction of peak FLOPS during training.
 *
 * Unsloth's ~2x speed claim over HF + Flash Attention 2 is roughly half better
 * MFU (custom Triton kernels, fused RoPE and cross-entropy) and half not
 * wasting memory bandwidth — this captures the first half.
 */
const TRAIN_MFU = {
	cuda: { stock: 0.25, unsloth: 0.4 },
	metal: { stock: 0.15, unsloth: 0.15 },
	cpu: { stock: 0.05, unsloth: 0.05 },
};

/** QLoRA dequantises every weight on every forward. It is not free. */
const QLORA_SPEED = 0.65;

/** DDP all-reduce overhead per extra GPU. */
const DDP_EFFICIENCY = 0.85;

/**
 * Count LoRA trainable parameters exactly, from the model's real projection
 * shapes.
 *
 * A rank-r adapter on a d_in x d_out projection is r x (d_in + d_out) — two
 * thin matrices, not one fat one. Summing the actual shapes rather than
 * applying a "0.5% of the model" rule of thumb matters because the fraction
 * is not constant: it falls as hidden size grows, so r=16 is 0.52% of an 8B
 * and 0.29% of a 70B.
 */
export function loraParams(model, rank, targetSet) {
	const { hidden, heads, kvHeads, headDim, inter, layers } = model;
	const qDim = heads * headDim;
	const kvDim = kvHeads * headDim;

	// q, k, v, o
	let perLayer =
		rank * (hidden + qDim) + // q_proj
		rank * (hidden + kvDim) + // k_proj
		rank * (hidden + kvDim) + // v_proj
		rank * (qDim + hidden); // o_proj

	if (targetSet === 'all') {
		perLayer +=
			rank * (hidden + inter) + // gate_proj
			rank * (hidden + inter) + // up_proj
			rank * (inter + hidden); // down_proj
	}

	return perLayer * layers;
}

/**
 * Full training report.
 *
 * @param {object} o
 * @param {object} o.model
 * @param {'full'|'lora'|'qlora'} o.method
 * @param {number} o.rank        LoRA rank
 * @param {'all'|'attn'} o.targets
 * @param {number} o.seq         sequence length in tokens
 * @param {number} o.batch       per-device micro-batch
 * @param {number} o.accum       gradient accumulation steps
 * @param {number} o.rows        dataset examples
 * @param {number} o.avgLen      average tokens per example
 * @param {number} o.epochs
 * @param {string} o.optimizer   OPTIMIZERS id
 * @param {boolean} o.checkpoint gradient checkpointing on
 * @param {boolean} o.unsloth    Unsloth kernels
 * @param {boolean} o.packing    pack examples instead of padding to seq
 * @param {object} o.hardware
 * @param {number} o.gpuCount
 * @param {number} o.vramGb
 * @param {'ddp'|'fsdp'} o.parallel
 */
export function trainReport(o) {
	const { model, method, seq, batch, hardware, gpuCount, vramGb } = o;
	const opt = OPT_MAP.get(o.optimizer) ?? OPT_MAP.get('adamw8');

	/* ---------------------------------------------------------- memory --- */

	const baseWeights = model.params * 1e9 * BASE_BYTES[method];
	const trainable = method === 'full' ? model.params * 1e9 : loraParams(model, o.rank, o.targets);

	const gradients = trainable * 2; // bf16
	const optimizer = trainable * opt.bytes;
	// Mixed precision needs an fp32 copy of anything it updates, so the
	// optimizer step does not lose small updates to bf16 rounding. For LoRA
	// that is a rounding error; for a full finetune it is 4 bytes per parameter
	// and it is a large part of why full finetuning costs ~10x the model size.
	const master = trainable * 4;

	// Gradient checkpointing keeps one boundary tensor per layer and recomputes
	// the rest during backward. Unsloth pushes those boundary tensors to system
	// RAM, which is most of its remaining memory advantage.
	const tokensInFlight = seq * batch;
	const savedActivations = o.checkpoint
		? model.layers * tokensInFlight * model.hidden * 2 * (o.unsloth ? 0.6 : 1)
		: model.layers * tokensInFlight * model.hidden * 2 * 14;
	const recomputePeak = o.checkpoint ? tokensInFlight * model.hidden * 2 * 20 : 0;

	// The tensor everyone forgets. Fused cross-entropy never materialises it in
	// full, which is why it is the single biggest memory win available.
	const logits = tokensInFlight * VOCAB * 4 * (o.unsloth ? 0.15 : 1);

	// Sharded parallelism splits the model-sized terms across GPUs; DDP
	// replicates them and only splits the batch.
	const shard = o.parallel === 'fsdp' && gpuCount > 1 ? gpuCount : 1;
	const modelSide = (baseWeights + gradients + optimizer + master) / shard;
	const perStep = savedActivations + recomputePeak + logits;

	const total = (modelSide + perStep + RUNTIME_BASE) * FRAGMENTATION;
	const budget = vramGb * GB * hardware.usableFrac;
	const fits = total <= budget;

	/* ----------------------------------------------------------- speed --- */

	// Backward through a frozen base still needs input gradients (2N) but no
	// weight gradients, so LoRA is 4N rather than 6N. Checkpointing adds one
	// extra forward pass, 2N.
	const flopsPerToken =
		(method === 'full' ? (o.checkpoint ? 8 : 6) : o.checkpoint ? 6 : 4) * model.active * 1e9;

	const mfu = TRAIN_MFU[hardware.kind][o.unsloth ? 'unsloth' : 'stock'];
	const methodSpeed = method === 'qlora' ? QLORA_SPEED : 1;
	const scale = gpuCount > 1 ? gpuCount * DDP_EFFICIENCY : 1;
	const effectiveFlops = hardware.tflops * 1e12 * mfu * methodSpeed * scale;
	const tokensPerSecond = effectiveFlops / flopsPerToken;

	/* ------------------------------------------------------------ work --- */

	// Padding waste. With packing, examples are concatenated into full
	// sequences and nothing is wasted. Without it, every example is padded to
	// the longest one in its batch, so the compute you pay for exceeds the
	// tokens you have. 1.6x is typical for chat-shaped data; a dataset with a
	// long tail is worse, and a length-sorted sampler is better. Padding can
	// never push a row past the sequence length — anything longer is truncated.
	const PAD_WASTE = 1.6;
	const tokensPerRow = o.packing ? Math.min(o.avgLen, seq) : Math.min(seq, o.avgLen * PAD_WASTE);
	const datasetTokens = o.rows * tokensPerRow;
	const totalTokens = datasetTokens * o.epochs;

	const tokensPerStep = seq * batch * o.accum * gpuCount;
	const steps = Math.ceil(totalTokens / tokensPerStep);

	const seconds = fits && tokensPerSecond > 0 ? totalTokens / tokensPerSecond : 0;
	const hours = seconds / 3600;

	const hourly = hardware.rentUsd !== null ? hardware.rentUsd * gpuCount : null;
	const cost = hourly !== null ? hours * hourly : null;

	return {
		// memory
		baseWeights: baseWeights / shard,
		trainable,
		adapterBytes: (gradients + optimizer + master) / shard,
		gradients: gradients / shard,
		optimizer: optimizer / shard,
		master: master / shard,
		activations: savedActivations + recomputePeak,
		logits,
		runtime: RUNTIME_BASE,
		total,
		budget,
		fits,
		headroom: budget - total,
		// work
		datasetTokens,
		totalTokens,
		tokensPerStep,
		steps,
		// speed & cost
		tokensPerSecond,
		seconds,
		hours,
		hourly,
		cost,
		costPerMillionTokens: cost !== null && totalTokens > 0 ? (cost / totalTokens) * 1e6 : null,
		secondsPerStep: tokensPerSecond > 0 ? tokensPerStep / tokensPerSecond : 0,
	};
}

/**
 * Largest micro-batch that still fits, at the current sequence length.
 *
 * Answers the question people actually have after "does it fit": how much
 * headroom did I leave on the table. Linear search rather than a closed form,
 * because the activation terms have a floor and the logits term does not.
 */
export function maxBatch(o) {
	for (let b = 1; b <= 64; b++) {
		if (!trainReport({ ...o, batch: b }).fits) return b - 1;
	}
	return 64;
}
