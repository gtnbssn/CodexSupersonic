import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instruments, getInstrument } from './registry';
import { validateSynthDef } from '../../../scripts/instruments-validate.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(directory, 'discovery-test-fixture');
afterEach(async () => { await rm(fixture, { recursive: true, force: true }); });

describe('folder instrument definitions', () => {
  it('discovers the four default instruments with stable IDs', () => {
    expect(instruments.map((instrument) => instrument.id).sort()).toEqual(['bass', 'hihat', 'kick', 'snare']);
    expect(() => getInstrument('missing')).toThrow('Unknown instrument');
  });
  it('maps velocity, clamps controls and preserves musical note intent', () => {
    const kick = getInstrument('kick');
    expect(kick.mapEvent({ pitch: 36, velocity: 0.5, duration: 0.2, parameters: { amp: 0.6, pitch: 1000 } })).toMatchObject({ amp: 0.3, pitch: 100 });
    const bass = getInstrument('bass');
    expect(bass.mapEvent({ pitch: 69, velocity: 1, duration: 0.3, parameters: { transpose: 12 } })).toMatchObject({ freq: 880, sustain: 0.3 });
    expect(bass.mapEvent({ pitch: 69, velocity: 0, duration: 0.3 }).amp).toBe(0);
  });
  it('validates the name, controls and binary structure of every bundled instrument', async () => {
    for (const instrument of instruments) {
      const bytes = await readFile(path.join(directory, instrument.id, 'synthdef.scsyndef'));
      const info = validateSynthDef(bytes, instrument.synthDefName);
      const mapped = instrument.mapEvent({ pitch: 48, velocity: 0.7, duration: 0.1 });
      for (const name of Object.keys(mapped)) expect(info.parameters).toContain(name);
      expect(info.ugens).toContain('EnvGen');
      const publicBytes = await readFile(path.join(directory, '../../../static', instrument.synthDefPath));
      expect(bytes.equals(publicBytes)).toBe(true);
    }
  });
  it('rejects missing signatures, truncated binaries and mismatched names with useful errors', async () => {
    const bytes = await readFile(path.join(directory, 'kick/synthdef.scsyndef'));
    expect(() => validateSynthDef(Buffer.from('this is not a synthdef'), 'poly_kick')).toThrow('SCgf');
    expect(() => validateSynthDef(bytes.subarray(0, 50), 'poly_kick')).toThrow('truncated');
    expect(() => validateSynthDef(bytes, 'wrong_name')).toThrow('name mismatch');
  });
  it('registers a newly added instrument folder without editing the registry', async () => {
    await mkdir(fixture, { recursive: true });
    await writeFile(path.join(fixture, 'index.ts'), `export default { id: 'discovery-test-fixture', name: 'Fixture', category: 'Test', description: 'Discovery test', synthDefName: 'poly_fixture', synthDefPath: '/synthdefs/poly_fixture.scsyndef', parameters: [], mapEvent: () => ({ amp: 0.1 }) };`);
    // A fresh module request forces the build-time glob to include the new folder.
    const modulePath = './registry.ts?discovery-test';
    const discovered = await import(/* @vite-ignore */ modulePath);
    expect(discovered.getInstrument('discovery-test-fixture').name).toBe('Fixture');
  });
});
