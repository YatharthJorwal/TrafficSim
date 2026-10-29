# Specification

Condensed from the original project brief. IDs are used in `TODO.md` and tests. Status: done / partial / todo.

## Purpose
Professional-grade browser simulation of one four-way urban intersection that evaluates adaptive signal control against
fixed-time control, with a real-time 3D view, deterministic vehicle behaviour, virtual detectors, quantitative analytics
and reproducible experiments. Optional, isolated local-AI extension. Works with no backend, internet or model weights.

## Requirements

| ID | Requirement | Milestone | Status |
|----|-------------|-----------|--------|
| E1 | Compact square environment, four blocks around a central four-way intersection, two-way roads | M3/M7 | done (placeholder scenery, M7 replaces) |
| E2 | Explicit lane geometry, stop lines, box boundary, entry/exit points; left/straight/right routes | M1 | done |
| E3 | Signal heads clearly visible in 3D; overview and close-up cameras | M3 | done (not yet reviewed by eye) |
| E4 | Blender-made environment and vehicles exported as optimised GLB | M7 | partial: procedural low-poly assets generated in code (M3.1); a Blender/GLB pipeline is optional later |
| E5 | (owner extension) Ambient pedestrians, crosswalks, sky, terrain, richer vehicles | M3.1 | done |
| E6 | (owner extension) Square ring road around the city; persistent, configurable fleet that spawns at the four fixed entries | M3.2 | done |
| V1 | Vehicles follow explicit routes (waypoints / spline) | M1 | done |
| V2 | Configurable arrival rates and route (turn) mix per approach | M1 | done |
| V3 | Bounded speed variation, smooth acceleration/deceleration | M1 | done |
| V4 | Safe following distance and queue formation | M1 | done |
| V5 | Stop-line compliance at red | M1 | done |
| V6 | Conflict checks and right-of-way inside the box | M1 | done (see known limitations) |
| V7 | Despawn / respawn at designated entry and exit points | M1 | done |
| V8 | Determinism for fixed seed + config; fixed timestep independent of frame rate | M1 | done |
| V9 | Simulation state separate from rendering state | M1 | done |
| D1 | Virtual detector zone per approach: approaching count, queue length, avg/max wait, windowed demand estimate, arrival/departure events | M3 | done |
| D2 | Observed counts clearly distinguished from derived estimates | M3 | done |
| D3 | Live visualisation of detector activation and the data given to the controller | M3 | done (3D overlay + panel) |
| C1 | Controller interface; controllers only request phases | M2 | done |
| C2 | Fixed-time: configurable cycle and phase sequence, explicit yellow and all-red | M2 | done |
| C3 | Adaptive rule-based: queue, approaching count, waiting time, min/max green, max wait, phase compatibility | M4 | done |
| C4 | Safety enforced independently of any controller: no conflicting greens, no skipped clearance | M2 | done |
| A1 | Optional local-AI recommender, outside the timestep, structured I/O, validated, timeout + fallback, logged, evaluated vs baseline | M8 | todo |
| X1 | Same arrival schedule, route mix, duration and seed for both controllers | M1/M5 | engine done (arrivals mode), experiment runner todo. Circulating mode gives each vehicle the same route choices, but arrival timing is endogenous, so it is not used for experiments |
| X2 | Metrics: vehicles cleared per simulated hour, mean waiting time, max queue length (+ throughput, avg queue, signal utilisation, time stopped) | M5 | todo |
| X3 | Demand profiles: light, balanced, uneven directional, heavy; repeated runs | M5 | todo |
| X4 | Comparison dashboard with numbers and charts; unfavourable results reported honestly | M6 | todo |
| U1 | Dashboard: 3D viewport, play/pause/reset/speed, controller select, demand per approach, live signals, per-road counters, clock, metric cards, comparison charts, reproducibility info, CSV/JSON export | M3-M6 | partial (viewport, controls, signals, counters, clock done; rest M6) |
| T1 | Tests for signal transitions, collision avoidance, red-light stopping, vehicle counting, metric calculations | M1-M5 | partial (all but metrics; detectors and 3D scene graph also tested) |
| T2 | Invalid configuration and reset handled predictably | M1/M2 | done |
| T3 | Documented assumptions and known limitations | ongoing | ongoing |

## Metric definitions (proposed; confirm at M5)
Window: `[0, T]` where T = `config.duration`. No drain period; unserved vehicles are reported, not hidden.
- **Generated**: scheduled arrivals with time <= t. **Inserted**: placed on the road (generated minus entry backlog).
  **Entered intersection**: front bumper crossed the stop line. **Exited**: reached the end of the exit arm.
- **Vehicles cleared per simulated hour** = Exited / (T / 3600).
- **Mean waiting time** = mean over *all generated vehicles* of (time at speed < 0.5 m/s upstream of the stop line +
  time in the entry backlog). Vehicles still waiting at T contribute what they have accrued, so queues cannot hide.
- **Max queue length** = maximum over time and approaches of the detector queue count (contiguous stopped chain
  from the stop line; stopped = speed < 0.5 m/s, chain gap <= 8 m). Implemented in `DetectorSystem` (`peakQueueCount`,
  `peakQueueLengthM`). Limited by the zone length (default 80 m); overflow is flagged.
- **Detector waiting time** (what controllers see) = seconds a vehicle has spent stopped inside the zone. This differs from the
  experiment metric above, which also counts the entry backlog and time upstream of the zone.
- **Signal utilisation** = vehicles entering during green / green seconds, per phase. **Time stopped** = seconds at speed < 0.1 m/s.
- Repeated runs: report mean and spread over seeds; pair fixed vs adaptive on the same seed.

## Definition of done
A user can configure demand, run fixed-time and adaptive control on the same reproducible scenario, watch vehicles and
signals in 3D, inspect live detector data, and compare the metrics, in a browser with no mandatory cloud dependency,
with results that can be independently inspected and explained.
