import { describe, it, expect } from 'vitest';
import { sampleSilhouette, countPetals, svgToBody, REF_FACE } from '../src/actors/silhouette.js';

const bbox = (pts) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 };
};

const pointInPolygon = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

describe('mascot silhouette', () => {
  it('is normalised: height 1, centred, roughly as wide as tall', () => {
    const { points } = sampleSilhouette();
    const b = bbox(points);
    expect(b.h).toBeCloseTo(1, 6);
    expect(Math.abs(b.cx)).toBeLessThan(1e-9);
    expect(Math.abs(b.cy)).toBeLessThan(1e-9);
    expect(b.w).toBeGreaterThan(0.85);
    expect(b.w).toBeLessThan(1.25);
  });

  it('is a star blob with 7–10 petals and real notches', () => {
    const { points } = sampleSilhouette({ samples: 240 });
    const petals = countPetals(points);
    expect(petals).toBeGreaterThanOrEqual(7);
    expect(petals).toBeLessThanOrEqual(10);
    const r = points.map((p) => Math.hypot(p.x, p.y));
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(0.12);
  });

  it('is a simple polygon with the requested sample count, CCW and no NaN', () => {
    const { points } = sampleSilhouette({ samples: 96 });
    expect(points).toHaveLength(96);
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
      area += a.x * b.y - b.x * a.y;
    }
    expect(area).toBeGreaterThan(0); // CCW winding
  });

  it('seed 0 is deterministic and other seeds vary the petals but keep the species', () => {
    const a = sampleSilhouette({ seed: 0 }), b = sampleSilhouette({ seed: 0 });
    expect(a.points).toEqual(b.points);
    const c = sampleSilhouette({ seed: 42 });
    const diff = a.points.reduce((s, p, i) => s + Math.hypot(p.x - c.points[i].x, p.y - c.points[i].y), 0) / a.points.length;
    expect(diff).toBeGreaterThan(0.005);
    expect(countPetals(c.points)).toBeGreaterThanOrEqual(6);
    expect(bbox(c.points).w).toBeGreaterThan(0.8);
  });

  it('places the face inside the body', () => {
    const { points, frame } = sampleSilhouette();
    for (const e of REF_FACE.eyes) {
      const c = svgToBody(frame, e.cx, e.cy);
      expect(pointInPolygon(c.x, c.y, points)).toBe(true);
      expect(c.y).toBeGreaterThan(0); // upper half
    }
    for (const [sx, sy] of REF_FACE.smile) {
      const c = svgToBody(frame, sx, sy);
      expect(pointInPolygon(c.x, c.y, points)).toBe(true);
    }
  });
});
