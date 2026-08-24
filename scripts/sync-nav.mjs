/**
 * Rewrite every page's <nav> block from the tool registry.
 *
 * There is no template engine here — each tool is a real static HTML document —
 * which means the header navigation is physically duplicated across five files.
 * Duplication that has to be edited by hand drifts, and a nav that disagrees
 * with itself between pages is the kind of bug nobody notices for months.
 *
 * So: `src/lib/tools.js` is the source of truth, and this script projects it
 * onto every page. It also sets `aria-current="page"` on whichever entry
 * matches the file being written.
 *
 * Run it after adding or renaming a tool:  npm run nav
 *
 * The script is idempotent — running it with nothing changed rewrites the same
 * bytes and reports no changes, so it is safe to run in a pre-commit hook.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../src/lib/tools.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `/vram` -> `vram.html`; the index is the only special case. */
const fileForHref = (href) => `${href.replace(/^\//, '')}.html`;

function navFor(filename) {
	const entries = TOOLS.map((t) => {
		const current = fileForHref(t.href) === filename ? ' aria-current="page"' : '';
		return `        <a class="nav-link" href="${t.href}"${current}>${escape(t.navLabel)}</a>`;
	});
	entries.push('        <a class="nav-link is-external" href="https://ml.box" rel="noopener">ml.box ↗</a>');
	return ['      <nav class="site-nav" aria-label="Tools">', ...entries, '      </nav>'].join('\n');
}

function escape(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let changed = 0;

for (const page of pages) {
	const path = join(ROOT, page);
	const before = readFileSync(path, 'utf8');
	const after = before.replace(
		/ {6}<nav class="site-nav"[\s\S]*?<\/nav>/,
		navFor(page),
	);
	if (after === before) {
		console.log(`  ok      ${page}`);
		continue;
	}
	writeFileSync(path, after);
	changed++;
	console.log(`  updated ${page}`);
}

console.log(`\n${changed} of ${pages.length} pages rewritten from the tool registry.`);
