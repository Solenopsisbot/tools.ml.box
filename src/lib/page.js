/** Shared page chrome: background mount and select population. */

import { WebGLBackground } from '../bg-shader.js';

/**
 * Mount the ambient shader. It is pure decoration, so a failure must never
 * take the page with it — a calculator that renders no numbers because a
 * fragment shader failed to link would be an absurd way to lose.
 */
export function initBackground() {
	try {
		window.__toolsBg = new WebGLBackground('webgl-canvas');
	} catch (err) {
		console.error('[page] background failed to init:', err);
		const canvas = document.getElementById('webgl-canvas');
		if (canvas) canvas.style.display = 'none';
	}
}

/**
 * Fill a <select> from grouped preset data.
 *
 * @param {string} selector
 * @param {Array<{group: string, items: object[]}>} groups
 * @param {(item: object) => {value: string, label: string}} map
 */
export function fillSelect(selector, groups, map) {
	const el = document.querySelector(selector);
	if (!el) return;
	el.innerHTML = groups
		.map(({ group, items }) => {
			const options = items
				.map((item) => {
					const { value, label } = map(item);
					return `<option value="${value}">${escapeHtml(label)}</option>`;
				})
				.join('');
			return `<optgroup label="${escapeHtml(group)}">${options}</optgroup>`;
		})
		.join('');
}

/** Fill a <select> from a flat list. */
export function fillFlatSelect(selector, items, map) {
	const el = document.querySelector(selector);
	if (!el) return;
	el.innerHTML = items
		.map((item) => {
			const { value, label } = map(item);
			return `<option value="${value}">${escapeHtml(label)}</option>`;
		})
		.join('');
}

/** Minimal escaping — preset labels are ours, but this is cheap insurance. */
export function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Set an element's text content by selector, tolerating a missing node. */
export function setText(selector, text) {
	const el = document.querySelector(selector);
	if (el) el.textContent = text;
}

/** Set an element's inner HTML by selector, tolerating a missing node. */
export function setHtml(selector, html) {
	const el = document.querySelector(selector);
	if (el) el.innerHTML = html;
}

/**
 * Render the stacked memory meter.
 *
 * Builds real DOM nodes and sets widths through the CSSOM rather than
 * interpolating a `style="..."` attribute into an HTML string. That is not a
 * stylistic preference: the site ships a strict Content-Security-Policy with
 * `style-src 'self'` and no `unsafe-inline`, which blocks inline style
 * ATTRIBUTES in parsed markup. Property assignment on an element is not
 * blocked, so this is the only way to keep both the strict policy and a bar
 * whose segments have computed widths.
 *
 * @param {string} selector      the `.meter-track` element
 * @param {Array<{id: string|number, label: string, bytes: number}>} parts
 * @param {object} opts
 * @param {number} opts.total    sum of the parts, bytes
 * @param {number} opts.budget   available memory, bytes
 * @param {(bytes: number) => string} opts.format
 */
export function renderMeter(selector, parts, { total, budget, format }) {
	const track = document.querySelector(selector);
	if (!track) return;
	track.replaceChildren();

	const scale = Math.max(total, budget);
	const pct = (bytes) => (bytes / scale) * 100;

	for (const part of parts) {
		const seg = document.createElement('div');
		seg.className = part.id === 'rest' ? 'meter-seg is-rest' : 'meter-seg';
		if (part.id !== 'rest') seg.dataset.series = String(part.id);
		seg.style.width = `${pct(part.bytes).toFixed(2)}%`;
		// Native tooltip. A full hover layer would be nice, but a meter with
		// four segments and a legend carrying every value does not need one.
		seg.title = `${part.label}: ${format(part.bytes)}`;
		track.append(seg);
	}

	if (total > budget) {
		// Overlay, not a fourth segment. The segments above already sum to the
		// total; appending the excess again would double-count it and push the
		// bar past the end of its own track.
		const over = document.createElement('div');
		over.className = 'meter-over';
		over.dataset.series = 'over';
		over.style.left = `${pct(budget).toFixed(2)}%`;
		over.style.width = `${pct(total - budget).toFixed(2)}%`;
		over.title = `Over budget by ${format(total - budget)}`;
		track.append(over);
	}

	const marker = document.createElement('span');
	marker.className = 'meter-budget';
	// Clamped short of the edge so the marker stays visible when it lands
	// exactly at 100%, which is the common "fits with headroom" case.
	marker.style.left = `${Math.min(99.6, pct(budget)).toFixed(2)}%`;
	marker.title = `Budget: ${format(budget)}`;
	track.append(marker);
}

/**
 * Render the meter's legend.
 *
 * Always present, because identity must never be carried by colour alone, and
 * each entry carries its own value — the segments are far too thin to hold a
 * direct label, so the legend is doing that job too.
 */
export function renderLegend(selector, parts, { budget, format }) {
	const list = document.querySelector(selector);
	if (!list) return;
	list.replaceChildren();

	for (const part of parts) {
		const li = document.createElement('li');
		const swatch = document.createElement('span');
		swatch.className = part.id === 'rest' ? 'legend-swatch is-rest' : 'legend-swatch';
		if (part.id !== 'rest') swatch.dataset.series = String(part.id);
		const value = document.createElement('span');
		value.className = 'legend-value';
		value.textContent = format(part.bytes);
		li.append(swatch, document.createTextNode(`${part.label} `), value);
		list.append(li);
	}

	const li = document.createElement('li');
	const swatch = document.createElement('span');
	swatch.className = 'legend-swatch is-budget';
	const value = document.createElement('span');
	value.className = 'legend-value';
	value.textContent = format(budget);
	li.append(swatch, document.createTextNode('Budget '), value);
	list.append(li);
}
