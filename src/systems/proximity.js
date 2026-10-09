// STUB — replaced by agent ⑤ (plan Task 5).
import { bus } from '../core/events.js';

export function nearest(pos, targets) {
  let best = null, bestD = Infinity;
  for (const t of targets) {
    const d = Math.hypot(pos.x - t.x, pos.z - t.z);
    if (d <= t.r && d < bestD) { best = t; bestD = d; }
  }
  return best ? { id: best.id, kind: best.kind } : null;
}

export function createProximity(targets, hysteresis = 0.3) {
  const api = {
    current: null,
    update(pos) {
      if (api.current) {
        const t = targets.find((x) => x.id === api.current.id);
        if (t && Math.hypot(pos.x - t.x, pos.z - t.z) <= t.r + hysteresis) return;
        bus.emit('proximity:leave', api.current);
        api.current = null;
      }
      const n = nearest(pos, targets);
      if (n) { api.current = n; bus.emit('proximity:enter', n); }
    },
  };
  return api;
}
