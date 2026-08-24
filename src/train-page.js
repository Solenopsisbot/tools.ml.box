import './style.css';
import {
	initBackground, fillSelect, fillFlatSelect, setText, setHtml, escapeHtml, renderMeter, renderLegend,
} from './lib/page.js';
import { UrlState, initShareButton } from './lib/urlstate.js';
import { MODEL_GROUPS, resolveModel, DEFAULT_MODEL } from './lib/models.js';
import { CUSTOM_ID, mountCustomFields, decodeCustom, encodeCustom, resolveWithCustom } from './lib/custom-model.js';
import { HARDWARE_GROUPS, HARDWARE, resolveHardware } from './lib/hardware.js';
import { trainReport, maxBatch, METHODS, TARGETS, OPTIMIZERS, OPT_MAP } from './lib/train.js';
import { GB } from './lib/calc.js';
import { gb, duration, usd, commas, tps, parseTokens, formatTokens, clampNum, params, markInvalidTokenInputs } from './lib/format.js';

/**
 * Finetune cost calculator.
 *
 * URL contract — public keys, add rather than repurpose:
 *   p  model        m   method (qlora|lora|full)   r    LoRA rank
 *   tg target set   sq  sequence length            bs   per-device batch
 *   ga grad accum   rows dataset examples          len  avg tokens/example
 *   ep epochs       opt optimizer                  gc   gradient checkpointing
 *   un unsloth      pk  packing                    hw   accelerator
 *   vram GB/card    n   card count                 par  ddp|fsdp
 */

const DEFAULT_HW_TRAIN = 'rtx-4090';

initBackground();

fillSelect('#model', MODEL_GROUPS.map((g) => ({ group: g.group, items: g.models })), (m) => ({
	value: m.id,
	label: m.generic || m.custom ? m.name : `${m.name} · ${params(m.params)}`,
}));
fillFlatSelect('#method', METHODS, (m) => ({ value: m.id, label: m.name }));
fillFlatSelect('#targets', TARGETS, (t) => ({ value: t.id, label: t.name }));
fillFlatSelect('#optimizer', OPTIMIZERS, (o) => ({ value: o.id, label: o.name }));
fillSelect('#hw', HARDWARE_GROUPS, (h) => ({ value: h.id, label: `${h.name} · ${h.vram}GB${h.rentUsd !== null ? ` · $${h.rentUsd.toFixed(2)}/h` : ''}` }));

/* --------------------------------------------------------------- state --- */

const hwEl = document.querySelector('#hw');
const vramEl = document.querySelector('#vram');

// Registered before UrlState, so the VRAM field is already updated by the time
// the state machine reads the form. See the same pattern in vram.js.
hwEl.addEventListener('change', () => {
	vramEl.value = String(resolveHardware(hwEl.value, DEFAULT_HW_TRAIN).vram);
});

/** Radio groups carry strings; these two turn "1"/"0" into real booleans. */
const boolDecode = (v) => v === '1' || v === 'true';
const boolEncode = (v) => (v ? '1' : '0');

// Injects the custom-architecture fields plus the hidden #cm input that
// carries them as one query parameter. Must run before UrlState so the binding
// below finds #cm in the DOM.
const custom = mountCustomFields('#model');

const state = new UrlState([
	{ key: 'p', el: '#model', default: DEFAULT_MODEL, decode: (v) => (v === CUSTOM_ID ? CUSTOM_ID : resolveModel(v).id) },
	{ key: 'cm', el: '#cm', default: encodeCustom({}), decode: (v) => encodeCustom(decodeCustom(v)) },
	{ key: 'm', el: '#method', default: 'qlora', decode: (v) => (METHODS.some((x) => x.id === v) ? v : 'qlora') },
	{ key: 'r', el: '#rank', default: 16, decode: (v) => Math.round(clampNum(v, { min: 1, max: 512, fallback: 16 })) },
	{ key: 'tg', el: '#targets', default: 'all', decode: (v) => (v === 'attn' ? 'attn' : 'all') },
	{ key: 'rows', el: '#rows', default: 52000, decode: (v) => Math.round(clampNum(parseTokens(v, 52000), { min: 1, max: 1e9, fallback: 52000 })), encode: (v) => commas(v) },
	{ key: 'len', el: '#avglen', default: 400, decode: (v) => Math.round(clampNum(v, { min: 1, max: 1e6, fallback: 400 })) },
	{ key: 'sq', el: '#seq', default: 2048, decode: (v) => Math.round(clampNum(parseTokens(v, 2048), { min: 64, max: 1048576, fallback: 2048 })), encode: formatTokens },
	{ key: 'ep', el: '#epochs', default: 3, decode: (v) => clampNum(v, { min: 0.1, max: 100, fallback: 3 }) },
	{ key: 'bs', el: '#batch', default: 2, decode: (v) => Math.round(clampNum(v, { min: 1, max: 256, fallback: 2 })) },
	{ key: 'ga', el: '#accum', default: 4, decode: (v) => Math.round(clampNum(v, { min: 1, max: 256, fallback: 4 })) },
	{ key: 'opt', el: '#optimizer', default: 'adamw8', decode: (v) => (OPT_MAP.has(v) ? v : 'adamw8') },
	{ key: 'pk', el: 'packing', radio: true, default: true, decode: boolDecode, encode: boolEncode },
	{ key: 'gc', el: 'gc', radio: true, default: true, decode: boolDecode, encode: boolEncode },
	{ key: 'un', el: 'stack', radio: true, default: true, decode: boolDecode, encode: boolEncode },
	{ key: 'hw', el: '#hw', default: DEFAULT_HW_TRAIN, decode: (v) => resolveHardware(v, DEFAULT_HW_TRAIN).id },
	{ key: 'vram', el: '#vram', default: () => resolveHardware(hwEl.value, DEFAULT_HW_TRAIN).vram, decode: (v) => clampNum(v, { min: 1, max: 2048, fallback: resolveHardware(hwEl.value, DEFAULT_HW_TRAIN).vram }) },
	{ key: 'n', el: '#count', default: 1, decode: (v) => Math.round(clampNum(v, { min: 1, max: 64, fallback: 1 })) },
	{ key: 'par', el: 'parallel', radio: true, default: 'ddp', decode: (v) => (v === 'fsdp' ? 'fsdp' : 'ddp') },
]);


/* -------------------------------------------------------------- inputs --- */

function inputs() {
	const v = state.values();
	const hardware = resolveHardware(v.hw, DEFAULT_HW_TRAIN);
	return {
		model: resolveWithCustom(resolveModel, v.p, v.cm),
		method: v.m,
		rank: v.r,
		targets: v.tg,
		rows: v.rows,
		avgLen: v.len,
		seq: v.sq,
		epochs: v.ep,
		batch: v.bs,
		accum: v.ga,
		optimizer: v.opt,
		packing: v.pk,
		checkpoint: v.gc,
		unsloth: v.un,
		hardware,
		gpuCount: v.n,
		vramGb: v.vram,
		parallel: v.par,
	};
}

function render() {
	const o = inputs();
	const r = trainReport(o);

	// The custom fields only exist when the custom entry is selected.
	custom.container.hidden = state.read('p') !== CUSTOM_ID;

	// LoRA rank and target modules mean nothing for a full finetune.
	document.querySelector('#lora-fields').hidden = o.method === 'full';
	// Sharding only exists once there is more than one card to shard across.
	document.querySelector('#parallel-field').hidden = o.gpuCount < 2;

	setText(
		'#trainable-hint',
		o.method === 'full'
			? ''
			: `${(r.trainable / 1e6).toFixed(1)}M trainable params · ${((r.trainable / (o.model.params * 1e9)) * 100).toFixed(2)}% of the model`,
	);

	renderVerdict(o, r);
	renderStats(o, r);
	renderMemory(o, r);
	renderBreakdown(o, r);
	renderRun(o, r);
	renderHardwareTable(o);
	renderNotes(o, r);
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
	const best = maxBatch(o);

	let tone;
	let title;
	let detail;

	if (r.fits && r.headroom > 2 * GB) {
		tone = 'good';
		title = 'Fits with room to spare';
		detail = `${gb(r.total)} of ${gb(r.budget)} on ${card}. ${gb(r.headroom)} spare — you could run batch ${best} instead of ${o.batch} and finish sooner for the same money.`;
	} else if (r.fits) {
		tone = 'warn';
		title = 'Fits, but it will be tight';
		detail = `${gb(r.total)} of ${gb(r.budget)} on ${card}, with only ${gb(r.headroom)} spare. Peak memory depends on your longest batch, so a single long example can still OOM this at step 400.`;
	} else {
		tone = 'bad';
		title = 'Will not fit';
		detail = `${gb(r.total)} needed against ${gb(r.budget)} on ${card} — over by ${gb(-r.headroom)}. ${suggestions(o, r).join(' ')}`;
	}

	el.className = `verdict is-${tone}`;
	setHtml('#verdict-icon', ICONS[tone]);
	setText('#verdict-title', title);
	setText('#verdict-detail', detail);
}

/** Concrete, ordered fixes for an OOM — cheapest change first. */
function suggestions(o, r) {
	const out = [];
	if (o.batch > 1) out.push(`Drop the batch to ${Math.max(1, Math.floor(o.batch / 2))} and raise grad accum to keep the effective batch.`);
	if (!o.checkpoint) out.push('Turn gradient checkpointing on — it is the single biggest saving available.');
	if (!o.unsloth) out.push('Unsloth’s fused cross-entropy alone would remove most of the logits tensor.');
	if (o.method === 'lora') out.push('Switch to QLoRA to hold the base weights in 4-bit.');
	if (o.method === 'full') out.push('A full finetune needs roughly 10× the model size; LoRA needs closer to 1.2×.');
	if (o.gpuCount > 1 && o.parallel === 'ddp') out.push('DDP replicates the model on every card — switch to FSDP to actually shard it.');
	if (out.length === 0) out.push(`Shorten the sequence length, or move to a card with at least ${Math.ceil(r.total / GB)} GB.`);
	return out.slice(0, 2);
}

/* --------------------------------------------------------------- stats --- */

function renderStats(o, r) {
	setText('#stat-mem', gb(r.total));
	setText('#stat-mem-sub', `${gb(r.budget)} available · ${((r.total / r.budget) * 100).toFixed(0)}% used`);

	setText('#stat-time', r.fits ? duration(r.seconds) : '—');
	setText(
		'#stat-time-sub',
		r.fits
			? `${commas(r.steps)} optimizer steps · ${duration(r.secondsPerStep * o.accum)} each`
			: 'fix the memory first',
	);

	if (!r.fits) {
		setText('#stat-cost', '—');
		setText('#stat-cost-sub', '');
	} else if (r.cost === null) {
		setText('#stat-cost', 'own hardware');
		setText('#stat-cost-sub', 'no rental price for this card — electricity only');
	} else {
		setText('#stat-cost', usd(r.cost));
		setText('#stat-cost-sub', `${usd(r.hourly)}/h × ${r.hours.toFixed(1)} h · ${usd(r.costPerMillionTokens)} per M tokens`);
	}

	setHtml('#stat-tps', `${tps(r.tokensPerSecond)}<span class="stat-unit">tok/s</span>`);
	setText('#stat-tps-sub', `${commas(Math.round(r.totalTokens / 1e6))}M tokens to process in total`);
}

/* --------------------------------------------------------------- meter --- */

/**
 * Memory breakdown slices.
 *
 * Three named categories from the validated categorical palette, in fixed
 * order, plus a neutral residual. The residual is deliberately grey: it is not
 * a fourth thing with an identity, it is everything small enough not to have
 * one, and giving it a hue would imply otherwise.
 */
function slices(r) {
	return [
		{ id: 1, label: 'Base weights', bytes: r.baseWeights },
		{ id: 2, label: 'Activations', bytes: r.activations },
		{ id: 3, label: 'Logits', bytes: r.logits },
		{
			id: 'rest',
			label: 'Optimizer + runtime',
			bytes: Math.max(0, r.total - r.baseWeights - r.activations - r.logits),
		},
	];
}

function renderMemory(o, r) {
	const parts = slices(r);
	const opts = { total: r.total, budget: r.budget, format: gb };

	renderMeter('#meter', parts, opts);
	renderLegend('#legend', parts, opts);

	setText(
		'#meter-desc',
		`Peak training memory ${gb(r.total)} against ${gb(r.budget)} available. ` +
			parts.map((p) => `${p.label} ${gb(p.bytes)}`).join(', ') +
			`. ${r.fits ? `Headroom ${gb(r.headroom)}.` : `Over by ${gb(r.total - r.budget)}.`}`,
	);
	setText('#meter-budget-label', gb(Math.max(r.total, r.budget)));
}

function renderBreakdown(o, r) {
	const opt = OPT_MAP.get(o.optimizer);
	const share = (b) => `${((b / r.total) * 100).toFixed(1)}%`;
	const shardNote = o.parallel === 'fsdp' && o.gpuCount > 1 ? ` ÷ ${o.gpuCount} (FSDP shard)` : '';

	const rows = [
		{
			series: 1,
			name: 'Base weights',
			bytes: r.baseWeights,
			how: `${params(o.model.params)} × ${o.method === 'qlora' ? '0.55 B/param (NF4 + block constants)' : '2 B/param (bf16)'}${shardNote}`,
		},
		{
			series: 2,
			name: 'Activations',
			bytes: r.activations,
			how: o.checkpoint
				? `checkpointed: ${o.model.layers} layer boundaries × ${commas(o.seq * o.batch)} tokens × ${commas(o.model.hidden)} dim${o.unsloth ? ', offloaded to system RAM' : ''}, plus one layer's recompute peak`
				: `no checkpointing: every intermediate for all ${o.model.layers} layers is retained`,
		},
		{
			series: 3,
			name: 'Logits',
			bytes: r.logits,
			how: `${commas(o.seq * o.batch)} tokens × 128k vocab × 4 B fp32${o.unsloth ? ', mostly avoided by fused cross-entropy' : ' — this is what fused cross-entropy removes'}`,
		},
		{
			series: null,
			name: 'Gradients',
			bytes: r.gradients,
			how: `${(r.trainable / 1e6).toFixed(1)}M trainable × 2 B (bf16)${shardNote}`,
		},
		{
			series: null,
			name: 'Optimizer state',
			bytes: r.optimizer,
			how: `${(r.trainable / 1e6).toFixed(1)}M trainable × ${opt.bytes} B — ${opt.name}${shardNote}`,
		},
		{
			series: null,
			name: 'fp32 master weights',
			bytes: r.master,
			how: `${(r.trainable / 1e6).toFixed(1)}M trainable × 4 B, so the optimizer step does not round away small updates${shardNote}`,
		},
		{
			series: null,
			name: 'Runtime',
			bytes: r.runtime,
			how: 'PyTorch, CUDA kernels, cuBLAS workspaces, allocator slack',
		},
	];

	setHtml(
		'#breakdown-rows',
		rows
			.map(
				(row) => `
			<tr>
				<td><span class="cell-swatch"${row.series ? ` data-series="${row.series}"` : ''}></span>${row.name}</td>
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
				<td>includes 5% for allocator fragmentation</td>
			</tr>`,
	);
}

/* ----------------------------------------------------------------- run --- */

function renderRun(o, r) {
	const effectiveBatch = o.batch * o.accum * o.gpuCount;
	const rows = [
		['Dataset', `${commas(o.rows)} examples × ${commas(o.avgLen)} tokens ≈ ${commas(Math.round(r.datasetTokens / 1e6))}M tokens`],
		['Tokens processed', `${commas(Math.round(r.totalTokens / 1e6))}M over ${o.epochs} epoch${o.epochs === 1 ? '' : 's'}${o.packing ? '' : ` (padding inflates this ~1.6×)`}`],
		['Effective batch', `${commas(effectiveBatch)} sequences — ${o.batch} per device × ${o.accum} accumulation${o.gpuCount > 1 ? ` × ${o.gpuCount} devices` : ''}`],
		['Tokens per step', commas(r.tokensPerStep)],
		['Optimizer steps', commas(r.steps)],
		['Time per step', r.fits ? duration(r.secondsPerStep * o.accum) : '—'],
		['Total time', r.fits ? duration(r.seconds) : 'does not fit'],
	];
	setHtml(
		'#run-rows',
		rows.map(([k, v]) => `<tr><th scope="row" class="row-label">${k}</th><td>${v}</td></tr>`).join(''),
	);

	setText(
		'#run-note',
		o.packing
			? 'Packing concatenates examples into full sequences, so nothing is wasted on padding. It changes the loss slightly — examples can share a sequence — which is fine for most SFT and wrong for anything that depends on per-example boundaries.'
			: 'Without packing, every example is padded up to the longest in its batch. The 1.6× assumed here is typical for chat data; a dataset with a long tail of long examples is worse. Sorting by length before batching recovers most of it.',
	);
}

/* ------------------------------------------------------- hardware table --- */

function renderHardwareTable(o) {
	// Only cards you can actually rent — a comparison table of hardware with no
	// price is a comparison of nothing.
	const rentable = [...HARDWARE.values()].filter((h) => h.rentUsd !== null).sort((a, b) => a.rentUsd - b.rentUsd);

	setHtml(
		'#hw-rows',
		rentable
			.map((hardware) => {
				const r = trainReport({ ...o, hardware, vramGb: hardware.vram });
				return `
			<tr class="${hardware.id === o.hardware.id ? 'row-current' : ''}">
				<td>${escapeHtml(hardware.name)}</td>
				<td class="num">${gb(r.total)}</td>
				<td>${r.fits ? '<span class="mark-yes">✓ yes</span>' : '<span class="mark-no">✕ no</span>'}</td>
				<td class="num">${tps(r.tokensPerSecond)} tok/s</td>
				<td class="num">${r.fits ? duration(r.seconds) : '—'}</td>
				<td class="num">${r.fits && r.cost !== null ? usd(r.cost) : '—'}</td>
			</tr>`;
			})
			.join(''),
	);
}

/* --------------------------------------------------------------- notes --- */

function renderNotes(o, r) {
	const notes = [];
	notes.push(METHODS.find((m) => m.id === o.method).note);
	if (o.model.approx) notes.push('This model\u2019s attention shape is reconstructed rather than published; the LoRA parameter count follows from it and is indicative.');
	if (o.model.custom) notes.push('LoRA parameters are counted from the projection shapes you entered, so the MLP intermediate size matters — it drives most of the adapter.');
	if (o.method !== 'full') notes.push(TARGETS.find((t) => t.id === o.targets).note);
	notes.push(OPT_MAP.get(o.optimizer).note);

	if (o.model.active !== o.model.params && o.targets === 'all') {
		notes.push(
			`${o.model.name} is a mixture of experts. Applying LoRA to every expert's MLP is rarely what people do — attention-only is the practical choice, and the parameter count here assumes one shared MLP rather than ${Math.round(o.model.params / o.model.active)}× the experts.`,
		);
	}
	if (o.seq > o.model.maxCtx) {
		notes.push(`Sequence length ${formatTokens(o.seq)} exceeds this model's native ${formatTokens(o.model.maxCtx)} window.`);
	}
	if (o.gpuCount > 1 && o.parallel === 'ddp') {
		notes.push('Under DDP each card holds a full copy, so peak memory per card is unchanged by the count — only throughput scales.');
	}
	if (o.hardware.kind === 'metal') {
		notes.push('Apple silicon training goes through MLX or PyTorch MPS. Both work; neither is close to CUDA on throughput, and Unsloth does not support them — the figures here use the stock multiplier regardless of the toggle.');
	}
	if (!o.checkpoint && r.total > r.budget) {
		notes.push('Gradient checkpointing is off. Turning it on typically cuts activation memory by an order of magnitude for a ~30% throughput cost.');
	}

	setText('#method-note', notes.join(' '));
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
// Visible custom fields are populated from the URL here and on history
// navigation only — never on every render, or editing one fights the keyboard.
custom.sync(decodeCustom(state.read('cm')));
window.addEventListener('popstate', () => custom.sync(decodeCustom(state.read('cm'))));
initShareButton('#share', state);
markInvalidTokenInputs(['#rows', '#seq', '#cm-maxCtx']);
render();
