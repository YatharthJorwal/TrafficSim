# Fixed-time vs adaptive: 5 profiles, 8 seeds, 1800 s

8 seeds (1..8), 1800 s simulated per run, arrivals mode. For each profile and seed every controller ran on the identical arrival schedule. Values are mean ± standard deviation over seeds. There is no drain period: vehicles still queued or waiting to enter at the end are counted as unserved and their waiting so far is included in the wait metrics. Detector queue counts stop at what the 80 m detector zone can hold (about 13 vehicles), so in overloaded profiles the max queue is the same for every controller and says nothing about them; the mean queue and the waits do.

## Light

120 veh/h per approach (480 total, under half of capacity)

| Controller | Cleared per hour (veh/h) | Mean wait (all generated) (s) | 95th percentile wait (s) | Longest wait (s) | Max queue (detector) (veh) | Mean queue (detector) (veh) | Unserved at end (veh) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed 60 s, equal split | 456.0 ± 20.0 | 8.3 ± 1.3 | 27.1 ± 2.1 | 39.7 ± 7.5 | 4.4 ± 0.5 | 0.25 ± 0.05 | 4.4 ± 2.1 |
| Fixed, Webster-tuned to mean demand | 456.8 ± 18.9 | 4.8 ± 0.6 | 16.6 ± 1.7 | 29.2 ± 6.3 | 3.4 ± 0.5 | 0.15 ± 0.02 | 4.0 ± 2.2 |
| Fixed, best plan searched on separate seeds | 456.8 ± 18.9 | 4.8 ± 0.6 | 16.6 ± 1.7 | 29.2 ± 6.3 | 3.4 ± 0.5 | 0.15 ± 0.02 | 4.0 ± 2.2 |
| Adaptive (rule-based) | 457.0 ± 19.6 | 3.8 ± 0.5 | 15.0 ± 0.9 | 24.2 ± 4.6 | 3.3 ± 0.5 | 0.12 ± 0.02 | 3.9 ± 1.9 |

**Adaptive (rule-based) compared with each baseline** (paired by seed; difference = Adaptive (rule-based) minus baseline; ± is the 95 % confidence half-width of the mean difference)

| Baseline | Metric | Difference | Seeds better / tied / worse | Verdict |
|---|---|---:|---:|---|
| Fixed 60 s, equal split | Mean wait (all generated) (s) | -4.5 ± 1.1 | 8 / 0 / 0 | better |
| Fixed 60 s, equal split | Cleared per hour (veh/h) | +1.0 ± 1.5 | 4 / 3 / 1 | no clear difference |
| Fixed 60 s, equal split | Longest wait (s) | -15.5 ± 4.9 | 8 / 0 / 0 | better |
| Fixed, Webster-tuned to mean demand | Mean wait (all generated) (s) | -1.0 ± 0.5 | 8 / 0 / 0 | better |
| Fixed, Webster-tuned to mean demand | Cleared per hour (veh/h) | +0.3 ± 2.3 | 2 / 3 / 3 | no clear difference |
| Fixed, Webster-tuned to mean demand | Longest wait (s) | -5.0 ± 3.8 | 7 / 0 / 1 | better |
| Fixed, best plan searched on separate seeds | Mean wait (all generated) (s) | -1.0 ± 0.5 | 8 / 0 / 0 | better |
| Fixed, best plan searched on separate seeds | Cleared per hour (veh/h) | +0.3 ± 2.3 | 2 / 3 / 3 | no clear difference |
| Fixed, best plan searched on separate seeds | Longest wait (s) | -5.0 ± 3.8 | 7 / 0 / 1 | better |

## Balanced

250 veh/h per approach (1000 total, about at capacity)

| Controller | Cleared per hour (veh/h) | Mean wait (all generated) (s) | 95th percentile wait (s) | Longest wait (s) | Max queue (detector) (veh) | Mean queue (detector) (veh) | Unserved at end (veh) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed 60 s, equal split | 963.8 ± 32.2 | 24.6 ± 8.9 | 81.1 ± 43.0 | 123.1 ± 49.2 | 11.5 ± 1.5 | 1.36 ± 0.39 | 18.3 ± 8.5 |
| Fixed, Webster-tuned to mean demand | 960.3 ± 28.0 | 27.4 ± 7.4 | 83.0 ± 32.1 | 135.4 ± 44.4 | 11.3 ± 1.8 | 1.58 ± 0.41 | 20.0 ± 8.7 |
| Fixed, best plan searched on separate seeds | 968.0 ± 33.1 | 19.6 ± 7.1 | 65.6 ± 29.9 | 108.3 ± 36.2 | 10.4 ± 2.6 | 1.10 ± 0.35 | 16.1 ± 6.7 |
| Adaptive (rule-based) | 970.8 ± 35.0 | 20.3 ± 6.8 | 60.2 ± 19.7 | 101.0 ± 30.3 | 11.0 ± 2.2 | 1.15 ± 0.37 | 14.8 ± 8.6 |

**Adaptive (rule-based) compared with each baseline** (paired by seed; difference = Adaptive (rule-based) minus baseline; ± is the 95 % confidence half-width of the mean difference)

| Baseline | Metric | Difference | Seeds better / tied / worse | Verdict |
|---|---|---:|---:|---|
| Fixed 60 s, equal split | Mean wait (all generated) (s) | -4.4 ± 6.9 | 6 / 0 / 2 | no clear difference |
| Fixed 60 s, equal split | Cleared per hour (veh/h) | +7.0 ± 12.3 | 6 / 1 / 1 | no clear difference |
| Fixed 60 s, equal split | Longest wait (s) | -22.1 ± 39.6 | 5 / 0 / 3 | no clear difference |
| Fixed, Webster-tuned to mean demand | Mean wait (all generated) (s) | -7.1 ± 3.5 | 7 / 0 / 1 | better |
| Fixed, Webster-tuned to mean demand | Cleared per hour (veh/h) | +10.5 ± 11.1 | 7 / 0 / 1 | no clear difference |
| Fixed, Webster-tuned to mean demand | Longest wait (s) | -34.3 ± 32.6 | 6 / 0 / 2 | better |
| Fixed, best plan searched on separate seeds | Mean wait (all generated) (s) | +0.7 ± 4.6 | 5 / 0 / 3 | no clear difference |
| Fixed, best plan searched on separate seeds | Cleared per hour (veh/h) | +2.8 ± 12.1 | 3 / 2 / 3 | no clear difference |
| Fixed, best plan searched on separate seeds | Longest wait (s) | -7.2 ± 32.9 | 4 / 1 / 3 | no clear difference |

## Uneven

N/S 450, E/W 100 veh/h per approach (1100 total, directional)

| Controller | Cleared per hour (veh/h) | Mean wait (all generated) (s) | 95th percentile wait (s) | Longest wait (s) | Max queue (detector) (veh) | Mean queue (detector) (veh) | Unserved at end (veh) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed 60 s, equal split | 773.3 ± 29.3 | 229.2 ± 43.9 | 596.0 ± 73.7 | 668.7 ± 66.0 | 13.0 ± 0.0 | 2.59 ± 0.15 | 148.1 ± 27.9 |
| Fixed, Webster-tuned to mean demand | 1003.5 ± 32.3 | 42.9 ± 25.7 | 139.5 ± 66.7 | 227.1 ± 56.7 | 12.9 ± 0.4 | 1.48 ± 0.29 | 33.0 ± 18.8 |
| Fixed, best plan searched on separate seeds | 1003.5 ± 32.3 | 42.9 ± 25.7 | 139.5 ± 66.7 | 227.1 ± 56.7 | 12.9 ± 0.4 | 1.48 ± 0.29 | 33.0 ± 18.8 |
| Adaptive (rule-based) | 988.0 ± 32.1 | 49.5 ± 22.4 | 171.1 ± 79.6 | 220.6 ± 89.6 | 13.0 ± 0.0 | 1.33 ± 0.25 | 40.8 ± 19.0 |

**Adaptive (rule-based) compared with each baseline** (paired by seed; difference = Adaptive (rule-based) minus baseline; ± is the 95 % confidence half-width of the mean difference)

| Baseline | Metric | Difference | Seeds better / tied / worse | Verdict |
|---|---|---:|---:|---|
| Fixed 60 s, equal split | Mean wait (all generated) (s) | -179.7 ± 24.2 | 8 / 0 / 0 | better |
| Fixed 60 s, equal split | Cleared per hour (veh/h) | +214.8 ± 28.1 | 8 / 0 / 0 | better |
| Fixed 60 s, equal split | Longest wait (s) | -448.1 ± 82.5 | 8 / 0 / 0 | better |
| Fixed, Webster-tuned to mean demand | Mean wait (all generated) (s) | +6.6 ± 9.7 | 2 / 0 / 6 | no clear difference |
| Fixed, Webster-tuned to mean demand | Cleared per hour (veh/h) | -15.5 ± 11.6 | 1 / 0 / 7 | worse |
| Fixed, Webster-tuned to mean demand | Longest wait (s) | -6.5 ± 63.7 | 4 / 0 / 4 | no clear difference |
| Fixed, best plan searched on separate seeds | Mean wait (all generated) (s) | +6.6 ± 9.7 | 2 / 0 / 6 | no clear difference |
| Fixed, best plan searched on separate seeds | Cleared per hour (veh/h) | -15.5 ± 11.6 | 1 / 0 / 7 | worse |
| Fixed, best plan searched on separate seeds | Longest wait (s) | -6.5 ± 63.7 | 4 / 0 / 4 | no clear difference |

## Heavy

400 veh/h per approach (1600 total, over capacity)

| Controller | Cleared per hour (veh/h) | Mean wait (all generated) (s) | 95th percentile wait (s) | Longest wait (s) | Max queue (detector) (veh) | Mean queue (detector) (veh) | Unserved at end (veh) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed 60 s, equal split | 1084.0 ± 40.6 | 253.2 ± 28.8 | 580.7 ± 74.5 | 668.2 ± 79.0 | 13.0 ± 0.0 | 5.19 ± 0.18 | 257.6 ± 31.8 |
| Fixed, Webster-tuned to mean demand | 1053.5 ± 23.6 | 271.4 ± 27.1 | 613.1 ± 56.2 | 707.5 ± 59.1 | 13.0 ± 0.0 | 5.89 ± 0.21 | 272.9 ± 27.1 |
| Fixed, best plan searched on separate seeds | 1103.3 ± 35.4 | 245.2 ± 36.0 | 534.1 ± 68.5 | 631.4 ± 80.4 | 13.0 ± 0.0 | 4.61 ± 0.14 | 248.0 ± 34.5 |
| Adaptive (rule-based) | 1088.0 ± 45.4 | 250.8 ± 25.3 | 566.1 ± 67.9 | 655.7 ± 86.6 | 13.0 ± 0.0 | 4.36 ± 0.10 | 255.6 ± 26.3 |

**Adaptive (rule-based) compared with each baseline** (paired by seed; difference = Adaptive (rule-based) minus baseline; ± is the 95 % confidence half-width of the mean difference)

| Baseline | Metric | Difference | Seeds better / tied / worse | Verdict |
|---|---|---:|---:|---|
| Fixed 60 s, equal split | Mean wait (all generated) (s) | -2.4 ± 12.6 | 5 / 0 / 3 | no clear difference |
| Fixed 60 s, equal split | Cleared per hour (veh/h) | +4.0 ± 20.5 | 5 / 1 / 2 | no clear difference |
| Fixed 60 s, equal split | Longest wait (s) | -12.5 ± 36.7 | 4 / 0 / 4 | no clear difference |
| Fixed, Webster-tuned to mean demand | Mean wait (all generated) (s) | -20.6 ± 19.9 | 7 / 0 / 1 | better |
| Fixed, Webster-tuned to mean demand | Cleared per hour (veh/h) | +34.5 ± 26.8 | 7 / 0 / 1 | better |
| Fixed, Webster-tuned to mean demand | Longest wait (s) | -51.7 ± 79.2 | 4 / 0 / 4 | no clear difference |
| Fixed, best plan searched on separate seeds | Mean wait (all generated) (s) | +5.6 ± 15.5 | 4 / 0 / 4 | no clear difference |
| Fixed, best plan searched on separate seeds | Cleared per hour (veh/h) | -15.3 ± 26.0 | 2 / 0 / 6 | no clear difference |
| Fixed, best plan searched on separate seeds | Longest wait (s) | +24.4 ± 60.7 | 3 / 0 / 5 | no clear difference |

## Shifting

N/S 450 and E/W 100 for the first half, then N/S 100 and E/W 450 (1100 total, the dominant road changes)

| Controller | Cleared per hour (veh/h) | Mean wait (all generated) (s) | 95th percentile wait (s) | Longest wait (s) | Max queue (detector) (veh) | Mean queue (detector) (veh) | Unserved at end (veh) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed 60 s, equal split | 894.5 ± 32.2 | 170.1 ± 38.4 | 477.9 ± 104.8 | 552.8 ± 112.2 | 13.0 ± 0.0 | 3.31 ± 0.48 | 95.6 ± 19.4 |
| Fixed, Webster-tuned to mean demand | 884.8 ± 34.1 | 182.4 ± 39.0 | 509.7 ± 105.2 | 586.4 ± 113.8 | 13.0 ± 0.0 | 3.88 ± 0.58 | 100.5 ± 21.8 |
| Fixed, best plan searched on separate seeds | 830.5 ± 34.3 | 126.3 ± 24.8 | 431.8 ± 51.0 | 498.0 ± 65.8 | 13.0 ± 0.0 | 2.38 ± 0.28 | 127.6 ± 21.1 |
| Adaptive (rule-based) | 984.3 ± 33.7 | 57.2 ± 26.5 | 161.5 ± 74.5 | 212.4 ± 79.2 | 13.0 ± 0.0 | 1.54 ± 0.35 | 50.8 ± 23.8 |

**Adaptive (rule-based) compared with each baseline** (paired by seed; difference = Adaptive (rule-based) minus baseline; ± is the 95 % confidence half-width of the mean difference)

| Baseline | Metric | Difference | Seeds better / tied / worse | Verdict |
|---|---|---:|---:|---|
| Fixed 60 s, equal split | Mean wait (all generated) (s) | -112.9 ± 25.8 | 8 / 0 / 0 | better |
| Fixed 60 s, equal split | Cleared per hour (veh/h) | +89.8 ± 15.5 | 8 / 0 / 0 | better |
| Fixed 60 s, equal split | Longest wait (s) | -340.4 ± 105.6 | 8 / 0 / 0 | better |
| Fixed, Webster-tuned to mean demand | Mean wait (all generated) (s) | -125.2 ± 25.8 | 8 / 0 / 0 | better |
| Fixed, Webster-tuned to mean demand | Cleared per hour (veh/h) | +99.5 ± 10.6 | 8 / 0 / 0 | better |
| Fixed, Webster-tuned to mean demand | Longest wait (s) | -374.0 ± 95.5 | 8 / 0 / 0 | better |
| Fixed, best plan searched on separate seeds | Mean wait (all generated) (s) | -69.1 ± 10.0 | 8 / 0 / 0 | better |
| Fixed, best plan searched on separate seeds | Cleared per hour (veh/h) | +153.8 ± 18.2 | 8 / 0 / 0 | better |
| Fixed, best plan searched on separate seeds | Longest wait (s) | -285.6 ± 30.9 | 8 / 0 / 0 | better |

## Safety counters

Red-light entries, anti-overlap guard hits and overlapping vehicle pairs were all 0 in every run.

**Max-green watchdog (informational).** The signal machine ends any green that reaches its maximum length, whatever the controller asked for. It fired in: Adaptive (rule-based) (17 of 40 runs). The adaptive controller deliberately keeps a green while no other road has meaningful demand, so the watchdog ends that rest at the limit.

