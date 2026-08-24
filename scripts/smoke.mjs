/**
 * Smoke test: load the built site in real Chrome and assert it actually works.
 *
 * The interesting checks here are not "does it render" — Vite would have
 * failed loudly — but the two failure modes this codebase is actually prone to:
 *
 *   1. **Extensionless URLs.** Production serves `/vram` from `dist/vram.html`.
 *      If a link, a canonical, or a sitemap entry disagrees with what Pages
 *      does, it breaks only in production. The preview server is configured to
 *      match, so this test catches the mismatch locally.
 *   2. **CSP violations.** `style-src 'self'` with no unsafe-inline means any
 *      `style="..."` attribute that creeps back into a template works in dev
 *      and silently dies in production. Chrome reports those as console
 *      errors, so the no-console-errors check is load-bearing — the test also
 *      applies the real policy from public/_headers via a meta tag so dev
 *      behaves like prod.
 *
 * Usage:  npm run build && npm run preview &   then:  npm run smoke
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.cache', 'screens');
const BASE = (process.env.SMOKE_URL ?? 'http://localhost:4174').replace(/\/$/, '');
const CHROME =
	process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** The exact policy Cloudflare will apply, lifted from the source of truth. */
const CSP = readFileSync(join(ROOT, 'public', '_headers'), 'utf8')
	.split('\n')
	.find((l) => l.trim().startsWith('Content-Security-Policy:'))
	.replace(/^\s*Content-Security-Policy:\s*/, '')
	.trim();

const failures = [];
function check(name, ok, detail = '') {
	// Detail only on failure — a passing line with a diagnostic appended reads
	// like a warning and trains you to ignore the output.
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
	if (!ok) failures.push(name);
}

async function newPage(browser, { reducedMotion = false, width = 1440 } = {}) {
	const page = await browser.newPage();
	await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
	if (reducedMotion) {
		await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
	}
	// Serve every HTML document with the production CSP as a real response
	// header, so a violation that would only surface on Cloudflare surfaces
	// here too. A <meta> injected via evaluateOnNewDocument cannot do this —
	// that callback runs before documentElement exists, and a meta CSP added
	// after parsing starts does not apply retroactively anyway.
	await page.setRequestInterception(true);
	page.on('request', async (req) => {
		if (req.resourceType() !== 'document') return req.continue();
		try {
			const upstream = await fetch(req.url(), { redirect: 'manual' });
			const body = Buffer.from(await upstream.arrayBuffer());
			await req.respond({
				status: upstream.status,
				headers: {
					'content-type': upstream.headers.get('content-type') ?? 'text/html',
					'content-security-policy': CSP,
				},
				body,
			});
		} catch {
			await req.continue();
		}
	});

	const errors = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
	return { page, errors };
}

const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: true,
	args: ['--hide-scrollbars', '--enable-unsafe-swiftshader', '--use-gl=angle'],
});

try {
	mkdirSync(OUT, { recursive: true });
	console.log(`smoke testing ${BASE}`);

	/* ------------------------------------------------------------- index -- */
	console.log('\nindex');
	{
		const { page, errors } = await newPage(browser);
		await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 30000 });
		await new Promise((r) => setTimeout(r, 900));

		check('no console errors / failed requests', errors.length === 0, errors.join(' | '));

		const tools = await page.$$eval('#tool-list a.tool-card', (els) => els.map((e) => e.getAttribute('href')));
		check('tool cards rendered from the registry', tools.length >= 2, tools.join(', '));

		const planned = await page.$$eval('#planned-list li', (els) => els.length);
		check('planned list rendered', planned >= 6, `${planned} entries`);

		const gl = await page.evaluate(() => {
			const c = document.getElementById('webgl-canvas');
			return c ? Boolean(c.getContext('webgl2')) : false;
		});
		check('WebGL2 background acquired', gl);

		const thirdParty = await page.evaluate(() =>
			performance
				.getEntriesByType('resource')
				.map((e) => new URL(e.name).origin)
				.filter((o) => o !== location.origin),
		);
		check('zero third-party requests', thirdParty.length === 0, thirdParty.join(', '));

		await page.screenshot({ path: join(OUT, 'index.png'), fullPage: true });
		await page.close();
	}

	/* -------------------------------------------------- extensionless URLs -- */
	console.log('\nextensionless routing (matches Cloudflare Pages)');
	for (const path of ['/vram', '/train']) {
		const { page } = await newPage(browser);
		const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		check(`${path} serves 200`, res.status() === 200, `status ${res.status()}`);
		await page.close();
	}

	/* -------------------------------------------------------------- vram -- */
	console.log('\n/vram');
	{
		const { page, errors } = await newPage(browser);
		// The exact URL shape from the brief. If this does not reproduce the
		// result, the whole premise of the site is broken.
		await page.goto(`${BASE}/vram?p=8b&d=q4&ctx=32k`, { waitUntil: 'networkidle0', timeout: 30000 });
		await new Promise((r) => setTimeout(r, 700));

		check('no console errors (incl. CSP violations)', errors.length === 0, errors.join(' | '));

		const hydrated = await page.evaluate(() => ({
			model: document.querySelector('#model').value,
			quant: document.querySelector('#quant').value,
			ctx: document.querySelector('#ctx').value,
		}));
		check('?p=8b hydrates the model select', hydrated.model === '8b', hydrated.model);
		check('?d=q4 resolves to a real quant', hydrated.quant === 'q4', hydrated.quant);
		check('?ctx=32k round-trips', hydrated.ctx === '32k', hydrated.ctx);

		const results = await page.evaluate(() => ({
			verdict: document.querySelector('#verdict-title').textContent,
			total: document.querySelector('#stat-total').textContent,
			decode: document.querySelector('#stat-decode').textContent,
			segments: document.querySelectorAll('#meter .meter-seg').length,
			legend: document.querySelectorAll('#legend li').length,
			ladder: document.querySelectorAll('#ladder-rows tr').length,
			ctxRows: document.querySelectorAll('#ctx-rows tr').length,
			breakdown: document.querySelectorAll('#breakdown-rows tr').length,
		}));
		check('verdict populated', results.verdict !== '—' && results.verdict.length > 3, results.verdict);
		check('total memory computed', /GB|MB/.test(results.total), results.total);
		check('decode speed computed', /\d/.test(results.decode), results.decode);
		check('meter has one segment per series', results.segments >= 3, `${results.segments}`);
		check('legend present with budget entry', results.legend === 4, `${results.legend}`);
		check('quant ladder populated', results.ladder >= 10, `${results.ladder} rows`);
		check('context ladder populated', results.ctxRows >= 7, `${results.ctxRows} rows`);
		check('breakdown table populated', results.breakdown === 4, `${results.breakdown} rows`);

		// Meter segment widths must come through the CSSOM, not a style attribute.
		const widthsApplied = await page.evaluate(() => {
			const segs = [...document.querySelectorAll('#meter .meter-seg')];
			// `every` on an empty list is vacuously true, which would let this
			// pass on a page that rendered no meter at all.
			return segs.length > 0 && segs.every((el) => el.style.width.endsWith('%'));
		});
		check('meter widths applied via CSSOM (CSP-safe)', widthsApplied);

		// Changing an input must rewrite the query string.
		await page.select('#quant', 'q8');
		await new Promise((r) => setTimeout(r, 400));
		const url = page.url();
		check('editing a control updates the URL', url.includes('d=q8'), url);

		// And a default value must NOT appear in the URL.
		await page.select('#kv', 'fp16');
		await new Promise((r) => setTimeout(r, 400));
		check('defaults are elided from the URL', !page.url().includes('kv='), page.url());

		await page.screenshot({ path: join(OUT, 'vram.png'), fullPage: true });
		await page.close();
	}

	/* ------------------------------------------------ vram: OOM behaviour -- */
	console.log('\n/vram — does-not-fit path');
	{
		const { page, errors } = await newPage(browser);
		await page.goto(`${BASE}/vram?p=llama-3.3-70b&d=q4km&hw=rtx-3090`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 500));
		check('no console errors', errors.length === 0, errors.join(' | '));

		const state = await page.evaluate(() => ({
			tone: document.querySelector('#verdict').className,
			over: Boolean(document.querySelector('#meter .meter-over')),
			// The segments must still sum to at most the track width — the
			// overflow is an overlay, so it must not add to the stack.
			stackPct: [...document.querySelectorAll('#meter .meter-seg')].reduce(
				(a, el) => a + Number.parseFloat(el.style.width),
				0,
			),
			desc: document.querySelector('#meter-desc').textContent,
		}));
		check('verdict reads as a failure', state.tone.includes('is-bad'), state.tone);
		check('meter shows a hatched overflow overlay', state.over);
		check('meter segments do not exceed the track', state.stackPct <= 100.5, `${state.stackPct.toFixed(1)}%`);
		check('meter has an accessible text description', state.desc.includes('Over budget'), state.desc.slice(0, 60));
		await page.close();
	}

	/* ------------------------------------------------------------- train -- */
	console.log('\n/train');
	{
		const { page, errors } = await newPage(browser);
		await page.goto(`${BASE}/train?p=llama-3.1-8b&m=qlora&sq=2k&bs=2`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 700));

		check('no console errors (incl. CSP violations)', errors.length === 0, errors.join(' | '));

		const results = await page.evaluate(() => ({
			verdict: document.querySelector('#verdict-title').textContent,
			mem: document.querySelector('#stat-mem').textContent,
			time: document.querySelector('#stat-time').textContent,
			cost: document.querySelector('#stat-cost').textContent,
			hwRows: document.querySelectorAll('#hw-rows tr').length,
			runRows: document.querySelectorAll('#run-rows tr').length,
			legend: document.querySelectorAll('#legend li').length,
		}));
		check('verdict populated', results.verdict.length > 3, results.verdict);
		check('peak VRAM computed', /GB|MB/.test(results.mem), results.mem);
		check('wall clock computed', results.time !== '—', results.time);
		check('cost computed', results.cost !== '—', results.cost);
		check('hardware comparison populated', results.hwRows >= 10, `${results.hwRows} rows`);
		check('run summary populated', results.runRows === 7, `${results.runRows} rows`);
		check('legend present with budget entry', results.legend === 5, `${results.legend}`);

		// Full finetune must hide the LoRA-only controls.
		await page.select('#method', 'full');
		await new Promise((r) => setTimeout(r, 300));
		// `.hidden` alone is not enough: an author `display: grid` rule beats the
		// UA's [hidden] rule, so check what the browser actually computed.
		const loraVisible = await page.evaluate(
			() => getComputedStyle(document.querySelector('#lora-fields')).display !== 'none',
		);
		check('LoRA fields hide for a full finetune', !loraVisible);
		await page.select('#method', 'qlora');
		await new Promise((r) => setTimeout(r, 300));
		const loraBack = await page.evaluate(
			() => getComputedStyle(document.querySelector('#lora-fields')).display !== 'none',
		);
		check('LoRA fields come back for QLoRA', loraBack);

		// Radio groups default to booleans; a mis-encoded default leaves every
		// option visually unselected while the maths quietly uses the default.
		const radios = await page.evaluate(() =>
			['packing', 'gc', 'stack'].map((n) => [...document.querySelectorAll(`input[name="${n}"]`)].some((i) => i.checked)),
		);
		check('every segmented control has a selected option', radios.every(Boolean), JSON.stringify(radios));

		await page.screenshot({ path: join(OUT, 'train.png'), fullPage: true });
		await page.close();
	}

	/* ------------------------------------------------- robustness & a11y -- */
	console.log('\nrobustness');
	{
		const { page, errors } = await newPage(browser);
		// Garbage in the query string is arbitrary text from a stranger. It must
		// degrade to a sensible default, never blank the page.
		await page.goto(`${BASE}/vram?p=<script>&d=nonsense&ctx=-5&b=abc&hw=potato&n=999`, {
			waitUntil: 'networkidle0',
		});
		await new Promise((r) => setTimeout(r, 500));
		check('hostile query string does not throw', errors.length === 0, errors.join(' | '));
		const still = await page.evaluate(() => document.querySelector('#stat-total').textContent);
		check('hostile query string still renders a result', /GB|MB/.test(still), still);
		await page.close();
	}

	console.log('\nmobile & reduced motion');
	{
		const { page, errors } = await newPage(browser, { width: 390, reducedMotion: true });
		await page.goto(`${BASE}/vram`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 700));
		check('no console errors at 390px', errors.length === 0, errors.join(' | '));

		// Measure element rects, NOT documentElement.scrollWidth. `body` carries
		// overflow-x: hidden as a safety net, which clips the excess and makes
		// scrollWidth equal clientWidth even when content genuinely overflows —
		// so the scrollWidth check passes on a visibly broken layout. Asking
		// each element where its right edge actually is does not have that hole.
		const overflow = await page.evaluate(() => {
			// A wide element inside a horizontal scroll container is fine — that
			// is what .table-wrap is for. Only an element that pushes past the
			// viewport with nothing to scroll it is a layout bug.
			const inScroller = (el) => {
				for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
					const ox = getComputedStyle(n).overflowX;
					if (ox === 'auto' || ox === 'scroll') return true;
				}
				return false;
			};
			const offenders = [];
			for (const el of document.querySelectorAll('main *')) {
				const r = el.getBoundingClientRect();
				if (r.right > window.innerWidth + 1 && !inScroller(el)) {
					offenders.push(`${el.tagName}.${el.className}`.slice(0, 50));
				}
			}
			return {
				offenders: [...new Set(offenders)].slice(0, 6),
				scrolls: document.documentElement.scrollHeight > window.innerHeight,
			};
		});
		check('no element overflows the viewport at 390px', overflow.offenders.length === 0, overflow.offenders.join(', '));
		check('page scrolls', overflow.scrolls);

		const animating = await page.evaluate(() => window.__toolsBg?.running === true);
		check('reduced motion does not start the RAF loop', animating === false);

		await page.screenshot({ path: join(OUT, 'vram-mobile.png'), fullPage: true });
		await page.close();
	}
} finally {
	await browser.close();
}

console.log(`\n${failures.length ? `FAILED: ${failures.join(', ')}` : 'all checks passed'}`);
process.exit(failures.length ? 1 : 0);
