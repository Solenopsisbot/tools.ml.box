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
├── serve.html                # /serve  — batched serving throughput
├── train.html                # /train  — finetune memory, time, cost
├── quant.html                # /quant  — measured quantisation quality
├── cost.html                 # /cost   — API cost & self-host crossover
├── vite.config.js            # Multi-page entries + extensionless-URL middleware
├── wrangler.toml
├── package.json              # ZERO runtime deps. Keep it that way.
├── scripts/
│   ├── sync-nav.mjs          # projects the tool registry onto every <nav>
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
    ├── serve-page.js         # /serve entry  (NOT serve.js — see §3.6)
    ├── train-page.js         # /train entry  (NOT train.js — see §3.6)
    ├── quant-page.js         # /quant entry  (NOT quant.js — see §3.6)
    ├── cost-page.js          # /cost  entry
    └── lib/
        ├── models.js         # model architectures (real config.json values)
        ├── quant.js          # bits-per-weight tables
        ├── hardware.js       # GPU / Apple / CPU specs
        ├── calc.js           # inference memory + speed maths
        ├── serve.js          # continuous-batching throughput maths
        ├── train.js          # training memory + time + cost maths
        ├── quality.js        # MEASURED perplexity data — see §4.4
        ├── providers.js      # hosted API pricing + self-host comparison
        ├── custom-model.js   # user-defined architectures — see section 4.6
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

### 3.2 Adding a tool means five edits
1. An entry in `src/lib/tools.js` (the registry — do this first)
2. A new `<name>.html` at the repo root
3. A new entry in `vite.config.js` under `build.rollupOptions.input`
4. A URL in `public/sitemap.xml` and a revalidate rule in `public/_headers`
5. `npm run nav` — projects the registry onto every page's `<nav>`

Miss one and you ship a page nobody can reach, or a link that 404s. The smoke
test asserts that every registry href appears in the nav, which catches a
forgotten step 5.

**Never hand-edit a `<nav>` block.** With five static pages the header is
physically duplicated five times; `scripts/sync-nav.mjs` exists so that
duplication cannot drift. It is idempotent, so running it is always safe.

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

### 3.6 Page entries end in `-page.js` when a lib shares the name
`/train`, `/serve` and `/quant` all have a maths or data module of the same
name under `src/lib/`, so their entries are `src/train-page.js`,
`src/serve-page.js` and `src/quant-page.js`. Naming an entry `src/train.js`
would sit one directory above `src/lib/train.js` and make every future import
ambiguous to read. `/vram` and `/cost` follow whichever form is unambiguous.

### 3.7 Boot last
Every tool entry calls `state.hydrate()` and `render()` as the **final**
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
post. `inter` is only used for LoRA parameter counting. If you cannot find a
real config, do not add the model — that is what the custom entry in §4.5 is
for. `approx: true` is the narrow exception: parameter counts solid, attention
shape reconstructed, and the UI warns the reader.

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

`src/lib/serve.js` shares the bandwidth model but with a different batch
term: weights are read once per decode step, KV once per sequence. Two
constants differ deliberately — decode MFU is 0.25 rather than prefill's 0.5
(batched decode GEMMs are skinny and never reach a long prompt's arithmetic
intensity), and `KV_UTILISATION` is 0.90 to match vLLM's default.

**Invariant:** `batchLadder()` returns an empty array when nothing fits. It
used to clamp to `max(1, n)`, and an unservable configuration then quoted a
throughput and a cost per token directly contradicting its own verdict. Any
page that reports a derived figure must gate it on `runnable`.

### 4.3 Say when you are unsure
Every tool page carries a "What this assumes" section stating the error bar
(±20% inference, ±25% training) and the load-bearing assumptions. Keep it
honest. If you add a term you are not confident in, say so on the page.

---

### 4.4 `src/lib/quality.js` is measurements, not estimates

Different rules apply to this file than to the rest of the site.

- **Never interpolate and never extrapolate.** Where the dataset is silent the
  UI renders "not measured". A plausible-looking number under a heading that
  says *measured* is worse than an empty cell.
- **`QUANT_TO_REFERENCE` must stay one-to-one.** It once mapped several
  reference rows onto a single site-wide quant id, and the lookup returned
  whichever came first in the array — so the tool reported Q4_K_S's damage
  under Q4_K_M's name, roughly double the real figure. Reference rows with no
  exact site-wide equivalent (Q3_K_S, Q3_K_L, Q4_K_S, Q5_0) appear in the
  ladder and attach to nothing.
- **Recommend by quality per byte, not by precision.** `RECOMMENDATION_ORDER`
  starts at Q6_K, because Q6_K measures 0.07% damage at a third of FP16's
  size. An earlier version picked the highest precision that fits and told
  people to take FP16 on a page whose own table contradicts that.
- **LLaMA-2 only, and say so.** It is the one family measured consistently
  across every level on one harness. Stitching newer piecemeal measurements
  together would produce a table that looks authoritative and is not.

### 4.5 Custom models: `src/lib/custom-model.js`

Presets only hold architectures whose shape came off a published config.
Everything else goes through the custom entry rather than being guessed at in
`models.js` — that is the whole reason it exists, so **resist adding a model
you had to reconstruct**. If you must, set `approx: true` and the UI will say
so.

Three invariants:

- **`FIELDS` order is positional and append-only.** The spec rides in one query
  parameter as `cm=8,8,32,4096,8,128,14336,128k`. Reordering or removing an
  entry silently decodes every existing link into a different architecture.
- **Eight visible inputs, one hidden `#cm`.** UrlState binds to the hidden
  input; the visible fields write into it. Eight separate query keys would make
  the URL unreadable and burn eight names out of a public namespace.
- **`sync()` runs on hydrate and popstate only, never on every render.**
  Writing sanitised values back mid-edit makes the field fight the keyboard —
  clear it to retype and it snaps to the minimum under your cursor.

`active` follows `params` until someone edits it directly. Without that, typing
70 into params leaves active at its default of 8 and the tool reports a 70B
model decoding at 8B speeds — a wrong answer that looks entirely reasonable.

A custom entry is always modelled as plain GQA: `swa` and `mla` are forced
null. Both change the cache by multiples and neither is expressible in eight
number fields without inviting a wrong answer, so the custom path is
deliberately the pessimistic one and the UI says so.

### 4.6 `src/lib/providers.js` will go stale

There is no price feed — this is a static site. Every row carries a
`confidence` (`published` vs `approximate`) that the UI renders, and
`PRICES_AS_OF` is shown prominently. When you touch a number, update the date;
when you are no longer sure a figure is current, downgrade it to `approximate`
rather than leaving a stale `published` claim standing.

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
npm run nav          # rewrite every page's <nav> from the tool registry
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
On a network with a TLS-inspecting proxy, `uv` needs the extra root CA — pass
`--system-certs` or set `SSL_CERT_FILE` — or skip stage one entirely by copying
the cached TTFs across, as below.
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
  npx wrangler pages deploy dist --project-name tools-ml-box --branch main
```

Attaching a custom domain takes **two** steps, and wrangler 3 has no
`pages domain` subcommand for either. First register it with the Pages API:

```bash
TOK=$(grep '^oauth_token' ~/Library/Preferences/.wrangler/config/default.toml | sed 's/.*= *"\(.*\)"/\1/')
curl -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  --data '{"name":"tools.ml.box"}' \
  "https://api.cloudflare.com/client/v4/accounts/7ce2ff65bcdfde3b27345384c3de0d8c/pages/projects/tools-ml-box/domains"
```

Then create the DNS record. **Cloudflare does not create it for you on this
path.** The dashboard flow does; the API call above only registers the domain
and leaves it `status: pending` forever while the hostname stays NXDOMAIN.

Wrangler's OAuth token carries `pages:write` and `zone:read` but **no DNS
scope**, so it cannot create the record — a `dns_records` POST returns
`10000 Authentication error`. You need either the dashboard or a scoped API
token (`Zone → DNS → Edit` on the `ml.box` zone):

```bash
curl -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"CNAME","name":"tools","content":"tools-ml-box.pages.dev","proxied":true}' \
  "https://api.cloudflare.com/client/v4/zones/bbfb65cdbc01b8fbc51d84fe0801c0da/dns_records"
```

The domain moves from `pending` to `active` within a few minutes of the record
appearing, once the certificate is issued.

Smoke-test the deployment, not just the local build:

```bash
SMOKE_URL="https://tools.ml.box" npm run smoke
```

---

## 7. Verification Checklist

Before declaring a change complete:

1. `npm run build` succeeds in well under a second
2. `dist/` contains every page's `.html`, plus `_headers`, `og.png`, `fonts/`
   and hashed `assets/`
3. `npm run smoke` passes every check, locally **and** against the deployment
4. Gzipped JS per page is still single-digit KB — if it jumped, something
   pulled in a dependency
5. If you touched `calc.js`, `serve.js` or `train.js`, re-check the calibration
   table in §4.2
6. If you touched `quality.js`, re-read §4.4 — that file has stricter rules
7. If you touched `custom-model.js`, re-read §4.5 — `FIELDS` is append-only
8. If you touched the palette, re-run the colour validator
9. If you added or renamed a tool, `npm run nav` and check all five edits in §3.2
10. Git tree clean and pushed
