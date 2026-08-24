/**
 * Quantization formats.
 *
 * `bpw` is EFFECTIVE bits per weight measured on real files, not the nominal
 * bit width of the format. The gap matters: q4_K_M is not 4 bits. K-quants
 * store per-block scales and keep some tensors (embeddings, output head, a few
 * attention projections) at higher precision, which is why a "4-bit" GGUF of
 * Llama 3.1 8B is 4.9 GB rather than 4.0 GB. Using the nominal width
 * underestimates every K-quant by 15-20%.
 *
 * Numbers here are file-size / parameter-count over published GGUFs.
 */

export const WEIGHT_QUANTS = [
	{ id: 'fp32', name: 'FP32', bpw: 32, group: 'Full precision', note: 'Almost never used for inference. Listed for training maths.' },
	{ id: 'fp16', name: 'FP16 / BF16', bpw: 16, group: 'Full precision', note: 'Native precision for most released weights.' },
	{ id: 'fp8', name: 'FP8 (E4M3)', bpw: 8, group: '8-bit', note: 'Hardware-accelerated on Ada/Hopper/Blackwell. Near-lossless.' },
	{ id: 'q8', name: 'Q8_0', bpw: 8.5, group: '8-bit', note: 'Effectively lossless. The extra 0.5 bpw is block scales.' },
	{ id: 'int8', name: 'INT8 (GPTQ/AWQ)', bpw: 8.25, group: '8-bit' },
	{ id: 'q6k', name: 'Q6_K', bpw: 6.56, group: '6-bit', note: 'Indistinguishable from FP16 in practice.' },
	{ id: 'q5km', name: 'Q5_K_M', bpw: 5.67, group: '5-bit' },
	{ id: 'q5ks', name: 'Q5_K_S', bpw: 5.52, group: '5-bit' },
	{ id: 'q4km', name: 'Q4_K_M', bpw: 4.83, group: '4-bit', note: 'The default trade. Small, well-understood quality loss.' },
	{ id: 'q4', name: 'Q4_0 / legacy 4-bit', bpw: 4.55, group: '4-bit' },
	{ id: 'awq4', name: 'AWQ / GPTQ 4-bit', bpw: 4.15, group: '4-bit', note: 'Group size 128. What vLLM usually serves.' },
	{ id: 'mxfp4', name: 'MXFP4', bpw: 4.25, group: '4-bit', note: 'Native format for gpt-oss. Blockwise FP4 with shared exponents.' },
	{ id: 'iq4xs', name: 'IQ4_XS', bpw: 4.25, group: '4-bit', note: 'Importance-matrix quant. Beats Q4_0 at a smaller size.' },
	{ id: 'q3km', name: 'Q3_K_M', bpw: 3.91, group: '3-bit', note: 'Noticeable degradation. Usually better to drop a model size.' },
	{ id: 'iq3xxs', name: 'IQ3_XXS', bpw: 3.06, group: '3-bit' },
	{ id: 'q2k', name: 'Q2_K', bpw: 2.63, group: '2-bit', note: 'Last resort. A smaller model at Q4 is almost always better.' },
	{ id: 'iq2xxs', name: 'IQ2_XXS', bpw: 2.06, group: '2-bit', note: 'Only viable on very large models, where redundancy is high.' },
];

export const QUANTS = new Map(WEIGHT_QUANTS.map((q) => [q.id, q]));
export const DEFAULT_QUANT = 'q4km';

/**
 * KV cache element formats.
 *
 * Separate from weight quants because the trade-off is completely different:
 * KV quantization below 8 bits degrades long-context recall specifically,
 * which is exactly what you bought the long context for.
 */
export const KV_QUANTS = [
	{ id: 'fp16', name: 'FP16', bytes: 2, note: 'Default everywhere.' },
	{ id: 'q8', name: 'Q8_0', bytes: 1.0625, note: 'Halves the cache for a barely measurable quality cost. Usually free money.' },
	{ id: 'q5', name: 'Q5_1', bytes: 0.75 },
	{ id: 'q4', name: 'Q4_0', bytes: 0.5625, note: 'Quarters the cache, but degrades long-context recall — the thing you wanted the context for.' },
];

export const KV_MAP = new Map(KV_QUANTS.map((q) => [q.id, q]));
export const DEFAULT_KV = 'fp16';

/** Tolerate `?d=Q4_K_M`, `?d=q4km`, `?d=Q4` and friends. */
export function resolveQuant(value, fallback = DEFAULT_QUANT) {
	if (!value) return QUANTS.get(fallback);
	const key = String(value).trim().toLowerCase().replace(/[_\-.\s]/g, '');
	return QUANTS.get(key) ?? QUANTS.get(fallback);
}

export function resolveKv(value, fallback = DEFAULT_KV) {
	if (!value) return KV_MAP.get(fallback);
	const key = String(value).trim().toLowerCase().replace(/[_\-.\s]/g, '');
	return KV_MAP.get(key) ?? KV_MAP.get(fallback);
}
