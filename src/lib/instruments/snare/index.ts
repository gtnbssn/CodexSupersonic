import { parametersFor, type InstrumentDefinition } from '../types';
const instrument: InstrumentDefinition = {
  id: 'snare', name: 'Snare', category: 'Percussion',
  description: 'A pitched shell layered with filtered white noise.',
  synthDefName: 'poly_snare', synthDefPath: '/synthdefs/poly_snare.scsyndef',
  parameters: [
    { id: 'tone', label: 'Tone', min: 100, max: 500, step: 1, defaultValue: 185, unit: 'Hz' },
    { id: 'noise', label: 'Noise', min: 0, max: 1, step: 0.01, defaultValue: 0.65 },
    { id: 'decay', label: 'Decay', min: 0.05, max: 0.8, step: 0.01, defaultValue: 0.18, unit: 's' },
    { id: 'amp', label: 'Volume', min: 0, max: 0.8, step: 0.01, defaultValue: 0.35 }
  ],
  mapEvent(event) { return parametersFor(instrument, event); }
};
export default instrument;
