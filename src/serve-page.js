import './style.css';
import {
	initBackground, fillSelect, fillFlatSelect, setText, setHtml, escapeHtml, renderMeter, renderLegend,
} from './lib/page.js';
import { UrlState, initShareButton } from './lib/urlstate.js';
import { MODEL_GROUPS, resolveModel } from './lib/models.js';
import { CUSTOM_ID, mountCustomFields, decodeCustom, encodeCustom, resolveWithCustom } from './lib/custom-model.js';
import { WEIGHT_QUANTS, KV_QUANTS, resolveQuant, resolveKv, DEFAULT_KV } from './lib/quant.js';
import { HARDWARE_GROUPS, resolveHardware } from './lib/hardware.js';
import { serveReport } from './lib/serve.js';
import { GB } from './lib/calc.js';
import { gb, tps, usd, commas, parseTokens, formatTokens, clampNum, params, markInvalidTokenInputs } from './lib/format.js';

/**
 * Batch throughput calculator.
 *
 * URL contract — public keys, add rather than repurpose:
 *   p model · d quant · ctx avg sequence · kv cache dtype
 *   t min tokens/sec per user · hw accelerator · vram GB/card · n card count
 */

const DEFAULT_MODEL_SERVE = 'llama-3.1-8b';
const DEFAULT_HW_SERVE = 'rtx-4090';

initBackground();

fillSelect('#model', MODEL_GROUPS.map((g) => ({ group: g.group, items: g.models })), (m) => ({
	value: m.id,
	label: m.generic || m.custom ? m.name : `${m.name} · ${params(m.params)}`,
}));
fillSelect(
	'#quant',
	WEIGHT_QUANTS.reduce((acc, q) => {
		const last = acc[acc.length - 1];
		if (last && last.group === q.group) last.items.push(q);
		else acc.push({ group: q.group, items: [q] });
		return acc;
	}, []),
	(q) => ({ value: q.id, label: `${q.name} — ${q.bpw} bpw` }),
);
fillFlatSelect('#kv', KV_QUANTS, (q) => ({ value: q.id, label: q.name }));
fillSelect('#hw', HARDWARE_GROUPS, (h) => ({
	value: h.id,
	label: `${h.name} · ${h.vram}GB${h.rentUsd !== null ? ` · $${h.rentUsd.toFixed(2)}/h` : ''}`,
}));

const hwEl = document.querySelector('#hw');
const vramEl = document.querySelector('#vram');
hwEl.addEventListener('change', () => {
	vramEl.value = String(resolveHardware(hwEl.value, DEFAULT_HW_SERVE).vram);
});

// Injects the custom-architecture fields plus the hidden #cm input that
// carries them as one query parameter. Must run before UrlState so the binding
// below finds #cm in the DOM.
const custom = mountCustomFields('#model');

const state = new UrlState([
	{ key: 'p', el: '#model', default: DEFAULT_MODEL_SERVE, decode: (v) => (v === CUSTOM_ID ? CUSTOM_ID : resolveModel(v).id) },
	{ key: 'cm', el: '#cm', default: encodeCustom({}), decode: (v) => encodeCustom(decodeCustom(v)) },
	{ key: 'd', el: '#quant', default: 'q4km', decode: (v) => resolveQuant(v).id },
	{ key: 'ctx', el: '#ctx', default: 4096, decode: (v) => clampNum(parseTokens(v, 4096), { min: 128, max: 1048576, fallback: 4096 }), encode: formatTokens },
	{ key: 'kv', el: '#kv', default: DEFAULT_KV, decode: (v) => resolveKv(v).id },
	{ key: 't', el: '#target', default: 15, decode: (v) => Math.round(clampNum(v, { min: 1, max: 500, fallback: 15 })) },
	{ key: 'hw', el: '#hw', default: DEFAULT_HW_SERVE, decode: (v) => resolveHardware(v, DEFAULT_HW_SERVE).id },
	{ key: 'vram', el: '#vram', default: () => resolveHardware(hwEl.value, DEFAULT_HW_SERVE).vram, decode: (v) => clampNum(v, { min: 1, max: 2048, fallback: resolveHardware(hwEl.value, DEFAULT_HW_SERVE).vram }) },
	{ key: 'n', el: '#count', default: 1, decode: (v) => Math.round(clampNum(v, { min: 1, max: 64, fallback: 1 })) },
]);

/* -------------------------------------------------------------- inputs --- */

function inputs() {
	const v = state.values();
	return {
		model: resolveWithCustom(resolveModel, v.p, v.cm),
		quant: resolveQuant(v.d),
		kv: resolveKv(v.kv),
		ctx: v.ctx,
		targetTps: v.t,
		hardware: resolveHardware(v.hw, DEFAULT_HW_SERVE),
		gpuCount: v.n,
		vramGb: v.vram,
	};
}

function render() {
	const o = inputs();
	const r = serveReport(o);

	// The custom fields only exist when the custom entry is selected.
	custom.container.hidden = state.read('p') !== CUSTOM_ID;

	setText('#quant-bpw', `${o.quant.bpw} bpw`);

	renderVerdict(o, r);
	renderStats(o, r);
	renderMemory(o, r);
	renderLadder(o, r);
}

/* ------------------------------------------------------------- verdict --- */

const ICONS = {
	good: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
	warn: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 17h.01"/></svg>',
	bad: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
};

function renderVerdict(o, r) {
	const el = document.querySelector('#verdict');
	const card = `${o.gpuCount > 1 ? `${o.gpuCount}× ` : ''}${o.hardware.name}`;

	let tone;
	let title;
	let detail;

	if (!r.runnable) {
		tone = 'bad';
		title = 'Cannot serve even one request';
		detail = `The weights alone need ${gb(r.weights)} of a ${gb(r.budget)} budget on ${card}, leaving nothing for a KV cache at ${formatTokens(o.ctx)}. Use a smaller quant, a shorter context, or a bigger card.`;
	} else if (!r.best) {
		tone = 'warn';
		title = `Room for ${r.maxSequences}, but never at ${o.targetTps} tok/s`;
		detail = `Even a single sequence only decodes at ${tps(r.single.perUserTps)} tok/s here, which is below your floor. The model is too large or the card too slow for this latency target — batching cannot fix that, it only trades latency for throughput.`;
	} else if (r.best.batch === r.maxSequences && r.best.perUserTps > o.targetTps * 1.5) {
		tone = 'good';
		title = `${r.maxSequences} concurrent users, memory-limited`;
		detail = `Every one of them still gets ${tps(r.best.perUserTps)} tok/s, comfortably above your ${o.targetTps} floor — so the KV cache runs out before the latency does. A card with more memory, a smaller KV dtype, or a shorter context all buy more users directly.`;
	} else if (r.best.batch === r.maxSequences) {
		tone = 'good';
		title = `${r.maxSequences} concurrent users`;
		detail = `Memory and latency run out at roughly the same point — ${tps(r.best.perUserTps)} tok/s each against a ${o.targetTps} floor. That is a well-balanced configuration; ${tps(r.best.totalTps)} tok/s total is ${r.batchingGain.toFixed(1)}× what serving one at a time would give you.`;
	} else {
		tone = 'warn';
		title = `${r.best.batch} concurrent users, latency-limited`;
		detail = `There is memory for ${r.maxSequences}, but past ${r.best.batch} the per-user rate drops below your ${o.targetTps} tok/s floor. Raising the floor or accepting slower replies would let you use the rest of the cache.`;
	}

	el.className = `verdict is-${tone}`;
	setHtml('#verdict-icon', ICONS[tone]);
	setText('#verdict-title', title);
	setText('#verdict-detail', detail);
}

/* --------------------------------------------------------------- stats --- */

function renderStats(o, r) {
	const best = r.best;

	// When nothing fits, every downstream figure describes a configuration that
	// cannot exist. Show dashes rather than numbers that contradict the verdict.
	if (!r.runnable) {
		setText('#stat-users', '0');
		setText('#stat-users-sub', `one ${formatTokens(o.ctx)} sequence needs ${gb(r.kvPerSeq)} of KV; only ${gb(Math.max(0, r.free))} is free`);
		setHtml('#stat-total', '—<span class="stat-unit">tok/s</span>');
		setText('#stat-total-sub', '');
		setHtml('#stat-user', '—<span class="stat-unit">tok/s</span>');
		setText('#stat-user-sub', '');
		setText('#stat-cost', '—');
		setText('#stat-cost-sub', '');
		return;
	}

	setText('#stat-users', commas(best ? best.batch : 0));
	setText('#stat-users-sub', `${commas(r.maxSequences)} fit in memory · ${gb(r.kvPerSeq)} of KV each`);

	setHtml('#stat-total', `${best ? tps(best.totalTps) : '—'}<span class="stat-unit">tok/s</span>`);
	setText('#stat-total-sub', best ? `${r.batchingGain.toFixed(1)}× the single-stream rate` : '');

	setHtml('#stat-user', `${best ? tps(best.perUserTps) : tps(r.single.perUserTps)}<span class="stat-unit">tok/s</span>`);
	setText(
		'#stat-user-sub',
		best
			? `${tps(r.single.perUserTps)} tok/s when serving one at a time`
			: `single stream — below your ${o.targetTps} tok/s floor`,
	);

	if (best && best.costPerMillion !== null) {
		setText('#stat-cost', usd(best.costPerMillion));
		setText('#stat-cost-sub', `${usd(r.hourly)}/h ÷ ${tps(best.totalTps)} tok/s, card fully busy`);
	} else {
		setText('#stat-cost', best ? 'own hardware' : '—');
		setText('#stat-cost-sub', best ? 'no rental price for this card' : '');
	}
}

/* --------------------------------------------------------------- meter --- */

function renderMemory(o, r) {
	const usedKv = r.best ? r.best.kvTotal : 0;
	const parts = [
		{ id: 1, label: 'Weights', bytes: r.weights },
		{ id: 2, label: 'KV in use', bytes: usedKv },
		{ id: 3, label: 'Runtime', bytes: r.overhead },
		{ id: 'rest', label: 'Unused / reserved', bytes: Math.max(0, r.budget - r.weights - usedKv - r.overhead) },
	];
	const opts = { total: r.budget, budget: r.budget, format: gb };

	renderMeter('#meter', parts, opts);
	renderLegend('#legend', parts, opts);

	setText(
		'#meter-desc',
		`Of ${gb(r.budget)} available: ` + parts.map((p) => `${p.label} ${gb(p.bytes)}`).join(', ') + '.',
	);
	setText('#meter-budget-label', gb(r.budget));

	setText(
		'#ceiling-note',
		`Weights and runtime come off the top, 10% is held back for the paged allocator, and whatever survives is divided by ${gb(r.kvPerSeq)} — the cache one ${formatTokens(o.ctx)} sequence needs. That division is the concurrency ceiling, and on most cards it binds long before compute does.`,
	);
}

/* -------------------------------------------------------------- ladder --- */

function renderLadder(o, r) {
	if (!r.runnable) {
		setHtml('#ladder-rows', '<tr><td colspan="6">No batch size fits — see above.</td></tr>');
		setText(
			'#ladder-note',
			`A single ${formatTokens(o.ctx)} sequence needs ${gb(r.kvPerSeq)} of KV cache and only ${gb(Math.max(0, r.free))} is free after weights and runtime. Shorten the context, quantise the KV cache, or use a card with more memory.`,
		);
		return;
	}

	setHtml(
		'#ladder-rows',
		r.ladder
			.map((row) => {
				const ok = row.perUserTps >= o.targetTps;
				const isBest = r.best && row.batch === r.best.batch;
				return `
			<tr class="${isBest ? 'row-current' : ''}">
				<td>${commas(row.batch)}</td>
				<td class="num">${ok ? tps(row.perUserTps) : `<span class="mark-no">${tps(row.perUserTps)}</span>`}</td>
				<td class="num">${tps(row.totalTps)}</td>
				<td class="num">${gb(row.kvTotal)}</td>
				<td>${escapeHtml(row.boundBy)}</td>
				<td class="num">${row.costPerMillion !== null ? usd(row.costPerMillion) : '—'}</td>
			</tr>`;
			})
			.join(''),
	);

	const crossover = r.ladder.find((row) => row.boundBy === 'compute');
	setText(
		'#ladder-note',
		`Per-user rates below your ${o.targetTps} tok/s floor are dimmed; the highlighted row is the best batch that clears it. ` +
			(crossover
				? `Past ${crossover.batch} concurrent the steps become compute-bound, so adding users starts costing per-user speed roughly one-for-one.`
				: 'Every level here is bandwidth-bound, so total throughput keeps climbing with concurrency — the cache runs out before the FLOPs do.'),
	);
}

/* ---------------------------------------------------------------- boot --- */

// Last statement in the file: render() reaches the const tables above only
// after they are initialised. See the same note in vram.js.
state.onChange(render);
state.hydrate();
// Visible custom fields are populated from the URL here and on history
// navigation only — never on every render, or editing one fights the keyboard.
custom.sync(decodeCustom(state.read('cm')));
window.addEventListener('popstate', () => custom.sync(decodeCustom(state.read('cm'))));
initShareButton('#share', state);
markInvalidTokenInputs(['#ctx', '#cm-maxCtx']);
render();
