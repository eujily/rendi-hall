import { describe, it, expect } from 'vitest';
import { step, velocityToward } from '../src/systems/movement.js';

const ROOM = { minX: -12, maxX: 12, minZ: -9, maxZ: 9 };
const R = 0.45;

describe('movement.step', () => {
  it('moves by vel*dt', () => {
    const p = step({ x: 0, z: 0 }, { x: 4, z: -2 }, 0.1, [], ROOM);
    expect(p.x).toBeCloseTo(0.4, 6);
    expect(p.z).toBeCloseTo(-0.2, 6);
  });

  it('does not mutate its input', () => {
    const pos = { x: 1, z: 1 };
    step(pos, { x: 1, z: 1 }, 0.1, [], ROOM);
    expect(pos).toEqual({ x: 1, z: 1 });
  });

  it('slides along circle (tangential component kept)', () => {
    const c = { x: 0, z: 0, r: 1.3 };
    // just outside the collider on +x side, moving diagonally into it
    let pos = { x: c.r + R + 0.01, z: 0 };
    const vel = { x: -3, z: 3 };
    const startAngle = Math.atan2(pos.z, pos.x);
    for (let i = 0; i < 20; i++) pos = step(pos, vel, 1 / 60, [c], ROOM);
    const d = Math.hypot(pos.x - c.x, pos.z - c.z);
    expect(d).toBeGreaterThanOrEqual(c.r + R - 1e-6); // never inside
    expect(d).toBeLessThan(c.r + R + 0.05); // hugs the surface
    expect(Math.atan2(pos.z, pos.x)).toBeGreaterThan(startAngle + 0.3); // moved around it (z grew)
  });

  it('a purely tangential move is not slowed', () => {
    const c = { x: 0, z: 0, r: 1 };
    const start = { x: 0, z: 1 + R + 0.5 };
    const p = step(start, { x: 2, z: 0 }, 0.1, [c], ROOM);
    expect(p.x).toBeCloseTo(0.2, 6);
  });

  it('clamped to bounds (radius aware)', () => {
    const p = step({ x: 11.5, z: -8.5 }, { x: 50, z: -50 }, 0.5, [], ROOM);
    expect(p.x).toBeCloseTo(ROOM.maxX - R, 6);
    expect(p.z).toBeCloseTo(ROOM.minZ + R, 6);
  });

  it('no tunnelling on big dt', () => {
    const c = { x: 0, z: 0, r: 1.3 };
    // 20 units in one frame, straight at the centre: must stop on the near side, not jump over
    const head = step({ x: -3, z: 0 }, { x: 40, z: 0 }, 0.5, [c], ROOM);
    expect(head.x).toBeCloseTo(-(c.r + R), 6);
    // off-centre: slides around, ends outside the circle
    const off = step({ x: -3, z: 0.2 }, { x: 40, z: 0 }, 0.5, [c], ROOM);
    expect(Math.hypot(off.x - c.x, off.z - c.z)).toBeGreaterThanOrEqual(c.r + R - 1e-6);
  });

  it('survives a dead-centre start and zero/negative dt', () => {
    const c = { x: 0, z: 0, r: 1 };
    const p = step({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.1, [c], ROOM);
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(1 + R - 1e-6);
    expect(step({ x: 2, z: 2 }, { x: 5, z: 5 }, 0, [], ROOM)).toEqual({ x: 2, z: 2 });
  });
});

describe('movement.velocityToward', () => {
  it('points at the target with the given speed', () => {
    const v = velocityToward({ x: 0, z: 0 }, { x: 3, z: 4 }, 5);
    expect(v.x).toBeCloseTo(3, 6);
    expect(v.z).toBeCloseTo(4, 6);
  });

  it('arrives: zero velocity within arriveDist, and walking converges', () => {
    expect(velocityToward({ x: 0, z: 0 }, { x: 0.1, z: 0 }, 4)).toEqual({ x: 0, z: 0 });
    let pos = { x: 0, z: 0 };
    const target = { x: 5, z: -3 };
    for (let i = 0; i < 600; i++) {
      const v = velocityToward(pos, target, 4.2);
      if (!v.x && !v.z) break;
      pos = step(pos, v, 1 / 60, [], ROOM);
    }
    expect(Math.hypot(pos.x - target.x, pos.z - target.z)).toBeLessThan(0.15);
  });
});
