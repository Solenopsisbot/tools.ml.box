# tools.ml.box

Calculators for running and training large language models. A sub-site of
[ml.box](https://ml.box).

- **[/vram](https://tools.ml.box/vram)** — will this model fit, and how fast
  will it decode? Real attention shapes (GQA, sliding windows, MLA, MoE),
  measured bits-per-weight, bandwidth-bound throughput, CPU offload.
- **[/serve](https://tools.ml.box/serve)** — how many concurrent users one GPU
  can hold at a target latency, and what that costs per million tokens.
- **[/train](https://tools.ml.box/train)** — LoRA and QLoRA memory, wall-clock
  time and rental cost for a given dataset, sequence length and GPU.
- **[/quant](https://tools.ml.box/quant)** — the measured perplexity cost of
  every quantisation level, and which one to actually download.
- **[/cost](https://tools.ml.box/cost)** — what a workload costs across hosted
  providers, and the token volume at which renting a GPU becomes cheaper.

Every result is a URL: `tools.ml.box/vram?p=8b&d=q4&ctx=32k` reproduces a
calculation exactly, so you can paste numbers at someone instead of a
screenshot.

Everything runs in the browser. No backend, no account, no analytics, and no
network request after the page loads.

## Development

```bash
npm install
npm run dev                          # :5174
npm run build && npm run preview &   # :4174
npm run smoke                        # real-Chrome smoke test
```

Zero runtime dependencies — Vite, vanilla ES modules, vanilla CSS, raw WebGL2.

Read [AGENTS.md](AGENTS.md) before changing anything. It documents the rules
that are load-bearing rather than stylistic: query keys are a public contract,
the CSP forbids inline style attributes, and the speed constants are calibrated
against a table of published benchmarks.

## Accuracy

Most of these are first-principles estimates with constants calibrated against
published llama.cpp, vLLM and Unsloth figures — good to roughly ±20% for
inference and ±25% for training. Good enough to decide what to download and
which card to buy; not a substitute for benchmarking your own stack.

`/quant` is the exception: it reproduces published perplexity measurements
rather than estimating anything, and shows "not measured" wherever the dataset
is silent instead of interpolating.

`/cost` carries hosted API prices, which go stale. Anthropic rows are
first-party published rates; the rest are marked approximate, and the table
shows the date it was last checked.
