/**
 * Continuous-batching throughput maths.
 *
 * The question this answers: how many people can one GPU serve at once before
 * the experience gets bad — which is the number that decides self-host versus
 * API, and it is nothing like the single-stream figure on /vram.
 *
 * The key asymmetry: **weights are read once per step, KV is read per
 * sequence.** At batch 1 a decode step reads the whole model to produce one
 * token, which is why single-stream decode is so bandwidth-inefficient. At
 * batch 32 it reads the same weights to produce 32 tokens. Total throughput
 * therefore climbs steeply with batch size while per-user speed barely moves —
 * until one of three things stops it:
 *
 *   1. **KV memory.** Every concurrent sequence needs its own cache. This is
 *      usually the binding constraint on consumer cards and it is why
 *      long-context serving is so much more expensive than it looks.
 *   2. **Compute.** Once the per-step GEMMs are large enough, the step becomes
 *      FLOP-bound rather than bandwidth-bound and per-user speed starts
 *      dropping roughly linearly with batch size.
 *   3. **Your latency floor.** Below ~10 tokens/sec a chat UI feels broken,
 *      whatever the throughput number says.
 */

import { GB, kvCacheBytes, weightBytes, overheadBytes } from './calc.js';

/** Peak achievable fraction of theoretical memory bandwidth, by backend. */
const BW_EFFICIENCY = { cuda: 0.85, metal: 0.8, cpu: 0.65 };

/**
 * Achieved fraction of peak FLOPS during batched decode.
 *
 * Lower than prefill MFU: decode GEMMs are skinny (batch x hidden against
 * hidden x hidden), so they never reach the arithmetic intensity a long prompt
 * does, even at large batch.
 */
const DECODE_MFU = { cuda: 0.25, metal: 0.15, cpu: 0.05 };

/** MoE expert-gather derate — see the same constant in calc.js. */
const MOE_PENALTY = { cuda: 0.6, metal: 0.6, cpu: 0.4 };

/**
 * Fraction of the KV budget a real server can actually use.
 *
 * vLLM's `gpu_memory_utilization` defaults to 0.90, and on top of that the
 * paged allocator needs slack to avoid preemption thrash under bursty arrival.
 * Sizing to 100% of free memory produces a server that OOMs on the first
 * unlucky minute.
 */
const KV_UTILISATION = 0.9;

/**
 * Throughput at one batch size.
 *
 * @param {object} o
 * @param {object} o.model
 * @param {object} o.quant
 * @param {object} o.kv
 * @param {number} o.ctx      average sequence length, tokens
 * @param {number} o.batch    concurrent sequences decoding
 * @param {object} o.hardware
 * @param {number} o.gpuCount
 * @param {number} o.vramGb
 */
export function throughputAt(o) {
	const { model, hardware, gpuCount, batch } = o;

	const weights = weightBytes(model, o.quant);
	const activeWeights = weights * (model.active / model.params);
	const kvPerSeq = kvCacheBytes(model, o.ctx, 1, o.kv.bytes);

	const isMoe = model.active < model.params;
	const bytesPerStep = activeWeights + batch * kvPerSeq;
	// Efficiency saturates on the per-step read, which is large once batched —
	// so the small-model penalty that dominates single-stream decode mostly
	// disappears here.
	const gbRead = bytesPerStep / GB;
	const eff = BW_EFFICIENCY[hardware.kind] * (gbRead / (gbRead + 1.5)) * (isMoe ? MOE_PENALTY[hardware.kind] : 1);
	const bandwidth = hardware.bw * gpuCount * (gpuCount > 1 ? 0.85 : 1) * eff * GB;

	const memorySeconds = bytesPerStep / bandwidth;

	// Compute side: 2 FLOPs per active parameter per token, batch tokens per step.
	const flops = hardware.tflops * 1e12 * DECODE_MFU[hardware.kind] * gpuCount * (gpuCount > 1 ? 0.9 : 1);
	const computeSeconds = (2 * model.active * 1e9 * batch) / flops;

	const stepSeconds = Math.max(memorySeconds, computeSeconds);

	return {
		stepSeconds,
		perUserTps: 1 / stepSeconds,
		totalTps: batch / stepSeconds,
		kvPerSeq,
		kvTotal: kvPerSeq * batch,
		boundBy: computeSeconds > memorySeconds ? 'compute' : 'bandwidth',
	};
}

/**
 * How many concurrent sequences the KV cache has room for.
 *
 * Weights and runtime overhead come off the top; whatever is left is divided
 * by the per-sequence cache. On a 24 GB card serving an 8B at 32k context this
 * is usually a single-digit number, which surprises people.
 */
export function concurrencyCeiling(o) {
	const { model, hardware, gpuCount, vramGb } = o;
	const weights = weightBytes(model, o.quant);
	const overhead = overheadBytes(model, o.ctx, 1, hardware, gpuCount);
	const budget = vramGb * GB * gpuCount * hardware.usableFrac;

	const free = (budget - weights - overhead) * KV_UTILISATION;
	const kvPerSeq = kvCacheBytes(model, o.ctx, 1, o.kv.bytes);

	return {
		budget,
		weights,
		overhead,
		free,
		kvPerSeq,
		maxSequences: free > 0 && kvPerSeq > 0 ? Math.floor(free / kvPerSeq) : 0,
	};
}

/**
 * Batch sizes worth tabulating. Doubling is the right granularity here.
 *
 * Returns EMPTY when not even one sequence fits. An earlier version clamped
 * the ceiling to `max(1, maxSequences)` so the ladder always had a batch-1
 * row — which meant an unservable configuration still reported a throughput
 * and a cost per token, directly contradicting its own verdict.
 */
export function batchLadder(maxSequences) {
	if (maxSequences < 1) return [];
	const steps = [1, 2, 4, 8, 16, 32, 64, 128, 256];
	const usable = steps.filter((b) => b <= maxSequences);
	// Always show the ceiling itself, since that is the interesting number.
	if (!usable.includes(maxSequences)) usable.push(maxSequences);
	return usable.sort((a, b) => a - b);
}

/**
 * Full serving report.
 *
 * `targetTps` is the per-user speed below which the experience is considered
 * unacceptable. Human reading speed is roughly 5-8 tokens/sec, so 10 is a
 * defensible floor for chat and 30+ is what feels genuinely fast.
 */
export function serveReport(o) {
	const ceiling = concurrencyCeiling(o);

	const ladder = batchLadder(ceiling.maxSequences).map((batch) => ({
		batch,
		...throughputAt({ ...o, batch }),
	}));

	// Best batch that still clears the latency floor. Throughput rises with
	// batch, so the largest acceptable batch is always the best one.
	const acceptable = ladder.filter((r) => r.perUserTps >= o.targetTps);
	const best = acceptable.length ? acceptable[acceptable.length - 1] : null;

	// Only meaningful when a single sequence actually fits; otherwise it is a
	// number describing a configuration that cannot exist.
	const runnable = ceiling.maxSequences >= 1;
	const single = runnable ? throughputAt({ ...o, batch: 1 }) : null;

	// Cost per million output tokens, if this card is rentable. The whole
	// point of batching is that this number falls as concurrency rises.
	const hourly = o.hardware.rentUsd !== null ? o.hardware.rentUsd * o.gpuCount : null;
	const costPerMillion = (tps) => (hourly !== null && tps > 0 ? (hourly / 3600 / tps) * 1e6 : null);

	return {
		...ceiling,
		ladder: ladder.map((r) => ({ ...r, costPerMillion: costPerMillion(r.totalTps) })),
		best: best ? { ...best, costPerMillion: costPerMillion(best.totalTps) } : null,
		single,
		hourly,
		// The headline: how much throughput batching buys over serving one at a time.
		batchingGain: best && single ? best.totalTps / single.totalTps : 1,
		runnable,
	};
}
