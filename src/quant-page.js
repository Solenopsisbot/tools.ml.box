import './style.css';
import { initBackground, fillSelect, fillFlatSelect, setText, setHtml, escapeHtml } from './lib/page.js';
import { UrlState, initShareButton } from './lib/urlstate.js';
import { MODEL_GROUPS, resolveModel } from './lib/models.js';
import { CUSTOM_ID, mountCustomFields, decodeCustom, encodeCustom, resolveWithCustom } from './lib/custom-model.js';
import { WEIGHT_QUANTS, QUANTS, KV_MAP } from './lib/quant.js';
import { resolveHardware } from './lib/hardware.js';
import { report } from './lib/calc.js';
import {
	PPL_REFERENCE, FINDINGS, MODERN_PENALTY, referenceRow, RECOMMENDATION_ORDER,
} from './lib/quality.js';
import { gb, parseTokens, formatTokens, clampNum, params, markInvalidTokenInputs } from './lib/format.js';

/**
 * Quantisation quality.
 *
 * The one page on this site built on measurements rather than estimates, so
 * the design rule is different: never interpolate, never extrapolate, and show
 * a dash where the dataset is silent. A plausible-looking number in a table
 * captioned "measured" is worse than an empty cell.
 *
 * URL contract: f reference family · p model · ctx context · vram budget GB
 */

const DEFAULT_FAMILY = 'llama2-7b';
const DEFAULT_MODEL_QUANT = 'llama-3.1-8b';

initBackground();

fillFlatSelect('#family', Object.entries(PPL_REFERENCE), ([id, f]) => ({
	value: id,
	label: `${f.name} — llama.cpp measurements`,
}));
fillSelect('#model', MODEL_GROUPS.map((g) => ({ group: g.group, items: g.models })), (m) => ({
	value: m.id,
	label: m.generic || m.custom ? m.name : `${m.name} · ${params(m.params)}`,
}));

// Injects the custom-architecture fields plus the hidden #cm input that
// carries them as one query parameter. Must run before UrlState so the binding
// below finds #cm in the DOM.
const custom = mountCustomFields('#model');

const state = new UrlState([
	{ key: 'f', el: '#family', default: DEFAULT_FAMILY, decode: (v) => (PPL_REFERENCE[v] ? v : DEFAULT_FAMILY) },
	{ key: 'p', el: '#model', default: DEFAULT_MODEL_QUANT, decode: (v) => (v === CUSTOM_ID ? CUSTOM_ID : resolveModel(v).id) },
	{ key: 'cm', el: '#cm', default: encodeCustom({}), decode: (v) => encodeCustom(decodeCustom(v)) },
	{ key: 'ctx', el: '#ctx', default: 8192, decode: (v) => clampNum(parseTokens(v, 8192), { min: 128, max: 1048576, fallback: 8192 }), encode: formatTokens },
	{ key: 'vram', el: '#vram', default: 24, decode: (v) => clampNum(v, { min: 1, max: 2048, fallback: 24 }) },
]);

/* -------------------------------------------------------------- render --- */

function render() {
	const v = state.values();
	const family = PPL_REFERENCE[v.f];
	const model = resolveWithCustom(resolveModel, v.p, v.cm);

	// The custom fields only exist when the custom entry is selected.
	custom.container.hidden = state.read('p') !== CUSTOM_ID;

	renderLadder(family);
	renderFit(model, v.ctx, v.vram, family);
	renderVerdict(model, v.ctx, v.vram);
	renderFindings();

	setText('#modern-note', MODERN_PENALTY);
	setText('#ladder-caption', `${family.name} — perplexity ${family.baselinePpl.toFixed(4)} at FP16`);
	setText('#fit-caption', `${model.name} at ${formatTokens(v.ctx)} context, ${v.vram} GB budget`);
}

/**
 * Qualitative damage bands.
 *
 * The thresholds are percentage increases over the model's own baseline, and
 * they are judgement calls made once, here, rather than re-argued in prose on
 * every row. 0.5% is inside measurement noise; past 5% the model is visibly
 * a different, worse model.
 */
function damageBand(pctWorse) {
	if (pctWorse < 0.1) return { label: 'none', tone: 'good' };
	if (pctWorse < 0.5) return { label: 'negligible', tone: 'good' };
	if (pctWorse < 1.5) return { label: 'minor', tone: 'good' };
	if (pctWorse < 4) return { label: 'noticeable', tone: 'warn' };
	if (pctWorse < 10) return { label: 'significant', tone: 'warn' };
	return { label: 'severe', tone: 'bad' };
}

const TONE_CLASS = { good: 'mark-yes', warn: '', bad: 'mark-no' };

function renderLadder(family) {
	setHtml(
		'#ladder-rows',
		family.rows
			.map((row) => {
				const ppl = family.baselinePpl + row.pplDelta;
				const pct = (row.pplDelta / family.baselinePpl) * 100;
				const band = damageBand(pct);
				return `
			<tr>
				<td>${escapeHtml(row.label)}</td>
				<td class="num">${ppl.toFixed(4)}</td>
				<td class="num">+${row.pplDelta.toFixed(4)}</td>
				<td class="num">${pct < 0.01 ? '&lt;0.01' : pct.toFixed(2)}%</td>
				<td><span class="${TONE_CLASS[band.tone]}">${band.label}</span></td>
			</tr>`;
			})
			.join(''),
	);
}

/**
 * The user's own model at every quant, sized with the same maths as /vram, and
 * annotated with the measured quality cost where the dataset has one.
 */
function renderFit(model, ctx, vramGb, family) {
	// A generic single-GPU CUDA context, since this page is about the model
	// rather than the card — the budget is the number the user typed.
	const hardware = { ...resolveHardware('rtx-4090'), vram: vramGb, usableFrac: 1 };

	const rows = WEIGHT_QUANTS.filter((q) => q.id !== 'fp32').map((quant) => {
		const r = report({
			model,
			quant,
			kv: KV_MAP.get('fp16'),
			ctx,
			batch: 1,
			hardware,
			gpuCount: 1,
			vramGb,
			splitMode: 'layer',
			ramBandwidth: 0,
		});

		return { quant, r, measured: referenceRow(family, quant.id) };
	});

	setHtml(
		'#fit-rows',
		rows
			.map(({ quant, r, measured }) => {
				let quality = '<span class="mark-no">not measured</span>';
				if (measured) {
					const pct = (measured.pplDelta / family.baselinePpl) * 100;
					const band = damageBand(pct);
					quality = `<span class="${TONE_CLASS[band.tone]}">+${pct.toFixed(2)}%</span>`;
				}
				return `
			<tr>
				<td>${escapeHtml(quant.name)}</td>
				<td class="num">${gb(r.weights)}</td>
				<td class="num">${gb(r.total)}</td>
				<td>${r.fits ? '<span class="mark-yes">✓ yes</span>' : '<span class="mark-no">✕ no</span>'}</td>
				<td class="num">${quality}</td>
			</tr>`;
			})
			.join(''),
	);

	const best = rows.filter((x) => x.r.fits)[0];
	setText(
		'#fit-note',
		best
			? `Quality cost is the measured ${family.name} figure for that format, shown only where the dataset actually covers it — the IQ formats and MXFP4 postdate these runs, so they get a dash rather than a guess. Sizes are computed the same way as on /vram, including the ${gb(rows[0].r.kvBytes)} KV cache at ${formatTokens(ctx)}.`
			: `Nothing fits in ${vramGb} GB at ${formatTokens(ctx)} context — even the smallest quant is over budget. Shorten the context or pick a smaller model.`,
	);
}

function renderVerdict(model, ctx, vramGb) {
	const el = document.querySelector('#verdict');
	const hardware = { ...resolveHardware('rtx-4090'), vram: vramGb, usableFrac: 1 };
	const opts = { model, kv: KV_MAP.get('fp16'), ctx, batch: 1, hardware, gpuCount: 1, vramGb, splitMode: 'layer', ramBandwidth: 0 };

	// Best quality PER BYTE that fits, not highest precision that fits. Q6_K is
	// measured at 0.07% damage and is a third the size of FP16, so recommending
	// FP16 just because it fits would contradict the table directly below.
	const fittingId = RECOMMENDATION_ORDER.find((id) => {
		const quant = QUANTS.get(id);
		return quant && report({ ...opts, quant }).fits;
	});
	const fitting = fittingId ? QUANTS.get(fittingId) : null;

	let tone;
	let title;
	let detail;

	if (!fitting) {
		tone = 'bad';
		title = 'Nothing fits';
		detail = `${model.name} does not fit in ${vramGb} GB at ${formatTokens(ctx)} context at any quantisation level. Shorten the context, quantise the KV cache, or choose a smaller model.`;
	} else if (fitting.bpw >= 6) {
		tone = 'good';
		title = `Take ${fitting.name}`;
		detail = `${fitting.name} fits, and at ${fitting.bpw} bits per weight the measured quality cost is 0.07% — inside the noise of the measurement itself. Going higher costs real memory and buys nothing: FP16 is 2.4× the size for no detectable difference.`;
	} else if (fitting.bpw >= 4.5) {
		tone = 'good';
		title = `Take ${fitting.name}`;
		detail = `${fitting.name} is the best that fits, and it is the standard trade for a reason: roughly 1% quality cost for a 3× memory saving. This is where most people should be.`;
	} else if (fitting.bpw >= 3.5) {
		tone = 'warn';
		title = `${fitting.name} fits, but you are into real losses`;
		detail = `At ${fitting.bpw} bits per weight the measured cost is several percent, and instruction-following degrades faster than perplexity suggests. A smaller model at Q4_K_M is usually the better buy at this point.`;
	} else {
		tone = 'warn';
		title = `Only ${fitting.name} fits — consider a smaller model`;
		detail = `Below about 3.5 bits per weight the quantisation damage outruns the parameter advantage. ${params(model.params)} at ${fitting.name} will generally lose to a genuinely smaller model at Q4_K_M, unless this one is very large — big models have far more redundancy to spend.`;
	}

	el.className = `verdict is-${tone}`;
	setHtml(
		'#verdict-icon',
		tone === 'good'
			? '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
			: tone === 'warn'
				? '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 17h.01"/></svg>'
				: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
	);
	setText('#verdict-title', title);
	setText('#verdict-detail', detail);
}

function renderFindings() {
	setHtml(
		'#findings',
		FINDINGS.map((f) => `<li><strong>${escapeHtml(f.title)}.</strong> ${escapeHtml(f.body)}</li>`).join(''),
	);
}

/* ---------------------------------------------------------------- boot --- */

state.onChange(render);
state.hydrate();
// Visible custom fields are populated from the URL here and on history
// navigation only — never on every render, or editing one fights the keyboard.
custom.sync(decodeCustom(state.read('cm')));
window.addEventListener('popstate', () => custom.sync(decodeCustom(state.read('cm'))));
initShareButton('#share', state);
markInvalidTokenInputs(['#ctx', '#cm-maxCtx']);
render();
