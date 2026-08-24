/**
 * Model architecture presets.
 *
 * These are real `config.json` values, not guesses — the KV-cache maths below
 * is only worth doing if the shapes are right, and the shapes vary a lot more
 * than parameter count suggests. Two 8B models can differ 4x in KV footprint
 * purely from `numKvHeads` and `headDim`.
 *
 * Field reference:
 *   id            URL-safe slug. This is what lands in `?p=` — treat it as a
 *                 public contract, don't rename one without a redirect.
 *   params        Total parameters, in billions.
 *   active        Active parameters per token, in billions. Equals `params`
 *                 for dense models; much smaller for MoE.
 *   layers        Number of transformer blocks.
 *   hidden        Model dimension (d_model).
 *   kvHeads       Key/value heads AFTER grouped-query reduction. This is the
 *                 number that drives the KV cache, not `heads`.
 *   headDim       Dimension per head. Often hidden/heads, but NOT always —
 *                 Gemma 3 4B has hidden 2560 across 8 heads of 256.
 *   maxCtx        Native trained context window.
 *   inter         MLP intermediate size (per expert, for MoE). Only used by
 *                 the finetune tool, to count LoRA parameters on the MLP
 *                 projections — which are the bulk of them.
 *   swa           Optional sliding-window attention. `{ window, every }` means
 *                 one in every `every` layers is full-attention and the rest
 *                 are capped at `window` tokens. This is a huge KV saving at
 *                 long context and ignoring it overestimates Gemma 3 by ~5x.
 *   mla           Optional multi-head latent attention (DeepSeek). When set,
 *                 the KV cache is a single compressed latent per token per
 *                 layer of `mla` bytes-worth of elements, not 2*kvHeads*headDim.
 *   nativeQuant   Model ships pre-quantized at this scheme; anything higher
 *                 precision is a lie (gpt-oss is MXFP4 from the factory).
 *   note          Shown in the UI when this model is selected.
 */

/** @type {Array<{group: string, models: object[]}>} */
export const MODEL_GROUPS = [
	{
		group: 'Generic (parameter count only)',
		models: [
			generic('0.5b', 0.5, 24, 896, 2, 64),
			generic('1b', 1, 16, 2048, 8, 64),
			generic('3b', 3, 28, 3072, 8, 128),
			generic('7b', 7, 32, 4096, 8, 128),
			generic('8b', 8, 32, 4096, 8, 128),
			generic('13b', 13, 40, 5120, 40, 128),
			generic('14b', 14, 48, 5120, 8, 128),
			generic('22b', 22, 56, 6144, 8, 128),
			generic('32b', 32, 64, 5120, 8, 128),
			generic('70b', 70, 80, 8192, 8, 128),
			generic('123b', 123, 88, 12288, 8, 128),
			generic('405b', 405, 126, 16384, 8, 128),
		],
	},
	{
		group: 'Llama',
		models: [
			m({ id: 'llama-3.2-1b', name: 'Llama 3.2 1B', params: 1.24, layers: 16, hidden: 2048, heads: 32, kvHeads: 8, headDim: 64, maxCtx: 131072, inter: 8192 }),
			m({ id: 'llama-3.2-3b', name: 'Llama 3.2 3B', params: 3.21, layers: 28, hidden: 3072, heads: 24, kvHeads: 8, headDim: 128, maxCtx: 131072, inter: 8192 }),
			m({ id: 'llama-3.1-8b', name: 'Llama 3.1 8B', params: 8.03, layers: 32, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, maxCtx: 131072, inter: 14336 }),
			m({ id: 'llama-3.3-70b', name: 'Llama 3.3 70B', params: 70.6, layers: 80, hidden: 8192, heads: 64, kvHeads: 8, headDim: 128, maxCtx: 131072, inter: 28672 }),
			m({ id: 'llama-3.1-405b', name: 'Llama 3.1 405B', params: 405.9, layers: 126, hidden: 16384, heads: 128, kvHeads: 8, headDim: 128, maxCtx: 131072, inter: 53248 }),
		],
	},
	{
		group: 'Qwen',
		models: [
			m({ id: 'qwen2.5-0.5b', name: 'Qwen2.5 0.5B', params: 0.49, layers: 24, hidden: 896, heads: 14, kvHeads: 2, headDim: 64, maxCtx: 32768, inter: 4864 }),
			m({ id: 'qwen2.5-1.5b', name: 'Qwen2.5 1.5B', params: 1.54, layers: 28, hidden: 1536, heads: 12, kvHeads: 2, headDim: 128, maxCtx: 32768, inter: 8960 }),
			m({ id: 'qwen2.5-7b', name: 'Qwen2.5 7B', params: 7.62, layers: 28, hidden: 3584, heads: 28, kvHeads: 4, headDim: 128, maxCtx: 32768, inter: 18944 }),
			m({ id: 'qwen2.5-32b', name: 'Qwen2.5 32B', params: 32.8, layers: 64, hidden: 5120, heads: 40, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 27648 }),
			m({ id: 'qwen2.5-72b', name: 'Qwen2.5 72B', params: 72.7, layers: 80, hidden: 8192, heads: 64, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 29568 }),
			m({ id: 'qwen3-4b', name: 'Qwen3 4B', params: 4.02, layers: 36, hidden: 2560, heads: 32, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 9728 }),
			m({ id: 'qwen3-8b', name: 'Qwen3 8B', params: 8.19, layers: 36, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 12288 }),
			m({ id: 'qwen3-14b', name: 'Qwen3 14B', params: 14.8, layers: 40, hidden: 5120, heads: 40, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 17408 }),
			m({ id: 'qwen3-32b', name: 'Qwen3 32B', params: 32.8, layers: 64, hidden: 5120, heads: 64, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 25600 }),
			m({
				id: 'qwen3-30b-a3b', name: 'Qwen3 30B-A3B', params: 30.5, active: 3.3,
				layers: 48, hidden: 2048, heads: 32, kvHeads: 4, headDim: 128, maxCtx: 32768, inter: 768,
				note: 'MoE: 128 experts, 8 active. Weights are 30B but only ~3.3B move per token, so it decodes like a small model and stores like a large one.',
			}),
			m({
				id: 'qwen3-235b-a22b', name: 'Qwen3 235B-A22B', params: 235, active: 22,
				layers: 94, hidden: 4096, heads: 64, kvHeads: 4, headDim: 128, maxCtx: 32768, inter: 1536,
				note: 'MoE: 128 experts, 8 active.',
			}),
		],
	},
	{
		group: 'Mistral',
		models: [
			m({ id: 'mistral-7b', name: 'Mistral 7B v0.3', params: 7.25, layers: 32, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 14336 }),
			m({ id: 'mistral-nemo-12b', name: 'Mistral Nemo 12B', params: 12.2, layers: 40, hidden: 5120, heads: 32, kvHeads: 8, headDim: 128, maxCtx: 131072, inter: 14336 }),
			m({ id: 'mistral-small-24b', name: 'Mistral Small 24B', params: 23.6, layers: 40, hidden: 5120, heads: 32, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 32768 }),
			m({ id: 'mistral-large-123b', name: 'Mistral Large 123B', params: 123, layers: 88, hidden: 12288, heads: 96, kvHeads: 8, headDim: 128, maxCtx: 131072, inter: 28672 }),
		],
	},
	{
		group: 'Gemma',
		models: [
			m({
				id: 'gemma-3-4b', name: 'Gemma 3 4B', params: 4.3, layers: 34, hidden: 2560,
				heads: 8, kvHeads: 4, headDim: 256, maxCtx: 131072, inter: 10240, swa: { window: 1024, every: 6 },
				note: 'Sliding-window attention: 5 of every 6 layers only keep a 1024-token window, so the KV cache barely grows past ~8k.',
			}),
			m({
				id: 'gemma-3-12b', name: 'Gemma 3 12B', params: 12.2, layers: 48, hidden: 3840,
				heads: 16, kvHeads: 8, headDim: 256, maxCtx: 131072, inter: 15360, swa: { window: 1024, every: 6 },
			}),
			m({
				id: 'gemma-3-27b', name: 'Gemma 3 27B', params: 27.4, layers: 62, hidden: 5376,
				heads: 32, kvHeads: 16, headDim: 128, maxCtx: 131072, inter: 21504, swa: { window: 1024, every: 6 },
			}),
		],
	},
	{
		group: 'MoE & frontier open weights',
		models: [
			m({
				id: 'gpt-oss-20b', name: 'gpt-oss 20B', params: 20.9, active: 3.6,
				layers: 24, hidden: 2880, heads: 64, kvHeads: 8, headDim: 64, maxCtx: 131072, inter: 2880,
				swa: { window: 128, every: 2 }, nativeQuant: 'mxfp4',
				note: 'Ships natively in MXFP4 — ~4.25 bits is the real weight precision, so "fp16" here would just be padding zeroes.',
			}),
			m({
				id: 'gpt-oss-120b', name: 'gpt-oss 120B', params: 116.8, active: 5.1,
				layers: 36, hidden: 2880, heads: 64, kvHeads: 8, headDim: 64, maxCtx: 131072, inter: 2880,
				swa: { window: 128, every: 2 }, nativeQuant: 'mxfp4',
				note: 'Ships natively in MXFP4. Fits an 80GB card whole; the 5.1B active params make it decode fast.',
			}),
			m({
				id: 'deepseek-v3', name: 'DeepSeek V3 / R1 671B', params: 671, active: 37,
				layers: 61, hidden: 7168, heads: 128, kvHeads: 128, headDim: 128, maxCtx: 131072, inter: 2048,
				mla: 576,
				note: 'Multi-head latent attention compresses KV to a single 576-value latent per token per layer — the cache is ~10x smaller than the shape suggests.',
			}),
		],
	},
];

/** Dense-model shorthand: everything a generic entry needs, none of the ceremony. */
function generic(id, params, layers, hidden, kvHeads, headDim) {
	return m({
		id,
		name: `Generic ${params}B (dense)`,
		params,
		layers,
		hidden,
		heads: Math.round(hidden / headDim),
		kvHeads,
		headDim,
		maxCtx: 131072,
		// No real config to read: 3.5x hidden is the typical SwiGLU ratio and
		// only affects the LoRA parameter count, which is a small term.
		inter: Math.round(hidden * 3.5),
		generic: true,
	});
}

/** Fill in the derived defaults so every model object has the same shape. */
function m(cfg) {
	return {
		active: cfg.params,
		swa: null,
		mla: null,
		nativeQuant: null,
		inter: Math.round(cfg.hidden * 3.5),
		note: '',
		generic: false,
		...cfg,
	};
}

/** Flat id -> model lookup, built once at module load. */
export const MODELS = new Map(MODEL_GROUPS.flatMap((g) => g.models).map((x) => [x.id, x]));

export const DEFAULT_MODEL = 'llama-3.1-8b';

/**
 * Resolve a `?p=` value to a model.
 *
 * Accepts an exact id, and also tolerates the shapes people actually type:
 * `8B`, `70b`, `llama-3.1-8B`. Falls back to the nearest generic dense model
 * so a typo degrades into a plausible answer rather than a blank page.
 */
export function resolveModel(value) {
	if (!value) return MODELS.get(DEFAULT_MODEL);
	const key = String(value).trim().toLowerCase();
	if (MODELS.has(key)) return MODELS.get(key);

	const num = Number.parseFloat(key.replace(/[^0-9.]/g, ''));
	if (Number.isFinite(num) && num > 0) {
		const generics = MODEL_GROUPS[0].models;
		return generics.reduce((best, cur) =>
			Math.abs(cur.params - num) < Math.abs(best.params - num) ? cur : best,
		);
	}
	return MODELS.get(DEFAULT_MODEL);
}
