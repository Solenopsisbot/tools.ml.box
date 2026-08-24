/**
 * The tool registry.
 *
 * Single source of truth for the index page AND the header nav — run
 * `npm run nav` after editing this and every page's <nav> is rewritten from
 * `navLabel` below, so the five copies cannot drift apart.
 *
 * Adding a tool means four things: an entry here, a new `.html` at the repo
 * root, an entry in `vite.config.js` under `rollupOptions.input`, and a URL in
 * `public/sitemap.xml`. Miss one and you ship a page nobody can reach.
 */

export const TOOLS = [
	{
		href: '/vram',
		name: 'VRAM & speed',
		navLabel: 'VRAM',
		blurb: 'Will this model fit, and how fast will it run? Real attention shapes, honest KV cache, bandwidth-bound throughput.',
		tags: ['inference', 'memory', 'throughput'],
	},
	{
		href: '/serve',
		name: 'Batch throughput',
		navLabel: 'Serving',
		blurb: 'How many concurrent users one GPU can serve at a target latency, and what that costs per million tokens.',
		tags: ['serving', 'batching', 'latency'],
	},
	{
		href: '/train',
		name: 'Finetune cost',
		navLabel: 'Finetune',
		blurb: 'LoRA and QLoRA memory, wall-clock time and rental cost for a given dataset, sequence length and GPU.',
		tags: ['training', 'lora', 'cost'],
	},
	{
		href: '/quant',
		name: 'Quantisation quality',
		navLabel: 'Quants',
		blurb: 'The measured perplexity cost of every quantisation level, and when a bigger model at lower precision wins.',
		tags: ['quality', 'gguf', 'measured'],
	},
	{
		href: '/cost',
		name: 'API cost & self-hosting',
		navLabel: 'Cost',
		blurb: 'What a workload costs across hosted providers, and the token volume at which renting a GPU becomes cheaper.',
		tags: ['pricing', 'api', 'break-even'],
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
		name: 'Context cost calculator',
		blurb: 'What a long system prompt actually costs you per request, in money and in time-to-first-token.',
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
