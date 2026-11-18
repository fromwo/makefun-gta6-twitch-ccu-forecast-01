# makefun-gta6-twitch-ccu-forecast-01

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/fromwo/makefun-gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/fromwo/makefun-gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecasts GTA VI's launch-day Twitch viewers hour by hour from the first hour's print. The median for each hour is the hour-1 count times the launch-day shape of past rolling-midnight console launches, with log-normal quantiles widening as the square root of the horizon.

## How it works

`main.ts` (Node 22, standard library only, no network, fully deterministic) reads one case at a time from `/input/<id>.in` and writes one forecast to `/output/<id>.out`: five quantiles of Twitch viewers for each of hours 2–24 of the release day.

- **Shape, re-derived at run time from the case's own comparables.** For each comparable the program takes its release day's 24 hourly counts and keeps only the launches that unlocked at midnight local time, rolling across time zones — GTA VI's own unlock pattern, a console-only game — and whose tier is "comparable". It then takes the cross-launch median of `viewers(h) / viewers(1)` at each hour. Launches with a simultaneous global unlock or a paid early access are excluded: their hour-1 count is a pre-launch trickle, so their ratios explode and would drag the shape up. On the kit's practice comparables the rolling set is 11 launches.
- **Median shape (hour-1 = 1.00):** h2 0.90, h3 0.80, h4 0.75, h5 0.82, h6 0.99, h7 1.05, h8 1.06, h9 1.03, h10 1.08, h11 1.09, h12 1.08, h13 1.20, h14 1.31, h15 1.52, h16 1.82, h17 1.95, h18 2.07, h19 2.40, h20 2.37, h21 2.33, h22 2.30, h23 2.18, h24 1.90. The curve dips overnight, climbs slowly through the morning, then rises steeply as the Americas unlock (US East 05:00Z, US West 08:00Z) to a peak in hour 19 — the US afternoon — and eases into the night.
- **Spread:** quantiles are log-normal around the median with `sigma(h) = 0.20 * sqrt(h - 1)`. The scale 0.20 was picked on a leave-one-out backtest over the 11 rolling launches; the wider cross-launch dispersion (log-sd about 0.63–0.71 after hour 6) scored worse, because most launches track the median shape closely and a few far outliers should not widen every hour's band.

## Validation

- **Backtest (each comparable's launch day as a pseudo-case, hour 1 known, hours 2–24 answered):** leave-one-out mean log pinball loss **0.304** (spread 0.20) versus **0.363** for the persistence baseline — about 16% better. In-sample the same model scores 0.281 versus 0.363. The house baseline scores 0.387 on the four practice cases; the practice answers are not in the kit, so no practice loss can be computed locally.
- **Practice cases p00–p03:** all four outputs pass the format check (exactly 23 rows, hours 2–24, five finite non-decreasing quantiles in (0, 1e9], under 65,536 bytes), two runs are byte-identical, and each case runs in about 150 ms — far under the 8-second cap.
- **Local grade:** `grade-local` refuses program/v1 competitions ("its scorer and reference data are not published in the kit, so it is graded on the server only"), as the kit's RULES.txt states.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
