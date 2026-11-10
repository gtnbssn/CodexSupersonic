<script lang="ts">
  import { onMount } from 'svelte';
  import { createDemo, compileComposition, replanComposition, addAnchor, moveAnchor, validateComposition, type Composition } from '#lib/model/composition';
  import { instruments, getInstrument } from '#lib/instruments/registry';
  import { tempoAt, phaseAt, timeAtBeat } from '#lib/math/trajectory';
  import type { SuperSonicEngine } from '#lib/audio/SuperSonicEngine';

  const initialDemo = createDemo();
  let composition = $state<Composition>(initialDemo);
  let compiled = $state.raw(compileComposition(initialDemo));
  let selectedId = $state(initialDemo.tracks[0].id);
  let newAnchorTime = $state(initialDemo.duration / 2);
  let selectedStep = $state(0);
  let engine: SuperSonicEngine | undefined;
  let hydrated = $state(false);
  let ready = $state(false);
  let playing = $state(false);
  let busy = $state(false);
  let position = $state(0);
  let error = $state('');
  let notice = $state('');
  let diagnostics = $state<Record<string, unknown>>({});
  let showDiagnostics = $state(false);
  let dragging = $state<number | null>(null);
  let fileInput: HTMLInputElement;
  let selected = $derived(composition.tracks.find(track => track.id === selectedId) ?? composition.tracks[0]);
  let instrument = $derived(getInstrument(selected.instrumentId));
  let trajectory = $derived(compiled.trajectories[selected.id]);
  let selectedEvent = $derived(selected.steps[selectedStep]);
  let beatTicks = $derived(Object.fromEntries(composition.tracks.map(track => {
    const t = compiled.trajectories[track.id];
    const first = Math.ceil(t.startBeat), count = Math.floor(t.endBeat) - first + 1;
    const stride = Math.max(1, Math.ceil(count / 256));
    return [track.id, Array.from({length:Math.ceil(count / stride)}, (_,i) => {
      const beat = first + i * stride;
      return { beat, time:timeAtBeat(t,beat), strong:Math.abs(beat / track.patternBeats - Math.round(beat / track.patternBeats)) < 1e-8 };
    })];
  })));
  let currentTempo = $derived(trajectory ? tempoAt(trajectory, position) : 0);
  let currentPhase = $derived(trajectory ? phaseAt(trajectory, position) : 0);
  let bpmMax = $derived(Math.max(240, ...Object.values(compiled.trajectories).flatMap(t => Array.from({length:41}, (_,i) => tempoAt(t, i * composition.duration / 40)))));
  const fmt = (n: number, digits = 1) => n.toFixed(digits);
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  onMount(() => {
    hydrated = true;
    let frame = 0;
    let last = 0;
    const render = (time: number) => {
      if (engine && time - last > 30) {
        position = engine.position; playing = engine.playing; ready = engine.ready;
        if (showDiagnostics) diagnostics = { ...engine.diagnostics };
        last = time;
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); void engine?.destroy(); };
  });

  async function getEngine() {
    if (!engine) {
      const { SuperSonicEngine } = await import('#lib/audio/SuperSonicEngine');
      engine = new SuperSonicEngine();
      engine.subscribe(() => {
        if (engine) { ready = engine.ready; playing = engine.playing; diagnostics = { ...engine.diagnostics }; if (engine.diagnostics.error) error = engine.diagnostics.error; }
      });
    }
    if (!engine.ready) await engine.initialize();
    ready = engine.ready;
    return engine;
  }
  async function action(run: () => unknown | Promise<unknown>) {
    if (busy) return;
    busy = true; error = ''; notice = '';
    try { await run(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { busy = false; }
  }
  async function edit(mutate: (draft: Composition) => void) {
    if (busy) return;
    const isLive = playing;
    if (isLive) busy = true;
    const draft = clone(composition);
    try {
      mutate(draft);
      const boundary = playing && engine ? engine.committedPosition() : 0;
      const next = playing ? replanComposition(draft, compiled.trajectories, boundary) : compileComposition(draft);
      if (playing && engine) await engine.update(next.plan, boundary);
      composition = draft; compiled = next; error = '';
      if (playing) notice = `Edit scheduled at ${fmt(boundary, 2)}s · committed audio is preserved`;
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { if (isLive) busy = false; }
  }
  function editTrack(mutate: (track: Composition['tracks'][number]) => void) {
    edit(draft => mutate(draft.tracks.find(track => track.id === selectedId)!));
  }
  async function play() { await action(async () => { const audio = await getEngine(); await audio.play(compiled.plan, position); playing = audio.playing; }); }
  async function pause() { await action(async () => { await engine?.pause(); playing = false; }); }
  async function stop() { await action(async () => { await engine?.stop(); playing = false; position = 0; }); }
  async function seek(value: number) {
    position = value;
    if (engine) await action(async () => { await engine!.seek(value); });
  }
  function reset() {
    void action(async () => { await engine?.stop(); playing = false; position = 0; composition = createDemo(); compiled = compileComposition(composition); selectedId = composition.tracks[0].id; selectedStep = 0; });
  }
  function setInstrument(id: string) { editTrack(track => { track.instrumentId = id; track.parameters = Object.fromEntries(getInstrument(id).parameters.map(p => [p.id,p.defaultValue])); }); }
  function setCurve(kind: Composition['tracks'][number]['curve']['kind']) {
    editTrack(track => { track.curve = {...track.curve, kind}; if (kind === 'editable' && !track.curve.points) track.curve.points = [{time:0,bpm:track.curve.startBpm ?? 120},{time:.5,bpm:180},{time:1,bpm:track.curve.endBpm ?? 120}]; });
  }
  function curvePath(id: string) {
    const t = compiled.trajectories[id];
    return Array.from({length:121}, (_,i) => `${i === 0 ? 'M' : 'L'}${i / 120 * 960 + 40},${180 - tempoAt(t,i / 120 * composition.duration) / bpmMax * 150}`).join(' ');
  }
  function movePoint(event: PointerEvent) {
    if (dragging === null) return;
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * 1020 - 40) / 960));
    const bpm = Math.max(12, Math.min(500, (180 - (event.clientY - rect.top) / rect.height * 210) / 150 * bpmMax));
    const index = dragging;
    editTrack(track => {
      const points = track.curve.points!;
      const point = points[index];
      const current = tempoAt(trajectory, point.time * composition.duration);
      point.bpm = Math.max(1, Math.round(point.bpm * bpm / Math.max(1,current)));
      if (index > 0 && index < points.length - 1) point.time = Math.max(points[index-1].time+.015, Math.min(points[index+1].time-.015, x));
    });
  }
  function save() {
    const blob = new Blob([JSON.stringify(composition,null,2)],{type:'application/json'});
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${composition.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.json`; link.click(); URL.revokeObjectURL(link.href); notice = 'Composition exported';
  }
  async function load(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await action(async () => {
      const next = validateComposition(JSON.parse(await file.text()));
      const result = compileComposition(next);
      await engine?.stop(); composition = next; compiled = result; position = 0; playing = false; selectedId = next.tracks[0].id; selectedStep = 0; notice = `Loaded ${next.name}`;
    });
    fileInput.value = '';
  }
  function newTrack() {
    edit(draft => {
      const base = clone(draft.tracks[0]);
      base.id = `track-${Date.now()}`; base.name = `Track ${draft.tracks.length + 1}`; base.color = ['#b9ca86','#d9a87b','#9ba9d8','#ba9acb','#7cbba5'][draft.tracks.length % 5];
      base.steps.forEach((step,i) => step.active = i % 4 === 0); draft.tracks.push(base);
      for (const anchor of draft.anchors) anchor.beats[base.id] = anchor.beats[draft.tracks[0].id];
      selectedId = base.id;
    });
  }
</script>

<svelte:head><title>Confluence — Independent rhythms. Shared moments.</title><meta name="description" content="An experimental polyrhythmic sequencer with independent musical clocks, shared synchronization anchors, and SuperSonic synthesis."/></svelte:head>

<div class="studio">
  <fieldset class="app-controls" disabled={!hydrated} aria-label="Sequencer controls">
  <header class="topbar">
    <a href="/" class="brand" aria-label="Confluence home"><svg width="31" height="31" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4 6C14 6 18 26 28 26M4 16C14 16 18 16 28 16M4 26C14 26 18 6 28 6" stroke="currentColor" stroke-width="2"/></svg><span>confluence<span class="brand-dot">.</span></span></a>
    <span class="edition">A STUDY IN INDEPENDENT TIME</span>
    <div class="top-actions"><span class:online={ready} class="engine-status"><i></i>{busy ? 'CONNECTING' : ready ? 'AUDIO READY' : 'AUDIO OFFLINE'}</span><button class="quiet" onclick={() => fileInput.click()} title="Import composition">Open</button><button class="outline" data-testid="save" onclick={save}>Export <span class="export-arrow"><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 10L10 2M3 2h7v7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span></button></div>
    <input class="hidden" bind:this={fileInput} type="file" accept="application/json,.json" onchange={load} data-testid="load-composition" aria-label="Import composition"/>
  </header>

  <main>
    <div class="workspace-heading"><div><p class="eyebrow">COMPOSITION / 001</p><h1>Independent rhythms.<br/><span>Shared moments.</span></h1></div><div class="composition-meta"><span class="small-tag">EXPERIMENT 01</span><input aria-label="Composition name" value={composition.name} onchange={e => edit(c => c.name = e.currentTarget.value)}/><p>{composition.tracks.length} voices <span>·</span> {fmt(composition.duration,0)} second cycle <span>·</span> SuperSonic engine</p></div></div>

    <section class="transport" aria-label="Transport">
      <div class="transport-buttons"><button class="play" data-testid="play" onclick={play} disabled={busy || playing} aria-label="Play"><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2L14 8 4 14Z" fill="currentColor"/></svg>Play</button><button class="icon-button" data-testid="pause" onclick={pause} disabled={!playing || busy} aria-label="Pause"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h3v10H3zm5 0h3v10H8z" fill="currentColor"/></svg></button><button class="icon-button" data-testid="stop" onclick={stop} aria-label="Stop">■</button><span class="transport-divider"></span><button class="icon-button reset" onclick={reset} aria-label="Reset demo" title="Reset demo">↺</button></div>
      <div class="time-display"><span>{fmt(position,2).padStart(5,'0')}</span><small>/ {fmt(composition.duration,2)} <b>SEC</b></small></div>
      <input class="scrubber" type="range" min="0" max={composition.duration} step="0.01" value={position} oninput={e => void seek(Number(e.currentTarget.value))} aria-label="Playback position"/>
      <button class:enabled={composition.loop} class="loop-button" aria-pressed={composition.loop} onclick={() => edit(c => c.loop = !c.loop)}><span>↻</span> LOOP</button><span class="transport-divider"></span><span class="anchor-summary"><i></i>{composition.anchors.length} SYNC ANCHORS</span>
    </section>
    {#if error}<div class="message error" role="alert"><span>!</span>{error}<button onclick={() => error = ''} aria-label="Dismiss error">×</button></div>{/if}
    {#if notice}<div class="message notice" role="status">{notice}<button onclick={() => notice = ''} aria-label="Dismiss notice">×</button></div>{/if}

    <div class="arrangement-shell">
      <section class="arrangement" aria-label="Sequencer arrangement">
        <div class="section-top"><div><span class="eyebrow">ARRANGEMENT</span><span class="section-subtitle">Every voice follows its own clock.</span></div><div class="legend"><i></i>SYNC POINT <span>TIME →</span></div></div>
        <div class="arrangement-body">
          <div class="track-labels"><div class="lane-ruler-label">VOICES <span>{String(composition.tracks.length).padStart(2,'0')}</span></div>
            {#each composition.tracks as track, i}<button class:selected={track.id === selected.id} class:muted={track.muted} class="track-label" style={`--track:${track.color}`} onclick={() => { selectedId = track.id; selectedStep = 0; }}><span class="track-number">{String(i+1).padStart(2,'0')}</span><div><strong>{track.name}</strong><small>{getInstrument(track.instrumentId).name} <span>·</span> {fmt(tempoAt(compiled.trajectories[track.id],position),0)} BPM</small></div><span class="track-indicator"></span></button>{/each}
            <button class="add-track" disabled={playing || busy || composition.tracks.length >= 16} onclick={newTrack}>+ Add voice</button>
          </div>
          <div class="timeline-wrap">
            <svg class="timeline" data-testid="timeline" viewBox={`0 0 1000 ${44 + composition.tracks.length * 82}`} preserveAspectRatio="none" style={`height:${44 + composition.tracks.length * 82}px`} aria-label="Musical events spaced by their exact playback times" role="img">
              <defs><pattern id="fine-grid" width={1000 / composition.duration} height="82" patternUnits="userSpaceOnUse"><path d="M 0 0 V 82" stroke="#2b3028" stroke-width="1"/></pattern></defs>
              {#each Array.from({length:Math.floor(composition.duration)+1}, (_,i) => i) as second}<text x={second / composition.duration * 1000 + (second === 0 ? 8 : second === composition.duration ? -5 : 0)} y="24" text-anchor={second === 0 ? 'start' : second === composition.duration ? 'end' : 'middle'} class="ruler-text">{String(second).padStart(2,'0')}s</text>{/each}
              {#each composition.tracks as track, i}
                <rect x="0" y={44+i*82} width="1000" height="82" fill={track.id === selected.id ? '#20251d' : '#1a1e18'}/><rect x="0" y={44+i*82} width="1000" height="82" fill="url(#fine-grid)"/><line x1="0" x2="1000" y1={44+(i+1)*82} y2={44+(i+1)*82} stroke="#30352c"/>
                {#each beatTicks[track.id] as tick}<line x1={tick.time/composition.duration*1000} x2={tick.time/composition.duration*1000} y1={44+i*82} y2={44+(i+1)*82} stroke={track.color} opacity={tick.strong ? .13 : .05}/><line x1={tick.time/composition.duration*1000} x2={tick.time/composition.duration*1000} y1={44+(i+1)*82-5} y2={44+(i+1)*82} stroke={track.color} opacity=".4"/>{/each}
                {#each compiled.plan.tracks.find(t => t.id === track.id)?.events ?? [] as event}<rect x={event.time / composition.duration * 1000} y={65+i*82 + (1-event.velocity)*12} width={Math.min(22,Math.max(5,event.duration/composition.duration*1000))} height={30 * event.velocity + 8} rx="2" fill={track.color} opacity={track.muted ? .2 : 1}/>{/each}
              {/each}
              {#each composition.anchors as anchor, i}<line x1={anchor.time/composition.duration*1000} x2={anchor.time/composition.duration*1000} y1="36" y2={44+composition.tracks.length*82} stroke="#bccb87" stroke-width="1" stroke-dasharray="3 5" opacity=".65"/><path d={`M${anchor.time/composition.duration*1000-4} 34h8l-4 6Z`} fill="#bccb87"/><text x={Math.max(7,Math.min(970,anchor.time/composition.duration*1000+7))} y={55+composition.tracks.length*82} class="anchor-label">A{i+1}</text>{/each}
              <line x1={position/composition.duration*1000} x2={position/composition.duration*1000} y1="33" y2={44+composition.tracks.length*82} stroke="#f1f0df" stroke-width="1.4"/>
            </svg>
          </div>
        </div>
        <div class="arrangement-footer"><span><i></i>Actual time spacing · independent beat subdivisions</span><span>ALL VOICES CONVERGE AT THE ANCHORS <span class="arrow">↗</span></span></div>
      </section>
      <aside class="instrument-panel" aria-label="Instrument controls">
        <div class="panel-heading"><span class="eyebrow">SOUND / {selected.name.toUpperCase()}</span><span class="tiny-icon">◉</span></div>
        <label class="field-label" for="instrument">INSTRUMENT</label><select id="instrument" data-testid="instrument-select" value={selected.instrumentId} onchange={e => setInstrument(e.currentTarget.value)}>{#each instruments as item}<option value={item.id}>{item.name}</option>{/each}</select>
        <div class="instrument-caption"><span>{instrument.category}</span><span>SYNTHDEF</span></div><p class="instrument-description">{instrument.description}</p>
        <div class="parameters">{#each instrument.parameters as parameter}<label class="parameter"><span>{parameter.label}<output>{fmt(selected.parameters[parameter.id] ?? parameter.defaultValue,parameter.step < .01 ? 3 : parameter.step < 1 ? 2 : 0)}<small>{parameter.unit ?? ''}</small></output></span><input type="range" min={parameter.min} max={parameter.max} step={parameter.step} value={selected.parameters[parameter.id] ?? parameter.defaultValue} oninput={e => editTrack(t => t.parameters[parameter.id] = Number(e.currentTarget.value))}/></label>{/each}</div>
        <button class="audition" data-testid="audition" disabled={busy} onclick={() => action(async () => { const audio = await getEngine(); await audio.audition(instrument,selected.parameters,{pitch:selectedEvent.pitch,velocity:selectedEvent.velocity,duration:selectedEvent.duration}); })}><span>▷</span> Audition instrument <kbd>AUDIO</kbd></button>
        <div class="mixer"><label class="parameter"><span>Track volume <output>{fmt(selected.volume * 100,0)}<small>%</small></output></span><input type="range" min="0" max="1" step="0.01" value={selected.volume} oninput={e => editTrack(t => t.volume = Number(e.currentTarget.value))}/></label><label class="parameter"><span>Pan <output>{selected.pan === 0 ? 'C' : `${fmt(Math.abs(selected.pan)*100,0)}${selected.pan < 0 ? 'L' : 'R'}`}</output></span><input type="range" min="-1" max="1" step="0.01" value={selected.pan} oninput={e => editTrack(t => t.pan = Number(e.currentTarget.value))}/></label><div class="mute-solo"><button class:active={selected.muted} aria-pressed={selected.muted} onclick={() => editTrack(t => t.muted = !t.muted)}>M <span>Mute</span></button><button class:active={selected.solo} aria-pressed={selected.solo} onclick={() => editTrack(t => t.solo = !t.solo)}>S <span>Solo</span></button></div></div>
      </aside>
    </div>

    <div class="editor-grid">
      <section class="tempo-editor" aria-label="Tempo curve editor"><div class="section-top"><div><span class="eyebrow">TEMPO TRAJECTORY</span><span class="selected-name" style={`color:${selected.color}`}>{selected.name}</span></div><span class="feasible"><i></i>ANCHORS SATISFIED</span></div><div class="curve-controls"><div class="segmented">{#each ['constant','linear','eased','editable'] as kind}<button class:active={selected.curve.kind === kind} onclick={() => setCurve(kind as Composition['tracks'][number]['curve']['kind'])}>{kind}</button>{/each}</div><div class="live-tempo"><strong>{fmt(currentTempo,1)}</strong><span>BPM</span></div></div>
        <svg class="tempo-svg" viewBox="0 0 1020 210" aria-label="Tempo curves over composition time" role="img" onpointermove={movePoint} onpointerup={() => dragging = null} onpointerleave={() => dragging = null}>
          {#each [0,.25,.5,.75,1] as fraction}<line x1="40" x2="1000" y1={180-fraction*150} y2={180-fraction*150} stroke="#30352c" stroke-dasharray={fraction === 0 ? '' : '2 5'}/><text x="29" y={184-fraction*150} text-anchor="end" class="axis-text">{fmt(fraction*bpmMax,0)}</text>{/each}
          {#each composition.anchors as anchor}<line x1={40+anchor.time/composition.duration*960} x2={40+anchor.time/composition.duration*960} y1="20" y2="180" stroke="#bccb87" stroke-dasharray="3 5" opacity=".35"/>{/each}
          {#each composition.tracks as track}<path d={curvePath(track.id)} fill="none" stroke={track.color} stroke-width={track.id === selected.id ? 2.8 : 1.2} opacity={track.id === selected.id ? 1 : .2}/>{/each}
          {#if selected.curve.kind === 'editable'}{#each selected.curve.points ?? [] as point, i}<circle cx={40+point.time*960} cy={180-tempoAt(trajectory, point.time*composition.duration)/bpmMax*150} r="6" fill={selected.color} stroke="#171b15" stroke-width="3" role="button" tabindex="0" aria-label={`Tempo point ${i+1}`} onpointerdown={e => { dragging = i; (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId); }} onkeydown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') editTrack(t => t.curve.points![i].bpm += e.key === 'ArrowUp' ? 5 : -5); }}/>{/each}{/if}
          <line x1={40+position/composition.duration*960} x2={40+position/composition.duration*960} y1="20" y2="180" stroke="#e4e5d8" opacity=".5"/>
          <text x="40" y="204" class="axis-text">0 SECONDS</text><text x="1000" y="204" text-anchor="end" class="axis-text">{composition.duration} SECONDS</text>
        </svg>
        <div class="curve-bottom"><label>START WEIGHT <input aria-label="Start tempo weight" type="number" min="10" max="500" value={selected.curve.startBpm ?? 120} onchange={e => editTrack(t => { t.curve.startBpm = Number(e.currentTarget.value); if (t.curve.points) t.curve.points[0].bpm = Number(e.currentTarget.value); })}/></label><span>→</span><label>END WEIGHT <input aria-label="End tempo weight" type="number" min="10" max="500" value={selected.curve.endBpm ?? 120} onchange={e => editTrack(t => { t.curve.endBpm = Number(e.currentTarget.value); if (t.curve.points) t.curve.points[t.curve.points.length-1].bpm = Number(e.currentTarget.value); })}/></label><p>Curves normalize to the shared anchors.<br/>{selected.curve.kind === 'editable' ? 'Drag points to shape tempo.' : 'Select editable to move control points.'}</p></div>
      </section>
      <section class="pattern-editor" aria-label="Rhythmic pattern"><div class="section-top"><span class="eyebrow">PATTERN / {selected.name.toUpperCase()}</span><label class="pattern-meter">CYCLE <input aria-label="Pattern beats" type="number" min="0.25" max="64" step="0.25" value={selected.patternBeats} onchange={e => editTrack(t => t.patternBeats = Number(e.currentTarget.value))}/> BEATS</label></div><div class="pattern-description"><h2>A rhythm of its own.</h2><span>{fmt(currentPhase,2)} <small>BEATS ELAPSED</small></span></div><div class="step-grid" style={`--track:${selected.color}`}>{#each selected.steps as step,i}<button class:active={step.active} class:chosen={selectedStep === i} class:downbeat={i%4===0} aria-label={`Step ${i+1}${step.active ? ', on' : ', off'}`} aria-pressed={step.active} onclick={() => { selectedStep = i; editTrack(t => t.steps[i].active = !t.steps[i].active); }}><span>{String(i+1).padStart(2,'0')}</span><i style={`height:${step.velocity*45}%`}></i></button>{/each}</div><div class="step-edit-heading">STEP {String(selectedStep+1).padStart(2,'0')} <span>Click a step to toggle and edit</span></div><div class="note-fields"><label>NOTE <input aria-label="Step pitch" type="number" min="0" max="127" value={selectedEvent.pitch} onchange={e => editTrack(t => t.steps[selectedStep].pitch = Number(e.currentTarget.value))}/></label><label>VELOCITY <input aria-label="Step velocity" type="number" min="0.01" max="1" step="0.05" value={selectedEvent.velocity} onchange={e => editTrack(t => t.steps[selectedStep].velocity = Number(e.currentTarget.value))}/></label><label>DURATION <input aria-label="Step duration" type="number" min="0.01" max="8" step="0.05" value={selectedEvent.duration} onchange={e => editTrack(t => t.steps[selectedStep].duration = Number(e.currentTarget.value))}/></label></div><p class="pattern-note">Musical events stay the same as time bends around them.</p></section>
    </div>

    <section class="anchors-panel" aria-label="Synchronization anchors"><div class="section-top"><div><span class="eyebrow">SYNCHRONIZATION ANCHORS</span><span class="section-subtitle">Different journeys. A common destination.</span></div><div class="add-anchor"><input aria-label="New anchor time" type="number" min="0.1" max={composition.duration-.1} step="0.1" bind:value={newAnchorTime} disabled={playing}/><span>SEC</span><button class="quiet" disabled={playing || busy} onclick={() => edit(c => { addAnchor(c, newAnchorTime); })}>+ Add anchor</button></div></div><div class="anchor-cards">{#each composition.anchors as anchor,i}<div class="anchor-card"><span class="anchor-diamond">◇</span><div><strong>A{String(i+1).padStart(2,'0')}</strong><label>AT <input aria-label={`Anchor ${i+1} time`} type="number" step="0.1" min="0" max={composition.duration} value={anchor.time} disabled={playing || i===0 || i===composition.anchors.length-1} onchange={e => edit(c => { moveAnchor(c,i,Number(e.currentTarget.value)); })}/> SEC</label></div><div class="anchor-beats">{#each composition.tracks as track}<label style={`--track:${track.color}`}><i></i>{track.name}<input aria-label={`Anchor ${i+1} ${track.name} beat`} type="number" min="0" step="1" value={anchor.beats[track.id]} disabled={playing || i===0} onchange={e => edit(c => c.anchors[i].beats[track.id] = Number(e.currentTarget.value))}/><span>beats</span></label>{/each}</div></div>{/each}</div></section>

    <section class="diagnostics-panel"><button class="diagnostics-toggle" data-testid="diagnostics" onclick={() => showDiagnostics = !showDiagnostics} aria-expanded={showDiagnostics}><span class="eyebrow"><span class="diagnostic-symbol">⌘</span> ENGINE DIAGNOSTICS</span><span>{ready ? 'SUPERSONIC 0.96.0' : 'INITIALIZE AUDIO TO CONNECT'} <b>{showDiagnostics ? '−' : '+'}</b></span></button>{#if showDiagnostics}<div class="diagnostics-content"><pre>{JSON.stringify(diagnostics,null,2)}</pre><div><p>Scheduling uses the engine clock and timestamped OSC. UI animation never controls musical time.</p><button class="outline" onclick={() => action(async () => { const audio = await getEngine(); await audio.recover(); ready = audio.ready; })}>Recover audio engine ↗</button><p>Live edits take effect beyond the committed lookahead window. Pause and stop safely purge queued events.</p></div></div>{/if}</section>
    <footer><span>CONFLUENCE <span class="footer-dot">●</span> A POLYRHYTHMIC EXPLORATION</span><span>Powered by SuperSonic <span><svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 10L10 2M3 2h7v7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span><small>AGPL-3.0-or-later</small></span></footer>
  </main>
  </fieldset>
</div>
