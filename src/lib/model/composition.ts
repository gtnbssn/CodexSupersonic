import { instruments, getInstrument } from '../instruments/registry';
import { createTimeline, replanTimeline, phaseAt, type TempoCurve, type Trajectory } from '../math/trajectory';
import { schedulePattern } from '../math/schedule';
import type { AudioPlan } from '../audio/types';
export interface Step { active:boolean; pitch:number; velocity:number; duration:number }
export interface Track {
 id:string; name:string; color:string; instrumentId:string; patternBeats:number;
 steps:Step[]; curve:TempoCurve; muted:boolean; solo:boolean; volume:number; pan:number; parameters:Record<string,number>;
}
export interface Anchor { time:number; beats:Record<string,number> }
export interface Composition { name:string; duration:number; loop:boolean; anchors:Anchor[]; tracks:Track[] }
export interface CompiledComposition { plan:AudioPlan; trajectories:Record<string,Trajectory> }
export function createDemo():Composition {
 const ids=['kick','snare','hihat','bass'];
 const beats=[16,12,20,8], colors=['#c6ef7b','#b6b5f4','#efb783','#7dc8c0'];
 const patterns=[[0,4,8,10,12],[0,6,8,14],[0,2,4,6,8,10,12,14],[0,3,6,8,11,14]];
 const tracks=ids.map((id,i):Track=>({id:`track-${id}`, name:['Low orbit','Counterweight','Particle field','Undercurrent'][i], color:colors[i],instrumentId:id,patternBeats:4,
  steps:Array.from({length:16},(_,j)=>({active:patterns[i].includes(j),pitch:i===3?[36,36,43,36,39,36,43,36,34,34,41,34,39,34,41,34][j]:60,velocity:j%4===0?0.9:0.65,duration:i===3?0.45:0.2})),
  curve:{kind:i===0?'constant':i===1?'linear':'eased',startBpm:[120,60,190,40][i],endBpm:[120,120,110,80][i]},
  muted:false,solo:false,volume:0.7,pan:[0,-0.12,0.18,0][i],parameters:Object.fromEntries(getInstrument(id).parameters.map(p=>[p.id,p.defaultValue]))}));
 return {name:'Divergence / 001',duration:8,loop:true,tracks,anchors:[{time:0,beats:Object.fromEntries(tracks.map(t=>[t.id,0]))},{time:8,beats:Object.fromEntries(tracks.map((t,i)=>[t.id,beats[i]]))}]};
}
const curveSignatures = new WeakMap<Trajectory,string>();
const limits={minBpm:10,maxBpm:480,maxAcceleration:600};
function planFor(composition:Composition,trajectories:Record<string,Trajectory>):CompiledComposition {
 const projected=composition.tracks.reduce((count,track)=>{const t=trajectories[track.id];return count+(Math.ceil((t.endBeat-t.startBeat)/track.patternBeats)+2)*track.steps.filter(s=>s.active).length;},0);
 if(projected>100000)throw new Error('Composition exceeds the 100,000-event limit. Shorten the cycle or simplify patterns.');
 return {trajectories, plan:{duration:composition.duration,loop:composition.loop,tracks:composition.tracks.map(track=>{
  const instrument=getInstrument(track.instrumentId);
  const events=schedulePattern(trajectories[track.id],track.steps.flatMap((step,i)=>step.active?[{beat:i*track.patternBeats/track.steps.length,pitch:step.pitch,velocity:step.velocity,duration:step.duration}]:[]),track.patternBeats,{from:0,to:composition.duration,trackId:track.id}).map(e=>({time:e.time,pitch:e.pitch,velocity:e.velocity,duration:e.durationSeconds,parameters:instrument.mapEvent({pitch:e.pitch,velocity:e.velocity,duration:e.durationSeconds,parameters:track.parameters})}));
  return {id:track.id,instrumentId:instrument.id,synthDefName:instrument.synthDefName,synthDefPath:instrument.synthDefPath,parameters:track.parameters,muted:track.muted,solo:track.solo,volume:track.volume,pan:track.pan,events};
 })}};
}
export function compileComposition(composition:Composition):CompiledComposition {
 const trajectories=Object.fromEntries(composition.tracks.map(t=>{const trajectory=createTimeline(composition.anchors.map(a=>({time:a.time,beat:a.beats[t.id]})),t.curve,limits);curveSignatures.set(trajectory,JSON.stringify(t.curve));return [t.id,trajectory];}));
 return planFor(composition,trajectories);
}
/** The caller keeps this exact future boundary; notes already committed to audio remain valid. */
export function replanComposition(composition:Composition,previous:Record<string,Trajectory>,boundary:number):CompiledComposition {
 const trajectories=Object.fromEntries(composition.tracks.map(track=>{
  const old=previous[track.id];
  if (!old) throw new Error(`Missing active trajectory for ${track.id}.`);
  if(curveSignatures.get(old)===JSON.stringify(track.curve))return [track.id,old];
  if(boundary>=old.endTime-1e-6)throw new Error('This edit is too close to the loop boundary. Try again after the next cycle.');
  const next=replanTimeline(old,Math.max(old.startTime,boundary),composition.anchors.map(a=>({time:a.time,beat:a.beats[track.id]})),track.curve,limits);
  curveSignatures.set(next,JSON.stringify(track.curve));return [track.id,next];
 }));
 return planFor(composition,trajectories);
}
export function addAnchor(composition:Composition,time:number):Composition {
 if (!(time>0.1&&time<composition.duration-0.1)||composition.anchors.some(a=>Math.abs(a.time-time)<0.1)) throw new Error('Place anchors at least 0.1 seconds apart, inside the timeline.');
 const {trajectories}=compileComposition(composition);
 composition.anchors.push({time,beats:Object.fromEntries(composition.tracks.map(t=>[t.id,phaseAt(trajectories[t.id],time)]))});
 composition.anchors.sort((a,b)=>a.time-b.time);return composition;
}
export function moveAnchor(composition:Composition,index:number,time:number):Composition {
 if(index<=0||index>=composition.anchors.length-1) throw new Error('The start and end anchors define the composition boundary.');
 if(time<=composition.anchors[index-1].time+0.1||time>=composition.anchors[index+1].time-0.1) throw new Error('Anchor must stay between its neighbors (0.1 second minimum gap).');
 const previous=composition.anchors[index].time;composition.anchors[index].time=time;
 try { compileComposition(composition); } catch(error) {composition.anchors[index].time=previous;throw error;}
 return composition;
}
function object(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function finite(value:unknown,min:number,max:number):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;}
/** Explicit bounded import validation prevents malformed or unbounded schedules. */
export function validateComposition(value:unknown):Composition {
 if(!object(value)||typeof value.name!=='string'||value.name.length>200||!finite(value.duration,0.5,600)||typeof value.loop!=='boolean'||!Array.isArray(value.tracks)||value.tracks.length<1||value.tracks.length>16||!Array.isArray(value.anchors)||value.anchors.length<2||value.anchors.length>64) throw new Error('Invalid composition: expected name, duration, loop, 1–16 tracks, and 2–64 anchors.');
 const seen=new Set<string>();
 for(const raw of value.tracks){
  if(!object(raw)||typeof raw.id!=='string'||seen.has(raw.id)||raw.id.length>80||typeof raw.name!=='string'||typeof raw.color!=='string'||!/^#[0-9a-f]{6}$/i.test(raw.color)||!instruments.some(i=>i.id===raw.instrumentId)||!finite(raw.patternBeats,0.25,64)||!Array.isArray(raw.steps)||raw.steps.length<1||raw.steps.length>128||!object(raw.curve)||!object(raw.parameters)||typeof raw.muted!=='boolean'||typeof raw.solo!=='boolean'||!finite(raw.volume,0,1)||!finite(raw.pan,-1,1)) throw new Error('Invalid track or unknown instrument.');
  seen.add(raw.id);
  for(const step of raw.steps) if(!object(step)||typeof step.active!=='boolean'||!finite(step.pitch,0,127)||!finite(step.velocity,0,1)||!finite(step.duration,0.001,64)) throw new Error('Invalid note: pitch 0–127, velocity 0–1, positive duration required.');
  for(const v of Object.values(raw.parameters)) if(!finite(v,-1e6,1e6)) throw new Error('Instrument parameters must be finite numbers.');
  const instrument=getInstrument(raw.instrumentId as string);
  for(const p of instrument.parameters)if(raw.parameters[p.id]!==undefined&&!finite(raw.parameters[p.id],p.min,p.max))throw new Error(`${p.label} must be between ${p.min} and ${p.max}.`);
  if(Array.isArray(raw.curve.points)&&raw.curve.points.length>64)throw new Error('Use at most 64 tempo control points.');
 }
 const composition=value as unknown as Composition;
 let last=-1;
 for(const anchor of composition.anchors){if(!object(anchor)||!finite(anchor.time,0,composition.duration)||anchor.time<=last||!object(anchor.beats))throw new Error('Anchor times must be strictly increasing.');last=anchor.time;
  for(const id of seen)if(!finite(anchor.beats[id],0,4096))throw new Error('Each anchor needs a finite beat target for every track.');
 }
 if(composition.anchors[0].time!==0||composition.anchors.at(-1)!.time!==composition.duration)throw new Error('Anchors must span the complete composition.');
 compileComposition(composition);return structuredClone(composition);
}
