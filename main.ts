// Forecast GTA VI's launch-day Twitch viewers, hour by hour, from the first
// hour's print.
//
// Method (all numbers measured on the case's own comparables; see README.md
// and analysis/analyze.py for the full table and backtest):
//
//   1. Shape. Past big launches that unlocked at midnight local time, rolling
//      across time zones -- the same unlock pattern as GTA VI, a console-only
//      game -- share one daily shape when each launch is scaled by its own
//      hour-1 count: a dip to about 0.75x in hour 4, a slow climb through the
//      morning, then a steep rise as the Americas unlock (05:00Z US East,
//      08:00Z US West) to a peak of about 2.4x in hour 19 (US afternoon),
//      easing to about 1.9x by hour 24. The program re-derives this shape at
//      run time from the comparables inside the case file: for each
//      comparable it takes the release day's 24 hourly counts, keeps the
//      launches whose unlock note says "midnight local" and whose tier is
//      "comparable", and takes the cross-launch median of viewers(h) /
//      viewers(1) at each hour. Launches with a simultaneous global unlock
//      or a paid early access are left out on purpose: their hour-1 count is
//      a pre-launch trickle, so their ratios explode and would drag the
//      median shape up and the spread out. If fewer than five such launches
//      qualify, the program falls back to the shape measured beforehand on
//      the kit's practice comparables (same 11 launches). In the final case
//      the set grows: its comparables add the four practice launches, all
//      rolling-midnight console games, so the median is then over 15.
//   2. Level. The median forecast for hour h is the case's hour-1 print
//      times the shape factor for h. Hour 1 is the only level information
//      the program uses; GTA VI's own pre-release category history is far
//      below launch scale and carries no usable level signal.
//   3. Spread. Quantiles are log-normal around the median with
//      sigma(h) = 0.20 * sqrt(h - 1), widening with the horizon. The scale
//      0.20 was picked on a leave-one-out backtest over the 11 rolling
//      launches (loss 0.304, versus 0.363 for the persistence baseline);
//      the wider cross-launch dispersion (log-sd about 0.63-0.71 after
//      hour 6) scored worse there, because most launches track the median
//      shape closely and a few far outliers should not widen every hour's
//      band. The house baseline uses the same sqrt shape with 0.15.
//
// The program is deterministic: no clock, no randomness, no network, and
// every input file is processed in name order. It reads the case files from
// $MAKEFUN_INPUT_DIR (else /input) and writes one <id>.out per case to
// $MAKEFUN_OUTPUT_DIR (else /output).
//
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

/** Quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** Standard normal quantiles at LEVELS. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Log-spread scale per square-root hour (leave-one-out winner, see above). */
const SPREAD_SCALE = 0.2;
/** A comparable only counts toward the shape if it has this many hours. */
const MIN_CURVE_HOURS = 20;
/** Fall back to the pre-measured shape below this many rolling launches. */
const MIN_ROLLING_LAUNCHES = 5;

/**
 * Shape measured beforehand on the kit's practice comparables: the median
 * viewers(h) / viewers(1) over the 11 rolling-midnight launches
 * (Black Ops 6, Modern Warfare 4, Modern Warfare III, Cyberpunk 2077,
 * ELDEN RING, FINAL FANTASY VII REBIRTH, Ghost of Yōtei, Monster Hunter
 * Wilds, Resident Evil Requiem, The Last of Us Part II, Zelda: Tears of
 * the Kingdom -- see analysis/analyze.py). Used only when the case at
 * hand yields too few rolling launches.
 */
const FALLBACK_SHAPE: Record<number, number> = {
  2: 0.898, 3: 0.803, 4: 0.75, 5: 0.821, 6: 0.989, 7: 1.046, 8: 1.06,
  9: 1.026, 10: 1.08, 11: 1.085, 12: 1.078, 13: 1.2, 14: 1.313, 15: 1.518,
  16: 1.82, 17: 1.951, 18: 2.065, 19: 2.402, 20: 2.372, 21: 2.33,
  22: 2.298, 23: 2.182, 24: 1.902,
};

interface HourlyPoint {
  from: string;
  viewers: number;
}

interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  hourly: HourlyPoint[];
}

interface CaseFile {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables?: Comparable[];
}

/** The median of a non-empty list of numbers (sorted copy, middle value). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "2026-11-19T00:00:00Z" shifted by `hours` whole hours, same format. */
function shiftHour(iso: string, hours: number): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The release-day shape implied by one comparable: viewers(h) / viewers(1)
 * for h = 2..24, from its hourly points. Returns null when the launch has
 * no usable hour-1 count or too few hours of its release day.
 */
function launchRatios(comp: Comparable): Map<number, number> | null {
  const byFrom = new Map<string, number>();
  for (const p of comp.hourly ?? []) {
    if (typeof p.viewers === "number" && p.viewers > 0) byFrom.set(p.from, p.viewers);
  }
  const first = byFrom.get(comp.day_start);
  if (first === undefined) return null;
  const ratios = new Map<number, number>();
  for (let h = 1; h <= 24; h++) {
    const v = byFrom.get(shiftHour(comp.day_start, h - 1));
    if (v !== undefined) ratios.set(h, v / first);
  }
  return ratios.size >= MIN_CURVE_HOURS ? ratios : null;
}

/** True for a rolling-midnight launch of the comparable tier (GTA VI's class). */
function isRollingLaunch(comp: Comparable): boolean {
  const note = (comp.unlock ?? "").toLowerCase();
  return note.includes("midnight local") && note.includes("tier: comparable");
}

/**
 * Median shape factor per hour, re-derived from the case's comparables.
 * Falls back to FALLBACK_SHAPE when too few rolling launches qualify.
 */
function deriveShape(comparables: Comparable[] | undefined): Record<number, number> {
  const perHour: number[][] = Array.from({ length: 25 }, () => []);
  let launches = 0;
  for (const comp of comparables ?? []) {
    if (!isRollingLaunch(comp)) continue;
    const ratios = launchRatios(comp);
    if (ratios === null) continue;
    launches++;
    for (let h = 2; h <= 24; h++) {
      const r = ratios.get(h);
      if (r !== undefined) perHour[h].push(r);
    }
  }
  if (launches < MIN_ROLLING_LAUNCHES) return { ...FALLBACK_SHAPE };
  const shape: Record<number, number> = {};
  for (let h = 2; h <= 24; h++) {
    shape[h] = perHour[h].length > 0 ? median(perHour[h]) : FALLBACK_SHAPE[h];
  }
  return shape;
}

/** A value rounded to 2 decimals (half up), as the house baseline does. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** The five quantiles for one hour: median * exp(z * sigma), kept in order. */
function hourQuantiles(medianValue: number, hour: number): number[] {
  const sigma = SPREAD_SCALE * Math.sqrt(hour - 1);
  let prev = 0;
  return Z.map((z) => {
    const q = round2(medianValue * Math.exp(z * sigma));
    const clamped = Math.min(1e9, Math.max(0.01, q));
    const out = Math.max(clamped, prev);
    prev = out;
    return out;
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith(".in")).sort();
for (const file of inputs) {
  const id = file.slice(0, -".in".length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), "utf8")) as CaseFile;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${file} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);
  const shape = deriveShape(c.comparables);
  const hours = [...c.forecast]
    .sort((a, b) => a.hour - b.hour)
    .map(({ hour }) => ({ hour, q: hourQuantiles(p1 * shape[hour], hour) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
