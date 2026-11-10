/** Musical phase is measured in beats; time is composition-relative seconds. */
export type CurveKind = 'constant' | 'linear' | 'eased' | 'editable';
export interface TempoPoint { time: number; bpm: number }
export interface TempoCurve {
  kind: CurveKind;
  startBpm?: number;
  endBpm?: number;
  /** Normalized time in [0, 1]. Editable points must include both endpoints. */
  points?: TempoPoint[];
}
export interface TempoLimits {
  minBpm?: number;
  maxBpm?: number;
  /** Absolute BPM change per second. */
  maxAcceleration?: number;
}
export interface TempoSegment {
  startTime: number;
  endTime: number;
  startBeat: number;
  endBeat: number;
  /** BPM polynomial c0 + c1*u + c2*u² + c3*u³, u in [0, 1]. */
  coefficients: [number, number, number, number];
}
export interface Trajectory {
  startTime: number;
  endTime: number;
  startBeat: number;
  endBeat: number;
  segments: TempoSegment[];
  anchors?: BeatAnchor[];
}
export interface TrajectoryOptions {
  startTime: number;
  endTime: number;
  startBeat?: number;
  beats: number;
  curve: TempoCurve;
  limits?: TempoLimits;
  /** Fix the initial BPM while normalizing all subsequent control points. */
  startTempo?: number;
  /** Optional fixed terminal BPM; used to join a revised interval to its old future. */
  endTempo?: number;
}
export interface BeatAnchor { time: number; beat: number }
export class InfeasibleTrajectoryError extends Error {
  constructor(message: string) { super(message); this.name = 'InfeasibleTrajectoryError'; }
}
const EPS = 1e-9;
const finite = (value: number, name: string) => {
  if (!Number.isFinite(value)) throw new InfeasibleTrajectoryError(`${name} must be finite.`);
};
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const polynomial = ([a,b,c,d]: TempoSegment['coefficients'], u: number) => a + u * (b + u * (c + u * d));
const primitive = ([a,b,c,d]: TempoSegment['coefficients'], u: number) => a*u + b*u*u/2 + c*u*u*u/3 + d*u*u*u*u/4;
const phaseInSegment = (segment: TempoSegment, time: number) => {
  const duration = segment.endTime - segment.startTime;
  return segment.startBeat + duration / 60 * primitive(segment.coefficients, clamp((time - segment.startTime) / duration, 0, 1));
};

function curvePoints(curve: TempoCurve): TempoPoint[] {
  const start = curve.startBpm ?? 120;
  const end = curve.endBpm ?? start;
  if (!['constant','linear','eased','editable'].includes(curve.kind)) throw new InfeasibleTrajectoryError('Unknown tempo curve kind.');
  const points = curve.kind === 'editable' ? curve.points?.map(p => ({...p})) : [
    {time:0,bpm:start}, {time:1,bpm:curve.kind === 'constant' ? start : end}
  ];
  if (!points || points.length < 2 || points[0].time !== 0 || points.at(-1)!.time !== 1)
    throw new InfeasibleTrajectoryError('A tempo curve must include control points at normalized times 0 and 1.');
  points.forEach((point, index) => {
    finite(point.time,'Control point time'); finite(point.bpm,'Control point BPM');
    if (point.bpm <= 0 || (index > 0 && point.time <= points[index-1].time))
      throw new InfeasibleTrajectoryError('Tempo values must be positive and control point times strictly increasing.');
  });
  return points;
}
function interpolatePoints(points: TempoPoint[], x: number, eased: boolean) {
  const i = Math.max(0, points.findIndex((p,index) => index < points.length-1 && x >= p.time && x <= points[index+1].time));
  const a=points[i], b=points[i+1];
  const u=clamp((x-a.time)/(b.time-a.time),0,1);
  return a.bpm+(b.bpm-a.bpm)*(eased ? u*u*(3-2*u) : u);
}
function checkLimits(segment: TempoSegment, limits: TempoLimits) {
  const min = limits.minBpm ?? 1, max = limits.maxBpm ?? 600;
  const maxAcceleration = limits.maxAcceleration ?? Infinity;
  if (!(min > 0 && max >= min && maxAcceleration > 0)) throw new InfeasibleTrajectoryError('Invalid tempo or acceleration limits.');
  const [a,b,c,d]=segment.coefficients;
  const candidates=[0,1];
  // Exact interior extrema of the cubic, rather than sampling around short peaks.
  if (Math.abs(d)<EPS) { if (Math.abs(c)>EPS) candidates.push(-b/(2*c)); }
  else {
    const disc=4*c*c-12*d*b;
    if (disc>=0) candidates.push((-2*c+Math.sqrt(disc))/(6*d),(-2*c-Math.sqrt(disc))/(6*d));
  }
  for (const u of candidates.filter(u=>u>=0&&u<=1)) {
    const bpm=polynomial(segment.coefficients,u);
    if (bpm < min-EPS || bpm > max+EPS)
      throw new InfeasibleTrajectoryError(`Anchor requires ${bpm.toFixed(2)} BPM outside ${min}–${max} BPM.`);
  }
  const duration=segment.endTime-segment.startTime;
  const accelerationAt=(u:number)=>Math.abs((b+2*c*u+3*d*u*u)/duration);
  const accelPoints=[0,1];
  if (Math.abs(d)>EPS) accelPoints.push(-c/(3*d));
  if (accelPoints.filter(u=>u>=0&&u<=1).some(u=>accelerationAt(u)>maxAcceleration+EPS))
    throw new InfeasibleTrajectoryError(`Anchor exceeds the ${maxAcceleration} BPM/s acceleration limit.`);
}

/** Normalize a positive curve so its integral hits the required beat anchor exactly. */
export function createTrajectory(options: TrajectoryOptions): Trajectory {
  const {startTime,endTime,beats,curve}=options;
  const startBeat=options.startBeat??0, duration=endTime-startTime;
  [startTime,endTime,startBeat,beats].forEach(v=>finite(v,'Trajectory constraint'));
  if (!(duration>0 && beats>0)) throw new InfeasibleTrajectoryError('Anchors require increasing times and beat positions.');
  let points=curvePoints(curve);
  if (options.startTempo !== undefined || options.endTempo !== undefined) {
    for (const tempo of [options.startTempo, options.endTempo]) {
      if (tempo !== undefined && (!Number.isFinite(tempo) || tempo<=0)) throw new InfeasibleTrajectoryError('Fixed endpoint tempo must be finite and positive.');
    }
    // Intermediate knots leave enough freedom to normalize without moving fixed endpoints.
    const positions=[...new Set([...points.map(p=>p.time), ...Array.from({length:9},(_,i)=>i/8)])].sort((a,b)=>a-b);
    points=positions.map(time=>({time,bpm:interpolatePoints(points,time,curve.kind==='eased')}));
    if (options.startTempo!==undefined) points[0].bpm=options.startTempo;
    if (options.endTempo!==undefined) points[points.length-1].bpm=options.endTempo;
    const isFixed=(index:number)=>(index===0 && options.startTempo!==undefined)||(index===points.length-1 && options.endTempo!==undefined);
    let fixedArea=0, variableArea=0;
    for (let i=0;i<points.length-1;i++) {
      const width=(points[i+1].time-points[i].time)/2;
      for (const index of [i,i+1]) {
        if (isFixed(index)) fixedArea+=width*points[index].bpm;
        else variableArea+=width*points[index].bpm;
      }
    }
    const scale=(beats*60/duration-fixedArea)/variableArea;
    if (!(scale>0)) throw new InfeasibleTrajectoryError('The remaining anchor cannot be reached while preserving the current tempo.');
    points=points.map((p,i)=>({...p,bpm:isFixed(i)?p.bpm:p.bpm*scale}));
  } else {
    const area=points.slice(0,-1).reduce((sum,p,i)=>sum+(points[i+1].time-p.time)*(p.bpm+points[i+1].bpm)/2,0);
    const scale=beats*60/duration/area;
    points=points.map(p=>({...p,bpm:p.bpm*scale}));
  }
  let phase=startBeat;
  const segments:TempoSegment[]=points.slice(0,-1).map((p,i)=>{
    const next=points[i+1], delta=next.bpm-p.bpm;
    const coefficients:TempoSegment['coefficients']=curve.kind==='eased' ? [p.bpm,0,3*delta,-2*delta] : [p.bpm,delta,0,0];
    const segment:TempoSegment={startTime:startTime+p.time*duration,endTime:startTime+next.time*duration,startBeat:phase,endBeat:0,coefficients};
    segment.endBeat=phaseInSegment(segment,segment.endTime);
    checkLimits(segment,options.limits??{});
    phase=segment.endBeat;
    return segment;
  });
  // Keep the constraint itself as the exact endpoint; interpolation error is sub-ulp.
  segments.at(-1)!.endBeat=startBeat+beats;
  return {startTime,endTime,startBeat,endBeat:startBeat+beats,segments,anchors:[{time:startTime,beat:startBeat},{time:endTime,beat:startBeat+beats}]};
}

export function tempoAt(trajectory: Trajectory, time: number): number {
  finite(time,'Time');
  const segment=trajectory.segments.find(s=>time<s.endTime)??trajectory.segments.at(-1)!;
  return polynomial(segment.coefficients,clamp((time-segment.startTime)/(segment.endTime-segment.startTime),0,1));
}
export function phaseAt(trajectory: Trajectory, time: number): number {
  finite(time,'Time');
  if (time<=trajectory.startTime) return trajectory.startBeat;
  if (time>=trajectory.endTime) return trajectory.endBeat;
  const segment=trajectory.segments.find(s=>time<s.endTime)!;
  return phaseInSegment(segment,time);
}
/** Bounded monotone inversion; positive tempo ensures a unique solution. */
export function timeAtBeat(trajectory: Trajectory, beat: number): number {
  finite(beat,'Beat');
  if (beat<trajectory.startBeat-EPS || beat>trajectory.endBeat+EPS) throw new RangeError('Beat lies outside the trajectory.');
  if (beat<=trajectory.startBeat) return trajectory.startTime;
  if (beat>=trajectory.endBeat) return trajectory.endTime;
  const segment=trajectory.segments.find(s=>beat<s.endBeat)??trajectory.segments.at(-1)!;
  let lo=segment.startTime, hi=segment.endTime;
  for (let iteration=0;iteration<64&&hi-lo>1e-10;iteration++) {
    const mid=(lo+hi)/2;
    if (phaseInSegment(segment,mid)<beat) lo=mid; else hi=mid;
  }
  return (lo+hi)/2;
}

function prefix(segment: TempoSegment, boundary: number): TempoSegment {
  const fraction=(boundary-segment.startTime)/(segment.endTime-segment.startTime);
  const [a,b,c,d]=segment.coefficients;
  return {...segment,endTime:boundary,endBeat:phaseInSegment(segment,boundary),coefficients:[a,b*fraction,c*fraction*fraction,d*fraction*fraction*fraction]};
}
/** Retain committed history, current BPM/phase, and the next synchronization anchor. */
export function replanTrajectory(current: Trajectory, boundary: number, curve: TempoCurve, limits?: TempoLimits): Trajectory {
  if (!(boundary>=current.startTime && boundary<current.endTime)) throw new InfeasibleTrajectoryError('Replanning boundary must precede the final anchor.');
  const nextSegment=current.segments.find(s=>s.endTime>boundary)!;
  const anchor=current.anchors?.find(a=>a.time>boundary+EPS)??{time:current.endTime,beat:current.endBeat};
  const beat=phaseAt(current,boundary), tempo=tempoAt(current,boundary);
  const future=createTrajectory({startTime:boundary,endTime:anchor.time,startBeat:beat,beats:anchor.beat-beat,curve,limits,startTempo:tempo,endTempo:tempoAt(current,anchor.time)});
  const history=current.segments.filter(s=>s.endTime<=boundary).map(s=>({...s}));
  if (nextSegment.startTime<boundary) history.push(prefix(nextSegment,boundary));
  const retainedFuture=current.segments.filter(s=>s.startTime>=anchor.time);
  return {...current,segments:[...history,...future.segments,...retainedFuture]};
}

/** Build continuous tempo trajectories through a sequence of composition anchors. */
export function createTimeline(anchors: BeatAnchor[], curves: TempoCurve[] | TempoCurve, limits?: TempoLimits): Trajectory {
  if (anchors.length<2) throw new InfeasibleTrajectoryError('At least two anchors are required.');
  if (Array.isArray(curves)&&curves.length!==anchors.length-1) throw new InfeasibleTrajectoryError('Each anchor interval needs a tempo curve.');
  const segments:TempoSegment[]=[];
  for (let i=0;i<anchors.length-1;i++) {
    const trajectory=createTrajectory({startTime:anchors[i].time,endTime:anchors[i+1].time,startBeat:anchors[i].beat,beats:anchors[i+1].beat-anchors[i].beat,curve:Array.isArray(curves)?curves[i]:curves,limits,startTempo:segments.length?tempoAt({...trajectoryShell(segments),segments},anchors[i].time):undefined});
    segments.push(...trajectory.segments);
  }
  return {...trajectoryShell(segments),segments,anchors:anchors.map(a=>({...a}))};
}
function trajectoryShell(segments:TempoSegment[]) {
  return {startTime:segments[0].startTime,endTime:segments.at(-1)!.endTime,startBeat:segments[0].startBeat,endBeat:segments.at(-1)!.endBeat};
}

/** Apply a new curve to every remaining interval, keeping all supplied beat anchors. */
export function replanTimeline(current:Trajectory,boundary:number,anchors:BeatAnchor[],curve:TempoCurve,limits?:TempoLimits):Trajectory {
  if (!(Number.isFinite(boundary)&&boundary>=current.startTime&&boundary<current.endTime)) throw new InfeasibleTrajectoryError('Replanning boundary must precede the final anchor.');
  const futureAnchors=anchors.filter(a=>a.time>boundary+EPS);
  if (!futureAnchors.length || futureAnchors.at(-1)!.time!==current.endTime)
    throw new InfeasibleTrajectoryError('Replanning requires all future anchors including the final anchor.');
  const history=current.segments.filter(s=>s.endTime<=boundary).map(s=>({...s}));
  const partial=current.segments.find(s=>s.startTime<boundary&&s.endTime>boundary);
  if (partial) history.push(prefix(partial,boundary));
  const segments=[...history];
  let time=boundary, beat=phaseAt(current,boundary), tempo=tempoAt(current,boundary);
  for (const anchor of futureAnchors) {
    const future=createTrajectory({startTime:time,endTime:anchor.time,startBeat:beat,beats:anchor.beat-beat,curve,limits,startTempo:tempo});
    segments.push(...future.segments);
    tempo=tempoAt(future,anchor.time);
    time=anchor.time; beat=anchor.beat;
  }
  return {...trajectoryShell(segments),segments,anchors:anchors.map(a=>({...a}))};
}
