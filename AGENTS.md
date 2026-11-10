# Development instructions

Use the existing checkout. Cloud tasks already run in an isolated environment; do not create a Git worktree unless the user requests one.

Run `npm ci` when dependencies need refreshing. SuperSonic 0.96.0 client and core must stay version-matched and pinned; `npm run assets:sync` refreshes self-hosted runtime assets. Do not use native Web Audio oscillators, Tone.js, or a substitute synthesis backend. Consult official SuperSonic docs before changing its API usage.

Keep tempo integration/inversion independent of audio under `src/lib/math`. Instrument sound mapping belongs in discovered `src/lib/instruments/*/index.ts`; new instruments must not require scheduler/UI edits. Keep compiled `.scsyndef` files and `.scd` sources in sync using `npm run instruments:build`; never fabricate success when `sclang` is missing.

Use `npm run check`, `npm test`, `npm run instruments:validate`, `npm run build`, and `npm run test:e2e` for relevant changes. Browser tests exercise real audio with Chromium. Do not replace audible-output checks with OSC-dispatch assertions.

Use engine NTP time and timestamped OSC through the transferable OscChannel in the worker. Timers are wakeups only. Never assume selective cancellation of queued bundles. Preserve the committed horizon, all anchor constraints, and unaffected track trajectories on live edits. Do not directly send OSC from components.

Retain the AGPL notices and source-access obligations documented in `docs/licensing.md` when distributing or deploying this application.
