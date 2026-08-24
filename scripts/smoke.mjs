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
		check('tool cards rendered from the registry', tools.length >= 5, tools.join(', '));

		// The nav is duplicated across every page and kept in sync by
		// `npm run nav`. If someone edits a page by hand the copies drift, and
		// the drift is invisible until you happen to be on the wrong page.
		const navHrefs = await page.$$eval('.site-nav a', (els) => els.map((e) => e.getAttribute('href')));
		check('nav matches the tool registry', tools.every((h) => navHrefs.includes(h)), navHrefs.join(', '));

		const planned = await page.$$eval('#planned-list li', (els) => els.length);
		check('planned list rendered', planned >= 3, `${planned} entries`);

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
	for (const path of ['/vram', '/serve', '/train', '/quant', '/cost']) {
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


	/* ------------------------------------------------------------- serve -- */
	console.log('\n/serve');
	{
		const { page, errors } = await newPage(browser);
		await page.goto(`${BASE}/serve?p=llama-3.1-8b&ctx=4k&t=15`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 600));
		check('no console errors (incl. CSP violations)', errors.length === 0, errors.join(' | '));

		const r = await page.evaluate(() => ({
			verdict: document.querySelector('#verdict-title').textContent,
			users: document.querySelector('#stat-users').textContent,
			total: document.querySelector('#stat-total').textContent,
			ladder: document.querySelectorAll('#ladder-rows tr').length,
			legend: document.querySelectorAll('#legend li').length,
			segments: document.querySelectorAll('#meter .meter-seg').length,
		}));
		check('verdict populated', r.verdict.length > 3, r.verdict);
		check('concurrency computed', /[0-9]/.test(r.users), r.users);
		check('throughput computed', /[0-9]/.test(r.total), r.total);
		check('batch ladder populated', r.ladder >= 4, `${r.ladder} rows`);
		check('memory meter rendered', r.segments === 4 && r.legend === 5, `${r.segments} segs / ${r.legend} legend`);

		// Long context must collapse concurrency — that is the tool's whole point.
		// At 128k an 8B needs 17 GB of KV per sequence, so a 24 GB card cannot
		// hold even one alongside the weights. Accept either a tiny ceiling or
		// the explicit "cannot serve one request" verdict.
		await page.goto(`${BASE}/serve?p=llama-3.1-8b&ctx=128k&t=15`, { waitUntil: 'networkidle0' });
		await new Promise((r2) => setTimeout(r2, 400));
		const long = await page.evaluate(() => ({
			sub: document.querySelector('#stat-users-sub').textContent,
			users: document.querySelector('#stat-users').textContent,
		}));
		check(
			'long context collapses concurrency',
			Number.parseInt(long.users, 10) <= 4,
			`${long.users} — ${long.sub}`,
		);
		// An unservable configuration must not also quote a throughput and a
		// price — those contradict its own verdict.
		const consistent = await page.evaluate(() => ({
			total: document.querySelector('#stat-total').textContent,
			cost: document.querySelector('#stat-cost').textContent,
			ladder: document.querySelectorAll('#ladder-rows tr').length,
		}));
		check(
			'unservable config quotes no throughput or cost',
			consistent.total.startsWith('—') && consistent.cost === '—',
			JSON.stringify(consistent),
		);

		await page.screenshot({ path: join(OUT, 'serve.png'), fullPage: true });
		await page.close();
	}

	/* ------------------------------------------------------------- quant -- */
	console.log('\n/quant');
	{
		const { page, errors } = await newPage(browser);
		await page.goto(`${BASE}/quant?p=llama-3.1-8b&vram=24&ctx=8k`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 600));
		check('no console errors (incl. CSP violations)', errors.length === 0, errors.join(' | '));

		const r = await page.evaluate(() => ({
			verdict: document.querySelector('#verdict-title').textContent,
			ladder: document.querySelectorAll('#ladder-rows tr').length,
			fit: document.querySelectorAll('#fit-rows tr').length,
			findings: document.querySelectorAll('#findings li').length,
			// The measured table must never invent a value for a format the
			// dataset does not cover.
			notMeasured: [...document.querySelectorAll('#fit-rows tr')].filter((tr) =>
				tr.textContent.includes('not measured'),
			).length,
		}));
		check('verdict populated', r.verdict.length > 3, r.verdict);
		check('measured ladder populated', r.ladder === 12, `${r.ladder} rows`);
		check('fit table populated', r.fit >= 14, `${r.fit} rows`);
		check('findings rendered', r.findings === 5, `${r.findings}`);
		check('unmeasured formats are marked, not interpolated', r.notMeasured >= 3, `${r.notMeasured}`);

		await page.screenshot({ path: join(OUT, 'quant.png'), fullPage: true });
		await page.close();
	}

	/* -------------------------------------------------------------- cost -- */
	console.log('\n/cost');
	{
		const { page, errors } = await newPage(browser);
		await page.goto(`${BASE}/cost?api=sonnet-5&req=100,000&in=2k&out=512`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 600));
		check('no console errors (incl. CSP violations)', errors.length === 0, errors.join(' | '));

		const r = await page.evaluate(() => ({
			verdict: document.querySelector('#verdict-title').textContent,
			api: document.querySelector('#stat-api').textContent,
			self: document.querySelector('#stat-self').textContent,
			util: document.querySelector('#stat-util').textContent,
			providers: document.querySelectorAll('#provider-rows tr').length,
			selfRows: document.querySelectorAll('#self-rows tr').length,
		}));
		check('verdict populated', r.verdict.length > 3, r.verdict);
		check('API cost computed', r.api.startsWith('$'), r.api);
		check('self-host cost computed', r.self.startsWith('$'), r.self);
		check('utilisation computed', r.util.endsWith('%'), r.util);
		check('provider table populated', r.providers >= 14, `${r.providers} rows`);
		check('self-host working shown', r.selfRows === 8, `${r.selfRows} rows`);

		// The cache slider must actually change the answer.
		const before = r.api;
		await page.goto(`${BASE}/cost?api=sonnet-5&req=100,000&in=2k&out=512&c=90`, { waitUntil: 'networkidle0' });
		await new Promise((r2) => setTimeout(r2, 400));
		const after = await page.evaluate(() => document.querySelector('#stat-api').textContent);
		check('prompt caching reduces the bill', after !== before, `${before} -> ${after}`);

		await page.screenshot({ path: join(OUT, 'cost.png'), fullPage: true });
		await page.close();
	}

	/* ------------------------------------------------------ custom model -- */
	console.log('\ncustom models');
	{
		const { page, errors } = await newPage(browser);

		// One shared link must reproduce the same architecture on every page.
		const link = '?p=custom&cm=70,70,80,8192,8,128,28672,128k';
		for (const path of ['/vram', '/serve', '/train', '/quant', '/cost']) {
			await page.goto(`${BASE}${path}${link}`, { waitUntil: 'networkidle0' });
			await new Promise((r) => setTimeout(r, 400));
			const st = await page.evaluate(() => ({
				sel: document.querySelector('#model').value,
				shown: getComputedStyle(document.querySelector('#custom-fields')).display !== 'none',
				params: document.querySelector('#cm-params')?.value,
				layers: document.querySelector('#cm-layers')?.value,
				verdict: document.querySelector('#verdict-title')?.textContent ?? '',
			}));
			check(
				`${path} restores a shared custom spec`,
				st.sel === 'custom' && st.shown && st.params === '70' && st.layers === '80' && st.verdict.length > 3,
				JSON.stringify(st),
			);
		}
		check('no console errors across custom pages', errors.length === 0, errors.join(' | '));

		// A custom spec matching a preset must land on the preset's numbers.
		await page.goto(`${BASE}/vram?p=custom&cm=8.03,8.03,32,4096,8,128,14336,128k&ctx=8k`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 400));
		const custom = await page.evaluate(() => document.querySelector('#stat-total').textContent);
		await page.goto(`${BASE}/vram?p=llama-3.1-8b&ctx=8k`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 400));
		const preset = await page.evaluate(() => document.querySelector('#stat-total').textContent);
		check('custom spec reproduces the equivalent preset', custom === preset, `${custom} vs ${preset}`);

		// Editing params must carry `active` with it, or a dense model silently
		// reports MoE decode speed.
		await page.goto(`${BASE}/vram?p=custom`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 300));
		await page.focus('#cm-params');
		await page.evaluate(() => document.querySelector('#cm-params').select());
		await page.keyboard.type('70');
		await new Promise((r) => setTimeout(r, 400));
		const linked = await page.evaluate(() => document.querySelector('#cm-active').value);
		check('active follows params until edited', linked === '70', linked);
		check('custom spec rides in one query param', page.url().includes('cm=70,70,'), page.url());

		// The custom fieldset must be absent for a preset.
		await page.goto(`${BASE}/vram?p=qwen3-32b`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 300));
		const hiddenForPreset = await page.evaluate(
			() => getComputedStyle(document.querySelector('#custom-fields')).display === 'none',
		);
		check('custom fields hidden for a preset', hiddenForPreset);

		await page.close();
	}

	/* -------------------------------------------------- live URL updating -- */
	console.log('\nlive URL state');
	{
		const { page } = await newPage(browser);
		await page.goto(`${BASE}/vram`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 400));
		check('a fresh load at defaults has a bare URL', !page.url().includes('?'), page.url());

		await page.select('#model', 'qwen3-32b');
		await new Promise((r) => setTimeout(r, 400));
		check('select writes to the URL without pressing anything', page.url().includes('p=qwen3-32b'), page.url());

		await page.focus('#ctx');
		await page.evaluate(() => document.querySelector('#ctx').select());
		await page.keyboard.type('64k');
		await new Promise((r) => setTimeout(r, 400));
		check('typing writes to the URL', page.url().includes('ctx=64k'), page.url());

		// Unparseable text must be visibly marked, not silently swapped for the
		// default while the numbers carry on as if nothing happened.
		await page.focus('#ctx');
		await page.evaluate(() => {
			const el = document.querySelector('#ctx');
			el.setSelectionRange(el.value.length, el.value.length);
		});
		await page.keyboard.type('zzz');
		await new Promise((r) => setTimeout(r, 400));
		const marked = await page.evaluate(() => document.querySelector('#ctx').classList.contains('is-invalid'));
		check('unparseable input is marked invalid', marked);

		await page.close();
	}

	/* ------------------------------------------------- robustness & a11y -- */
	console.log('\nrobustness');
	{
		const { page, errors } = await newPage(browser);
		// Garbage in the query string is arbitrary text from a stranger. It must
		// degrade to a sensible default, never blank the page.
		const junk = '?p=<script>&d=nonsense&ctx=-5&b=abc&hw=potato&n=999&api=nope&req=-1&c=999&f=fake';
		for (const path of ['/vram', '/serve', '/train', '/quant', '/cost']) {
			await page.goto(`${BASE}${path}${junk}`, { waitUntil: 'networkidle0' });
			await new Promise((r) => setTimeout(r, 350));
			const rendered = await page.evaluate(() => document.querySelector('#verdict-title')?.textContent ?? '');
			check(`${path} survives a hostile query string`, rendered.length > 3, rendered);
		}
		check('no errors from any hostile query string', errors.length === 0, errors.join(' | '));
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
