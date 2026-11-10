import {timeAtBeat, type Trajectory} from './trajectory';
export interface PatternEvent {
  /** Position within the repeating pattern, in beats. */
  beat: number;
  pitch: number;
  velocity: number;
  /** Duration in beats; it is converted with the same trajectory as note-on. */
  duration: number;
}
export interface ScheduledEvent extends PatternEvent {
  trackId: string;
  eventId: string;
  absoluteBeat: number;
  time: number;
  durationSeconds: number;
}
export interface ScheduleWindow { from: number; to: number; trackId: string }
/** Return events in the half-open time window [from,to), with deterministic IDs. */
export function schedulePattern(trajectory:Trajectory, pattern:PatternEvent[], patternBeats:number, window:ScheduleWindow):ScheduledEvent[] {
  if (!(Number.isFinite(patternBeats)&&patternBeats>0)) throw new RangeError('Pattern length must be positive.');
  if (!Number.isFinite(window.from)||!Number.isFinite(window.to)||window.to<window.from) throw new RangeError('Invalid scheduling window.');
  pattern.forEach(event=>{
    if (![event.beat,event.pitch,event.velocity,event.duration].every(Number.isFinite)||event.beat<0||event.beat>=patternBeats||event.duration<=0||event.velocity<0||event.velocity>1)
      throw new RangeError('Pattern events require a valid beat, pitch, velocity (0–1), and positive duration.');
  });
  const events:ScheduledEvent[]=[];
  const firstCycle=Math.floor(trajectory.startBeat/patternBeats);
  const lastCycle=Math.ceil(trajectory.endBeat/patternBeats);
  for (let cycle=firstCycle;cycle<=lastCycle;cycle++) {
    pattern.forEach((event,index)=>{
      const absoluteBeat=cycle*patternBeats+event.beat;
      if (absoluteBeat<trajectory.startBeat||absoluteBeat>trajectory.endBeat) return;
      const time=timeAtBeat(trajectory,absoluteBeat);
      if (time<window.from||time>=window.to) return;
      const endBeat=Math.min(trajectory.endBeat,absoluteBeat+event.duration);
      const durationSeconds=timeAtBeat(trajectory,endBeat)-time;
      events.push({...event,trackId:window.trackId,eventId:`${window.trackId}:${cycle}:${index}`,absoluteBeat,time,durationSeconds:Math.max(0.001,durationSeconds)});
    });
  }
  return events.sort((a,b)=>a.time-b.time||a.eventId.localeCompare(b.eventId));
}
