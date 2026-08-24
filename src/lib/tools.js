/**
 * The tool registry.
 *
 * Single source of truth for the index page and the header nav. Adding a tool
 * means: a new entry here, a new `.html` at the repo root, and a new entry in
 * `vite.config.js` under `rollupOptions.input`. All three, or the build will
 * quietly ship a page nobody can reach.
 */

export const TOOLS = [
	{
		href: '/vram',
		name: 'VRAM & speed',
		blurb: 'Will this model fit, and how fast will it run? Real attention shapes, honest KV cache, bandwidth-bound throughput.',
		tags: ['inference', 'memory', 'throughput'],
		status: 'live',
	},
	{
		href: '/train',
		name: 'Finetune cost',
		blurb: 'LoRA and QLoRA memory, wall-clock time and rental cost for a given dataset, sequence length and GPU.',
		tags: ['training', 'lora', 'cost'],
		status: 'live',
	},
];

/**
 * Tools that are worth building next, shown on the index as a roadmap.
 *
 * This is a public backlog, not a promise. Anything here that turns out to be
 * a thin wrapper around one division should be folded into an existing tool
 * instead of getting its own page.
 */
export const PLANNED = [
	{
		name: 'Quant quality ladder',
		blurb: 'Perplexity and KL-divergence deltas per quantisation level, so "is Q4 good enough" stops being a vibe.',
	},
	{
		name: 'API price comparison',
		blurb: 'Cost per million tokens across hosted providers for an equivalent model, including cache-hit pricing.',
	},
	{
		name: 'Context cost calculator',
		blurb: 'What a long system prompt actually costs you per request, in money and in time-to-first-token.',
	},
	{
		name: 'Batch throughput planner',
		blurb: 'Concurrent users a given GPU can serve at a target p95 latency — the number that decides whether you self-host.',
	},
	{
		name: 'Tokenizer explorer',
		blurb: 'Paste text, see it split by several tokenizers side by side, with tokens-per-word ratios for non-English scripts.',
	},
	{
		name: 'Multi-GPU planner',
		blurb: 'Given a budget, which combination of cards holds the model you want — and where PCIe bandwidth starts to hurt.',
	},
	{
		name: 'Pretraining compute',
		blurb: 'Chinchilla-optimal token budgets, GPU-hours and cost for training a model from scratch at a target size.',
	},
	{
		name: 'Embedding index sizing',
		blurb: 'RAM and disk for a vector index at a given corpus size, dimension and quantisation, across HNSW and IVF.',
	},
];
