/**
 * Inference memory and speed maths.
 *
 * Everything here is a first-principles estimate with the constants tuned
 * against published llama.cpp / vLLM benchmarks. The two things it gets right
 * that back-of-envelope calculators usually don't:
 *
 *  1. KV cache is computed from the real attention shape — grouped-query head
 *     count, head dim, sliding windows, and MLA latents — not from a
 *     "params x context x fudge" rule. Those features move the answer by
 *     factors of 5-10, not percentages.
 *  2. Decode speed is bandwidth-bound, and includes the KV cache in the bytes
 *     read per token. That is why a model that runs at 120 tok/s empty runs at
 *     60 tok/s once the context is full, which the naive formula never shows.
 *
 * Units: bytes internally, GB (1e9) at the boundary. Storage-vendor gigabytes,
 * not gibibytes, because that is how every GPU spec sheet quotes VRAM.
 */

export const GB = 1e9;

/** Prefill micro-batch. llama.cpp's `n_ubatch` default; vLLM chunks similarly. */
const UBATCH = 512;

/** Peak achievable fraction of theoretical memory bandwidth, by backend. */
const BW_EFFICIENCY = { cuda: 0.85, metal: 0.8, cpu: 0.65 };

/**
 * Model size at which bandwidth efficiency reaches half its ceiling, in GB.
 * Small models never saturate the bus — per-layer kernel launches and
 * synchronisation dominate, so a 0.5B model does not run 20x a 10B model.
 * Calibrated so that a 3090 lands at ~340 tok/s on a 1B and ~120 tok/s on an
 * 8B, both q4, which is where llama.cpp actually sits.
 */
const SATURATION_GB = 1.5;

/**
 * MoE bandwidth derate, by backend.
 *
 * An MoE layer reads only its active experts, but it reads them by gathering
 * scattered rows, which coalesces far worse than a dense sweep. Counting only
 * the active parameters and stopping there overstates a 30B-A3B by roughly 2x
 * against measured llama.cpp and vLLM numbers.
 *
 * The penalty is harsher on CPU: a GPU memory controller is built to absorb
 * scattered reads, a DRAM controller fronting an EPYC is not. Without this,
 * the tool would claim ~15 tok/s for DeepSeek R1 on 12-channel DDR5, where
 * the real figure is single digits.
 */
const MOE_BW_PENALTY = { cuda: 0.6, metal: 0.6, cpu: 0.4 };

/**
 * Fraction of peak DRAM bandwidth a CPU inference run achieves. Lower than a
 * GPU against HBM, but not catastrophically so on a modern core count.
 */
const CPU_BW_FRACTION = 0.7;

/** Achieved fraction of peak FLOPS during prefill, by backend. */
const MFU = { cuda: 0.5, metal: 0.3, cpu: 0.35 };

/** Fixed runtime/driver allocation before a single weight is loaded, in bytes. */
const RUNTIME_BASE = { cuda: 0.6 * GB, metal: 0.3 * GB, cpu: 0.2 * GB };

/**
 * Multi-GPU derating. Both scales must return exactly 1 at n = 1 — a single
 * card is not paying a multi-GPU penalty.
 *
 *   tensor  every card reads its shard simultaneously, so bandwidth scales;
 *           all-reduce traffic between layers eats ~15% of it.
 *   layer   cards run one after another, so a token still waits on the whole
 *           model being read once. Memory scales, throughput does not. Prefill
 *           gets a partial win because micro-batches can overlap stages.
 */
const SPLIT = {
	tensor: {
		bwScale: (n) => (n <= 1 ? 1 : n * 0.85),
		flopScale: (n) => (n <= 1 ? 1 : n * 0.9),
	},
	layer: {
		bwScale: (n) => (n <= 1 ? 1 : 0.97),
		flopScale: (n) => (n <= 1 ? 1 : 1 + (n - 1) * 0.35),
	},
};

/* -------------------------------------------------------------- memory --- */

/**
 * KV cache elements stored per token, summed across all layers.
 *
 * Returns element COUNT, not bytes, so the caller can multiply by whatever the
 * cache dtype costs. Handles the three attention families that actually change
 * the answer:
 *
 *   - MLA (DeepSeek): one compressed latent per token per layer. There is no
 *     separate K and V to store, which is the whole point of the design.
 *   - Sliding-window (Gemma 3, gpt-oss): local layers stop growing once the
 *     context passes the window, so the cache flattens out instead of scaling
 *     linearly. At 128k this is the difference between 80 GB and 8 GB.
 *   - Plain GQA: 2 (K and V) x kvHeads x headDim x ctx, per layer.
 */
export function kvElements(model, ctx) {
	if (model.mla) return model.layers * model.mla * ctx;

	const perLayerPerToken = 2 * model.kvHeads * model.headDim;

	if (model.swa) {
		const { window, every } = model.swa;
		const globalLayers = Math.floor(model.layers / every);
		const localLayers = model.layers - globalLayers;
		const localCtx = Math.min(ctx, window);
		return perLayerPerToken * (globalLayers * ctx + localLayers * localCtx);
	}

	return perLayerPerToken * model.layers * ctx;
}

/** KV cache size in bytes for `batch` concurrent sequences of `ctx` tokens. */
export function kvCacheBytes(model, ctx, batch, kvBytesPerElement) {
	return kvElements(model, ctx) * kvBytesPerElement * batch;
}

/** Weight footprint in bytes at a given effective bits-per-weight. */
export function weightBytes(model, quant) {
	return (model.params * 1e9 * quant.bpw) / 8;
}

/**
 * Everything that is neither weights nor KV: the driver context, prefill
 * activation buffers, the attention mask, and the logits tensor.
 *
 * The activation term is dominated by the prefill micro-batch, not by decode —
 * during decode the activations are a single token wide and effectively free.
 * The `24` multiplier covers the residual stream plus attention and MLP
 * temporaries for a runtime with fused kernels; it is empirical.
 */
export function overheadBytes(model, ctx, batch, hardware, gpuCount) {
	const base = RUNTIME_BASE[hardware.kind] * (hardware.kind === 'cuda' ? gpuCount : 1);
	const ubatch = Math.min(UBATCH, ctx);

	const activations = ubatch * model.hidden * 2 * 24;
	const mask = ubatch * ctx * 2; // only material without flash attention
	const logits = batch * 131072 * 4; // vocab x fp32, one row per sequence

	return base + activations + mask + logits;
}

/* --------------------------------------------------------------- speed --- */

/**
 * Achieved bandwidth fraction for a working set of `bytes`.
 *
 * Saturating a modern memory bus needs a big enough read to amortise launch
 * and sync overhead. A hyperbolic ramp captures this well enough: at
 * SATURATION_GB you get half the ceiling, and by ~10x that you are near it.
 */
function bandwidthEfficiency(bytes, kind, isMoe) {
	const gb = bytes / GB;
	return BW_EFFICIENCY[kind] * (gb / (gb + SATURATION_GB)) * (isMoe ? MOE_BW_PENALTY[kind] : 1);
}

/**
 * Estimate decode throughput in tokens/sec.
 *
 * Decode is memory-bound: every token requires reading the active weights plus
 * the whole KV cache. Divide bytes-read by achieved bandwidth and you have the
 * per-token latency. For MoE models only the active experts are read, which is
 * why a 30B-A3B decodes at roughly 3B speeds.
 *
 * When the model does not fit, the overflow is served from system RAM at DRAM
 * bandwidth. That term dominates immediately and completely — it is normal for
 * a 20% overflow to cost 90% of the speed.
 */
export function decodeSpeed({ activeBytes, kvBytes, hardware, gpuCount, splitMode, gpuFraction, ramBandwidth, isMoe }) {
	const totalBytes = activeBytes + kvBytes;
	if (totalBytes <= 0) return { tps: 0, msPerToken: 0 };

	const eff = bandwidthEfficiency(totalBytes, hardware.kind, isMoe);
	const gpuBw = hardware.bw * SPLIT[splitMode].bwScale(gpuCount) * eff;

	const gpuTime = (totalBytes * gpuFraction) / (gpuBw * GB);
	// CPU-side inference saturates DRAM less well than a GPU saturates HBM.
	const cpuTime = ramBandwidth > 0 ? (totalBytes * (1 - gpuFraction)) / (ramBandwidth * CPU_BW_FRACTION * GB) : Infinity;

	const seconds = gpuTime + (gpuFraction >= 1 ? 0 : cpuTime);
	return { tps: 1 / seconds, msPerToken: seconds * 1000 };
}

/**
 * Estimate prefill throughput in tokens/sec.
 *
 * Prefill is compute-bound: 2 FLOPs per active parameter per token for the
 * forward pass. Sub-8-bit weights carry a dequantisation tax because the
 * tensor cores want 8- or 16-bit operands and something has to unpack them.
 */
export function prefillSpeed({ model, quant, hardware, gpuCount, splitMode, gpuFraction, ramBandwidth }) {
	const dequantTax = quant.bpw < 8 ? 0.9 : 1;
	const gpuFlops = hardware.tflops * 1e12 * MFU[hardware.kind] * SPLIT[splitMode].flopScale(gpuCount) * dequantTax;
	// CPU prefill FLOPS track core count more than DRAM speed, but DRAM speed
	// is the input we have and the two correlate closely across real machines:
	// nobody pairs 12-channel DDR5 with four cores.
	const cpuFlops = ramBandwidth > 0 ? ramBandwidth * 0.023 * 1e12 : 0;

	const flopsPerToken = 2 * model.active * 1e9;
	const blended = gpuFraction * gpuFlops + (1 - gpuFraction) * cpuFlops;
	if (blended <= 0) return { tps: 0 };
	return { tps: blended / flopsPerToken };
}

/* -------------------------------------------------------------- report --- */

/**
 * Full VRAM + speed report for one configuration.
 *
 * @param {object} o
 * @param {object} o.model       from models.js
 * @param {object} o.quant       from quant.js WEIGHT_QUANTS
 * @param {object} o.kv          from quant.js KV_QUANTS
 * @param {number} o.ctx         context length in tokens
 * @param {number} o.batch       concurrent sequences
 * @param {object} o.hardware    from hardware.js
 * @param {number} o.gpuCount    number of identical accelerators
 * @param {number} o.vramGb      per-accelerator memory, GB (user-overridable)
 * @param {'tensor'|'layer'} o.splitMode
 * @param {number} o.ramBandwidth system RAM GB/s, or 0 to forbid offload
 */
export function report(o) {
	const { model, quant, kv, ctx, batch, hardware, gpuCount, vramGb, splitMode, ramBandwidth } = o;

	const weights = weightBytes(model, quant);
	const kvBytes = kvCacheBytes(model, ctx, batch, kv.bytes);
	const overhead = overheadBytes(model, ctx, batch, hardware, gpuCount);
	const total = weights + kvBytes + overhead;

	// Unified-memory machines cannot hand the whole pool to the GPU, and the
	// GTX 970's crippled tail partition is worse than not having it.
	const budget = vramGb * GB * gpuCount * hardware.usableFrac;

	const fits = total <= budget;
	// The overhead is not divisible — it exists whether or not the weights do —
	// so only weights and KV participate in the split.
	const splittable = weights + kvBytes;
	const gpuFraction = fits
		? 1
		: Math.max(0, Math.min(1, (budget - overhead) / splittable));

	const activeBytes = weights * (model.active / model.params);
	const isMoe = model.active < model.params;
	const speedArgs = { activeBytes, hardware, gpuCount, splitMode, gpuFraction, ramBandwidth, isMoe };
	const decode = decodeSpeed({ ...speedArgs, kvBytes });
	const decodeEmpty = decodeSpeed({ ...speedArgs, kvBytes: 0 });
	const prefill = prefillSpeed({ model, quant, hardware, gpuCount, splitMode, gpuFraction, ramBandwidth });

	const runnable = fits || (ramBandwidth > 0 && gpuFraction >= 0);

	return {
		weights,
		kvBytes,
		overhead,
		total,
		budget,
		fits,
		gpuFraction,
		runnable,
		headroom: budget - total,
		decodeTps: runnable ? decode.tps : 0,
		decodeEmptyTps: runnable ? decodeEmpty.tps : 0,
		prefillTps: runnable ? prefill.tps : 0,
		ttftSeconds: runnable && prefill.tps > 0 ? ctx / prefill.tps : 0,
		maxCtx: maxContextThatFits({ ...o, weights, overheadFor: (c) => overheadBytes(model, c, batch, hardware, gpuCount) }),
	};
}

/**
 * Largest power-of-two-ish context that still fits entirely in memory.
 *
 * Binary search rather than division, because sliding-window models have a
 * piecewise-linear cache curve and MLA changes the constant — there is no
 * single "bytes per token" to divide by.
 */
function maxContextThatFits({ model, kv, batch, hardware, gpuCount, vramGb, weights, overheadFor }) {
	const budget = vramGb * GB * gpuCount * hardware.usableFrac;
	const roomFor = (c) => weights + kvCacheBytes(model, c, batch, kv.bytes) + overheadFor(c) <= budget;

	if (!roomFor(1)) return 0;

	let lo = 1;
	// 1M is the reporting ceiling. Past that the answer stops being useful —
	// no open-weight model is trained anywhere near it, and "it fits 1.7M
	// tokens" reads as a bug rather than as headroom.
	let hi = 1024 * 1024;
	if (roomFor(hi)) return hi;

	while (hi - lo > 128) {
		const mid = Math.floor((lo + hi) / 2);
		if (roomFor(mid)) lo = mid;
		else hi = mid;
	}
	// Round down to a whole 1024 so the answer reads as "109k" rather than
	// "112000". Nobody sets a context window to 111,847 tokens, and the extra
	// precision is well inside the model's own error bars.
	return lo >= 1024 ? Math.floor(lo / 1024) * 1024 : lo;
}
