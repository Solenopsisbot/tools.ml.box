/**
 * Hosted API pricing, USD per million tokens.
 *
 * **These go stale.** Provider pricing moves constantly and this is a static
 * file in a static site — there is no price feed, and pretending otherwise
 * would be worse than useless. Two mitigations:
 *
 *   1. Every row carries a `confidence`. `published` means the figure was read
 *      off the provider's own pricing reference. `approximate` means it is a
 *      representative market rate for that class of model, good to maybe ±30%,
 *      and the UI marks it as such rather than rendering it like a quote.
 *   2. The tool has a custom row so anyone can type today's real number in and
 *      get an answer, and the URL captures it.
 *
 * `PRICES_AS_OF` is rendered prominently. Update it whenever you touch a
 * number here, and downgrade a row to `approximate` rather than leaving a
 * stale `published` claim standing.
 *
 * Fields (all USD per million tokens):
 *   in        input tokens
 *   out       output tokens
 *   cacheRead cached input tokens, if the provider offers prompt caching
 *   cacheWrite cost to write to the cache, if charged separately
 *   batch     multiplier for the asynchronous batch tier (0.5 = half price)
 */

export const PRICES_AS_OF = '2026-06-24';

export const PROVIDERS = [
	{
		group: 'Anthropic',
		note: 'First-party API rates. Prompt caching is charged at 1.25x input to write and 0.1x input to read; the Batches API is 50% off. These same rates apply on Microsoft Foundry; Bedrock and Vertex are partner-operated and priced separately.',
		models: [
			p({ id: 'fable-5', name: 'Claude Fable 5', in: 10, out: 50 }),
			p({ id: 'opus-5', name: 'Claude Opus 5', in: 5, out: 25 }),
			p({ id: 'opus-4-8', name: 'Claude Opus 4.8', in: 5, out: 25 }),
			p({ id: 'sonnet-5', name: 'Claude Sonnet 5', in: 3, out: 15 }),
			p({ id: 'sonnet-4-6', name: 'Claude Sonnet 4.6', in: 3, out: 15 }),
			p({ id: 'haiku-4-5', name: 'Claude Haiku 4.5', in: 1, out: 5 }),
		],
	},
	{
		group: 'Other frontier APIs',
		note: 'Representative rates for the frontier tier. Verify against the provider before committing to a budget — this class of pricing changes on a scale of weeks.',
		models: [
			p({ id: 'gpt-5-1', name: 'GPT-5.1', in: 1.25, out: 10, cacheRead: 0.125, confidence: 'approximate' }),
			p({ id: 'gpt-5-1-mini', name: 'GPT-5.1 mini', in: 0.25, out: 2, cacheRead: 0.025, confidence: 'approximate' }),
			p({ id: 'gpt-5-1-nano', name: 'GPT-5.1 nano', in: 0.05, out: 0.4, confidence: 'approximate' }),
			p({ id: 'gemini-3-pro', name: 'Gemini 3 Pro', in: 2, out: 12, confidence: 'approximate' }),
			p({ id: 'gemini-3-flash', name: 'Gemini 3 Flash', in: 0.3, out: 2.5, confidence: 'approximate' }),
		],
	},
	{
		group: 'Hosted open weights',
		note: 'Third-party inference providers (Together, Fireworks, DeepInfra, Groq and similar) serving open-weight models. Prices here track raw compute cost closely, so they are the honest comparison point for a self-hosting decision — and the number to beat.',
		models: [
			p({ id: 'hosted-8b', name: 'Llama 3.1 8B class', in: 0.1, out: 0.1, confidence: 'approximate' }),
			p({ id: 'hosted-32b', name: 'Qwen3 32B class', in: 0.3, out: 0.3, confidence: 'approximate' }),
			p({ id: 'hosted-70b', name: 'Llama 3.3 70B class', in: 0.6, out: 0.6, confidence: 'approximate' }),
			p({ id: 'hosted-gpt-oss-120b', name: 'gpt-oss 120B', in: 0.15, out: 0.6, confidence: 'approximate' }),
			p({ id: 'hosted-deepseek', name: 'DeepSeek V3 / R1', in: 0.3, out: 1.2, confidence: 'approximate' }),
		],
	},
];

function p(cfg) {
	return {
		cacheRead: null,
		cacheWrite: null,
		batch: 0.5,
		confidence: 'published',
		...cfg,
	};
}

// Attach each model's group as we flatten. `/cost` needs it to spot the
// apples-to-oranges case — comparing a self-hosted 8B against a frontier API
// is a capability mismatch, not just a price difference, and the tool should
// say so rather than let the cheaper number speak for itself.
export const PROVIDER_MODELS = new Map(
	PROVIDERS.flatMap((g) => g.models.map((m) => [m.id, { ...m, group: g.group }])),
);
export const DEFAULT_PROVIDER = 'sonnet-5';

export function resolveProvider(value, fallback = DEFAULT_PROVIDER) {
	if (!value) return PROVIDER_MODELS.get(fallback);
	return PROVIDER_MODELS.get(String(value).trim().toLowerCase()) ?? PROVIDER_MODELS.get(fallback);
}

/**
 * Anthropic prompt-cache multipliers, applied against the input rate.
 * Documented as 1.25x to write and 0.1x to read.
 */
export const CACHE_WRITE_MULT = 1.25;
export const CACHE_READ_MULT = 0.1;

/**
 * Monthly cost of a hosted API workload.
 *
 * @param {object} o
 * @param {object} o.provider     a PROVIDERS entry
 * @param {number} o.requests     requests per month
 * @param {number} o.inTokens     input tokens per request
 * @param {number} o.outTokens    output tokens per request
 * @param {number} o.cachedFrac   fraction of input served from prompt cache
 * @param {boolean} o.batchTier   use the asynchronous batch tier
 */
export function apiCost(o) {
	const { provider, requests, inTokens, outTokens, cachedFrac, batchTier } = o;

	// Where a provider has not published a cache-read rate, assume Anthropic's
	// documented 0.1x ratio rather than inventing a provider-specific one. The
	// UI says so. Cache *writes* are ignored: on a workload with a stable
	// prefix the write is amortised across many reads, and modelling it
	// properly needs a hit-rate the user does not have.
	const cacheRate = provider.cacheRead ?? provider.in * CACHE_READ_MULT;

	const cachedInput = inTokens * cachedFrac;
	const freshInput = inTokens - cachedInput;

	const perRequest =
		(freshInput / 1e6) * provider.in +
		(cachedInput / 1e6) * cacheRate +
		(outTokens / 1e6) * provider.out;

	const discount = batchTier ? provider.batch : 1;
	const monthly = perRequest * requests * discount;

	const totalTokens = (inTokens + outTokens) * requests;

	return {
		perRequest: perRequest * discount,
		monthly,
		yearly: monthly * 12,
		totalTokens,
		inputTokens: inTokens * requests,
		outputTokens: outTokens * requests,
		perMillionBlended: totalTokens > 0 ? (monthly / totalTokens) * 1e6 : 0,
		cacheSaving: cachedFrac > 0 ? ((cachedInput / 1e6) * (provider.in - cacheRate) * requests * discount) : 0,
	};
}

/**
 * Self-hosting cost for the same workload.
 *
 * The thing people get wrong here is **utilisation**. A rented GPU bills by
 * the hour whether or not you are sending it work, so the cost per token is
 * not a property of the hardware — it is a property of how busy you keep it. A
 * card at 5% utilisation costs twenty times more per token than the same card
 * at 100%, which is why self-hosting so often loses to an API for bursty or
 * low-volume workloads and wins decisively for steady high-volume ones.
 *
 * @param {object} o
 * @param {number} o.hourlyUsd       rental cost per hour for the whole rig
 * @param {number} o.outputTps       sustained output tokens/sec at the chosen batch
 * @param {number} o.prefillTps      prompt processing tokens/sec
 * @param {number} o.inputTokens     input tokens per month
 * @param {number} o.outputTokens    output tokens per month
 */
export function selfHostCost(o) {
	const { hourlyUsd, outputTps, prefillTps, inputTokens, outputTokens } = o;
	if (!(outputTps > 0) || !(prefillTps > 0) || hourlyUsd === null) return null;

	const HOURS_PER_MONTH = 730;

	// GPU-seconds the workload actually needs, prompt processing included —
	// leaving prefill out understates a RAG-shaped workload badly.
	const decodeSeconds = outputTokens / outputTps;
	const prefillSeconds = inputTokens / prefillTps;
	const busySeconds = decodeSeconds + prefillSeconds;
	const busyHours = busySeconds / 3600;

	// You rent whole hours of a whole machine. Either you keep it up all month
	// (and pay for the idle time) or you keep it exactly as busy as the work
	// requires (which needs traffic that never sleeps, or a cold-start you are
	// willing to eat).
	const alwaysOnCost = hourlyUsd * HOURS_PER_MONTH;
	const perfectUtilisationCost = hourlyUsd * busyHours;
	const utilisation = busyHours / HOURS_PER_MONTH;

	const totalTokens = inputTokens + outputTokens;

	return {
		busyHours,
		utilisation,
		alwaysOnCost,
		perfectUtilisationCost,
		alwaysOnPerMillion: totalTokens > 0 ? (alwaysOnCost / totalTokens) * 1e6 : 0,
		perfectPerMillion: totalTokens > 0 ? (perfectUtilisationCost / totalTokens) * 1e6 : 0,
		// Monthly token volume at which an always-on rig matches the API's rate.
		// Below this the API wins on price alone; above it the rig does.
		breakEvenTokens: (apiPerMillion) => (apiPerMillion > 0 ? (alwaysOnCost / apiPerMillion) * 1e6 : Infinity),
	};
}
