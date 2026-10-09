import { describe, it, expect } from 'vitest';
import { pickBugs } from '../src/systems/bugHunt.js';

describe('pickBugs', () => {
  const bugs = [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 5, z: 0 }, { id: 'c', x: 0.5, z: 0, fixed: true }];
  it('picks unfixed bugs within radius', () => {
    expect(pickBugs(bugs, 0.3, 0.3, 0.9)).toEqual(['a']);
  });
  it('ignores far bugs', () => {
    expect(pickBugs(bugs, 2.5, 0, 0.9)).toEqual([]);
  });
});
