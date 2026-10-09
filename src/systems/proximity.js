import { bus } from '../core/events.js';

const dist = (pos, t) => Math.hypot(pos.x - t.x, pos.z - t.z);

/** Closest target whose own radius contains `pos`, as {id, kind}, or null. Pure. */
export function nearest(pos, targets) {
  let best = null, bestD = Infinity;
  for (const t of targets) {
    const d = dist(pos, t);
    if (d <= t.r && d < bestD) { best = t; bestD = d; }
  }
  return best ? { id: best.id, kind: best.kind } : null;
}

/**
 * Tracks the single nearest target and emits proximity:enter / proximity:leave on the bus.
 * The current target is kept until `pos` is further than r + hysteresis (no flicker on the edge).
 * Targets are read live, so moving targets (NPCs) may mutate their x/z between updates.
 * Switching emits leave first, then enter, within the same update.
 */
export function createProximity(targets, hysteresis = 0.3) {
  const api = {
    current: null,
    update(pos) {
      const cur = api.current;
      if (cur) {
        const t = targets.find((x) => x.id === cur.id && x.kind === cur.kind);
        const d = t ? dist(pos, t) : Infinity;
        if (t && d <= t.r) return; // still inside: stay
        if (t && d <= t.r + hysteresis) {
          // In the hysteresis band: stay unless another target has been properly entered.
          const other = nearest(pos, targets);
          if (!other || (other.id === cur.id && other.kind === cur.kind)) return;
        }
        api.current = null;
        bus.emit('proximity:leave', cur);
      }
      const n = nearest(pos, targets);
      if (n) {
        api.current = n;
        bus.emit('proximity:enter', n);
      }
    },
  };
  return api;
}
