/**
 * Hardware presets.
 *
 * Field reference:
 *   vram        Default on-board memory in GB. Editable in the UI — this is
 *               only the starting value.
 *   bw          Peak theoretical memory bandwidth, GB/s. Decode speed is
 *               almost entirely a function of this number.
 *   tflops      Dense FP16 tensor throughput with FP32 accumulate, in TFLOPS.
 *               Deliberately the conservative figure: vendor marketing quotes
 *               the 2x sparsity number, which no LLM runtime achieves. Prefill
 *               speed is a function of this.
 *   usableFrac  Fraction of `vram` a runtime can actually allocate. Below 1.0
 *               for unified memory (macOS reserves the rest for the system)
 *               and for the GTX 970, whose last 512 MB sits behind a crippled
 *               28 GB/s partition and is worse than useless for weights.
 *   rentUsd     Typical community-cloud rental, USD/hour. Volatile — treat as
 *               an order of magnitude, not a quote.
 *   kind        'cuda' | 'metal' | 'cpu'. Drives the fixed runtime overhead:
 *               a CUDA context costs ~600 MB before you load anything.
 */

export const HARDWARE_GROUPS = [
	{
		group: 'NVIDIA — GeForce',
		items: [
			hw({ id: 'rtx-5090', name: 'RTX 5090', vram: 32, bw: 1792, tflops: 210, rentUsd: 0.65 }),
			hw({ id: 'rtx-5080', name: 'RTX 5080', vram: 16, bw: 960, tflops: 112 }),
			hw({ id: 'rtx-5070-ti', name: 'RTX 5070 Ti', vram: 16, bw: 896, tflops: 88 }),
			hw({ id: 'rtx-5070', name: 'RTX 5070', vram: 12, bw: 672, tflops: 61 }),
			hw({ id: 'rtx-4090', name: 'RTX 4090', vram: 24, bw: 1008, tflops: 165, rentUsd: 0.44 }),
			hw({ id: 'rtx-4080-super', name: 'RTX 4080 Super', vram: 16, bw: 736, tflops: 104 }),
			hw({ id: 'rtx-4070-ti-super', name: 'RTX 4070 Ti Super', vram: 16, bw: 672, tflops: 88 }),
			hw({ id: 'rtx-4060-ti-16g', name: 'RTX 4060 Ti 16GB', vram: 16, bw: 288, tflops: 44, note: 'The memory is generous and the bus is not. 288 GB/s puts a hard ceiling on decode speed.' }),
			hw({ id: 'rtx-3090', name: 'RTX 3090', vram: 24, bw: 936, tflops: 71, rentUsd: 0.22, note: 'Still the best VRAM-per-dollar on the used market.' }),
			hw({ id: 'rtx-3090-ti', name: 'RTX 3090 Ti', vram: 24, bw: 1008, tflops: 80 }),
			hw({ id: 'rtx-3080-10g', name: 'RTX 3080 10GB', vram: 10, bw: 760, tflops: 60 }),
			hw({ id: 'rtx-3060-12g', name: 'RTX 3060 12GB', vram: 12, bw: 360, tflops: 25.6 }),
			hw({ id: 'gtx-1080-ti', name: 'GTX 1080 Ti', vram: 11, bw: 484, tflops: 11.3, note: 'Pascal has no usable FP16 path — the FLOPS figure here is FP32.' }),
			hw({
				id: 'gtx-970', name: 'GTX 970', vram: 4, bw: 224, tflops: 3.9, usableFrac: 0.875,
				note: 'The infamous 3.5 + 0.5 GB split: the last 512 MB runs at 28 GB/s. Usable VRAM is capped at 3.5 GB here on purpose.',
			}),
		],
	},
	{
		group: 'NVIDIA — workstation & datacenter',
		items: [
			hw({ id: 'rtx-pro-6000', name: 'RTX PRO 6000 Blackwell', vram: 96, bw: 1792, tflops: 252 }),
			hw({ id: 'rtx-6000-ada', name: 'RTX 6000 Ada', vram: 48, bw: 960, tflops: 182, rentUsd: 0.74 }),
			hw({ id: 'rtx-a6000', name: 'RTX A6000', vram: 48, bw: 768, tflops: 77, rentUsd: 0.49 }),
			hw({ id: 'l40s', name: 'L40S', vram: 48, bw: 864, tflops: 181, rentUsd: 0.99 }),
			hw({ id: 'l4', name: 'L4', vram: 24, bw: 300, tflops: 60, rentUsd: 0.43 }),
			hw({ id: 'a100-40', name: 'A100 40GB', vram: 40, bw: 1555, tflops: 312, rentUsd: 1.19 }),
			hw({ id: 'a100-80', name: 'A100 80GB', vram: 80, bw: 2039, tflops: 312, rentUsd: 1.65 }),
			hw({ id: 'h100-pcie', name: 'H100 PCIe 80GB', vram: 80, bw: 2000, tflops: 756, rentUsd: 2.19 }),
			hw({ id: 'h100-sxm', name: 'H100 SXM 80GB', vram: 80, bw: 3350, tflops: 989, rentUsd: 2.69 }),
			hw({ id: 'h200', name: 'H200 141GB', vram: 141, bw: 4800, tflops: 989, rentUsd: 3.59 }),
			hw({ id: 'b200', name: 'B200 180GB', vram: 180, bw: 8000, tflops: 2250, rentUsd: 5.99 }),
			hw({ id: 'v100-32', name: 'V100 32GB', vram: 32, bw: 900, tflops: 125, rentUsd: 0.29 }),
			hw({ id: 't4', name: 'Tesla T4 16GB', vram: 16, bw: 320, tflops: 65, rentUsd: 0.16 }),
		],
	},
	{
		group: 'AMD',
		items: [
			hw({ id: 'mi300x', name: 'Instinct MI300X', vram: 192, bw: 5300, tflops: 1307, rentUsd: 2.49 }),
			hw({ id: 'rx-7900-xtx', name: 'Radeon RX 7900 XTX', vram: 24, bw: 960, tflops: 123, note: 'ROCm support is real but rougher than CUDA. Expect lower achieved efficiency than the numbers suggest.' }),
			hw({ id: 'rx-9070-xt', name: 'Radeon RX 9070 XT', vram: 16, bw: 645, tflops: 97 }),
		],
	},
	{
		group: 'Apple silicon (unified memory)',
		items: [
			mac({ id: 'm1', name: 'M1', vram: 16, bw: 68, tflops: 2.6 }),
			mac({ id: 'm1-pro', name: 'M1 Pro', vram: 32, bw: 200, tflops: 10.4 }),
			mac({ id: 'm1-max', name: 'M1 Max', vram: 64, bw: 400, tflops: 21 }),
			mac({ id: 'm1-ultra', name: 'M1 Ultra', vram: 128, bw: 800, tflops: 42 }),
			mac({ id: 'm2', name: 'M2', vram: 16, bw: 100, tflops: 3.6 }),
			mac({ id: 'm2-pro', name: 'M2 Pro', vram: 32, bw: 200, tflops: 13.6 }),
			mac({ id: 'm2-max', name: 'M2 Max', vram: 96, bw: 400, tflops: 27 }),
			mac({ id: 'm2-ultra', name: 'M2 Ultra', vram: 192, bw: 800, tflops: 54 }),
			mac({ id: 'm3', name: 'M3', vram: 24, bw: 100, tflops: 4.1 }),
			mac({ id: 'm3-pro', name: 'M3 Pro', vram: 36, bw: 150, tflops: 14, note: 'M3 Pro cut bandwidth vs M2 Pro — 150 GB/s, not 200. It is slower at decode than its predecessor.' }),
			mac({ id: 'm3-max', name: 'M3 Max', vram: 128, bw: 400, tflops: 28 }),
			mac({ id: 'm3-ultra', name: 'M3 Ultra', vram: 512, bw: 800, tflops: 57, note: '512 GB of unified memory holds a 671B MoE at 4-bit. 800 GB/s means it will not be fast, but it will run.' }),
			mac({ id: 'm4', name: 'M4', vram: 32, bw: 120, tflops: 4.6 }),
			mac({ id: 'm4-pro', name: 'M4 Pro', vram: 48, bw: 273, tflops: 17 }),
			mac({ id: 'm4-max', name: 'M4 Max', vram: 128, bw: 546, tflops: 34 }),
			mac({ id: 'm5', name: 'M5', vram: 24, bw: 153, tflops: 18, note: 'Neural accelerators in every GPU core lift prefill dramatically; 153 GB/s still sets the decode ceiling.' }),
		],
	},
	{
		group: 'CPU only',
		items: [
			cpu({ id: 'ddr4-dual', name: 'DDR4-3200 dual channel', vram: 32, bw: 51, tflops: 1.8 }),
			cpu({ id: 'ddr5-dual', name: 'DDR5-5600 dual channel', vram: 64, bw: 90, tflops: 3.0 }),
			cpu({ id: 'ddr5-6400-dual', name: 'DDR5-6400 dual channel', vram: 96, bw: 102, tflops: 3.6 }),
			cpu({ id: 'ddr5-quad', name: 'DDR5-5600 quad channel', vram: 128, bw: 179, tflops: 6.0 }),
			cpu({ id: 'epyc-12ch', name: 'EPYC 12-channel DDR5-4800', vram: 384, bw: 460, tflops: 12, note: 'The cheapest route to running a 671B model at all. Single-digit tokens/sec, but it runs.' }),
		],
	},
];

function hw(cfg) {
	return { kind: 'cuda', usableFrac: 1, rentUsd: null, note: '', ...cfg };
}

/**
 * macOS caps how much unified memory the GPU may wire down. The default is
 * roughly 75% on machines with plenty of RAM; below that the system keeps a
 * larger slice. This is raisable with `sysctl iogpu.wired_limit_mb`, which the
 * UI mentions — but the default is what most people actually have.
 */
function mac(cfg) {
	return { kind: 'metal', usableFrac: cfg.vram >= 32 ? 0.75 : 0.67, rentUsd: null, note: '', ...cfg };
}

/**
 * CPU entries carry a `tflops` figure too, because prefill on a CPU is still
 * compute-bound and something has to divide into it. These are effective
 * AVX2/AVX-512 GEMM throughput for the class of machine that ships with that
 * memory configuration — nobody pairs 12-channel DDR5 with four cores.
 */
function cpu(cfg) {
	return { kind: 'cpu', usableFrac: 0.9, rentUsd: null, note: '', ...cfg };
}

export const HARDWARE = new Map(HARDWARE_GROUPS.flatMap((g) => g.items).map((x) => [x.id, x]));
export const DEFAULT_HW = 'rtx-3090';

export function resolveHardware(value, fallback = DEFAULT_HW) {
	if (!value) return HARDWARE.get(fallback);
	const key = String(value).trim().toLowerCase();
	return HARDWARE.get(key) ?? HARDWARE.get(fallback);
}

/**
 * System RAM options for the CPU-offload path. When a model does not fit in
 * VRAM, llama.cpp will happily put the overflow layers in system memory and
 * run them on the CPU — at whatever the DRAM bandwidth is. That is usually the
 * difference between "impossible" and "slow", so it is worth modelling.
 */
export const RAM_SPEEDS = [
	{ id: 'none', name: 'No offload (must fit in VRAM)', bw: 0 },
	{ id: 'ddr4-dual', name: 'DDR4-3200 dual channel', bw: 51 },
	{ id: 'ddr5-dual', name: 'DDR5-5600 dual channel', bw: 90 },
	{ id: 'ddr5-quad', name: 'DDR5-5600 quad channel', bw: 179 },
	{ id: 'epyc-12ch', name: 'EPYC 12-channel DDR5', bw: 460 },
];

export const RAM_MAP = new Map(RAM_SPEEDS.map((r) => [r.id, r]));
