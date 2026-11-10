/** A precomputed musical plan. All times are composition seconds, never wall time. */
export interface AudioEvent {
  time: number;
  pitch: number;
  velocity: number;
  duration: number;
  /** The instrument's mapEvent result. Mapping does not belong to the scheduler. */
  parameters?: Record<string, number>;
}

export interface AudioTrack {
  id: string;
  instrumentId: string;
  synthDefName: string;
  synthDefPath?: string;
  parameters: Record<string, number>;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  events: AudioEvent[];
}

export interface AudioPlan {
  duration: number;
  loop: boolean;
  tracks: AudioTrack[];
}

export interface AudioDiagnostics {
  status: 'idle' | 'loading' | 'ready' | 'playing' | 'suspended' | 'error';
  mode: string;
  error: string;
  sampleRate: number;
  rms: number;
  peak: number;
  scheduled: number;
  missed: number;
  dropped: number;
  queueDepth: number;
  late: number;
  maxLateMs: number;
  lookahead: number;
}

export const DEFAULT_LOOKAHEAD = 0.12;

export interface PlanChange { plan: AudioPlan; at: number }

/** Accepted plans form a timeline. Rapid edits must not erase earlier cutovers. */
export function enqueuePlanChange(queue: PlanChange[], change: PlanChange): PlanChange[] {
  return [...queue.filter((item) => Math.abs(item.at - change.at) > 1e-9), change]
    .sort((left, right) => left.at - right.at);
}

/** Pure compilation is shared by tests and the real worker. */
export function noteArguments(track: AudioTrack, event: AudioEvent, node: number, group: number): (string | number)[] {
  const parameters = { ...track.parameters, ...event.parameters };
  parameters.amp = (parameters.amp ?? event.velocity * 0.35) * track.volume;
  parameters.pan = track.pan;
  return [track.synthDefName, node, 0, group, ...Object.entries(parameters).flat()];
}

/** Expand cycles in a half-open interval. A boundary note is scheduled once. */
export function eventsInWindow(plan: AudioPlan, from: number, to: number): { track: AudioTrack; event: AudioEvent; time: number }[] {
  if (!(plan.duration > 0) || !(to > from)) return [];
  const anySolo = plan.tracks.some((track) => track.solo && !track.muted);
  const firstCycle = plan.loop ? Math.max(0, Math.floor(from / plan.duration)) : 0;
  const lastCycle = plan.loop ? Math.floor(to / plan.duration) : 0;
  const result = [];
  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    for (const track of plan.tracks) {
      if (track.muted || (anySolo && !track.solo)) continue;
      for (const event of track.events) {
        if (event.time < 0 || event.time >= plan.duration) continue;
        const time = cycle * plan.duration + event.time;
        if (time >= from - 1e-9 && time < to - 1e-9) result.push({ track, event, time });
      }
    }
  }
  return result.sort((a, b) => a.time - b.time || a.track.id.localeCompare(b.track.id));
}
