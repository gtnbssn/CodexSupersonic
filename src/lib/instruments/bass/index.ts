import { midiToHz, parametersFor, type InstrumentDefinition } from '../types';
const instrument: InstrumentDefinition = {
  id: 'bass', name: 'Bass', category: 'Synthesizer',
  description: 'A rounded saw bass with a resonant low-pass filter.',
  synthDefName: 'poly_bass', synthDefPath: '/synthdefs/poly_bass.scsyndef',
  parameters: [
    { id: 'transpose', label: 'Transpose', min: -24, max: 24, step: 1, defaultValue: 0, unit: 'st' },
    { id: 'cutoff', label: 'Cutoff', min: 100, max: 8000, step: 25, defaultValue: 850, unit: 'Hz' },
    { id: 'resonance', label: 'Resonance', min: 0.1, max: 1, step: 0.01, defaultValue: 0.5 },
    { id: 'release', label: 'Release', min: 0.05, max: 2, step: 0.01, defaultValue: 0.25, unit: 's' },
    { id: 'amp', label: 'Volume', min: 0, max: 0.8, step: 0.01, defaultValue: 0.3 }
  ],
  mapEvent(event) {
    const { transpose, ...parameters } = parametersFor(instrument, event);
    return { ...parameters, freq: midiToHz(event.pitch + transpose), sustain: Math.max(0.01, event.duration) };
  }
};
export default instrument;
