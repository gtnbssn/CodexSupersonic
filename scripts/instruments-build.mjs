import { mkdtemp, writeFile, readFile, copyFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverInstruments, root, validateSynthDef, validateInstruments } from './instruments-validate.mjs';

const scString = (text) => JSON.stringify(text);
const temporary = await mkdtemp(path.join(tmpdir(), 'poly-synthdefs-'));
try {
  const definitions = await discoverInstruments();
  const compiler = process.env.SCLANG || 'sclang';
  const script = path.join(temporary, 'compile.scd');
  // Each source writes its named definition into an isolated output directory.
  await writeFile(script, `try {\n~outputDir = ${scString(temporary)};\n${definitions.map(({ folder }) => `${scString(path.join(folder, 'synthdef.scd'))}.load;`).join('\n')}\n0.exit;\n} { |error| error.reportError; 1.exit; };\n`);
  const args = [...(process.env.SCLANG_CONFIG ? ['-l', process.env.SCLANG_CONFIG] : []), '-D', script];
  const result = spawnSync(compiler, args, { encoding: 'utf8', timeout: 120000, env: { ...process.env, QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM || 'offscreen' } });
  if (result.error?.code === 'ENOENT') throw new Error('sclang not found. Install SuperCollider language (Debian: supercollider-language), or set SCLANG to its executable. Playback and instruments:validate use bundled assets and do not require sclang.');
  if (result.error || result.status !== 0) throw new Error(`SuperCollider compilation failed (${result.error?.message || `exit ${result.status}`}):\n${result.stdout || ''}\n${result.stderr || ''}`);
  await mkdir(path.join(root, 'static/synthdefs'), { recursive: true });
  // Validate every output before replacing any bundled asset.
  for (const { name } of definitions) validateSynthDef(await readFile(path.join(temporary, `${name}.scsyndef`)), name);
  for (const { folder, name, id } of definitions) {
    const output = path.join(temporary, `${name}.scsyndef`);
    await copyFile(output, path.join(folder, 'synthdef.scsyndef'));
    await copyFile(output, path.join(root, 'static/synthdefs', `${name}.scsyndef`));
    console.log(`Compiled ${id} → ${name}.scsyndef`);
  }
  await validateInstruments();
} catch (error) {
  console.error(`Instrument build failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
