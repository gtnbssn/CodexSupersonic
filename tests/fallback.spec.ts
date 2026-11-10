import { expect, test } from '@playwright/test';

test('postMessage fallback plays real PCM and drains queued notes on stop without cross-origin isolation', async ({ page }, testInfo) => {
  // Keep all audio assets local while exercising SuperSonic's documented
  // automatic fallback when a deployment cannot provide isolation headers.
  await page.route('http://127.0.0.1:5173/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: {
      ...response.headers(),
      'cross-origin-embedder-policy': 'unsafe-none',
      'cross-origin-opener-policy': 'unsafe-none'
    } });
  });
  await page.goto('/');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await page.evaluate(async () => {
    const adapterPath = '/src/lib/audio/SuperSonicEngine.ts';
    const modelPath = '/src/lib/model/composition.ts';
    const [{ SuperSonicEngine }, { compileComposition, createDemo }] = await Promise.all([import(adapterPath), import(modelPath)]);
    const engine = new SuperSonicEngine();
    (window as unknown as { fallbackEngine: any }).fallbackEngine = engine;
    const button = document.createElement('button');
    button.id = 'fallback-play';
    button.textContent = 'Start fallback audio';
    button.onclick = () => {
      engine.play(compileComposition(createDemo()).plan)
        .then(() => button.dataset.ready = 'true')
        .catch((error: Error) => button.dataset.error = error.message);
    };
    document.body.append(button);
  });
  try {
    await page.locator('#fallback-play').click();
    await expect(page.locator('#fallback-play')).toHaveAttribute('data-ready', 'true');
    const output = await page.evaluate(async () => {
      const engine = (window as unknown as { fallbackEngine: any }).fallbackEngine;
      let observedRms = 0, observedPeak = 0;
      const end = performance.now() + 450;
      while (performance.now() < end) {
        const diagnostics = engine.diagnostics;
        observedRms = Math.max(observedRms, diagnostics.rms);
        observedPeak = Math.max(observedPeak, diagnostics.peak);
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      return { ...engine.diagnostics, observedRms, observedPeak };
    });
    expect(output.mode).toBe('postMessage');
    expect(output.status).toBe('playing');
    expect(output.observedRms).toBeGreaterThan(0.001);
    expect(output.observedPeak).toBeGreaterThan(0.001);
    expect(output.scheduled).toBeGreaterThanOrEqual(4);
    expect(output.error).toBe('');
    expect(output.dropped).toBe(0);
    const deviceChange = await page.evaluate(() => {
      const engine = (window as unknown as { fallbackEngine: any }).fallbackEngine;
      if (!navigator.mediaDevices?.dispatchEvent) return undefined;
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      return { playing: engine.playing, warning: engine.diagnostics.error };
    });
    if (deviceChange) {
      expect(deviceChange.playing).toBe(true);
      expect(deviceChange.warning).toContain('Recover audio engine');
    }
    await page.evaluate(async () => { await (window as unknown as { fallbackEngine: any }).fallbackEngine.stop(); });
    await expect.poll(() => page.evaluate(() => (window as unknown as { fallbackEngine: any }).fallbackEngine.diagnostics.rms)).toBeLessThan(0.00001);
    await expect.poll(() => page.evaluate(() => (window as unknown as { fallbackEngine: any }).fallbackEngine.diagnostics.queueDepth)).toBe(0);
    const stopped = await page.evaluate(() => {
      const engine = (window as unknown as { fallbackEngine: any }).fallbackEngine;
      return { playing: engine.playing, position: engine.position, ...engine.diagnostics };
    });
    expect(stopped.playing).toBe(false);
    expect(stopped.position).toBe(0);
    expect(stopped.queueDepth).toBe(0);
    await testInfo.attach('postMessage-audio-output.json', { body: JSON.stringify({ output, stopped }, null, 2), contentType: 'application/json' });
  } finally {
    await page.evaluate(async () => { await (window as unknown as { fallbackEngine?: any }).fallbackEngine?.destroy(); }).catch(() => {});
  }
});
