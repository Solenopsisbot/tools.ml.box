/**
 * Two-way binding between form controls and the query string.
 *
 * The whole point of this site is that a result is a URL. Every input is a
 * short query parameter, so `?p=8b&d=q4&ctx=32k` reproduces a calculation
 * exactly — paste it in Discord and the other person sees your numbers, not a
 * screenshot of them.
 *
 * Design decisions worth keeping:
 *
 *  - **Defaults are omitted.** A parameter only appears in the URL if it
 *    differs from the default, so the common case stays short and readable.
 *    Changing a default therefore changes the meaning of old short URLs;
 *    prefer adding a new key over redefining an old one.
 *  - **replaceState, not pushState.** Dragging a slider must not stuff fifty
 *    entries into the back stack. The back button leaves the page, which is
 *    what people expect from a calculator.
 *  - **popstate re-hydrates.** So arriving back via history still shows the
 *    configuration the URL describes.
 *  - **Coercion lives in the binding.** `decode` runs on whatever came out of
 *    the URL, which is arbitrary text from a stranger. It must always return
 *    something valid — never throw, never return undefined.
 */

export class UrlState {
	/**
	 * @param {Array<object>} bindings
	 *   key      query parameter name
	 *   el       CSS selector, or a radio-group name when `radio: true`
	 *   radio    treat `el` as an input[name] group
	 *   default  value considered "not worth putting in the URL". May be a
	 *            function, evaluated at read time — the VRAM field's default is
	 *            whatever the currently selected accelerator ships with, so it
	 *            has to be computed, not captured. Bindings hydrate in array
	 *            order, so a lazy default may read any binding declared before
	 *            it (and must not read one declared after).
	 *   decode   (raw: string) => value   — must be total; sanitize here
	 *   encode   (value) => string        — inverse of decode
	 */
	constructor(bindings) {
		this.bindings = bindings.map((b) => ({
			decode: (v) => v,
			encode: (v) => String(v),
			radio: false,
			...b,
			nodes: b.radio
				? [...document.querySelectorAll(`input[name="${b.el}"]`)]
				: [document.querySelector(b.el)].filter(Boolean),
		}));
		this.listeners = [];
		this.suppress = false;

		for (const b of this.bindings) {
			for (const node of b.nodes) {
				// `input` for live feedback while typing/dragging, `change` to
				// catch selects and the commit of a spinner.
				node.addEventListener('input', () => this.handleChange());
				node.addEventListener('change', () => this.handleChange());
			}
		}

		window.addEventListener('popstate', () => {
			this.hydrate();
			this.emit();
		});
	}

	/** Resolve a binding default, which may be a lazily evaluated function. */
	static defaultOf(b) {
		return typeof b.default === 'function' ? b.default() : b.default;
	}

	/** Current value of one binding, read from the DOM. */
	read(key) {
		const b = this.bindings.find((x) => x.key === key);
		if (!b) return undefined;
		if (b.radio) {
			const checked = b.nodes.find((n) => n.checked);
			// `encode`, not String(): a boolean default of `true` has to become
			// the literal radio value "1", and String(true) is "true".
			return b.decode(checked ? checked.value : b.encode(UrlState.defaultOf(b)));
		}
		const node = b.nodes[0];
		if (!node) return UrlState.defaultOf(b);
		if (node.type === 'checkbox') return node.checked;
		return b.decode(node.value);
	}

	/** Every binding's current value, as a plain object keyed by param name. */
	values() {
		return Object.fromEntries(this.bindings.map((b) => [b.key, this.read(b.key)]));
	}

	/** Write a value into the DOM without triggering a URL write or a render. */
	write(key, value) {
		const b = this.bindings.find((x) => x.key === key);
		if (!b) return;
		this.suppress = true;
		if (b.radio) {
			for (const n of b.nodes) n.checked = n.value === b.encode(value);
		} else if (b.nodes[0]) {
			const node = b.nodes[0];
			if (node.type === 'checkbox') node.checked = Boolean(value);
			else node.value = b.encode(value);
		}
		this.suppress = false;
	}

	/**
	 * Pull the query string into the form. Anything absent or unparseable
	 * falls back to the binding default, so a mangled link still renders.
	 */
	hydrate() {
		const q = new URLSearchParams(window.location.search);
		this.suppress = true;
		for (const b of this.bindings) {
			const raw = q.get(b.key);
			const value = raw === null ? UrlState.defaultOf(b) : b.decode(raw);
			if (b.radio) {
				for (const n of b.nodes) n.checked = n.value === b.encode(value);
			} else if (b.nodes[0]) {
				const node = b.nodes[0];
				if (node.type === 'checkbox') node.checked = raw === null ? Boolean(UrlState.defaultOf(b)) : raw !== '0' && raw !== 'false';
				else node.value = b.encode(value);
			}
		}
		this.suppress = false;
	}

	/** Query string for the current form state, defaults elided. */
	query() {
		const q = new URLSearchParams();
		for (const b of this.bindings) {
			const value = this.read(b.key);
			const dflt = UrlState.defaultOf(b);
			if (value === dflt) continue;
			if (b.nodes[0]?.type === 'checkbox') {
				q.set(b.key, value ? '1' : '0');
				continue;
			}
			q.set(b.key, b.encode(value));
		}
		// URLSearchParams percent-encodes commas, which turns a compact custom
		// spec into `cm=70%2C70%2C80%2C...`. Commas are legal unencoded in a
		// query value, and readable URLs are the whole point of this site, so
		// put them back.
		return q.toString().replace(/%2C/g, ',');
	}

	/** Absolute, shareable URL for the current form state. */
	href() {
		const q = this.query();
		return `${window.location.origin}${window.location.pathname}${q ? `?${q}` : ''}`;
	}

	/** Register a render callback. Called on every committed change. */
	onChange(fn) {
		this.listeners.push(fn);
		return this;
	}

	emit() {
		const v = this.values();
		for (const fn of this.listeners) fn(v);
	}

	handleChange() {
		if (this.suppress) return;
		this.emit();
		this.scheduleUrlWrite();
	}

	/**
	 * Debounced, because a range input fires `input` on every pixel and
	 * history.replaceState is rate-limited by browsers. 200ms is below the
	 * threshold where someone would notice the URL lagging their edit.
	 */
	scheduleUrlWrite() {
		clearTimeout(this._urlTimer);
		this._urlTimer = setTimeout(() => {
			const q = this.query();
			const url = `${window.location.pathname}${q ? `?${q}` : ''}`;
			window.history.replaceState(null, '', url);
		}, 200);
	}
}

/**
 * Wire up a "copy link" button. Falls back to selecting the URL in a prompt-
 * free way (a visible input) is overkill here — the button simply reports
 * failure, and the address bar already holds the same URL.
 */
export function initShareButton(selector, state) {
	const btn = document.querySelector(selector);
	if (!btn) return;
	const label = btn.querySelector('.btn-text') ?? btn;
	const original = label.textContent;

	btn.addEventListener('click', async () => {
		const href = state.href();
		try {
			if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
			await navigator.clipboard.writeText(href);
			label.textContent = 'Copied';
		} catch {
			label.textContent = 'Copy failed';
		}
		btn.classList.add('is-copied');
		clearTimeout(btn._resetTimer);
		btn._resetTimer = setTimeout(() => {
			label.textContent = original;
			btn.classList.remove('is-copied');
		}, 1600);
	});
}
