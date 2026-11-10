import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function discoverInstruments() {
  const directory = path.join(root, 'src/lib/instruments');
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(directory, entry.name);
    const metadata = await readFile(path.join(folder, 'index.ts'), 'utf8').catch(() => { throw new Error(`${entry.name}: missing index.ts instrument metadata.`); });
    const name = metadata.match(/synthDefName:\s*['"]([^'"]+)['"]/)?.[1];
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`${entry.name}: define a literal, safe synthDefName in index.ts.`);
    await access(path.join(folder, 'synthdef.scd')).catch(() => { throw new Error(`${entry.name}: missing synthdef.scd source.`); });
    results.push({ folder, name, id: entry.name });
  }
  if (!results.length) throw new Error('No instrument folders found. Add src/lib/instruments/<id>/index.ts and synthdef.scd.');
  if (new Set(results.map(({ name }) => name)).size !== results.length) throw new Error('Duplicate SynthDef names. Each instrument needs a unique synthDefName.');
  return results.sort((a, b) => a.id.localeCompare(b.id));
}
/** Parse the standard SCgf v2 container, including inputs, outputs and variants. */
export function validateSynthDef(bytes, expectedName) {
  const buffer = Buffer.from(bytes);
  let offset = 0;
  const ensure = (n) => { if (n < 0 || offset + n > buffer.length) throw new Error('Malformed SynthDef: truncated binary.'); };
  const i16 = () => { ensure(2); const n = buffer.readInt16BE(offset); offset += 2; return n; };
  const i32 = () => { ensure(4); const n = buffer.readInt32BE(offset); offset += 4; return n; };
  const skip = (n) => { ensure(n); offset += n; };
  const string = () => { ensure(1); const length = buffer[offset++]; ensure(length); const s = buffer.toString('utf8', offset, offset + length); offset += length; return s; };
  ensure(10);
  if (buffer.toString('ascii', 0, 4) !== 'SCgf') throw new Error('Invalid SynthDef magic; expected SCgf binary, not text or an HTTP error page.');
  offset = 4;
  if (i32() !== 2) throw new Error('Expected a version 2 SynthDef compiled by SuperCollider 3.x.');
  if (i16() !== 1) throw new Error('Each instrument must contain exactly one SynthDef.');
  const name = string();
  if (expectedName && name !== expectedName) throw new Error(`SynthDef name mismatch: metadata requests ${expectedName}, binary defines ${name}.`);
  const constants = i32(); skip(constants * 4);
  const controls = i32(); skip(controls * 4);
  const parameters = [];
  for (let count = i32(); count > 0; count--) { parameters.push(string()); const index = i32(); if (index < 0 || index >= controls) throw new Error('Invalid control parameter index.'); }
  const ugens = [];
  const unitCount = i32();
  if (unitCount < 1 || unitCount > 10000) throw new Error('Invalid UGen count.');
  for (let unit = 0; unit < unitCount; unit++) {
    ugens.push(string()); skip(1);
    const inputs = i32(), outputs = i32(); skip(2);
    if (inputs < 0 || outputs < 0) throw new Error('Invalid UGen input/output count.');
    for (let input = 0; input < inputs; input++) {
      const source = i32(), output = i32();
      if (source < -1 || source >= unit || output < 0 || (source === -1 && output >= constants)) throw new Error('Invalid UGen input reference.');
    }
    skip(outputs);
  }
  for (let variants = i16(); variants > 0; variants--) { string(); skip(controls * 4); }
  if (offset !== buffer.length) throw new Error('Malformed SynthDef: unexpected trailing bytes.');
  if (!ugens.includes('Out') || !ugens.includes('EnvGen')) throw new Error(`${name}: expected Out and a self-freeing EnvGen envelope.`);
  return { name, parameters, ugens };
}
export async function validateInstruments({ quiet = false } = {}) {
  const definitions = await discoverInstruments();
  for (const definition of definitions) {
    const sourcePath = path.join(definition.folder, 'synthdef.scsyndef');
    const publicPath = path.join(root, 'static/synthdefs', `${definition.name}.scsyndef`);
    const source = await readFile(sourcePath).catch(() => { throw new Error(`${definition.id}: missing compiled synthdef.scsyndef. Run npm run instruments:build with sclang installed.`); });
    const publicBytes = await readFile(publicPath).catch(() => { throw new Error(`${definition.id}: missing public asset ${publicPath}. Run npm run instruments:build.`); });
    const info = validateSynthDef(source, definition.name);
    validateSynthDef(publicBytes, definition.name);
    if (!source.equals(publicBytes)) throw new Error(`${definition.id}: source and public SynthDef assets differ. Rebuild instruments.`);
    if (!quiet) console.log(`✓ ${definition.id}: ${info.name}; ${source.length} bytes; ${info.ugens.length} UGens`);
  }
  return definitions.length;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateInstruments().catch((error) => { console.error(`Instrument validation failed: ${error.message}`); process.exitCode = 1; });
}
