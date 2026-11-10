# Architecture

Confluence separates musical time, sound definitions, and audio transport. SuperSonic is the exclusive synthesis engine. The application does not create native Web Audio oscillators or use another synthesis library. Its Web Audio analyser observes SuperSonic's output for diagnostics; it does not generate sound.

## Boundaries

```text
Svelte UI
  -> composition model + pure trajectory/event functions
  -> engine-agnostic AudioPlan
  -> SuperSonicEngine
  -> scheduler Web Worker / transferable OscChannel
  -> NTP-timestamped OSC bundles
  -> SuperSonic AudioWorklet + WebAssembly scsynth
```

- `src/lib/math/`: positive tempo curves, anchor normalization, analytical integration, bounded phase inversion, and deterministic beat-pattern scheduling. No audio-engine dependency.
- `src/lib/model/composition.ts`: composition/track data, validation, anchor editing, musical-plan compilation, and live replanning. This is where instrument mappings are combined with absolute event times.
- `src/lib/instruments/`: stable instrument IDs, metadata, parameter defaults/ranges, musical-event mappings, human-editable SuperCollider source, and compiled SynthDefs.
- `src/lib/audio/SuperSonicEngine.ts`: browser-only initialization, SynthDef/sample loading, node/group allocation, audition, transport, worker lifecycle, recovery, and diagnostics.
- `src/lib/audio/scheduler.worker.ts`: lookahead scheduling through SuperSonic's own `OscChannel` and OSC encoder. It does not synthesize audio or integrate musical phase.
- `src/routes/+page.svelte`: controls and SVG visualization. It supplies plans and instrument definitions to the adapter; it does not send raw OSC.

## Sound definitions remain independent

`import.meta.glob('./*/index.ts', { eager: true })` discovers instrument folders at build time. The registry validates required metadata and rejects duplicate IDs. Adding a valid folder and rebuilding makes its instrument available without changing scheduler or transport code.

Each instrument supplies a SynthDef name/path, parameter metadata, and `mapEvent`. Mapping receives pitch, velocity, duration in seconds, and parameter overrides. The model invokes it before dispatching plans to the audio worker. The worker handles every instrument uniformly: allocate a node, apply track volume/pan, and send `/s_new`. Instrument modules do not own clocks, timers, queues, or OSC channels.

The adapter loads required definitions before playback or instrument-switch updates. Default SynthDefs have finite envelopes and free themselves. Pause/stop also free the application's group, so those operations release active notes. The adapter exposes an active-node parameter method, but the current UI primarily changes subsequent notes; it does not provide a general active-voice editor.

Optional initialization metadata can declare sample paths. The adapter offers sample loading, but the bundled instruments are self-contained and do not require external samples. See [creating-instruments.md](creating-instruments.md) for the compilation/discovery workflow.

## Engine lifecycle and deployment

SuperSonic is dynamically imported on the client in response to audio initialization/play/audition actions. Server rendering never starts an audio engine. Initialization creates the application group and transfers a dedicated `OscChannel` to a module worker using SuperSonic's documented transferable API.

Both SuperSonic packages are pinned to `0.96.0` in `package.json`, with exact resolutions in the lockfile. `scripts/sync-assets.mjs` copies worker and WASM assets into `static/`; compiled instruments are served from `static/synthdefs/`. Playback needs no SuperCollider language runtime after definitions have been compiled.

Development and the SvelteKit server supply cross-origin opener/embedder policies for SharedArrayBuffer isolation. Deploy over HTTPS (or a browser's trusted localhost development context), preserve the isolation headers, and serve the self-hosted assets from the same origin. A reverse proxy or static host must retain the required headers as well. SuperSonic also has a fallback mode, but the intended deployment supports isolated shared-memory operation.

The combined SuperSonic engine carries AGPL-3.0-or-later obligations. Dependency licenses and distribution notes belong in the README/licensing documentation; pinning versions does not remove those obligations.

## Clock and scheduling contract

The composition uses seconds relative to its own origin. SuperSonic supplies engine-clock seconds in the NTP representation expected by its OSC encoder. Playback establishes one mapping:

```text
engineOrigin = engineClockNow + startupLead - compositionPosition
bundleNtpTime = engineOrigin + absoluteCompositionEventTime
```

The worker obtains current time through `OscChannel.now()` and encodes each event with `osc.encodeSingleBundle`. It sends encoded bytes through that channel to SuperSonic's existing communication/scheduling infrastructure. No duplicate audio-engine scheduling queue is implemented in application code.

A timer wakes the worker approximately every quarter-lookahead interval, but the timer is not musical time: timestamps in engine-clock OSC bundles determine playback. SVG animation is presentation only. The configurable lookahead defaults to 120 ms and is clamped to 50–500 ms. The worker skips events whose target is already within three milliseconds of engine time and reports them as missed rather than pretending they were on time.

Compiled plans contain one composition cycle. `eventsInWindow` expands cycles and applies mute/solo before generating timestamped note messages. Half-open windows prevent duplicate boundary notes.

## Live changes and committed audio

The engine cannot assume selective cancellation of already queued track bundles. Ordinary edits retain old queued notes and switch to a pending plan at an explicit shared future boundary. `committedPosition()` adds lookahead plus a 70 ms guard to the current composition position. The UI evaluates mathematical replanning at that same boundary, and the worker rejects a replacement whose boundary precedes its committed cursor.

Curve edits preserve the edited track's phase/BPM and future anchors when feasible. Unchanged tracks keep their mathematical trajectories. Instrument changes and parameter changes preserve musical timing and affect future notes after the cutover; required SynthDefs load before the update is committed. Already sounding nodes may continue their existing envelopes.

This creates a bounded normal edit latency approximately equal to lookahead plus the guard, rather than rewriting already committed sound. Heavy scheduling delays or late delivery are reported as errors/missed events; there is no hard real-time guarantee for a suspended browser. Edits too near the loop seam can be rejected. The trajectory does not enforce periodic endpoint BPM; see [mathematics.md](mathematics.md).

Pause, stop, and seek require a different strategy. The worker halts, sends `/sync` on its own channel as a drain barrier, and the adapter waits for the engine reply before invoking SuperSonic's global purge and freeing the application group. Resume/seek creates a new engine-to-composition mapping from the selected position. This is a deliberate whole-application transport operation, not per-track queue cancellation.

## Recovery and diagnostics

The adapter reports initialization/loading failures, engine `/fail` responses, worker failures, and request timeouts. Suspension/interruption records the current position and stops advancing the application transport. Recovery is a user action: call SuperSonic's recovery API, recreate the application worker/channel and analyser, prepare the current plan's definitions/resources, and return to a paused ready state. Playback then resumes through the regular path.

The developer panel exposes engine scheduler queue depth, late/dropped counters, maximum lateness, application scheduled/missed counts, and RMS/peak measured from the engine output. A successful OSC send is not by itself proof of audible output; browser tests should inspect actual signal energy as well. Device changes and tab suspension depend on browser/platform behavior and need hardware/browser coverage beyond deterministic unit tests.

## Testing and limits

Vitest covers trajectory correctness, event scheduling, composition behavior, and instrument metadata. Playwright exercises the actual browser engine and UI where supported. Test results, supported browser behavior, and outstanding limitations should be reported from completed runs rather than inferred from the architecture.

Current intentional limits include finite one-shot default instruments, precomputed composition-cycle plans, nonperiodic loop seam tempo, and no arbitrary active-node editing UI. The architecture permits new SynthDefs and optional resources without coupling their sound design to tempo or anchor logic.
