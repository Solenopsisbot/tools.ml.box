/**
 * Custom model support.
 *
 * The preset list only holds architectures whose shape came off a published
 * config. Anything else — a model released last week, a private finetune, a
 * hypothetical you are sizing hardware for — goes through here instead of
 * being guessed at in `models.js`.
 *
 * Two design decisions worth keeping:
 *
 *  1. **The fields are built in JavaScript, not written into five HTML files.**
 *     Every page with a model select needs the same eight inputs, and hand-
 *     duplicating them across vram/serve/train/quant/cost would drift the way
 *     the nav did. `mountCustomFields()` injects an identical fieldset wherever
 *     it is called. Built with `createElement`, so no inline styles and no CSP
 *     problem (see AGENTS.md section 3.3).
 *
 *  2. **The whole spec is ONE query parameter.** `?p=custom&cm=8,8,32,4096,8,128,14336,128k`
 *     rather than eight separate keys. Eight keys would make the URL unreadable
 *     and would burn eight names out of a namespace that is a public contract.
 *     A hidden input holds the encoded string and is what UrlState actually
 *     binds to; the visible fields write into it.
 */

import { MODELS } from './models.js';
import { parseTokens, formatTokens, clampNum } from './format.js';

export const CUSTOM_ID = 'custom';

/**
 * Field order in the encoded string. Positional, so **never reorder or remove
 * an entry** — old links would silently decode into a different architecture.
 * Append only.
 */
const FIELDS = [
	{ key: 'params', label: 'Params', unit: 'B', min: 0.01, max: 10000, step: 0.01, default: 8 },
	{ key: 'active', label: 'Active', unit: 'B', min: 0.01, max: 10000, step: 0.01, default: 8, hint: 'MoE' },
	{ key: 'layers', label: 'Layers', min: 1, max: 512, step: 1, default: 32 },
	{ key: 'hidden', label: 'Hidden dim', min: 8, max: 65536, step: 1, default: 4096 },
	{ key: 'kvHeads', label: 'KV heads', min: 1, max: 512, step: 1, default: 8 },
	{ key: 'headDim', label: 'Head dim', min: 8, max: 1024, step: 1, default: 128 },
	{ key: 'inter', label: 'MLP inter', min: 8, max: 262144, step: 1, default: 14336 },
	{ key: 'maxCtx', label: 'Native ctx', min: 128, max: 16777216, step: 1, default: 131072, tokens: true },
];

export const CUSTOM_DEFAULT = Object.fromEntries(FIELDS.map((f) => [f.key, f.default]));

/** Encode a spec to the compact `cm` value. Context uses `128k` shorthand. */
export function encodeCustom(spec) {
	return FIELDS.map((f) => {
		const v = spec[f.key] ?? f.default;
		return f.tokens ? formatTokens(v) : String(v);
	}).join(',');
}

/**
 * Decode a `cm` value. Total by construction: every field falls back to its
 * default, so a truncated, reordered or hostile string still yields a model
 * the rest of the site can compute with.
 */
export function decodeCustom(raw) {
	const parts = String(raw ?? '').split(',');
	const spec = {};
	FIELDS.forEach((f, i) => {
		const token = parts[i];
		const parsed = f.tokens ? parseTokens(token, f.default) : Number.parseFloat(token);
		const n = clampNum(parsed, { min: f.min, max: f.max, fallback: f.default });
		spec[f.key] = f.step === 1 ? Math.round(n) : n;
	});
	// Active parameters cannot exceed the total; a link claiming otherwise
	// would make MoE decode speed come out faster than the dense equivalent.
	spec.active = Math.min(spec.active, spec.params);
	return spec;
}

/** Build a model object in the same shape as a preset. */
export function customModel(spec) {
	const s = { ...CUSTOM_DEFAULT, ...spec };
	return {
		...MODELS.get(CUSTOM_ID),
		id: CUSTOM_ID,
		name: s.active < s.params ? `Custom ${s.params}B-A${s.active}B` : `Custom ${s.params}B`,
		params: s.params,
		active: s.active,
		layers: s.layers,
		hidden: s.hidden,
		heads: Math.max(1, Math.round(s.hidden / s.headDim)),
		kvHeads: s.kvHeads,
		headDim: s.headDim,
		inter: s.inter,
		maxCtx: s.maxCtx,
		// A custom entry never claims a sliding window or MLA. Both change the
		// cache by multiples and neither is something you can express in eight
		// number fields without inviting a wrong answer.
		swa: null,
		mla: null,
		custom: true,
	};
}

/**
 * Resolve a model id, swapping in the custom spec when the id is `custom`.
 * Every page that has a model select should go through this rather than
 * `resolveModel` directly.
 */
export function resolveWithCustom(resolveModel, id, cmRaw) {
	if (id === CUSTOM_ID) return customModel(decodeCustom(cmRaw));
	return resolveModel(id);
}

/**
 * Inject the custom fieldset directly after the model select, plus the hidden
 * input that carries the encoded spec.
 *
 * @param {string} selectSelector  the page's model `<select>`
 * @returns {{sync(spec): void, hiddenId: string, container: HTMLElement}}
 */
export function mountCustomFields(selectSelector = '#model') {
	const select = document.querySelector(selectSelector);
	if (!select) return { sync() {}, hiddenId: 'cm', container: null };

	const field = select.closest('.field') ?? select.parentElement;

	const container = document.createElement('div');
	container.className = 'custom-model';
	container.id = 'custom-fields';
	container.hidden = true;

	const note = document.createElement('p');
	note.className = 'field-note';
	// The per-field hints have to be near-nothing at this column width, so the
	// explanation lives here instead of wrapping every label mid-word.
	note.textContent =
		'From config.json. KV heads is post-GQA (num_key_value_heads) and MLP inter is per expert on an MoE — those two drive the cache and the adapter size.';
	container.append(note);

	// Two per row, matching the .field-row grid used elsewhere.
	for (let i = 0; i < FIELDS.length; i += 2) {
		const row = document.createElement('div');
		row.className = 'field-row';
		for (const f of FIELDS.slice(i, i + 2)) {
			const wrap = document.createElement('div');
			wrap.className = 'field';

			const label = document.createElement('label');
			label.className = 'field-label';
			label.htmlFor = `cm-${f.key}`;
			label.append(document.createTextNode(f.unit ? `${f.label} (${f.unit})` : f.label));
			if (f.hint) {
				const hint = document.createElement('span');
				hint.className = 'field-hint';
				hint.textContent = f.hint;
				label.append(hint);
			}

			const input = document.createElement('input');
			input.id = `cm-${f.key}`;
			input.dataset.cmField = f.key;
			if (f.tokens) {
				input.type = 'text';
				input.inputMode = 'numeric';
				input.spellcheck = false;
			} else {
				input.type = 'number';
				input.min = String(f.min);
				input.max = String(f.max);
				input.step = String(f.step);
			}

			wrap.append(label, input);
			row.append(wrap);
		}
		container.append(row);
	}

	// The single source of truth for the URL. UrlState binds to this, not to
	// the eight visible inputs.
	const hidden = document.createElement('input');
	hidden.type = 'hidden';
	hidden.id = 'cm';
	container.append(hidden);

	field.after(container);

	/**
	 * `active` follows `params` until someone edits it directly.
	 *
	 * Without this, typing 70 into params leaves active at its 8 default and
	 * the tool reports a 70B model that decodes at 8B speeds — a wrong answer
	 * that looks entirely reasonable. Linked-until-unlinked is the least
	 * surprising behaviour: dense models are the common case, and anyone
	 * entering an MoE will type an active count on purpose.
	 */
	let activeTouched = false;
	const paramsEl = container.querySelector('[data-cm-field="params"]');
	const activeEl = container.querySelector('[data-cm-field="active"]');
	activeEl.addEventListener('input', () => {
		activeTouched = true;
	});
	paramsEl.addEventListener('input', () => {
		if (!activeTouched) activeEl.value = paramsEl.value;
	});

	/** Read the visible fields, re-encode, and let UrlState notice. */
	const collect = () => {
		const spec = {};
		for (const f of FIELDS) {
			const el = container.querySelector(`[data-cm-field="${f.key}"]`);
			spec[f.key] = f.tokens ? parseTokens(el.value, f.default) : Number.parseFloat(el.value);
		}
		hidden.value = encodeCustom(decodeCustom(encodeCustom(spec)));
		hidden.dispatchEvent(new Event('input', { bubbles: true }));
	};

	for (const el of container.querySelectorAll('[data-cm-field]')) {
		el.addEventListener('input', collect);
	}

	return {
		hiddenId: 'cm',
		container,
		/**
		 * Push a decoded spec into the visible fields.
		 *
		 * Called after hydration and on popstate only — NOT on every render.
		 * Writing sanitised values back while someone is mid-edit makes the
		 * field fight the keyboard: clear it to retype and it snaps to the
		 * minimum under your cursor.
		 */
		sync(spec) {
			// A link that specifies a distinct active count has clearly unlinked
			// the two on purpose; keep it that way after hydration.
			activeTouched = spec.active !== spec.params;
			for (const f of FIELDS) {
				const el = container.querySelector(`[data-cm-field="${f.key}"]`);
				const v = spec[f.key] ?? f.default;
				el.value = f.tokens ? formatTokens(v) : String(v);
			}
			hidden.value = encodeCustom(spec);
		},
	};
}
