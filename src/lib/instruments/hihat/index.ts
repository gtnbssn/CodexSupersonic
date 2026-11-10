import { parametersFor, type InstrumentDefinition } from '../types';
const instrument: InstrumentDefinition = {
  id: 'hihat', name: 'Hi-hat', category: 'Percussion',
  description: 'Bright filtered noise with a tight percussive envelope.',
  synthDefName: 'poly_hihat', synthDefPath: '/synthdefs/poly_hihat.scsyndef',
  parameters: [
    { id: 'brightness', label: 'Brightness', min: 2500, max: 12000, step: 100, defaultValue: 7000, unit: 'Hz' },
    { id: 'decay', label: 'Decay', min: 0.02, max: 0.5, step: 0.01, defaultValue: 0.075, unit: 's' },
    { id: 'amp', label: 'Volume', min: 0, max: 0.8, step: 0.01, defaultValue: 0.2 }
  ],
  mapEvent(event) { return parametersFor(instrument, event); }
};
export default instrument;
