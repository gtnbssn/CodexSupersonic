# Validation record

Validated in the managed Linux cloud environment with Node 24.22.1, npm 11.9.0, system Chromium, and SuperSonic client/core 0.96.0.

- Clean frozen install: `npm --cache /workspace/.npm-cache ci` passed, including runtime asset copying and SvelteKit initialization.
- `npm run check`: zero errors, zero warnings.
- `npm test`: 36 tests passed across trajectory, composition, instrument, and audio scheduling suites.
- `npm run instruments:validate`: four valid, matching source/public SCgf binaries.
- `SCLANG=/workspace/toolchains/sclang/bin/sclang npm run instruments:build`: all four sources compiled using SuperCollider 3.13.0. Repeated compilation yielded identical binary hashes.
- `npm run build`: production client/server build passed.
- `npm run test:e2e`: six Chromium tests passed. They exercise real PCM output from every instrument; SAB and postMessage worker communication; timestamped concurrent playback; live tempo changes; pause, seek, loop, and stop silence; actual AudioContext suspension/recovery; device change notification; missing/corrupt SynthDefs; UI transport; JSON round trip; mobile width; malformed JSON composition rejection.
- Production custom server: interface/transport/live edit/import-export and mobile tests passed against `PORT=3000 npm start`. Static worker responses were independently checked for COOP and COEP headers.

The production build reports upstream optional MIDI/gamepad WASM URL warnings. These optional controllers are not exposed or requested by this application; audio worklet/WASM and scheduler runtime loading were exercised successfully in development and production. No warnings were hidden or verification checks disabled.

Validation does not establish Safari/Firefox/device-specific compatibility, freedom from browser suspension or CPU starvation, or publication into a new cloud task. Those remain deployment/platform checks. Optional external sample loading is implemented through the engine API but not exercised by the bundled, fully synthesized instruments. This record covers local build and runtime validation; Git publication and public deployment are separate operations.
