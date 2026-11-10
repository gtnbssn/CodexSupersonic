# Confluence

A browser instrument for independent rhythms and shared moments. Four SuperSonic voices follow independent musical clocks and meet at composition anchors. Built with SvelteKit, TypeScript, SVG, SuperCollider SynthDefs, and SuperSonic 0.96.0.

## Develop

Requires Node.js 24 and npm 11. All direct dependencies are pinned; the lockfile pins transitive dependencies.

```sh
npm ci
npm run dev
```

In this managed cloud workspace, use `npm --cache /workspace/.npm-cache ci` if the home cache is unwritable.

Open the development server in a modern browser on localhost or HTTPS. Press **Play** or **Audition** to initialize audio from a user gesture. Select a track, toggle steps, edit pitch/velocity/duration, choose an instrument, and adjust its sound controls. The timeline shows actual scheduled event times rather than an evenly spaced beat grid. Tempo curves are normalized shapes: the beat target and anchor duration determine the mean BPM. The displayed trajectory shows the resulting BPM.

Use the transport to pause, resume, stop, scrub, loop, or restore the demo. Export and open JSON compositions to retain your work. The engine panel reports measured output RMS/peak, scheduled/missed events, queue depth, and engine late/dropped counters. **Recover audio** reconnects the worklet and scheduler after suspension; press Play to resume.

```sh
npm run check
npm test
npm run instruments:validate
npm run build
npm run test:e2e
```

Browser tests use Chromium at `/usr/bin/chromium`. Override `CHROMIUM_PATH` for another installed Chromium; alternatively install Playwright Chromium and set that executable path. Tests measure actual SuperSonic output through an analyser as well as checking transport and timeline behavior. No audio oscillator fallback exists.

## Instruments

Four self-contained instruments ship with source and compiled SynthDefs: kick, snare, hi-hat, bass. A fresh installation needs no SuperCollider language runtime. `postinstall` copies version-matched SuperSonic workers/WASM and license notices into self-hosted static directories. Compiled instrument binaries are checked in under their instrument folders and `static/synthdefs`.

To rebuild instrument sources, install SuperCollider `sclang` 3.13 or compatible and run:

```sh
npm run instruments:build
# Or: SCLANG=/path/to/sclang npm run instruments:build
```

The onboarding machine also has a user-local compiler at `/workspace/toolchains/sclang/bin/sclang`. See [Creating instruments](docs/creating-instruments.md) for folder discovery, the metadata contract, a minimal tutorial, and the compilation pipeline.

## Deployment and timing

```sh
npm run build
HOST=0.0.0.0 PORT=3000 npm start
```

Serve the whole build and `static` assets using HTTPS. The app sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; keep these headers on the document and self-host all runtime assets. SharedArrayBuffer requires a secure, cross-origin-isolated context. SuperSonic also supports its documented postMessage transport. There are no runtime CDN dependencies or required secrets.

The scheduler worker uses SuperSonic's transferable `OscChannel` and engine NTP clock. Worker timers only wake the lookahead pass; future timestamped OSC bundles determine note time in the engine. The default horizon is 120ms. Edits cut over beyond the committed horizon plus a 70ms safety margin, keeping queued notes valid. BPM and phase remain continuous at that boundary, and anchor integrals remain exact. Other tracks keep their trajectories. No selective queue cancellation is assumed. Pause/stop drain the worker before globally purging queued events and freeing track nodes.

Live edits near the end of a cycle can be rejected; retry after the loop boundary. Infeasible BPM/acceleration constraints are reported without replacing the active plan. Editing anchor structure is a stopped-transport operation. Repeating a composition restarts its musical phase; different endpoint tempos may create a deliberate tempo jump at the loop seam. Sustained note tails may overlap loops. Late wakeups are counted and dropped rather than fired as bursts. This is an experimental composition tool, not a guarantee against browser/device suspension.

Read [Architecture](docs/architecture.md), [Mathematics](docs/mathematics.md), and [Licensing](docs/licensing.md).
