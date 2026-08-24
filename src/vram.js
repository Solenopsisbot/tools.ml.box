import './style.css';
import {
	initBackground, fillSelect, fillFlatSelect, setText, setHtml, escapeHtml, renderMeter, renderLegend,
} from './lib/page.js';
import { UrlState, initShareButton } from './lib/urlstate.js';
import { MODEL_GROUPS, resolveModel, DEFAULT_MODEL } from './lib/models.js';
import {
	WEIGHT_QUANTS, KV_QUANTS, resolveQuant, resolveKv, DEFAULT_QUANT, DEFAULT_KV,
} from './lib/quant.js';
import { HARDWARE_GROUPS, RAM_SPEEDS, RAM_MAP, resolveHardware, DEFAULT_HW } from './lib/hardware.js';
import { report, kvCacheBytes, GB } from './lib/calc.js';
import { gb, tps, duration, commas, parseTokens, formatTokens, clampNum, params } from './lib/format.js';

/**
 * VRAM & speed calculator.
 *
 * URL contract — these keys are public and links exist in the wild, so add
 * keys rather than repurposing them:
 *   p     model id           (also accepts a bare size, e.g. `8b`)
 *   d     weight quant id    (`q4km`, tolerates `Q4_K_M`)
 *   ctx   context length     (`32k`, `128k`, or a plain integer)
 *   kv    KV cache dtype
 *   b     concurrent sequences
 *   hw    accelerator id
 *   vram  per-accelerator GB (defaults to whatever `hw` ships with)
 *   n     accelerator count
 *   split `layer` | `tensor`
 *   ram   CPU offload memory speed id
 */

/* ------------------------------------------------------------ populate --- */

initBackground();

fillSelect('#model', MODEL_GROUPS.map((g) => ({ group: g.group, items: g.models })), (m) => ({
	value: m.id,
	label: m.generic ? m.name : `${m.name} · ${params(m.params)}${m.active !== m.params ? ` (${params(m.active)} active)` : ''}`,
}));

fillSelect(
	'#quant',
	// Group the flat quant list by its own `group` field, preserving order.
	WEIGHT_QUANTS.reduce((acc, q) => {
		const last = acc[acc.length - 1];
		if (last && last.group === q.group) last.items.push(q);
		else acc.push({ group: q.group, items: [q] });
		return acc;
	}, []),
	(q) => ({ value: q.id, label: `${q.name} — ${q.bpw} bpw` }),
);

fillFlatSelect('#kv', KV_QUANTS, (q) => ({ value: q.id, label: q.name }));
fillSelect('#hw', HARDWARE_GROUPS, (h) => ({ value: h.id, label: `${h.name} · ${h.vram}GB · ${commas(h.bw)} GB/s` }));
fillFlatSelect('#ram', RAM_SPEEDS, (r) => ({ value: r.id, label: r.name }));

/* --------------------------------------------------------------- state --- */

const hwEl = document.querySelector('#hw');
const vramEl = document.querySelector('#vram');

// Registered BEFORE UrlState binds its own listeners, so that by the time the
// state machine reads the form the VRAM field already holds the new card's
// memory. Picking a 4090 should show 24 GB, not whatever the last card had.
hwEl.addEventListener('change', () => {
	vramEl.value = String(resolveHardware(hwEl.value).vram);
});

const state = new UrlState([
	{ key: 'p', el: '#model', default: DEFAULT_MODEL, decode: (v) => resolveModel(v).id },
	{ key: 'd', el: '#quant', default: DEFAULT_QUANT, decode: (v) => resolveQuant(v).id },
	{ key: 'ctx', el: '#ctx', default: 8192, decode: (v) => clampNum(parseTokens(v, 8192), { min: 128, max: 4194304, fallback: 8192 }), encode: formatTokens },
	{ key: 'kv', el: '#kv', default: DEFAULT_KV, decode: (v) => resolveKv(v).id },
	{ key: 'b', el: '#batch', default: 1, decode: (v) => Math.round(clampNum(v, { min: 1, max: 512, fallback: 1 })) },
	// `hw` must precede `vram`: the VRAM default is read off the selected card.
	{ key: 'hw', el: '#hw', default: DEFAULT_HW, decode: (v) => resolveHardware(v).id },
	{ key: 'vram', el: '#vram', default: () => resolveHardware(hwEl.value).vram, decode: (v) => clampNum(v, { min: 1, max: 2048, fallback: resolveHardware(hwEl.value).vram }) },
	{ key: 'n', el: '#count', default: 1, decode: (v) => Math.round(clampNum(v, { min: 1, max: 64, fallback: 1 })) },
	{ key: 'split', el: 'split', radio: true, default: 'layer', decode: (v) => (v === 'tensor' ? 'tensor' : 'layer') },
	{ key: 'ram', el: '#ram', default: 'none', decode: (v) => (RAM_MAP.has(v) ? v : 'none') },
]);


/* -------------------------------------------------------------- render --- */

function inputs() {
	const v = state.values();
	return {
		model: resolveModel(v.p),
		quant: resolveQuant(v.d),
		kv: resolveKv(v.kv),
		ctx: v.ctx,
		batch: v.b,
		hardware: resolveHardware(v.hw),
		gpuCount: v.n,
		vramGb: v.vram,
		splitMode: v.split,
		ramBandwidth: RAM_MAP.get(v.ram)?.bw ?? 0,
	};
}

function render() {
	const o = inputs();
	const r = report(o);

	// Multi-GPU split only means anything with more than one accelerator, and
	// only on discrete GPUs — a Mac has one pool.
	document.querySelector('#split-field').hidden = o.gpuCount < 2 || o.hardware.kind !== 'cuda';

	setText('#quant-bpw', `${o.quant.bpw} bpw`);
	setText('#ctx-native', `native ${formatTokens(o.model.maxCtx)}`);

	renderVerdict(o, r);
	renderStats(o, r);
	renderMemory(o, r);
	renderBreakdown(o, r);
	renderArchNote(o, r);
	renderQuantLadder(o);
	renderContextLadder(o);
}

/* ------------------------------------------------------------- verdict --- */

const ICONS = {
	good: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
	warn: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 17h.01"/></svg>',
	bad: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
};

function renderVerdict(o, r) {
	const el = document.querySelector('#verdict');
	const hwLabel = `${o.gpuCount > 1 ? `${o.gpuCount}× ` : ''}${o.hardware.name}`;
	const usableNote = o.hardware.usableFrac < 1
		? ` (${gb(r.budget)} usable of ${o.vramGb * o.gpuCount} GB — ${o.hardware.kind === 'metal' ? 'macOS reserves the rest for the system' : 'the rest is unusable'})`
		: '';

	let tone;
	let title;
	let detail;

	if (r.fits && r.headroom > 1.5 * GB) {
		tone = 'good';
		title = 'Fits comfortably';
		detail = `${gb(r.total)} of ${gb(r.budget)} on ${hwLabel}${usableNote}. ${gb(r.headroom)} spare — enough to push context to ${formatTokens(r.maxCtx)}.`;
	} else if (r.fits) {
		tone = 'warn';
		title = 'Fits, but only just';
		detail = `${gb(r.total)} of ${gb(r.budget)} on ${hwLabel}${usableNote}. Only ${gb(r.headroom)} spare — a desktop compositor or a second process will push this over.`;
	} else if (o.ramBandwidth > 0) {
		tone = 'warn';
		title = 'Needs CPU offload';
		detail = `${gb(r.total)} against ${gb(r.budget)} on ${hwLabel}. About ${(r.gpuFraction * 100).toFixed(0)}% stays on the GPU; the rest streams from system RAM at ${o.ramBandwidth} GB/s, which is what drags decode down to ${tps(r.decodeTps)} tok/s.`;
	} else {
		tone = 'bad';
		title = 'Does not fit';
		detail = `${gb(r.total)} against ${gb(r.budget)} on ${hwLabel}${usableNote} — over by ${gb(-r.headroom)}. Drop to a smaller quant, shorten the context, or enable CPU offload to see what that costs.`;
	}

	el.className = `verdict is-${tone}`;
	setHtml('#verdict-icon', ICONS[tone]);
	setText('#verdict-title', title);
	setText('#verdict-detail', detail);
}

/* --------------------------------------------------------------- stats --- */

function renderStats(o, r) {
	setText('#stat-total', gb(r.total));
	setText('#stat-total-sub', `${gb(r.budget)} available · ${((r.total / r.budget) * 100).toFixed(0)}% used`);

	setHtml('#stat-decode', `${tps(r.decodeTps)}<span class="stat-unit">tok/s</span>`);
	setText(
		'#stat-decode-sub',
		r.decodeTps > 0
			? `at ${formatTokens(o.ctx)} context · ${tps(r.decodeEmptyTps)} tok/s with the cache empty`
			: 'needs to fit, or offload, first',
	);

	setHtml('#stat-prefill', `${tps(r.prefillTps)}<span class="stat-unit">tok/s</span>`);
	setText(
		'#stat-prefill-sub',
		r.prefillTps > 0 ? `${duration(r.ttftSeconds)} to first token on a full ${formatTokens(o.ctx)} prompt` : '—',
	);

	setText('#stat-maxctx', r.maxCtx > 0 ? formatTokens(r.maxCtx) : 'none');
}

/* --------------------------------------------------------------- meter --- */

/**
 * Memory breakdown series.
 *
 * Three categories, assigned hues in fixed order from the validated
 * categorical palette. The order never changes and never cycles: weights are
 * always cyan, KV is always violet, overhead is always pink, whatever the
 * relative sizes happen to be.
 */
const SERIES = [
	{ id: 1, key: 'weights', label: 'Weights' },
	{ id: 2, key: 'kvBytes', label: 'KV cache' },
	{ id: 3, key: 'overhead', label: 'Overhead' },
];

function renderMemory(o, r) {
	const parts = SERIES.map((s) => ({ id: s.id, label: s.label, bytes: r[s.key] }));
	const opts = { total: r.total, budget: r.budget, format: gb };

	renderMeter('#meter', parts, opts);
	renderLegend('#legend', parts, opts);

	setText(
		'#meter-desc',
		`Memory use ${gb(r.total)} against a budget of ${gb(r.budget)}. ` +
			parts.map((p) => `${p.label} ${gb(p.bytes)}`).join(', ') +
			`. ${r.fits ? `Headroom ${gb(r.headroom)}.` : `Over budget by ${gb(r.total - r.budget)}.`}`,
	);
	setText('#meter-budget-label', `${gb(Math.max(r.total, r.budget))}${r.fits ? '' : ' (budget marked)'}`);
}

function renderBreakdown(o, r) {
	const share = (b) => `${((b / r.total) * 100).toFixed(1)}%`;
	const kvPerToken = o.ctx > 0 ? r.kvBytes / o.ctx : 0;

	const rows = [
		{
			series: 1,
			name: 'Weights',
			bytes: r.weights,
			how: `${params(o.model.params)} params × ${o.quant.bpw} bits ÷ 8`,
		},
		{
			series: 2,
			name: 'KV cache',
			bytes: r.kvBytes,
			how: o.model.mla
				? `MLA: ${o.model.layers} layers × ${o.model.mla} latent values × ${formatTokens(o.ctx)} × ${o.kv.bytes} B`
				: o.model.swa
					? `${o.model.layers} layers (${Math.floor(o.model.layers / o.model.swa.every)} full, ${o.model.layers - Math.floor(o.model.layers / o.model.swa.every)} windowed at ${o.model.swa.window}) × 2 × ${o.model.kvHeads} KV heads × ${o.model.headDim} dim × ${o.kv.bytes} B`
					: `2 × ${o.model.layers} layers × ${o.model.kvHeads} KV heads × ${o.model.headDim} dim × ${formatTokens(o.ctx)} × ${o.kv.bytes} B${o.batch > 1 ? ` × ${o.batch} seqs` : ''}`,
		},
		{
			series: 3,
			name: 'Overhead',
			bytes: r.overhead,
			how: `${o.hardware.kind === 'cuda' ? 'CUDA context' : o.hardware.kind === 'metal' ? 'Metal runtime' : 'runtime'}, prefill activations, attention mask, logits`,
		},
	];

	setHtml(
		'#breakdown-rows',
		rows
			.map(
				(row) => `
			<tr>
				<td><span class="cell-swatch" data-series="${row.series}"></span>${row.name}</td>
				<td class="num">${gb(row.bytes)}</td>
				<td class="num">${share(row.bytes)}</td>
				<td>${escapeHtml(row.how)}</td>
			</tr>`,
			)
			.join('') +
			`
			<tr>
				<td><strong>Total</strong></td>
				<td class="num"><strong>${gb(r.total)}</strong></td>
				<td class="num">100%</td>
				<td>${kvPerToken > 0 ? `KV costs ${(kvPerToken / 1024).toFixed(1)} KB per token` : ''}</td>
			</tr>`,
	);
}

function renderArchNote(o, r) {
	const notes = [];
	if (o.model.note) notes.push(o.model.note);
	if (o.hardware.note) notes.push(o.hardware.note);
	if (o.quant.note) notes.push(`${o.quant.name}: ${o.quant.note}`);

	if (o.model.nativeQuant && o.quant.bpw > 5) {
		notes.push(
			`${o.model.name} ships natively quantised — asking for ${o.quant.name} does not add precision that was never there, it just makes the file bigger.`,
		);
	}
	if (o.ctx > o.model.maxCtx) {
		notes.push(
			`${formatTokens(o.ctx)} is past this model's native ${formatTokens(o.model.maxCtx)} window. It will run with RoPE scaling, but quality past the trained length degrades.`,
		);
	}
	if (o.model.active !== o.model.params) {
		notes.push(
			`Decode speed uses the ${params(o.model.active)} active parameters, not all ${params(o.model.params)} — that is the MoE trade. At high batch sizes more experts get touched per step and the effective read grows toward the full weight set.`,
		);
	}
	if (o.gpuCount > 1 && o.hardware.kind === 'cuda') {
		notes.push(
			o.splitMode === 'layer'
				? 'Layer split runs one GPU at a time, so memory scales with card count but bandwidth does not — expect roughly single-card decode speed.'
				: 'Tensor parallel reads from every card at once, so decode scales with card count minus all-reduce traffic. It needs a runtime that supports it (vLLM, SGLang, TensorRT-LLM) and ideally NVLink.',
		);
	}

	setText('#arch-note', notes.join(' '));
}

/* -------------------------------------------------------------- ladders --- */

const YES = '<span class="mark-yes">✓ yes</span>';
const NO = '<span class="mark-no">✕ no</span>';

function renderQuantLadder(o) {
	const rows = WEIGHT_QUANTS.filter((q) => q.id !== 'fp32')
		.map((quant) => ({ quant, r: report({ ...o, quant }) }))
		.map(
			({ quant, r }) => `
		<tr class="${quant.id === o.quant.id ? 'row-current' : ''}">
			<td>${escapeHtml(quant.name)}</td>
			<td class="num">${gb(r.weights)}</td>
			<td class="num">${gb(r.total)}</td>
			<td>${r.fits ? YES : NO}</td>
			<td class="num">${r.fits ? tps(r.decodeTps) : '—'}</td>
			<td class="num">${r.maxCtx > 0 ? formatTokens(r.maxCtx) : '—'}</td>
		</tr>`,
		)
		.join('');
	setHtml('#ladder-rows', rows);
}

/** Context steps to tabulate, always including whatever the user picked. */
function contextSteps(ctx) {
	const base = [1024, 4096, 8192, 16384, 32768, 65536, 131072];
	const set = new Set([...base, ctx]);
	return [...set].sort((a, b) => a - b).filter((c) => c <= 1048576);
}

function renderContextLadder(o) {
	const rows = contextSteps(o.ctx)
		.map((ctx) => ({ ctx, r: report({ ...o, ctx }) }))
		.map(
			({ ctx, r }) => `
		<tr class="${ctx === o.ctx ? 'row-current' : ''}">
			<td>${formatTokens(ctx)}</td>
			<td class="num">${gb(r.kvBytes)}</td>
			<td class="num">${gb(r.total)}</td>
			<td>${r.fits ? YES : NO}</td>
			<td class="num">${r.decodeTps > 0 ? tps(r.decodeTps) : '—'}</td>
			<td class="num">${r.ttftSeconds > 0 ? duration(r.ttftSeconds) : '—'}</td>
		</tr>`,
		)
		.join('');
	setHtml('#ctx-rows', rows);

	// One concrete number beats a paragraph of theory about GQA.
	const perToken = kvCacheBytes(o.model, 1024, o.batch, o.kv.bytes) / 1024;
	setText(
		'#ctx-note',
		`This model costs about ${(perToken / 1024).toFixed(1)} KB of KV cache per token at ${o.kv.name}` +
			`${o.batch > 1 ? ` × ${o.batch} concurrent sequences` : ''}` +
			`${o.model.swa ? ', for the first 1024 tokens — after that only the full-attention layers keep growing' : ''}` +
			`. Decode slows as the cache fills because every token read has to sweep the whole thing.`,
	);
}

/* ---------------------------------------------------------------- boot --- */

/**
 * Deliberately the last statement in the file.
 *
 * `render()` reaches the `const` lookup tables declared below its own
 * definition — function declarations hoist, `const` bindings do not. Calling
 * it any earlier in module order throws a temporal-dead-zone error before the
 * page has drawn a single number.
 */
state.onChange(render);
state.hydrate();
initShareButton('#share', state);
render();
