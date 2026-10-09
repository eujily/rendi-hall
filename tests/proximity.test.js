import { describe, it, expect, beforeEach } from 'vitest';
import { bus } from '../src/core/events.js';
import { nearest, createProximity } from '../src/systems/proximity.js';

const targets = () => [
  { id: 'a', kind: 'stand', x: 0, z: 0, r: 2 },
  { id: 'b', kind: 'stand', x: 3, z: 0, r: 2 },
];

describe('proximity.nearest', () => {
  it('nearest within r', () => {
    expect(nearest({ x: 0.5, z: 0 }, targets())).toEqual({ id: 'a', kind: 'stand' });
    expect(nearest({ x: 2.4, z: 0 }, targets())).toEqual({ id: 'b', kind: 'stand' }); // inside both, b closer
  });
  it('null outside', () => {
    expect(nearest({ x: 10, z: 10 }, targets())).toBeNull();
  });
});

describe('createProximity', () => {
  let log, offs;
  beforeEach(() => {
    log = [];
    offs = [
      bus.on('proximity:enter', (p) => log.push(['enter', p.id])),
      bus.on('proximity:leave', (p) => log.push(['leave', p.id])),
    ];
    return () => offs.forEach((off) => off());
  });

  it('emits enter once, not on every update', () => {
    const prox = createProximity(targets());
    prox.update({ x: 0, z: 0 });
    prox.update({ x: 0.1, z: 0 });
    expect(log).toEqual([['enter', 'a']]);
    expect(prox.current).toEqual({ id: 'a', kind: 'stand' });
  });

  it('hysteresis: leave only beyond r+0.3', () => {
    const prox = createProximity([targets()[0]], 0.3);
    prox.update({ x: 1.9, z: 0 });
    prox.update({ x: 2.2, z: 0 }); // outside r, inside the band
    expect(log).toEqual([['enter', 'a']]);
    prox.update({ x: 2.4, z: 0 }); // beyond r + 0.3
    expect(log).toEqual([['enter', 'a'], ['leave', 'a']]);
    expect(prox.current).toBeNull();
  });

  it('leave then enter on switch', () => {
    const prox = createProximity(targets());
    prox.update({ x: -1, z: 0 }); // only a
    prox.update({ x: 4.5, z: 0 }); // only b, a far away
    expect(log).toEqual([['enter', 'a'], ['leave', 'a'], ['enter', 'b']]);
    expect(prox.current.id).toBe('b');
  });

  it('switches from the hysteresis band into a freshly entered neighbour', () => {
    const prox = createProximity(targets());
    prox.update({ x: 1.0, z: 0 }); // a
    prox.update({ x: 2.2, z: 0 }); // a: in band (2.2 <= 2.3); b: inside (0.8 <= 2) -> switch
    expect(log).toEqual([['enter', 'a'], ['leave', 'a'], ['enter', 'b']]);
  });

  it('reads moving targets live', () => {
    const t = [{ id: 'npc', kind: 'npc', x: 10, z: 10, r: 1.6 }];
    const prox = createProximity(t);
    prox.update({ x: 0, z: 0 });
    expect(log).toEqual([]);
    t[0].x = 0.5; t[0].z = 0;
    prox.update({ x: 0, z: 0 });
    expect(log).toEqual([['enter', 'npc']]);
  });
});
