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
 *   approx        Set when the parameter counts are solid but the attention
 *                 shape is reconstructed rather than read off a published
 *                 config. The UI says so. Prefer leaving a model out over
 *                 guessing silently — that is what the custom entry is for.
 *   note          Shown in the UI when this model is selected.
 */

/** @type {Array<{group: string, models: object[]}>} */
export const MODEL_GROUPS = [
	{
		group: 'Custom',
		models: [
			// Placeholder shape only. When `?p=custom` is selected the real
			// numbers come from the `cm` parameter via
			// src/lib/custom-model.js — this entry exists so the id resolves,
			// the option appears in every model select, and nothing NaNs if
			// something reads the model before the spec is decoded.
			m({
				id: 'custom', name: 'Custom model…', custom: true,
				params: 8, layers: 32, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128,
				inter: 14336, maxCtx: 131072,
			}),
		],
	},
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
			m({
				id: 'llama-4-scout', name: 'Llama 4 Scout', params: 109, active: 17,
				layers: 48, hidden: 5120, heads: 40, kvHeads: 8, headDim: 128, inter: 8192,
				maxCtx: 10485760, swa: { window: 8192, every: 4 },
				note: 'MoE: 16 experts plus a shared expert, 17B active. Interleaved attention — three chunked-local layers capped at 8192 tokens for every one global NoPE layer, which is what makes the advertised 10M window affordable at all.',
			}),
			m({
				id: 'llama-4-maverick', name: 'Llama 4 Maverick', params: 400, active: 17,
				layers: 48, hidden: 5120, heads: 40, kvHeads: 8, headDim: 128, inter: 8192,
				maxCtx: 1048576, swa: { window: 8192, every: 4 },
				note: 'MoE: 128 experts, 17B active. Same attention layout as Scout, so the KV cache is identical — the extra 290B of weights is all expert capacity.',
			}),
		],
	},
	{
		group: 'Qwen',
		models: [
			m({ id: 'qwen2.5-0.5b', name: 'Qwen2.5 0.5B', params: 0.49, layers: 24, hidden: 896, heads: 14, kvHeads: 2, headDim: 64, maxCtx: 32768, inter: 4864 }),
			m({ id: 'qwen2.5-1.5b', name: 'Qwen2.5 1.5B', params: 1.54, layers: 28, hidden: 1536, heads: 12, kvHeads: 2, headDim: 128, maxCtx: 32768, inter: 8960 }),
			m({ id: 'qwen2.5-3b', name: 'Qwen2.5 3B', params: 3.09, layers: 36, hidden: 2048, heads: 16, kvHeads: 2, headDim: 128, maxCtx: 32768, inter: 11008 }),
			m({ id: 'qwen2.5-7b', name: 'Qwen2.5 7B', params: 7.62, layers: 28, hidden: 3584, heads: 28, kvHeads: 4, headDim: 128, maxCtx: 32768, inter: 18944 }),
			m({ id: 'qwen2.5-14b', name: 'Qwen2.5 14B', params: 14.8, layers: 48, hidden: 5120, heads: 40, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 13824 }),
			m({ id: 'qwen2.5-32b', name: 'Qwen2.5 32B', params: 32.8, layers: 64, hidden: 5120, heads: 40, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 27648 }),
			m({ id: 'qwen2.5-72b', name: 'Qwen2.5 72B', params: 72.7, layers: 80, hidden: 8192, heads: 64, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 29568 }),
			m({ id: 'qwen3-0.6b', name: 'Qwen3 0.6B', params: 0.75, layers: 28, hidden: 1024, heads: 16, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 3072 }),
			m({ id: 'qwen3-1.7b', name: 'Qwen3 1.7B', params: 2.03, layers: 28, hidden: 2048, heads: 16, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 6144 }),
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
			m({
				id: 'qwen3-coder-480b', name: 'Qwen3-Coder 480B-A35B', params: 480, active: 35,
				layers: 62, hidden: 6144, heads: 64, kvHeads: 4, headDim: 128, maxCtx: 262144, inter: 2560,
				note: 'MoE: 160 experts, 8 active. Only 4 KV heads across 62 layers, so the cache stays modest even at 256k — the memory problem here is entirely the 480B of weights.',
			}),
		],
	},
	{
		group: 'Mistral',
		models: [
			m({ id: 'ministral-8b', name: 'Ministral 8B', params: 8.02, layers: 36, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, maxCtx: 32768, inter: 12288 }),
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
				id: 'gemma-3-1b', name: 'Gemma 3 1B', params: 1.0, layers: 26, hidden: 1152,
				heads: 4, kvHeads: 1, headDim: 256, maxCtx: 32768, inter: 6912,
				swa: { window: 512, every: 6 },
				note: 'One KV head and a 512-token window on five of every six layers. The cache is almost free — this is the model to reach for when memory is the binding constraint.',
			}),
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
		group: 'Phi',
		models: [
			m({ id: 'phi-4-mini', name: 'Phi-4-mini 3.8B', params: 3.84, layers: 32, hidden: 3072, heads: 24, kvHeads: 8, headDim: 128, maxCtx: 131072, inter: 8192 }),
			m({ id: 'phi-4', name: 'Phi-4 14B', params: 14.7, layers: 40, hidden: 5120, heads: 40, kvHeads: 10, headDim: 128, maxCtx: 16384, inter: 17920 }),
		],
	},
	{
		group: 'Dense, other',
		models: [
			m({
				id: 'command-a', name: 'Command A 111B', params: 111, layers: 64, hidden: 12288,
				heads: 96, kvHeads: 8, headDim: 128, maxCtx: 262144, inter: 36864,
				swa: { window: 4096, every: 4 }, approx: true,
				note: 'Interleaved sliding-window attention: three local layers capped at 4096 tokens for every full-attention layer.',
			}),
			m({
				id: 'olmo-2-32b', name: 'OLMo 2 32B', params: 32.2, layers: 64, hidden: 5120,
				heads: 40, kvHeads: 40, headDim: 128, maxCtx: 4096, inter: 27648,
				note: 'Full multi-head attention — no grouped-query reduction at all, so the KV cache is 5x a comparable GQA model. Fully open training data, which is the point of it.',
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
				id: 'deepseek-v2-lite', name: 'DeepSeek V2-Lite 16B', params: 15.7, active: 2.4,
				layers: 27, hidden: 2048, heads: 16, kvHeads: 16, headDim: 128, maxCtx: 32768, inter: 1408,
				mla: 576,
				note: 'MLA on a model small enough to run anywhere. 2.4B active parameters make it very fast; 16B of weights still have to be resident.',
			}),
			m({
				id: 'deepseek-v3', name: 'DeepSeek V3 / R1 671B', params: 671, active: 37,
				layers: 61, hidden: 7168, heads: 128, kvHeads: 128, headDim: 128, maxCtx: 131072, inter: 2048,
				mla: 576,
				note: 'Multi-head latent attention compresses KV to a single 576-value latent per token per layer — the cache is ~10x smaller than the shape suggests.',
			}),
			m({
				id: 'kimi-k2', name: 'Kimi K2 1T-A32B', params: 1000, active: 32,
				layers: 61, hidden: 7168, heads: 64, kvHeads: 64, headDim: 128, maxCtx: 131072, inter: 2048,
				mla: 576,
				note: 'A trillion parameters with 32B active, MLA for the cache. The weights are the entire problem: even at 2-bit this needs ~260 GB, so it is a multi-GPU-node or big-unified-memory model only.',
			}),
			m({
				id: 'glm-4.5-air', name: 'GLM-4.5-Air 106B-A12B', params: 106, active: 12,
				layers: 46, hidden: 4096, heads: 96, kvHeads: 8, headDim: 128, maxCtx: 131072, inter: 1408,
				approx: true,
			}),
			m({
				id: 'glm-4.5', name: 'GLM-4.5 355B-A32B', params: 355, active: 32,
				layers: 92, hidden: 5120, heads: 96, kvHeads: 8, headDim: 128, maxCtx: 131072, inter: 1536,
				approx: true,
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
		approx: false,
		custom: false,
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
