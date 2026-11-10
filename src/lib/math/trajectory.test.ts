import {describe,expect,it} from 'vitest';
import {createTimeline,createTrajectory,InfeasibleTrajectoryError,phaseAt,replanTimeline,replanTrajectory,tempoAt,timeAtBeat,type CurveKind} from './trajectory';
import {schedulePattern} from './schedule';

const linear=()=>createTrajectory({startTime:0,endTime:8,beats:16,curve:{kind:'linear',startBpm:60,endBpm:180}});
const pattern=[{beat:0,pitch:36,velocity:0.9,duration:0.5},{beat:1,pitch:43,velocity:0.5,duration:0.25}];
describe('anchored musical trajectories',()=>{
  it('integrates constant BPM and inverts phase analytically',()=>{
    const t=createTrajectory({startTime:10,endTime:18,startBeat:4,beats:16,curve:{kind:'constant',startBpm:100}});
    expect(tempoAt(t,12)).toBe(120);
    expect(phaseAt(t,12)).toBe(8);
    expect(timeAtBeat(t,8)).toBeCloseTo(12,8);
  });
  it('integrates a linear acceleration without discretization',()=>{
    const t=linear();
    expect(phaseAt(t,4)).toBeCloseTo(6,12);
    expect(tempoAt(t,0)).toBeCloseTo(60,12);
    expect(tempoAt(t,8)).toBeCloseTo(180,12);
    expect(phaseAt(t,8)).toBe(16);
  });
  it.each(['constant','linear','eased','editable'] as CurveKind[])('normalizes %s curves to exact anchors and inverts every beat',kind=>{
    const t=createTrajectory({startTime:2,endTime:11,startBeat:7,beats:20,curve:{kind,startBpm:85,endBpm:170,points:[{time:0,bpm:70},{time:0.3,bpm:180},{time:0.8,bpm:110},{time:1,bpm:140}]}});
    expect(phaseAt(t,2)).toBe(7);
    expect(phaseAt(t,11)).toBe(27);
    for (let beat=7;beat<=27;beat+=0.25) expect(phaseAt(t,timeAtBeat(t,beat))).toBeCloseTo(beat,8);
  });
  it('keeps tempo continuous through multiple anchors with different beat totals',()=>{
    const t=createTimeline([{time:0,beat:0},{time:8,beat:16},{time:16,beat:28}],{kind:'linear',startBpm:70,endBpm:140});
    expect(phaseAt(t,8)).toBeCloseTo(16,10);
    expect(phaseAt(t,16)).toBe(28);
    expect(tempoAt(t,8-1e-8)).toBeCloseTo(tempoAt(t,8+1e-8),5);
  });
  it('preserves phase and instantaneous tempo while retaining the next anchor',()=>{
    const current=linear(), boundary=3.25;
    const revised=replanTrajectory(current,boundary,{kind:'eased',startBpm:160,endBpm:50});
    expect(phaseAt(revised,boundary)).toBeCloseTo(phaseAt(current,boundary),10);
    expect(tempoAt(revised,boundary)).toBeCloseTo(tempoAt(current,boundary),10);
    expect(phaseAt(revised,8)).toBe(16);
    expect(tempoAt(revised,8)).toBeCloseTo(tempoAt(current,8),10);
    for (const time of [0,1,2,3]) expect(phaseAt(revised,time)).toBeCloseTo(phaseAt(current,time),10);
    expect(timeAtBeat(revised,12)).not.toBeCloseTo(timeAtBeat(current,12),3);
  });
  it('preserves the original eased polynomial before a replanning boundary',()=>{
    const current=createTrajectory({startTime:0,endTime:8,beats:16,curve:{kind:'eased',startBpm:60,endBpm:180}});
    const revised=replanTrajectory(current,2.7,{kind:'linear',startBpm:80,endBpm:180});
    for (const time of [0,0.5,1.5,2.5,2.7]) {
      expect(phaseAt(revised,time)).toBeCloseTo(phaseAt(current,time),10);
      expect(tempoAt(revised,time)).toBeCloseTo(tempoAt(current,time),10);
    }
  });
  it('replans only to the next anchor and retains subsequent trajectory',()=>{
    const current=createTimeline([{time:0,beat:0},{time:8,beat:16},{time:16,beat:32}],{kind:'constant'});
    const revised=replanTrajectory(current,3,{kind:'linear',startBpm:80,endBpm:160});
    expect(phaseAt(revised,8)).toBeCloseTo(16,10);
    expect(tempoAt(revised,8-1e-9)).toBeCloseTo(tempoAt(current,8),6);
    for (const time of [8,10,15,16]) {
      expect(phaseAt(revised,time)).toBeCloseTo(phaseAt(current,time),10);
      expect(tempoAt(revised,time)).toBeCloseTo(tempoAt(current,time),10);
    }
  });
  it('replans every future interval without moving any requested anchor',()=>{
    const anchors=[{time:0,beat:0},{time:8,beat:16},{time:16,beat:28},{time:24,beat:48}];
    const current=createTimeline(anchors,{kind:'constant'});
    const revised=replanTimeline(current,3.2,anchors,{kind:'eased',startBpm:70,endBpm:150});
    for (const anchor of anchors) expect(phaseAt(revised,anchor.time)).toBeCloseTo(anchor.beat,8);
    expect(phaseAt(revised,3.2)).toBeCloseTo(phaseAt(current,3.2),10);
    expect(tempoAt(revised,3.2)).toBeCloseTo(tempoAt(current,3.2),10);
    for (const time of [8,16]) expect(tempoAt(revised,time-1e-8)).toBeCloseTo(tempoAt(revised,time+1e-8),5);
    for (const time of [0,1,2,3]) expect(phaseAt(revised,time)).toBeCloseTo(phaseAt(current,time),10);
  });
  it('rejects anchors beyond BPM or acceleration limits',()=>{
    expect(()=>createTrajectory({startTime:0,endTime:1,beats:20,curve:{kind:'constant'}})).toThrow(InfeasibleTrajectoryError);
    expect(()=>createTrajectory({startTime:0,endTime:8,beats:16,curve:{kind:'eased',startBpm:60,endBpm:180},limits:{maxAcceleration:10}})).toThrow(/acceleration/);
  });
  it('rejects malformed control points and nonmonotonic anchors',()=>{
    expect(()=>createTrajectory({startTime:1,endTime:0,beats:1,curve:{kind:'constant'}})).toThrow(/increasing/);
    expect(()=>createTrajectory({startTime:0,endTime:8,beats:16,curve:{kind:'editable',points:[{time:0,bpm:90},{time:0,bpm:100},{time:1,bpm:140}]}})).toThrow(/strictly/);
    expect(()=>createTrajectory({startTime:0,endTime:8,beats:16,curve:{kind:'linear',startBpm:NaN}})).toThrow(/finite/);
    expect(()=>timeAtBeat(linear(),17)).toThrow(RangeError);
  });
});

describe('deterministic musical-event scheduling',()=>{
  it('maps events to exact phase-derived times, including note durations',()=>{
    const t=linear(), schedule=schedulePattern(t,pattern,4,{from:0,to:8,trackId:'kick'});
    expect(schedule).toHaveLength(8);
    for (const event of schedule) {
      expect(phaseAt(t,event.time)).toBeCloseTo(event.absoluteBeat,8);
      expect(phaseAt(t,event.time+event.durationSeconds)-event.absoluteBeat).toBeCloseTo(event.duration,8);
    }
  });
  it('seeking and disjoint scheduling windows produce the same events',()=>{
    const t=linear();
    const all=schedulePattern(t,pattern,4,{from:0,to:8,trackId:'bass'});
    const split=[...schedulePattern(t,pattern,4,{from:0,to:3,trackId:'bass'}),...schedulePattern(t,pattern,4,{from:3,to:8,trackId:'bass'})];
    expect(split).toEqual(all);
    expect(schedulePattern(t,pattern,4,{from:3,to:8,trackId:'bass'})).toEqual(all.filter(e=>e.time>=3));
  });
  it('tracks completing different beat counts reach a shared anchor simultaneously',()=>{
    const schedules=[16,12,20,8].map((beats,index)=>{
      const t=createTrajectory({startTime:0,endTime:8,beats,curve:{kind:'constant'}});
      return schedulePattern(t,[pattern[0]],1,{from:8,to:8.01,trackId:String(index)});
    });
    expect(schedules.map(s=>s[0].time)).toEqual([8,8,8,8]);
  });
  it('changing sound metadata cannot change timing',()=>{
    const t=linear();
    const a=schedulePattern(t,pattern,4,{from:0,to:8,trackId:'track'});
    const b=schedulePattern(t,pattern.map(e=>({...e,pitch:60})),4,{from:0,to:8,trackId:'track'});
    expect(a.map(e=>e.time)).toEqual(b.map(e=>e.time));
  });
  it('rejects invalid patterns instead of producing NaN timestamps',()=>{
    expect(()=>schedulePattern(linear(),pattern,0,{from:0,to:8,trackId:'x'})).toThrow(RangeError);
    expect(()=>schedulePattern(linear(),[{...pattern[0],velocity:2}],4,{from:0,to:8,trackId:'x'})).toThrow(/velocity/);
  });
});
