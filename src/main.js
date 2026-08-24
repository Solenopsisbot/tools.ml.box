import './style.css';
import { initBackground } from './lib/page.js';
import { TOOLS, PLANNED } from './lib/tools.js';

/**
 * Index page. Renders the tool directory from the registry so there is exactly
 * one place to add a tool, and mounts the shared background.
 */

const ARROW = `<svg class="tool-card-arrow" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"></path><path d="M7 7h10v10"></path></svg>`;

function renderTools() {
	const list = document.getElementById('tool-list');
	if (!list) return;
	list.innerHTML = TOOLS.map(
		(t) => `
		<li>
			<a class="tool-card" href="${t.href}">
				<span class="tool-card-head">
					<span class="tool-card-name">${t.name}</span>
					${ARROW}
				</span>
				<span class="tool-card-blurb">${t.blurb}</span>
				<ul class="tag-row">${t.tags.map((tag) => `<li class="tag">${tag}</li>`).join('')}</ul>
			</a>
		</li>`,
	).join('');
}

function renderPlanned() {
	const list = document.getElementById('planned-list');
	if (!list) return;
	list.innerHTML = PLANNED.map(
		(p) => `
		<li class="planned">
			<p class="planned-name">${p.name}</p>
			<p class="planned-blurb">${p.blurb}</p>
		</li>`,
	).join('');
}

initBackground();
renderTools();
renderPlanned();
