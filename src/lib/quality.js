/**
 * Quantisation quality reference data.
 *
 * IMPORTANT: unlike the rest of this site, these are MEASUREMENTS, not
 * estimates. They are reproduced from llama.cpp's published perplexity runs —
 * the canonical public dataset for quantisation quality, and the one every
 * community comparison traces back to. Do not "improve" a number here from
 * intuition; if a value is wrong, replace it with another measurement and cite
 * where it came from.
 *
 * Perplexity is measured on wikitext-2 at 4096 context. The absolute value is
 * meaningless across models — only the delta from that model's own FP16
 * baseline says anything about quantisation damage, which is why the tables
 * store `pplDelta` rather than raw perplexity.
 *
 * Why LLaMA-2: it is the only family with a complete, consistently-measured
 * ladder across every quantisation level from the llama.cpp k-quants work.
 * Newer models degrade *more* at a given bit width — see MODERN_PENALTY — but
 * no public dataset covers them at comparable rigour, so this tool shows the
 * measured ladder and states the adjustment separately rather than silently
 * baking a guess into a number that looks measured.
 */

/**
 * llama.cpp reference measurements, LLaMA-2 7B and 13B.
 *
 * `pplDelta` is the perplexity increase over that model's own FP16 baseline.
 * Lower is better; anything under ~0.01 is inside run-to-run noise.
 */
export const PPL_REFERENCE = {
	'llama2-7b': {
		name: 'LLaMA-2 7B',
		baselinePpl: 5.9066,
		rows: [
			{ quant: 'q2k', label: 'Q2_K', pplDelta: 0.8698 },
			{ quant: 'q3ks', label: 'Q3_K_S', pplDelta: 0.5505 },
			{ quant: 'q3km', label: 'Q3_K_M', pplDelta: 0.2437 },
			{ quant: 'q3kl', label: 'Q3_K_L', pplDelta: 0.1803 },
			{ quant: 'q4', label: 'Q4_0', pplDelta: 0.2499 },
			{ quant: 'q4ks', label: 'Q4_K_S', pplDelta: 0.1149 },
			{ quant: 'q4km', label: 'Q4_K_M', pplDelta: 0.0535 },
			{ quant: 'q5', label: 'Q5_0', pplDelta: 0.0796 },
			{ quant: 'q5ks', label: 'Q5_K_S', pplDelta: 0.0353 },
			{ quant: 'q5km', label: 'Q5_K_M', pplDelta: 0.0142 },
			{ quant: 'q6k', label: 'Q6_K', pplDelta: 0.0044 },
			{ quant: 'q8', label: 'Q8_0', pplDelta: 0.0004 },
		],
	},
	'llama2-13b': {
		name: 'LLaMA-2 13B',
		baselinePpl: 5.2543,
		rows: [
			{ quant: 'q2k', label: 'Q2_K', pplDelta: 0.6002 },
			{ quant: 'q3ks', label: 'Q3_K_S', pplDelta: 0.349 },
			{ quant: 'q3km', label: 'Q3_K_M', pplDelta: 0.1955 },
			{ quant: 'q3kl', label: 'Q3_K_L', pplDelta: 0.152 },
			{ quant: 'q4', label: 'Q4_0', pplDelta: 0.1653 },
			{ quant: 'q4ks', label: 'Q4_K_S', pplDelta: 0.0902 },
			{ quant: 'q4km', label: 'Q4_K_M', pplDelta: 0.0459 },
			{ quant: 'q5', label: 'Q5_0', pplDelta: 0.0569 },
			{ quant: 'q5ks', label: 'Q5_K_S', pplDelta: 0.0234 },
			{ quant: 'q5km', label: 'Q5_K_M', pplDelta: 0.0088 },
			{ quant: 'q6k', label: 'Q6_K', pplDelta: 0.0028 },
			{ quant: 'q8', label: 'Q8_0', pplDelta: 0.0004 },
		],
	},
};

/**
 * Two robust findings that fall straight out of the tables above, and which
 * decide most real download choices.
 *
 * 1. **Bigger models tolerate quantisation better.** Compare Q2_K: +0.87 ppl on
 *    7B against +0.60 on 13B, on a lower baseline. More parameters means more
 *    redundancy to destroy before behaviour changes. Extrapolating: Q2 on a 70B
 *    is a usable model, Q2 on a 7B is not.
 * 2. **K-quants beat legacy quants at the same size.** Q4_K_S is 3.86 GB and
 *    +0.115; Q4_0 is 3.83 GB and +0.250. Same size, less than half the damage.
 *    There is no reason to download a Q4_0 in 2026.
 */
export const FINDINGS = [
	{
		title: 'Q6_K and above is free',
		body: 'Q6_K costs +0.004 perplexity on a 5.9 baseline — roughly 0.07%, which is inside the noise of the measurement itself. Q8_0 is +0.0004. If a Q6_K fits, there is no quality argument for FP16, only a 2.4x memory bill.',
	},
	{
		title: 'Q4_K_M is the default for a reason',
		body: 'At 4.83 bits per weight it costs +0.054 perplexity, under 1%. That buys a 3.3x memory reduction against FP16. Everything below it starts to cost real capability, and everything above it costs real memory for very little.',
	},
	{
		title: 'A bigger model at Q4 beats a smaller model at Q8',
		body: 'LLaMA-2 13B at Q4_K_M lands at 5.30 perplexity in 8.0 GB. LLaMA-2 7B at Q8_0 lands at 5.91 in 7.2 GB. Same memory, and the bigger quantised model is comfortably ahead. This holds down to about Q3; below that the quantisation damage outruns the parameter advantage.',
	},
	{
		title: 'Never download a legacy quant',
		body: 'Q4_K_S is 3.86 GB for +0.115 perplexity. Q4_0 is 3.83 GB for +0.250. Identical size, more than double the damage. The same holds for Q5_0 against Q5_K_S. Importance-matrix quants (IQ*) push this further at the low end.',
	},
	{
		title: 'Below Q3, buy a smaller model instead',
		body: 'Q2_K costs +0.87 perplexity on a 7B — a different, visibly worse model. On a 70B the same format is merely lossy rather than broken, because there is far more redundancy to spend. The rule: low-bit quants are for models too large to fit any other way, not a way to squeeze a small model smaller.',
	},
];

/**
 * Modern models degrade more at a given bit width than LLaMA-2 did.
 *
 * The mechanism is not controversial: Llama 3 and later are trained on far
 * more tokens per parameter, so the weights carry more information per bit and
 * there is less redundancy for the quantiser to throw away. The community
 * measurements are consistent in direction and inconsistent in magnitude, so
 * this is deliberately a qualitative warning shown in the UI rather than a
 * multiplier applied to the numbers. Do not turn it into a coefficient without
 * a dataset to back it.
 */
export const MODERN_PENALTY =
	'These are LLaMA-2 measurements. Models trained on far more tokens per parameter — Llama 3 onward, Qwen 2.5 onward — degrade noticeably more at the same bit width, because there is less redundancy left to discard. Treat the deltas here as a floor for a modern model, not a prediction, and prefer one step up the ladder (Q5_K_M where you would have taken Q4_K_M) when the memory is there.';

/**
 * Site-wide quant id -> the reference row that measured that exact format.
 *
 * Deliberately ONE-TO-ONE and deliberately incomplete. An earlier version
 * mapped several reference rows onto the same site id (Q4_K_S and Q4_K_M both
 * to `q4km`), and the lookup then returned whichever came first in the array —
 * so the tool reported Q4_K_S's damage under Q4_K_M's name, roughly double the
 * real figure. A format with no exact measurement gets no number at all.
 *
 * Reference rows with no site-wide equivalent (Q3_K_S, Q3_K_L, Q4_K_S, Q5_0)
 * still appear in the measured ladder; they simply have nothing to attach to
 * in the fit table.
 */
export const QUANT_TO_REFERENCE = {
	q2k: 'q2k',
	q3km: 'q3km',
	q4: 'q4',
	q4km: 'q4km',
	q5ks: 'q5ks',
	q5km: 'q5km',
	q6k: 'q6k',
	q8: 'q8',
};

/**
 * Perplexity of a quantised model, for the reference families only.
 * Returns null when the quant is not in the measured ladder — the UI shows a
 * dash rather than an interpolation.
 */
export function referenceRow(family, quantId) {
	const key = QUANT_TO_REFERENCE[quantId];
	if (!key) return null;
	return family.rows.find((r) => r.quant === key) ?? null;
}

/**
 * Recommendation order: best quality per byte first, NOT highest precision
 * first.
 *
 * Straight out of the measurements above. Q6_K costs 0.07% and is a third
 * smaller than FP16, so "FP16 fits, take FP16" is advice this page's own data
 * contradicts. Anything above Q6_K buys nothing measurable.
 */
export const RECOMMENDATION_ORDER = ['q6k', 'q5km', 'q4km', 'iq4xs', 'q3km', 'iq3xxs', 'q2k', 'iq2xxs'];
