import { defineConfig } from 'vite';

/**
 * Extensionless-URL middleware.
 *
 * Cloudflare Pages serves `dist/vram.html` at `/vram` natively, so the shipped
 * links have no `.html`. Vite's dev and preview servers do NOT do that mapping,
 * so without this plugin every in-site link 404s locally while working fine in
 * production — the worst possible failure mode. This makes local match prod.
 */
function extensionlessHtml() {
	const rewrite = (req, _res, next) => {
		const [path, query = ''] = req.url.split('?');
		if (/\.[a-z0-9]+$/i.test(path) || path === '/') return next();
		const clean = path.replace(/\/$/, '');
		req.url = `${clean}.html${query ? `?${query}` : ''}`;
		next();
	};
	// Block bodies, not expression bodies: `middlewares.use()` returns the
	// connect app, and Vite treats a value returned from these hooks as a
	// post-hook function to invoke later. Returning the app makes Vite call it
	// with no arguments, which throws before the server ever starts.
	return {
		name: 'extensionless-html',
		configureServer(server) {
			server.middlewares.use(rewrite);
		},
		configurePreviewServer(server) {
			server.middlewares.use(rewrite);
		},
	};
}

export default defineConfig({
	plugins: [extensionlessHtml()],
	build: {
		// Baseline that supports WebGL2, backdrop-filter, and CSS custom props.
		target: 'es2020',
		cssTarget: 'chrome90',
		assetsInlineLimit: 4096,
		reportCompressedSize: true,
		sourcemap: false,
		// Multi-page. Every tool is a real HTML document — there is no router
		// here and adding one to serve a handful of static pages would be a
		// poor trade. Register new tools in both places: here and tools.js.
		rollupOptions: {
			input: {
				index: 'index.html',
				vram: 'vram.html',
				serve: 'serve.html',
				train: 'train.html',
				quant: 'quant.html',
				cost: 'cost.html',
			},
		},
	},
	server: {
		port: 5174,
		open: false,
	},
});
