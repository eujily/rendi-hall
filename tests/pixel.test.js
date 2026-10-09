import { describe, it, expect } from 'vitest';
import { defaultPalette, snapAxis, worldPerPixel } from '../src/kit/pixel.js';

describe('pixel helpers', () => {
  it('default palette: 8 brand colours x 5 steps, unique, valid 24-bit', () => {
    const p = defaultPalette();
    expect(p.length).toBeGreaterThanOrEqual(30);
    expect(new Set(p).size).toBe(p.length);
    p.forEach((c) => expect(c >= 0 && c <= 0xffffff).toBe(true));
    expect(p).toContain(0xf5d360);
    expect(p).toContain(0xa9c79a);
  });
  it('snapAxis lands on the grid and reports the remainder', () => {
    const { snapped, shift } = snapAxis(10.37, 0.1);
    expect(Math.abs(snapped / 0.1 - Math.round(snapped / 0.1))).toBeLessThan(1e-9);
    expect(Math.abs(shift)).toBeLessThanOrEqual(0.5);
    expect(snapped - shift * 0.1).toBeCloseTo(10.37, 9);
  });
  it('worldPerPixel: 19 units over 1080 device px at scale 3 and zoom 1', () => {
    expect(worldPerPixel(19, 1, 1080, 3)).toBeCloseTo((19 * 3) / 1080, 9);
    expect(worldPerPixel(19, 2, 1080, 3)).toBeCloseTo((19 * 3) / 1080 / 2, 9);
  });
});
