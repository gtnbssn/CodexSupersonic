# Creating an instrument

Instrument definitions own sound; the scheduler owns musical time. An instrument does not schedule notes, create workers or send OSC. SuperSonic is the only playback engine.

## Copy and edit a folder

Copy `src/lib/instruments/kick` to `src/lib/instruments/bell`. Its three files are:

- `index.ts`: stable ID, display metadata, parameter controls and musical-event mapping.
- `synthdef.scd`: human-editable SuperCollider source.
- `synthdef.scsyndef`: compiled binary, bundled so browsers need no language runtime.

Choose a globally unique ID (`bell`) and SynthDef name (`poly_bell`). Saved compositions refer to the ID, so keep it stable after release. Set `synthDefPath: '/synthdefs/poly_bell.scsyndef'`. The build script reads the literal `synthDefName` field; keep that field a literal string.

## Minimal sound source

Use this as `bell/synthdef.scd`:

```supercollider
SynthDef(\poly_bell, { |out=0, freq=440, decay=1, amp=0.2, pan=0|
    var envelope = EnvGen.kr(Env.perc(0.002, decay), doneAction: 2);
    var sound = SinOsc.ar(freq) * envelope * amp;
    Out.ar(out, Pan2.ar(sound, pan));
}).writeDefFile(~outputDir);
```

The build runner supplies `~outputDir`. Do not boot a server or add `s.waitForBoot`: compilation does not need an audio device. Use `doneAction: 2` or an equivalent self-freeing lifetime so notes cannot leave persistent nodes behind. `out` and `pan` are ordinary adapter-provided controls.

Standard oscillators, filters, noise, `EnvGen` and `Pan2` are supported by SuperSonic. Avoid optional third-party UGens unless the pinned WASM engine contains them. Read upstream [scsynth differences](https://github.com/samaaron/supersonic/blob/main/docs/SCSYNTH_DIFFERENCES.md) and test actual audio after compiling: a structurally valid binary cannot prove UGen compatibility or sound output.

## Metadata and mapping

Use this `bell/index.ts`:

```typescript
import { midiToHz, parametersFor, type InstrumentDefinition } from '../types';
const instrument: InstrumentDefinition = {
  id: 'bell', name: 'Bell', category: 'Synthesizer',
  description: 'A minimal sine bell.',
  synthDefName: 'poly_bell',
  synthDefPath: '/synthdefs/poly_bell.scsyndef',
  parameters: [
    { id: 'decay', label: 'Decay', min: 0.05, max: 3,
      step: 0.01, defaultValue: 1, unit: 's' },
    { id: 'amp', label: 'Volume', min: 0, max: 0.8,
      step: 0.01, defaultValue: 0.2 }
  ],
  mapEvent(event) {
    return { ...parametersFor(instrument, event), freq: midiToHz(event.pitch) };
  }
};
export default instrument;
```

Parameters are clamped to their metadata ranges. `parametersFor` supplies defaults and scales `amp` by event velocity. Pitch is MIDI, velocity is 0–1 and event duration is seconds. Return numeric SynthDef control values, not OSC data. The transport supplies pan and track gain. The bass example shows how duration maps to a self-freeing sustain/release envelope.

The UI builds controls from `parameters`; it does not need a new component for each sound. `registry.ts` uses Vite's eager `import.meta.glob('./*/index.ts')`. Adding this folder is the complete registry change. Restart development or rebuild if the development server has not detected the added folder.

## Compile and validate

Install SuperCollider's language compiler (`sclang`) on your development machine. On Debian, install `supercollider-language`; do not confuse it with the synthesis server package. The browser never runs this compiler.

```sh
npm run instruments:build
npm run instruments:validate
```

The build discovers each instrument source, compiles it, checks the SCgf version/name/structure and copies assets into both the instrument folder and `static/synthdefs`. It validates all outputs before replacing bundled files. Keep the `.scd`, `.scsyndef` and corresponding public asset together in version control.

A custom compiler location is supported:

```sh
SCLANG=/path/to/sclang npm run instruments:build
```

`SCLANG_CONFIG=/path/to/sclang_conf.yaml` optionally adds an explicit class-library configuration. Compilation runs offscreen and has a two-minute timeout. If an existing system compiler uses a writable user data directory, no further setup is needed. In restricted containers, set `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` to writable directories supported by your compiler installation.

In the prepared cloud environment the tested compiler is:

```sh
SCLANG=/workspace/toolchains/sclang/bin/sclang npm run instruments:build
```

It is a user-local SuperCollider 3.13.0 installation extracted from authenticated Debian packages, with its own Qt resource/class-library configuration. It is outside the application repository and is optional for normal installs because all four default binaries are bundled.

`instruments:validate` needs only Node. It catches missing sources, missing metadata, duplicate SynthDef names, missing binaries, mismatched public copies and invalid/truncated binary formats. A binary parser cannot infer whether an arbitrary envelope really frees its node; always inspect source and test note cleanup.

## Play and verify

Run `npm run dev`, initialize audio with a click, select the new instrument in the instrument panel and press audition. Adjust its generated controls and play a track. Changing its instrument must preserve the track's pattern, tempo and anchors.

Run `npm test` for instrument discovery/mapping/binary checks and the mathematical suite. Browser tests exercise the actual SuperSonic engine and audio. If a SynthDef fails, inspect the engine error panel for its name and UGen error. Never silently replace an unsupported sound with another synthesis library.
