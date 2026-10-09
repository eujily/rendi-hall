import { describe, it, expect } from 'vitest';
import { KINDS, paintKind, DEFAULT_BASE } from '../src/kit/textures.js';

describe('pixel texture kit', () => {
  for (const kind of KINDS) {
    it(`${kind}: deterministic, power-of-two, limited palette`, () => {
      const a = paintKind(kind), b = paintKind(kind);
      expect(a.data).toEqual(b.data);
      expect([32, 64]).toContain(a.w);
      expect(a.h).toBe(a.w);
      expect(new Set(a.px).size).toBeLessThanOrEqual(14);
      expect(DEFAULT_BASE[kind]).toBeTypeOf('number');
    });
  }
  it('recolours by base', () => {
    expect(paintKind('roofShingles', 0xd63532).px).not.toEqual(paintKind('roofShingles', 0xf5d360).px);
  });
  it('rejects unknown kinds', () => {
    expect(() => paintKind('nope')).toThrow();
  });
});
