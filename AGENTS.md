# AGENTS.md — Repository Guidance for AI Agents & Developers

**tools.ml.box** — calculators for running and training LLMs. A sub-site of
[ml.box](https://ml.box). This document is the contract for anyone (human or
agent) touching this codebase.

---

## 1. Overview & Stack

- **Domain**: `tools.ml.box`, deployed on Cloudflare Pages
- **Stack**: Vite + vanilla HTML5 / ES modules + vanilla CSS + raw WebGL2
- **Runtime dependencies: none.** `package.json` has an empty `dependencies`
  block and that is deliberate, inherited from the parent site. Everything
  shipped to the browser is hand-written.
- **Multi-page.** Each tool is a real HTML document. There is no client-side
  router and there should not be one.
- **Everything runs client-side.** No backend, no API calls, no analytics. The
  entire state of a calculation lives in the query string.

### Relationship to ml.box

This repo *deliberately duplicates* the parent site's `src/bg-shader.js`,
fonts, `favicon.svg`, and OG generation scripts rather than sharing them. Two
static sites on two Cloudflare Pages projects have no sane way to share a
build, and a shared package would be more machinery than the 9 KB of code it
saves. **When the parent's shader or design tokens change, port the change
here by hand.** The CSS tokens in `src/style.css` mirror
`ml.box/src/style.css`; keep them in sync.

---

## 2. Directory Structure

```
tools.ml.box/
├── index.html                # Tool directory
├── vram.html                 # /vram   — VRAM fit & inference speed
├── train.html                # /train  — finetune memory, time, cost
├── vite.config.js            # Multi-page entries + extensionless-URL middleware
├── wrangler.toml
├── package.json              # ZERO runtime deps. Keep it that way.
├── scripts/
│   ├── make-og-fonts.py      # woff2 -> static TTF instances + metrics (uv)
│   ├── gen-og.mjs            # renders og.png + icon PNGs via resvg
│   └── smoke.mjs             # real-Chrome smoke test of the built site
├── public/                   # copied verbatim to dist/ root
│   ├── _headers              # CSP + security + cache headers
│   ├── favicon.svg, og.png, icon-*.png, apple-touch-icon.png  (GENERATED)
│   ├── manifest.webmanifest, robots.txt, sitemap.xml
│   └── fonts/*.woff2         # self-hosted Outfit + JetBrains Mono
└── src/
    ├── style.css             # tokens, layout, components
    ├── bg-shader.js          # raw WebGL2 braid shader (ported from ml.box)
    ├── main.js               # index page entry
    ├── vram.js               # /vram entry
    ├── train-page.js         # /train entry  (NOT train.js — see §3.6)
    └── lib/
        ├── models.js         # model architectures (real config.json values)
        ├── quant.js          # bits-per-weight tables
        ├── hardware.js       # GPU / Apple / CPU specs
        ├── calc.js           # inference memory + speed maths
        ├── train.js          # training memory + time + cost maths
        ├── tools.js          # tool registry (index page + nav)
        ├── urlstate.js       # form <-> query-string binding
        ├── format.js         # display & parsing helpers
        └── page.js           # shared chrome: background, selects, meter
```

---

## 3. Hard Rules

### 3.1 The URL is the state
Every input is bound to a short query parameter through `src/lib/urlstate.js`.
`tools.ml.box/vram?p=8b&d=q4&ctx=32k` must reproduce a result exactly. This is
the reason the site exists.

**Query keys are a public contract.** Links exist in chat logs and issue
threads. Add a key; never repurpose one. The same goes for model ids
(`?p=llama-3.1-8b`), quant ids (`?d=q4km`) and hardware ids (`?hw=rtx-3090`) —
they are all URL surface.

Defaults are **elided** from the URL to keep it short. Changing a default
therefore silently changes the meaning of every existing short link. Don't,
unless you mean it.

### 3.2 Adding a tool means three edits
1. A new `<name>.html` at the repo root
2. A new entry in `vite.config.js` under `build.rollupOptions.input`
3. A new entry in `src/lib/tools.js`

Miss any one and you ship a page nobody can reach, or a link that 404s. Also
add it to `public/sitemap.xml` and `public/_headers`.

### 3.3 No inline style attributes. Ever.
`public/_headers` sets `style-src 'self'` with **no** `unsafe-inline`. That
blocks `style="..."` attributes in parsed markup. A `style="width: 40%"` in a
template will work perfectly in `npm run dev` and silently break in production,
because Vite does not apply `_headers`.

- For a static one-off, add a utility class (see the Utilities block in
  `style.css`).
- For a computed value, assign through the CSSOM: `el.style.width = '40%'`.
  Property assignment is *not* blocked by CSP. `renderMeter()` in
  `src/lib/page.js` exists for exactly this reason.

`npm run smoke` applies the real policy as a response header, so a violation
fails the test rather than reaching production.

### 3.4 `hidden` needs the `!important` rule
`style.css` carries `[hidden] { display: none !important }`. The UA rule loses
to any author `display` declaration, and `.field` / `.field-row` both set
`display: grid` — so without it, `el.hidden = true` sets the attribute and
changes nothing visible. This was a real bug. If you test a conditional
control, assert `getComputedStyle(el).display`, not `el.hidden`.

### 3.5 Do not measure overflow with `scrollWidth`
`body` carries `overflow-x: hidden` as a safety net, which clips overflowing
content and makes `documentElement.scrollWidth === clientWidth` even on a
visibly broken layout. The smoke test measures each element's
`getBoundingClientRect().right` instead, skipping anything inside a horizontal
scroll container. This caught a real 474px-wide column on a 342px viewport.

Relatedly: a CSS grid track defaults to `auto`, which sizes to **max-content**.
Any grid holding a table needs `grid-template-columns: minmax(0, 1fr)` or it
will grow past its parent.

### 3.6 `src/train.js` does not exist — and must not
The `/train` page entry is `src/train-page.js`. `src/lib/train.js` is the maths
module. Naming the entry `src/train.js` would sit one directory above a
same-named module and make every future import ambiguous to read.

### 3.7 Boot last
Both tool entries call `state.hydrate()` and `render()` as the **final**
statements in the file. `render()` reaches `const` lookup tables declared below
its own definition; function declarations hoist, `const` bindings do not.
Calling it earlier throws a temporal-dead-zone error before the page draws a
single number. This was a real bug too.

### 3.8 Never overwrite a file in `public/fonts/`
`_headers` serves `/fonts/*` as `immutable` with a one-year max-age. To change
a font, **add a new filename** and update the `@font-face` `src`.

### 3.9 Motion is opt-out
Any new animation sits behind `prefers-reduced-motion`. The shader handles
itself (renders one static frame, never starts the RAF loop). The CSS has a
global reduced-motion block — extend it, don't bypass it.

---

## 4. The numbers

The whole value of this site is that the numbers are *better than a rule of
thumb*. Treat the constants as calibrated, not arbitrary.

### 4.1 Where the models come from
`src/lib/models.js` holds real `config.json` values. `kvHeads`, `headDim`,
`layers` and the `swa` / `mla` flags are what make the KV cache correct — they
move the answer by factors of 5–10, not percentages:

- **Sliding-window attention** (Gemma 3, gpt-oss): only one layer in `every` is
  full-attention; the rest cap at `window` tokens. Ignoring this overstates
  Gemma 3 at 128k by ~5x.
- **MLA** (DeepSeek): KV compresses to a single 576-value latent per token per
  layer. Treating it as GQA overstates the cache by ~10x.
- **MoE**: `active` drives decode speed and prefill FLOPs; `params` drives
  memory.

When adding a model, take the numbers from the actual config, not from a blog
post. `inter` is only used for LoRA parameter counting.

### 4.2 Calibration reference points
`src/lib/calc.js` is tuned so these land within ~15% of published llama.cpp /
vLLM benchmarks. **If you change a constant, re-check all of them:**

| Config | Expected decode | Expected prefill |
|---|---|---|
| Llama 3.1 8B Q4_K_M, 8k ctx, RTX 3090 | ~110–125 tok/s | ~2200 tok/s |
| Llama 3.1 8B Q4_K_M, 8k ctx, RTX 4090 | ~130–150 tok/s | ~5000 tok/s |
| Llama 3.1 8B FP16, 8k ctx, RTX 3090 | ~45 tok/s | |
| Llama 3.2 1B Q4_K_M, RTX 3090 | ~300 tok/s | |
| Llama 3.3 70B Q4_K_M, 2× RTX 3090 | ~16 tok/s | |
| Llama 3.3 70B Q4_K_M, 3090 + DDR4 offload | ~1.5–2 tok/s | |
| Qwen2.5 7B Q4_K_M, M3 Max | ~60 tok/s | |
| Qwen3 30B-A3B Q4_K_M, RTX 3090 | ~80–140 tok/s | |
| DeepSeek R1 IQ2_XXS, EPYC 12-channel | single digits | |

The non-obvious constants and why they exist:

- `SATURATION_GB = 1.5` — small models never saturate the bus. Without the
  ramp, a 0.5B model is predicted at ~950 tok/s on a 3090 against a real ~350.
- `MOE_BW_PENALTY` — expert gather coalesces badly. Harsher on CPU (0.4) than
  GPU (0.6), which is what brings DeepSeek on EPYC back to single digits.
- `SPLIT.*.bwScale/flopScale` must return exactly `1` at `n = 1`. An early
  version applied the multi-GPU penalty to single cards and halved every
  prefill number on the site.
- Quant `bpw` values are **measured**, not nominal. Q4_K_M is 4.83, not 4.00.

`src/lib/train.js` is calibrated against Unsloth's published figures — their
headline "Llama 3.1 8B QLoRA r=16, 2048 tokens, batch 2 fits in ~8 GB" comes
out at ~8.0 GB here.

### 4.3 Say when you are unsure
Every tool page carries a "What this assumes" section stating the error bar
(±20% inference, ±25% training) and the load-bearing assumptions. Keep it
honest. If you add a term you are not confident in, say so on the page.

---

## 5. Data visualisation

The memory meter is the only chart, and its palette is **validated, not
chosen**:

```
--series-1: #0891b2   --series-2: #8b5cf6   --series-3: #ec4899
```

These pass all six checks (lightness band, chroma floor, CVD adjacent
separation, normal-vision floor, contrast) against surface `#0c0f17` in dark
mode. **The obvious brand triple `#38bdf8 / #818cf8 / #c084fc` fails** — indigo
and violet separate by ΔE 0.9 under protanopia, i.e. they are the same colour
to a protanope. The brand ramp is *sequential*; it is correct for gradients and
wrong for categorical series.

If you change these, re-run the validator rather than eyeballing it.

Other rules that are load-bearing rather than decorative:
- The legend is always present and carries every value — the segments are too
  thin to hold direct labels, and identity must never be colour-alone.
- Status colours (`--status-good/warn/bad`) are **reserved**: never reused as a
  series hue, and never the only signal — every use ships with an icon and a
  word.
- Overflow past the budget is an **overlay** (`.meter-over`), not a fourth
  segment. The segments already sum to the total; appending the excess again
  double-counts it and runs the bar off its own track.
- The `<details>` table under each meter is the accessible view of the chart,
  and `#meter-desc` is its text description. Keep both in sync with the bar.

---

## 6. Workflows

```bash
npm install          # install dev dependencies
npm run dev          # vite dev server on :5174
npm run build        # production build -> ./dist
npm run preview      # serve ./dist on :4174
npm run smoke        # real-Chrome smoke test (needs preview running)
npm run og           # regenerate og.png + all icon PNGs
```

### Extensionless URLs

Cloudflare Pages serves `dist/vram.html` at `/vram`, so every link on the site
omits `.html`. Vite's dev and preview servers do not do that mapping natively,
so `vite.config.js` installs a small middleware to match. Without it, every
in-site link 404s locally while working fine in production — the worst possible
failure mode.

The plugin's hooks use **block bodies**. `middlewares.use()` returns the connect
app, and Vite treats a value returned from `configureServer` /
`configurePreviewServer` as a post-hook to invoke later — returning the app made
Vite call it with no arguments and crash before the server started.

### Running the smoke test

```bash
npm run build && npm run preview &   # then:
npm run smoke
```

Drives your installed Chrome via `puppeteer-core` (no browser download).
Override with `CHROME_PATH=/path/to/chrome` on non-macOS. Screenshots land in
`.cache/screens/`.

It asserts: no console errors on any page, the real production CSP applied as a
response header (so an inline-style regression fails here), extensionless
routes returning 200, `?p=8b&d=q4&ctx=32k` hydrating the form, results
computing, defaults elided from the URL, edits writing to the URL, the meter
segments staying inside the track, the OOM path rendering an overflow overlay,
conditional fields actually hiding, every segmented control having a selected
option, a hostile query string degrading gracefully, no element overflowing a
390px viewport, and reduced motion not starting the RAF loop.

### Regenerating social/icon assets

```bash
npm run og
```

Requires [`uv`](https://docs.astral.sh/uv/) on PATH and network access to PyPI.
Two stages, for a non-obvious reason: resvg cannot read woff2, and it cannot be
trusted with variable-font axes — Outfit's `wght` axis defaults to 100, so
handing resvg the variable font silently yields a Thin wordmark. Stage one
instances the axis at fixed weights; stage two composes and rasterises.

The instanced TTFs land in `.cache/fonts-ttf/` and are identical to ml.box's,
so you can copy them across instead of re-running stage one:

```bash
cp ../ml.box/.cache/fonts-ttf/* .cache/fonts-ttf/ && node scripts/gen-og.mjs
```

Edit the copy at the top of `gen-og.mjs` (`WORDMARK`, `EYEBROW`, `TAGLINE`)
then re-run. Commit the resulting PNGs — they are served assets.

### Deploy

```bash
CLOUDFLARE_ACCOUNT_ID="7ce2ff65bcdfde3b27345384c3de0d8c" \
  npx wrangler pages deploy dist --project-name tools-ml-box
```

The Pages project needs `tools.ml.box` added as a custom domain.

---

## 7. Verification Checklist

Before declaring a change complete:

1. `npm run build` succeeds in well under a second
2. `dist/` contains `index.html`, `vram.html`, `train.html`, `_headers`,
   `og.png`, `fonts/`, and hashed `assets/`
3. `npm run smoke` passes every check
4. Gzipped JS per page is still single-digit KB — if it jumped, something
   pulled in a dependency
5. If you touched `src/lib/calc.js` or `src/lib/train.js`, re-check the
   calibration table in §4.2
6. If you touched the palette, re-run the colour validator
7. Git tree clean and pushed
