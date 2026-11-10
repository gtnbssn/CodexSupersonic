/** Musical intent, independent of any engine clock or OSC representation. */
export interface InstrumentEvent {
  pitch: number;
  velocity: number;
  duration: number;
  parameters?: Record<string, number>;
}
export interface InstrumentParameter {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
}
export interface InstrumentDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  synthDefName: string;
  synthDefPath: string;
  parameters: InstrumentParameter[];
  /** Optional resources are loaded by the engine before events are scheduled. */
  initialization?: { samples?: string[] };
  mapEvent(event: InstrumentEvent): Record<string, number>;
}
export function parametersFor(definition: InstrumentDefinition, event: InstrumentEvent): Record<string, number> {
  const mapped: Record<string, number> = {};
  for (const parameter of definition.parameters) {
    const value = event.parameters?.[parameter.id] ?? parameter.defaultValue;
    mapped[parameter.id] = Math.max(parameter.min, Math.min(parameter.max, Number.isFinite(value) ? value : parameter.defaultValue));
  }
  mapped.amp = (mapped.amp ?? 0.4) * Math.max(0, Math.min(1, event.velocity));
  return mapped;
}
export const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);
