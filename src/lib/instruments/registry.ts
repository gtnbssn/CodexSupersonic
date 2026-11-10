import type { InstrumentDefinition } from './types';

/** Each instrument folder owns its complete sound definition. No central list. */
const modules = import.meta.glob<{ default: InstrumentDefinition }>('./*/index.ts', { eager: true });
export const instruments: InstrumentDefinition[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, module]) => {
    const instrument = module.default;
    if (!instrument?.id || !instrument.synthDefName || !instrument.synthDefPath || typeof instrument.mapEvent !== 'function') {
      throw new Error(`Invalid instrument module: ${path}. Expected id, synthDefName, synthDefPath and mapEvent.`);
    }
    return instrument;
  });
if (new Set(instruments.map((instrument) => instrument.id)).size !== instruments.length) {
  throw new Error('Instrument IDs must be unique; compositions store these IDs.');
}
export function getInstrument(id: string): InstrumentDefinition {
  const instrument = instruments.find((candidate) => candidate.id === id);
  if (!instrument) throw new Error(`Unknown instrument “${id}”. Check its folder definition and rebuild.`);
  return instrument;
}
