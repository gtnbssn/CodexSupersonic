import { parametersFor, type InstrumentDefinition } from '../types';
const instrument: InstrumentDefinition = {
  id: 'kick', name: 'Kick', category: 'Percussion',
  description: 'A falling sine body with a soft saturated attack.',
  synthDefName: 'poly_kick', synthDefPath: '/synthdefs/poly_kick.scsyndef',
  parameters: [
    { id: 'pitch', label: 'Pitch', min: 30, max: 100, step: 1, defaultValue: 52, unit: 'Hz' },
    { id: 'decay', label: 'Decay', min: 0.08, max: 1.5, step: 0.01, defaultValue: 0.38, unit: 's' },
    { id: 'drive', label: 'Drive', min: 1, max: 6, step: 0.1, defaultValue: 1.8 },
    { id: 'amp', label: 'Volume', min: 0, max: 0.8, step: 0.01, defaultValue: 0.5 }
  ],
  mapEvent(event) { return parametersFor(instrument, event); }
};
export default instrument;
