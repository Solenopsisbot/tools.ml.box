/** Display and parsing helpers shared by every tool. */

/** Bytes -> "4.85 GB", with precision that shrinks as the number grows. */
export function gb(bytes) {
	const v = bytes / 1e9;
	if (v === 0) return '0 GB';
	if (v < 0.01) return `${(bytes / 1e6).toFixed(0)} MB`;
	if (v < 1) return `${(bytes / 1e6).toFixed(0)} MB`;
	if (v < 10) return `${v.toFixed(2)} GB`;
	if (v < 100) return `${v.toFixed(1)} GB`;
	return `${v.toFixed(0)} GB`;
}

/** Bytes -> a bare number in GB, for axis labels and tight table cells. */
export function gbNum(bytes) {
	const v = bytes / 1e9;
	return v < 10 ? v.toFixed(2) : v.toFixed(1);
}

/**
 * Token counts round-trip through the URL in the form people actually write:
 * `32k`, `128k`, `1m`. `k` is 1024, because that is what everyone means when
 * they say a model has 128k context.
 *
 * Returns null on unparseable input so a caller can tell the difference
 * between "the user typed 8k" and "the user typed nonsense and we are about to
 * silently show them the 8k answer". Use `parseTokens` when you just want a
 * number, `tryParseTokens` when you want to mark the field.
 */
export function tryParseTokens(value) {
	if (value === null || value === undefined || String(value).trim() === '') return null;
	const s = String(value).trim().toLowerCase().replace(/[,_\s]/g, '');
	const match = s.match(/^([0-9]*\.?[0-9]+)([km])?$/);
	if (!match) return null;
	const n = Number.parseFloat(match[1]);
	if (!Number.isFinite(n) || n <= 0) return null;
	const scale = match[2] === 'm' ? 1024 * 1024 : match[2] === 'k' ? 1024 : 1;
	return Math.round(n * scale);
}

export function parseTokens(value, fallback = 8192) {
	return tryParseTokens(value) ?? fallback;
}

/**
 * Flag text inputs whose contents the parser rejected.
 *
 * Purely visual — the calculation still runs on the fallback, because a
 * calculator that blanks itself on a typo is worse than one that shows a
 * marked field. Wire it once per page over the token-shaped inputs.
 */
export function markInvalidTokenInputs(selectors) {
	for (const sel of selectors) {
		const el = document.querySelector(sel);
		if (!el) continue;
		const check = () => {
			const raw = el.value.trim();
			el.classList.toggle('is-invalid', raw !== '' && tryParseTokens(raw) === null);
		};
		el.addEventListener('input', check);
		el.addEventListener('change', check);
		check();
	}
}

/** 32768 -> "32k". Falls back to plain digits when it is not a clean multiple. */
export function formatTokens(tokens) {
	if (tokens >= 1024 * 1024 && tokens % (1024 * 1024) === 0) return `${tokens / (1024 * 1024)}m`;
	if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}k`;
	return String(tokens);
}

/** Same shape as formatTokens but for prose: "32,768". */
export function commas(n) {
	return Math.round(n).toLocaleString('en-US');
}

/** Tokens/sec with precision that survives both 0.4 and 4000. */
export function tps(v) {
	if (!Number.isFinite(v) || v <= 0) return '—';
	if (v < 1) return v.toFixed(2);
	if (v < 10) return v.toFixed(1);
	return commas(v);
}

/** Seconds -> "1.4 s" / "3 min 20 s" / "2 h 15 min" / "3 d 4 h". */
export function duration(seconds) {
	if (!Number.isFinite(seconds) || seconds <= 0) return '—';
	if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
	if (seconds < 3600) {
		const min = Math.floor(seconds / 60);
		return `${min} min ${Math.round(seconds - min * 60)} s`;
	}
	if (seconds < 86400) {
		const h = Math.floor(seconds / 3600);
		return `${h} h ${Math.round((seconds - h * 3600) / 60)} min`;
	}
	const d = Math.floor(seconds / 86400);
	return `${d} d ${Math.round((seconds - d * 86400) / 3600)} h`;
}

/** USD, with cents while it matters and none once it doesn't. */
export function usd(v) {
	if (!Number.isFinite(v)) return '—';
	if (v === 0) return '$0';
	if (v < 0.01) return '<$0.01';
	if (v < 100) return `$${v.toFixed(2)}`;
	return `$${commas(v)}`;
}

/** Parameter counts: 3.3 -> "3.3B", 0.49 -> "490M". */
export function params(billions) {
	if (billions < 1) return `${Math.round(billions * 1000)}M`;
	return `${billions < 10 ? billions.toFixed(2).replace(/\.?0+$/, '') : Math.round(billions)}B`;
}

/** Clamp a parsed number into range, falling back when it is not a number. */
export function clampNum(value, { min, max, fallback }) {
	const n = Number.parseFloat(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}
