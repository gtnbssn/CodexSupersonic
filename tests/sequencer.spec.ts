import { expect, test, type Page } from '@playwright/test';

async function directEngine(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const enginePath = '/src/lib/audio/SuperSonicEngine.ts';
    const modelPath = '/src/lib/model/composition.ts';
    const [{ SuperSonicEngine }, model] = await Promise.all([import(enginePath), import(modelPath)]);
    const engine = new SuperSonicEngine({ lookahead: 0.12 });
    const state = window as unknown as { testAudio: any; testModel: any };
    state.testAudio = engine;
    state.testModel = model;
    const button = document.createElement('button');
    button.id = 'test-initialize';
    button.textContent = 'Initialize test audio';
    button.onclick = () => { engine.initialize().then(() => button.dataset.ready = 'true').catch((error: Error) => button.dataset.error = error.message); };
    document.body.append(button);
  });
  await page.locator('#test-initialize').click();
  await expect(page.locator('#test-initialize')).toHaveAttribute('data-ready', 'true');
}

async function audioSample(page: Page, milliseconds = 400) {
  return page.evaluate(async (duration) => {
    const engine = (window as unknown as { testAudio: any }).testAudio;
    let peak = 0, rms = 0;
    const end = performance.now() + duration;
    while (performance.now() < end) {
      const metrics = engine.diagnostics;
      peak = Math.max(peak, metrics.peak);
      rms = Math.max(rms, metrics.rms);
      await new Promise(resolve => setTimeout(resolve, 8));
    }
    return { peak, rms, ...engine.diagnostics, observedPeak: peak, observedRms: rms };
  }, milliseconds);
}

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => { await (window as unknown as { testAudio?: any }).testAudio?.destroy(); }).catch(() => {});
});

test('the interface auditions all four real SynthDefs and preserves timing when changing instruments', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Confluence/);
  await expect(page.getByTestId('timeline')).toBeVisible();
  await page.getByTestId('diagnostics').click();
  const sounds: Record<string, { rms: number; peak: number }> = {};
  for (const id of ['kick', 'snare', 'hihat', 'bass']) {
    await page.getByTestId('instrument-select').selectOption(id);
    await page.getByTestId('audition').click();
    await expect(page.locator('.engine-status')).toHaveText('AUDIO READY');
    sounds[id] = await page.evaluate(async () => {
      let rms = 0, peak = 0;
      const end = performance.now() + 500;
      while (performance.now() < end) {
        const metrics = JSON.parse(document.querySelector('.diagnostics-content pre')?.textContent || '{}');
        rms = Math.max(rms, metrics.rms || 0);
        peak = Math.max(peak, metrics.peak || 0);
        await new Promise(resolve => setTimeout(resolve, 8));
      }
      return { rms, peak };
    });
    expect(sounds[id].rms, `${id} must produce actual nonzero PCM output`).toBeGreaterThan(0.0001);
    expect(sounds[id].peak).toBeGreaterThan(0.001);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await testInfo.attach('measured-instrument-output.json', { body: JSON.stringify(sounds, null, 2), contentType: 'application/json' });

  // Sound changes preserve the mathematical plan's event times and note intent.
  const preserved = await page.evaluate(async () => {
    const modelPath = '/src/lib/model/composition.ts';
    const { createDemo, compileComposition } = await import(modelPath);
    const composition = createDemo();
    const before = compileComposition(composition).plan.tracks[0].events.map(({ time, pitch, velocity, duration }: any) => ({ time, pitch, velocity, duration }));
    composition.tracks[0].instrumentId = 'bass';
    const after = compileComposition(composition).plan.tracks[0].events.map(({ time, pitch, velocity, duration }: any) => ({ time, pitch, velocity, duration }));
    return { before, after };
  });
  expect(preserved.after).toEqual(preserved.before);
});

test('worker scheduling plays concurrent voices, applies a future edit, pauses, seeks, loops and recovers', async ({ page }, testInfo) => {
  await directEngine(page);
  await page.evaluate(async () => {
    const { testAudio: engine, testModel: model } = window as unknown as { testAudio: any; testModel: any };
    await engine.play(model.compileComposition(model.createDemo()).plan);
  });
  const initial = await audioSample(page, 800);
  expect(initial.status).toBe('playing');
  expect(initial.scheduled).toBeGreaterThan(4);
  expect(initial.observedRms).toBeGreaterThan(0.001);
  expect(initial.dropped).toBe(0);
  expect(initial.error).toBe('');

  const edit = await page.evaluate(async () => {
    const { testAudio: engine, testModel: model } = window as unknown as { testAudio: any; testModel: any };
    const composition = model.createDemo();
    const before = model.compileComposition(composition);
    const boundary = engine.committedPosition();
    composition.tracks[1].curve.endBpm = 140;
    const after = model.replanComposition(composition, before.trajectories, boundary);
    await engine.update(after.plan, boundary);
    return { boundary, position: engine.position, untouched: before.trajectories['track-kick'] === after.trajectories['track-kick'] };
  });
  expect(edit.boundary).toBeGreaterThan(edit.position);
  expect(edit.untouched).toBe(true);
  const edited = await audioSample(page, 400);
  expect(edited.status).toBe('playing');
  expect(edited.scheduled).toBeGreaterThan(initial.scheduled);
  expect(edited.error).toBe('');

  const pausedAt = await page.evaluate(async () => {
    const engine = (window as unknown as { testAudio: any }).testAudio;
    await engine.pause();
    return engine.position;
  });
  await page.waitForTimeout(150);
  const paused = await page.evaluate(() => {
    const engine = (window as unknown as { testAudio: any }).testAudio;
    return { position: engine.position, playing: engine.playing, diagnostics: engine.diagnostics };
  });
  expect(paused.playing).toBe(false);
  expect(paused.position).toBeCloseTo(pausedAt, 5);
  expect(paused.diagnostics.peak).toBeLessThan(0.00001);

  // Resume close to the end to exercise a real wrap in under a second.
  await page.evaluate(async () => {
    const { testAudio: engine, testModel: model } = window as unknown as { testAudio: any; testModel: any };
    await engine.seek(7.7);
    await engine.play(model.compileComposition(model.createDemo()).plan, engine.position);
  });
  const looped = await audioSample(page, 650);
  const afterLoop = await page.evaluate(() => (window as unknown as { testAudio: any }).testAudio.position);
  expect(afterLoop).toBeGreaterThan(0);
  expect(afterLoop).toBeLessThan(1.5);
  expect(looped.observedRms).toBeGreaterThan(0.001);
  expect(looped.error).toBe('');

  await page.evaluate(async () => {
    const engine = (window as unknown as { testAudio: any }).testAudio;
    await engine.stop();
    // Simulate an actual browser/device suspension, then exercise recovery.
    await engine.sonic.audioContext.suspend();
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { testAudio: any }).testAudio.diagnostics.status)).toBe('suspended');
  await page.evaluate(async () => { await (window as unknown as { testAudio: any }).testAudio.recover(); });
  const recovered = await page.evaluate(() => {
    const engine = (window as unknown as { testAudio: any }).testAudio;
    return { ready: engine.ready, position: engine.position, diagnostics: engine.diagnostics };
  });
  expect(recovered.ready).toBe(true);
  expect(recovered.position).toBe(0);
  expect(recovered.diagnostics.error).toBe('');
  await page.evaluate(async () => {
    const instrumentPath = '/src/lib/instruments/registry.ts';
    const { getInstrument } = await import(instrumentPath);
    await (window as unknown as { testAudio: any }).testAudio.audition(getInstrument('kick'));
  });
  const recoveryOutput = await audioSample(page, 350);
  expect(recoveryOutput.observedRms).toBeGreaterThan(0.001);
  await testInfo.attach('worker-and-recovery-metrics.json', { body: JSON.stringify({ initial, edited, paused, looped, recovered, recoveryOutput }, null, 2), contentType: 'application/json' });
});

test('missing and malformed SynthDefs report useful failures', async ({ page }) => {
  await directEngine(page);
  await page.route('**/synthdefs/broken.scsyndef', route => route.fulfill({ contentType: 'application/octet-stream', body: 'not-a-synthdef' }));
  const failures = await page.evaluate(async () => {
    const engine = (window as unknown as { testAudio: any }).testAudio;
    const errors: string[] = [];
    for (const path of ['/synthdefs/missing.scsyndef', '/synthdefs/broken.scsyndef']) {
      try { await engine.loadSynthDef(path); } catch (error) { errors.push(String(error)); }
    }
    return errors;
  });
  expect(failures).toHaveLength(2);
  expect(failures[0]).toContain('/synthdefs/missing.scsyndef');
  expect(failures[1]).toContain('/synthdefs/broken.scsyndef');
});
