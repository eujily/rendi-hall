import { describe, it, expect } from 'vitest';
import { makeFrame, worldToMini, miniToWorld, zoneBounds, clampToBounds } from '../src/ui/minimap.js';

describe('minimap mapping', () => {
  for (const zone of ['town', 'hall']) {
    it(`round-trips in ${zone}`, () => {
      const b = zoneBounds(zone);
      const f = makeFrame(b, 200, 160, 12);
      for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.maxZ], [f.cx, f.cz], [b.minX + 3, b.maxZ - 2]]) {
        const m = worldToMini(f, x, z);
        const w = miniToWorld(f, m.u, m.v);
        expect(w.x).toBeCloseTo(x, 6);
        expect(w.z).toBeCloseTo(z, 6);
      }
    });
    it(`fits canvas in ${zone}`, () => {
      const b = zoneBounds(zone);
      const f = makeFrame(b, 200, 160, 12);
      for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]]) {
        const m = worldToMini(f, x, z);
        expect(m.u).toBeGreaterThanOrEqual(0); expect(m.u).toBeLessThanOrEqual(200);
        expect(m.v).toBeGreaterThanOrEqual(0); expect(m.v).toBeLessThanOrEqual(160);
      }
    });
  }
  it('matches camera orientation', () => {
    const f = makeFrame(zoneBounds('hall'), 200, 160);
    const o = worldToMini(f, 0, 0);
    expect(worldToMini(f, 1, -1).u).toBeGreaterThan(o.u); // screen-right = (1,0,-1)
    expect(worldToMini(f, -1, -1).v).toBeLessThan(o.v); // screen-up = (-1,0,-1)
  });
  it('clamps', () => {
    expect(clampToBounds(zoneBounds('hall'), { x: 99, z: -99 })).toEqual({ x: 12, z: -9 });
  });
});
