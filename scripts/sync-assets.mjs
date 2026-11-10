import { cp, mkdir } from 'node:fs/promises';
const copies = [
 ['node_modules/supersonic-scsynth/dist/workers','static/supersonic/workers'],
 ['node_modules/supersonic-scsynth-core/wasm','static/supersonic-core/wasm'],
 ['node_modules/supersonic-scsynth-core/workers','static/supersonic-core/workers']
];
for (const [source, target] of copies) { await mkdir(target,{recursive:true}); await cp(source,target,{recursive:true}); }
for (const pkg of ['supersonic-scsynth','supersonic-scsynth-core']) {
 await cp('node_modules/supersonic-scsynth/COPYING', `static/${pkg === 'supersonic-scsynth' ? 'supersonic' : 'supersonic-core'}/COPYING`);
 await cp(`node_modules/${pkg}/LICENSE`, `static/${pkg === 'supersonic-scsynth' ? 'supersonic' : 'supersonic-core'}/LICENSE`);
}
await cp('docs/licenses/GPL-3.0.txt','static/supersonic-core/COPYING.GPL');
console.log('Self-hosted SuperSonic 0.96.0 runtime assets copied.');
