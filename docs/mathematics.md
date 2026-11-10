# Musical time and synchronization

The mathematical modules in `src/lib/math/` contain no browser, OSC, or synthesis dependencies. Composition time is measured in seconds, musical phase in beats, and instantaneous tempo in BPM.

For track `i`,

```text
db_i(t) / dt = v_i(t) / 60
b_i(T_k) = B_i,k
integral from T_k to T_(k+1) of v_i(t)/60 dt = B_i,k+1 - B_i,k
```

An anchor fixes each participating track's beat position at one composition time. It does not require equal tempos. The demo completes 16, 12, 20, and 8 beats over the same eight seconds: average tempos are 120, 90, 150, and 60 BPM.

## Curves and normalization

`createTrajectory` creates one anchored interval; `createTimeline` joins multiple intervals. Supported input shapes are:

- `constant`: equal control values at both ends.
- `linear`: interpolate between initial and final values.
- `eased`: use smoothstep `s(u) = 3u² - 2u³` between control values.
- `editable`: piecewise linear interpolation through positive control values at strictly increasing normalized times. The first and last times must be 0 and 1.

Input `startBpm`, `endBpm`, and editable point values define the requested **shape**. They are weights before normalization; they are not independent absolute BPM promises. For an unconstrained interval, all values are multiplied by

```text
scale = 60 * requiredBeats / (intervalSeconds * areaUnderInputShape)
```

The UI therefore labels the endpoint controls as weights. The trajectory graph and instantaneous BPM readout show the resulting normalized tempo. The input point handles represent editable weights; they may not lie on the resulting normalized graph.

At later anchors, the initial tempo is fixed to the preceding interval's terminal tempo. The solver inserts intermediate knots, keeps that initial value fixed, and scales the free control values to satisfy the next beat target. A constant input shape after a fixed boundary can consequently produce a varying curve: both continuity and the anchor take precedence over an unnormalized shape request.

## Exact integration and bounded inversion

Each stored span is a cubic BPM polynomial over normalized span time `u`:

```text
v(u) = c0 + c1*u + c2*u² + c3*u³
b(u) = startBeat + spanSeconds/60 *
       (c0*u + c1*u²/2 + c2*u³/3 + c3*u⁴/4)
```

Linear spans set the higher coefficients to zero. Eased spans use `[start, 0, 3*delta, -2*delta]`. Integration is analytical; it does not accumulate frame-by-frame or timer-step error. Public endpoint phase values are the exact requested anchor values.

`timeAtBeat` finds the containing span, then bisects its monotonic phase function. The search stops after at most 64 iterations or when its time bracket is narrower than `1e-10` seconds. Positive BPM makes the inverse unique. Seeking recomputes from the same trajectory, so it does not depend on playback history.

## Feasibility

A valid interval needs finite, strictly increasing times and beat positions, positive control values, and a feasible normalized curve. The solver checks exact cubic extrema for BPM limits and derivative extrema for acceleration limits. It throws `InfeasibleTrajectoryError` rather than clipping values and silently missing an anchor.

The composition model currently uses 10–480 BPM and a maximum absolute acceleration of 600 BPM per second. A supplied shape can be rejected even if some different shape could satisfy the same anchors; this solver validates and normalizes a requested family of curves rather than searching every possible trajectory.

Tempo is continuous between intervals. Acceleration need not be continuous across knots. Eased spans have zero first derivative at their own endpoints; arbitrary live edits do not promise acceleration continuity.

## Replanning

`replanTimeline(current, boundary, anchors, curve, limits)`:

1. Evaluates phase and instantaneous BPM at the future cutover boundary.
2. Retains earlier polynomial spans, clipping the boundary span by exact polynomial reparameterization.
3. Fixes the new curve's initial BPM to the evaluated value.
4. Normalizes each remaining interval to its supplied anchor and carries terminal BPM into the following interval.

This preserves phase, tempo, and every future anchor when feasible. `replanTrajectory` is a narrower alternative: it revises only to the next stored anchor, fixes that anchor's old BPM, and retains all later spans.

The composition model compares curve signatures. Editing a track's sound or another track's curve keeps unaffected trajectory objects unchanged. Musical events retain their beat positions; only their derived absolute times change.

## Event scheduling and loops

`schedulePattern` repeats beat-relative events, uses `timeAtBeat` for note-on and note-end, and returns deterministic event IDs. Its windows are half-open `[from, to)`, so adjacent windows do not duplicate a boundary note. A duration extending beyond the final composition anchor is truncated there; the engine receives a positive minimum duration of one millisecond.

The audio worker repeats the compiled composition in seconds. The end of a cycle is excluded and the next cycle's first event is included exactly once. This keeps anchor times aligned, but does **not** impose matching start/end BPM, acceleration, or pattern phase. A loop can therefore have a tempo jump at its seam. Use matching endpoint tempo and compatible beat totals when a smooth repeated seam matters. A live-replanned composition repeats its resulting historical-prefix/future-suffix trajectory on subsequent cycles.

Audio has a committed lookahead window; see [architecture.md](architecture.md). The mathematical cutover must lie beyond already queued audio. Edits near the cycle boundary can be rejected rather than break the continuity or scheduling contract.

## Verification

`src/lib/math/trajectory.test.ts` checks analytical integration, phase inversion, all four normalized shapes, multiple anchors, BPM/acceleration infeasibility, exact preservation of pre-edit eased curves, continuous replanning, deterministic seeking/window partitioning, and common anchor times for tracks with different beat totals. Model tests separately verify instrument switching, anchor edits, and composition validation.
