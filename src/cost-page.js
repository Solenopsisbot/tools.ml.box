import './style.css';
import { initBackground, fillSelect, fillFlatSelect, setText, setHtml, escapeHtml } from './lib/page.js';
import { UrlState, initShareButton } from './lib/urlstate.js';
import { MODEL_GROUPS, resolveModel } from './lib/models.js';
import { CUSTOM_ID, mountCustomFields, decodeCustom, encodeCustom, resolveWithCustom } from './lib/custom-model.js';
import { WEIGHT_QUANTS, resolveQuant, KV_MAP } from './lib/quant.js';
import { HARDWARE_GROUPS, HARDWARE, resolveHardware } from './lib/hardware.js';
import { serveReport } from './lib/serve.js';
import { report } from './lib/calc.js';
import {
	PROVIDERS, PROVIDER_MODELS, resolveProvider, apiCost, selfHostCost, PRICES_AS_OF, DEFAULT_PROVIDER,
} from './lib/providers.js';
import { usd, commas, tps, duration, parseTokens, clampNum, params, formatTokens, markInvalidTokenInputs } from './lib/format.js';

/**
 * API cost and the self-hosting crossover.
 *
 * URL contract: api provider model · req requests/month · in / out tokens per
 * request · c cached input percent · b batch tier · p self-host model ·
 * d quant · hw GPU
 */

const DEFAULT_SELF_MODEL = 'llama-3.1-8b';
const DEFAULT_SELF_HW = 'rtx-4090';

/** Serving context assumed for the self-host throughput estimate. */
const SERVE_CTX = 4096;

initBackground();

fillSelect('#provider', PROVIDERS.map((g) => ({ group: g.group, items: g.models })), (m) => ({
	value: m.id,
	label: `${m.name} — $${m.in}/$${m.out}${m.confidence === 'approximate' ? ' (approx)' : ''}`,
}));
fillSelect('#model', MODEL_GROUPS.map((g) => ({ group: g.group, items: g.models })), (m) => ({
	value: m.id,
	label: m.generic || m.custom ? m.name : `${m.name} · ${params(m.params)}`,
}));
fillFlatSelect('#quant', WEIGHT_QUANTS.filter((q) => q.id !== 'fp32'), (q) => ({ value: q.id, label: q.name }));
// Only rentable cards: a self-hosting cost comparison against a card with no
// price is a comparison against nothing.
fillSelect(
	'#hw',
	HARDWARE_GROUPS.map((g) => ({ group: g.group, items: g.items.filter((h) => h.rentUsd !== null) })).filter((g) => g.items.length),
	(h) => ({ value: h.id, label: `${h.name} · $${h.rentUsd.toFixed(2)}/h` }),
);

// Injects the custom-architecture fields plus the hidden #cm input that
// carries them as one query parameter. Must run before UrlState so the binding
// below finds #cm in the DOM.
const custom = mountCustomFields('#model');

const state = new UrlState([
	{ key: 'api', el: '#provider', default: DEFAULT_PROVIDER, decode: (v) => resolveProvider(v).id },
	{ key: 'req', el: '#requests', default: 100000, decode: (v) => Math.round(clampNum(parseTokens(v, 100000), { min: 1, max: 1e10, fallback: 100000 })), encode: (v) => commas(v) },
	{ key: 'in', el: '#intok', default: 2048, decode: (v) => Math.round(clampNum(parseTokens(v, 2048), { min: 1, max: 2e6, fallback: 2048 })), encode: formatTokens },
	{ key: 'out', el: '#outtok', default: 512, decode: (v) => Math.round(clampNum(parseTokens(v, 512), { min: 1, max: 2e6, fallback: 512 })), encode: formatTokens },
	{ key: 'c', el: '#cached', default: 0, decode: (v) => Math.round(clampNum(v, { min: 0, max: 95, fallback: 0 })) },
	{ key: 'b', el: 'tier', radio: true, default: false, decode: (v) => v === '1', encode: (v) => (v ? '1' : '0') },
	{ key: 'p', el: '#model', default: DEFAULT_SELF_MODEL, decode: (v) => (v === CUSTOM_ID ? CUSTOM_ID : resolveModel(v).id) },
	{ key: 'cm', el: '#cm', default: encodeCustom({}), decode: (v) => encodeCustom(decodeCustom(v)) },
	{ key: 'd', el: '#quant', default: 'q4km', decode: (v) => resolveQuant(v).id },
	{ key: 'hw', el: '#hw', default: DEFAULT_SELF_HW, decode: (v) => {
		const h = resolveHardware(v, DEFAULT_SELF_HW);
		// Guard against a link naming a card that has no rental price and so is
		// not in this page's select at all.
		return h.rentUsd !== null ? h.id : DEFAULT_SELF_HW;
	} },
]);

/* -------------------------------------------------------------- compute --- */

function inputs() {
	const v = state.values();
	return {
		provider: resolveProvider(v.api),
		requests: v.req,
		inTokens: v.in,
		outTokens: v.out,
		cachedFrac: v.c / 100,
		batchTier: v.b,
		model: resolveWithCustom(resolveModel, v.p, v.cm),
		quant: resolveQuant(v.d),
		hardware: resolveHardware(v.hw, DEFAULT_SELF_HW),
	};
}

/**
 * Self-hosted throughput for this model on this card.
 *
 * Uses the batched serving figure, not the single-stream one — a server that
 * handled requests one at a time would understate a real deployment by an
 * order of magnitude, and nobody serves that way.
 */
function selfHostThroughput(o) {
	const serve = serveReport({
		model: o.model,
		quant: o.quant,
		kv: KV_MAP.get('fp16'),
		ctx: SERVE_CTX,
		hardware: o.hardware,
		gpuCount: 1,
		vramGb: o.hardware.vram,
		targetTps: 10,
	});
	const single = report({
		model: o.model,
		quant: o.quant,
		kv: KV_MAP.get('fp16'),
		ctx: SERVE_CTX,
		batch: 1,
		hardware: o.hardware,
		gpuCount: 1,
		vramGb: o.hardware.vram,
		splitMode: 'layer',
		ramBandwidth: 0,
	});
	return {
		serve,
		fits: single.fits,
		outputTps: serve.best ? serve.best.totalTps : 0,
		prefillTps: single.prefillTps,
		batch: serve.best ? serve.best.batch : 0,
	};
}

function render() {
	const o = inputs();
	const api = apiCost(o);
	const th = selfHostThroughput(o);
	const self = th.fits
		? selfHostCost({
				hourlyUsd: o.hardware.rentUsd,
				outputTps: th.outputTps,
				prefillTps: th.prefillTps,
				inputTokens: api.inputTokens,
				outputTokens: api.outputTokens,
			})
		: null;

	// The custom fields only exist when the custom entry is selected.
	custom.container.hidden = state.read('p') !== CUSTOM_ID;

	setText('#cached-hint', `${o.cachedFrac * 100}%`);

	renderVerdict(o, api, self, th);
	renderStats(o, api, self, th);
	renderProviders(o, api);
	renderSelf(o, api, self, th);

	setText(
		'#prices-note',
		`Prices as of ${PRICES_AS_OF}, USD per million tokens. Anthropic rows are first-party published rates; everything marked "approx" is a representative market rate for that class of model rather than a quote, and all of it moves. Cached input is charged at each provider's published cache rate where there is one, and at the 0.1× ratio otherwise.`,
	);
}

/* ------------------------------------------------------------- verdict --- */

const ICONS = {
	good: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
	warn: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 17h.01"/></svg>',
	bad: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
};

function renderVerdict(o, api, self, th) {
	const el = document.querySelector('#verdict');
	let tone;
	let title;
	let detail;

	if (!th.fits) {
		tone = 'warn';
		title = 'The API wins by default here';
		detail = `${o.model.name} at ${o.quant.name} does not fit on a ${o.hardware.name}, so there is no self-hosted option to compare against. ${usd(api.monthly)}/month on ${o.provider.name} is what this workload costs. Pick a smaller model or a bigger card to see the alternative.`;
	} else if (self.alwaysOnCost < api.monthly) {
		tone = 'good';
		title = `Self-hosting wins — ${usd(api.monthly - self.alwaysOnCost)}/month cheaper`;
		detail = `A ${o.hardware.name} running around the clock costs ${usd(self.alwaysOnCost)}/month against ${usd(api.monthly)} on ${o.provider.name}, and the workload only keeps it ${(self.utilisation * 100).toFixed(0)}% busy — so there is headroom to grow into. This counts the GPU and nothing else.${capabilityCaveat(o)}`;
	} else {
		const breakEven = self.breakEvenTokens(api.perMillionBlended);
		tone = 'warn';
		title = `The API wins at this volume`;
		detail = `${usd(api.monthly)}/month on ${o.provider.name} against ${usd(self.alwaysOnCost)} for an always-on ${o.hardware.name}, which this workload keeps only ${(self.utilisation * 100).toFixed(1)}% busy. You would need roughly ${commas(Math.round(breakEven / 1e6))}M tokens a month — about ${(breakEven / api.totalTokens).toFixed(1)}× your current volume — before the rig pays for itself.${capabilityCaveat(o)}`;
	}

	el.className = `verdict is-${tone}`;
	setHtml('#verdict-icon', ICONS[tone]);
	setText('#verdict-title', title);
	setText('#verdict-detail', detail);
}

/**
 * Flag the apples-to-oranges comparison.
 *
 * The arithmetic will happily tell you that a rented 4090 running an 8B is
 * cheaper than a frontier API, and it is — but they are not the same product,
 * and a cost tool that stays silent about that is quietly giving bad advice.
 * Only fires when the mismatch is real: a small open model against a frontier
 * tier, not against another hosted open-weight model.
 */
function capabilityCaveat(o) {
	const frontier = o.provider.group === 'Anthropic' || o.provider.group === 'Other frontier APIs';
	if (!frontier || o.model.params >= 70) return '';
	return ` Note that ${o.model.name} is not a substitute for ${o.provider.name} — this compares cost, not capability.`;
}

/* --------------------------------------------------------------- stats --- */

function renderStats(o, api, self, th) {
	setText('#stat-api', usd(api.monthly));
	setText(
		'#stat-api-sub',
		`${usd(api.perMillionBlended)}/M blended · ${usd(api.perRequest)} per request${o.batchTier ? ' · batch tier' : ''}`,
	);

	setText('#stat-self', self ? usd(self.alwaysOnCost) : '—');
	setText(
		'#stat-self-sub',
		self
			? `${o.hardware.name} at ${usd(o.hardware.rentUsd)}/h, 730 h/month`
			: `${o.model.name} does not fit on this card`,
	);

	setText('#stat-util', self ? `${(self.utilisation * 100).toFixed(1)}%` : '—');
	setText(
		'#stat-util-sub',
		self ? `${duration(self.busyHours * 3600)} of work in a 730-hour month` : '',
	);

	if (self) {
		const breakEven = self.breakEvenTokens(api.perMillionBlended);
		const ratio = breakEven / api.totalTokens;
		setText('#stat-break', `${commas(Math.round(breakEven / 1e6))}M`);
		// Which side of the line you are on is the point; a bare multiplier
		// reads the same whether you are above or below it.
		setText(
			'#stat-break-sub',
			ratio <= 1
				? `already past it — you are at ${commas(Math.round(api.totalTokens / 1e6))}M/month`
				: `${ratio.toFixed(1)}× your ${commas(Math.round(api.totalTokens / 1e6))}M/month`,
		);
	} else {
		setText('#stat-break', '—');
		setText('#stat-break-sub', 'no self-hosted option to compare');
	}
}

/* ----------------------------------------------------------- providers --- */

function renderProviders(o, current) {
	const rows = PROVIDERS.flatMap((g) =>
		g.models.map((provider) => ({ provider, cost: apiCost({ ...o, provider }) })),
	).sort((a, b) => a.cost.monthly - b.cost.monthly);

	setHtml(
		'#provider-rows',
		rows
			.map(
				({ provider, cost }) => `
		<tr class="${provider.id === o.provider.id ? 'row-current' : ''}">
			<td>${escapeHtml(provider.name)}${provider.confidence === 'approximate' ? ' <span class="mark-no">approx</span>' : ''}</td>
			<td class="num">$${provider.in}</td>
			<td class="num">$${provider.out}</td>
			<td class="num">${usd(cost.perRequest)}</td>
			<td class="num">${usd(cost.monthly)}</td>
		</tr>`,
			)
			.join(''),
	);

	setText(
		'#providers-caption',
		`${commas(o.requests)} requests/month · ${commas(o.inTokens)} in, ${commas(o.outTokens)} out · ${o.cachedFrac * 100}% cached${o.batchTier ? ' · batch tier' : ''}`,
	);
}

/* ---------------------------------------------------------- self-host --- */

function renderSelf(o, api, self, th) {
	if (!self) {
		setHtml(
			'#self-rows',
			`<tr><th scope="row" class="row-label">Fits on ${escapeHtml(o.hardware.name)}</th><td><span class="mark-no">✕ no</span> — ${escapeHtml(o.model.name)} at ${escapeHtml(o.quant.name)} is too large for ${o.hardware.vram} GB</td></tr>`,
		);
		setText('#self-note', 'Choose a smaller model, a lower quantisation, or a card with more memory to get a comparison.');
		return;
	}

	const rows = [
		['Serving config', `${o.model.name} at ${o.quant.name} on a ${o.hardware.name}, ${th.batch} concurrent sequences`],
		['Output throughput', `${tps(th.outputTps)} tok/s sustained (batched)`],
		['Prefill throughput', `${tps(th.prefillTps)} tok/s`],
		['Work per month', `${commas(Math.round(api.inputTokens / 1e6))}M input + ${commas(Math.round(api.outputTokens / 1e6))}M output`],
		['GPU time needed', `${duration(self.busyHours * 3600)} — ${(self.utilisation * 100).toFixed(1)}% of the month`],
		['Cost, always on', `${usd(self.alwaysOnCost)}/month · ${usd(self.alwaysOnPerMillion)}/M tokens`],
		['Cost, perfect utilisation', `${usd(self.perfectUtilisationCost)}/month · ${usd(self.perfectPerMillion)}/M tokens — the unreachable floor`],
		['Same workload on the API', `${usd(api.monthly)}/month · ${usd(api.perMillionBlended)}/M tokens`],
	];

	setHtml(
		'#self-rows',
		rows.map(([k, v]) => `<tr><th scope="row" class="row-label">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join(''),
	);

	setText(
		'#self-note',
		`Throughput is the batched figure from /serve at ${formatTokens(SERVE_CTX)} context, because that is how a real server runs. The gap between the always-on and perfect-utilisation rows is the cost of idle time, and closing it needs traffic that never sleeps — which is exactly what a hosted API sells you.`,
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
markInvalidTokenInputs(['#requests', '#intok', '#outtok', '#cm-maxCtx']);
render();
