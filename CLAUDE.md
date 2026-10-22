# CLAUDE.md - instructions for AI sessions on this repo

Adaptive Urban Traffic Flow Simulation Platform: a browser app that runs one four-way intersection under a
fixed-time and an adaptive signal controller on identical seeded traffic and compares the results honestly.
Stack: React + Vite + TypeScript, Three.js / React Three Fiber (from milestone 3), Vitest. No backend.

## Read first, in this order
1. `docs/HANDOFF.md`      current state, what to do next, known issues
2. `docs/TODO.md`         milestone checklist
3. `docs/SPEC.md`         requirements and metric definitions
4. `docs/ARCHITECTURE.md` layers, interfaces, tick order
5. `docs/RULES.md`        hard engineering rules
6. `docs/DECISIONS.md`    why things are the way they are

## Commands (PowerShell on Windows, repo root)
```
npm install
npm test
npm run typecheck
npm run dev
npm run sim:headless -- 1 300 1800 60
npm run apply -- $HOME\Downloads\<bundle>.zip
```

## How we work
- One milestone at a time. Stop at the end of each milestone for approval. Never generate the whole app at once.
- Deliver changes as a **bundle** (zip of changed files) plus exact apply commands. See `docs/BUNDLES.md`.
- Give commands one per line, copy-pasteable, with no trailing comments.
- Run `npm test` and `npm run typecheck` before delivering. Report what actually passed, and report unfavourable results honestly.
- Update `docs/HANDOFF.md`, `docs/TODO.md` and `CHANGELOG.md` in every bundle. Add an entry to `docs/DECISIONS.md` for any non-obvious choice.

## Non-negotiables (details in docs/RULES.md)
- `src/sim` and `src/control` never import React or Three.js. The renderer only reads snapshots.
- The simulation is deterministic: no `Math.random`, no wall-clock time, fixed timestep.
- Only `SignalStateMachine` owns real signal state. Controllers (rule-based or AI) can only *request* a phase.
- Both controllers must get the identical arrival schedule. Never tune the baseline to make adaptive look good.
