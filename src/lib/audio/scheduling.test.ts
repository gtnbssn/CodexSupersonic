import { describe, expect, it } from 'vitest';
import { osc } from 'supersonic-scsynth';
import { enqueuePlanChange, eventsInWindow, noteArguments, type AudioPlan, type AudioTrack } from './types';

const track = (id: string, times: number[], overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  id, instrumentId: 'kick', synthDefName: 'poly_kick', parameters: { amp: 0.4 }, muted: false, solo: false,
  volume: 0.5, pan: -0.25,
  events: times.map((time) => ({ time, pitch: 48, velocity: 0.8, duration: 0.2, parameters: { amp: 0.3, pitch: 55 } })),
  ...overrides
});
const plan = (tracks: AudioTrack[], loop = false): AudioPlan => ({ duration: 8, loop, tracks });

describe('audio scheduling contract', () => {
  it('keeps coincident events from independent tracks at the exact same NTP timestamp', () => {
    const source = plan([track('three', [0, 8 / 3, 16 / 3]), track('four', [0, 2, 4, 6])]);
    const events = eventsInWindow(source, 0, 0.12);
    expect(events).toHaveLength(2);
    const origin = 2208988800 + 1730000000.125;
    const packets = events.map(({ event, track: instrument, time }, index) => {
      const bytes = osc.encodeSingleBundle(origin + time, '/s_new', noteArguments(instrument, event, 1001 + index, 1000));
      return osc.decode(bytes) as { timeTag: number; packets: unknown[] };
    });
    expect(packets[0].timeTag).toBe(origin);
    expect(packets[1].timeTag).toBe(origin);
    expect(packets[0].packets[0]).toEqual(['/s_new', 'poly_kick', 1001, 0, 1000, 'amp', expect.closeTo(0.15), 'pitch', 55, 'pan', -0.25]);
  });

  it('schedules every boundary once across successive short lookahead windows', () => {
    const source = plan([track('a', [0, 0.12, 0.24, 0.36])]);
    const events = [[0, 0.12], [0.12, 0.24], [0.24, 0.36], [0.36, 0.48]]
      .flatMap(([start, end]) => eventsInWindow(source, start, end));
    expect(events.map(({ time }) => time)).toEqual([0, 0.12, 0.24, 0.36]);
  });

  it('loops and seeks deterministically without duplicating the shared anchor', () => {
    const source = plan([track('a', [0, 2, 4, 6])], true);
    expect(eventsInWindow(source, 7.9, 8.1).map(({ time }) => time)).toEqual([8]);
    expect(eventsInWindow(source, 12, 16.1).map(({ time }) => time)).toEqual([12, 14, 16]);
    expect(eventsInWindow(source, 12, 16.1)).toEqual(eventsInWindow(source, 12, 16.1));
    expect(eventsInWindow({ ...source, loop: false }, 8, 9)).toEqual([]);
  });

  it('switches plans at an uncommitted boundary while retaining already committed events', () => {
    const old = plan([track('a', [0.1, 0.2, 0.3])]);
    const next = plan([track('a', [0.1, 0.21, 0.28])]);
    const cutover = 0.2;
    const sent = [...eventsInWindow(old, 0, cutover), ...eventsInWindow(next, cutover, 0.4)];
    expect(sent.map(({ time }) => time)).toEqual([0.1, 0.21, 0.28]);
  });

  it('retains every accepted cutover during rapid edits and replaces equal-boundary revisions', () => {
    const a = plan([track('a', [0.1, 0.2, 0.3])]);
    const b = plan([track('a', [0.1, 0.21, 0.3])]);
    const c = plan([track('a', [0.1, 0.21, 0.28])]);
    const d = plan([track('a', [0.1, 0.21, 0.27])]);
    let queue = enqueuePlanChange([], { plan: b, at: 0.2 });
    queue = enqueuePlanChange(queue, { plan: c, at: 0.25 });
    queue = enqueuePlanChange(queue, { plan: d, at: 0.25 });
    expect(queue.map(({ at }) => at)).toEqual([0.2, 0.25]);
    const sent = [
      ...eventsInWindow(a, 0, queue[0].at),
      ...eventsInWindow(queue[0].plan, queue[0].at, queue[1].at),
      ...eventsInWindow(queue[1].plan, queue[1].at, 0.4)
    ];
    expect(sent.map(({ time }) => time)).toEqual([0.1, 0.21, 0.27]);
  });

  it('applies mute and solo, maps volume after velocity, and leaves the musical plan intact', () => {
    const source = plan([track('normal', [0]), track('solo', [0], { solo: true }), track('muted', [0], { solo: true, muted: true })]);
    const before = structuredClone(source);
    const event = eventsInWindow(source, 0, 1);
    expect(event.map(({ track: instrument }) => instrument.id)).toEqual(['solo']);
    noteArguments(event[0].track, event[0].event, 8, 7);
    expect(source).toEqual(before);
  });
});
