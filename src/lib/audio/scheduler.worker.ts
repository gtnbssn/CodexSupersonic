/// <reference lib="webworker" />
import { OscChannel, osc } from 'supersonic-scsynth';
import { DEFAULT_LOOKAHEAD, enqueuePlanChange, eventsInWindow, noteArguments, type AudioPlan, type PlanChange } from './types';

let channel: OscChannel | undefined;
let plan: AudioPlan | undefined;
let pending: PlanChange[] = [];
let origin = 0;
let cursor = 0;
let running = false;
let group = 0;
let lookahead = DEFAULT_LOOKAHEAD;
let timer: ReturnType<typeof setTimeout> | undefined;
let scheduled = 0;
let missed = 0;
let dropped = 0;

function report() {
  self.postMessage({ type: 'metrics', scheduled, missed, dropped, committed: cursor });
}

function schedule(from: number, to: number) {
  if (!plan || !channel) return;
  const engineNow = channel.now();
  for (const item of eventsInWindow(plan, from, to)) {
    const ntpTime = origin + item.time;
    if (ntpTime < engineNow + 0.003) { missed++; continue; }
    const bytes = osc.encodeSingleBundle(ntpTime, '/s_new', noteArguments(item.track, item.event, channel.nextNodeId(), group));
    if (channel.send(bytes)) scheduled++;
    else dropped++;
  }
}

function tick() {
  if (!running || !channel || !plan) return;
  const now = channel.now() - origin;
  const target = Math.max(cursor, now + lookahead);
  let end = target;
  if (!plan.loop) end = Math.min(end, plan.duration);
  // Plans have an explicit future cutover. Never enqueue old events past it.
  while (pending.length && pending[0].at <= end) {
    const change = pending.shift()!;
    schedule(cursor, change.at);
    cursor = change.at;
    plan = change.plan;
    end = plan.loop ? target : Math.min(target, plan.duration);
  }
  schedule(cursor, end);
  cursor = end;
  report();
  if (!plan.loop && now >= plan.duration) {
    running = false;
    self.postMessage({ type: 'ended' });
    return;
  }
  // Wakeups are approximate; the engine clock and OSC NTP tags own playback.
  timer = setTimeout(tick, Math.max(10, lookahead * 1000 / 4));
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      channel = await OscChannel.fromTransferable(data.channel);
      group = data.group;
      lookahead = Math.max(0.05, Math.min(0.5, data.lookahead ?? DEFAULT_LOOKAHEAD));
      self.postMessage({ type: 'ready', requestId: data.requestId });
    } else if (data.type === 'play') {
      if (!channel) throw new Error('Audio worker has no OscChannel');
      clearTimeout(timer);
      plan = data.plan;
      pending = [];
      cursor = data.position;
      origin = data.origin;
      running = true;
      tick();
      self.postMessage({ type: 'started', requestId: data.requestId });
    } else if (data.type === 'update') {
      if (!running) { plan = data.plan; self.postMessage({ type: 'updated', at: data.at, requestId: data.requestId }); return; }
      // Parent chooses an uncommitted boundary; reject rather than duplicate notes.
      if (data.at < cursor - 1e-6) throw new Error('Plan boundary precedes committed audio. Retry the edit.');
      pending = enqueuePlanChange(pending, { plan: data.plan, at: data.at });
      self.postMessage({ type: 'updated', at: data.at, requestId: data.requestId });
    } else if (data.type === 'halt') {
      running = false;
      clearTimeout(timer);
      pending = [];
      // A sync sent on THIS channel confirms earlier sends reached the engine.
      // Main awaits its reply before purging the global timestamp queue.
      channel?.send(osc.encodeMessage('/sync', [data.syncId]));
      self.postMessage({ type: 'halted', requestId: data.requestId });
    } else if (data.type === 'close' || data.type === 'release') {
      running = false;
      clearTimeout(timer);
      channel?.close();
      self.postMessage({ type: 'released', requestId: data.requestId });
      self.close();
    }
  } catch (error) {
    if (data.type !== 'update') { running = false; clearTimeout(timer); }
    self.postMessage({ type: 'error', fatal: data.type !== 'update', error: error instanceof Error ? error.message : String(error), requestId: data.requestId });
  }
};
