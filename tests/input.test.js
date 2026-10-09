// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appState } from '../src/core/appState.js';
import { bus } from '../src/core/events.js';
import { createInput } from '../src/systems/input.js';

const key = (type, code, target = window, init = {}) => {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe('input', () => {
  let canvas, input, floorPick, firstMoves, off;
  beforeEach(() => {
    if (appState.mode === 'LOADING') appState.request('ready');
    canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
    document.body.append(canvas);
    floorPick = { x: 5, z: 5 };
    input = createInput(canvas, { pickFloor: () => floorPick, pickStand: () => null });
    firstMoves = 0;
    off = bus.on('player:firstMove', () => firstMoves++);
  });
  afterEach(() => {
    input.destroy();
    off();
    canvas.remove();
  });

  const click = () => canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }));

  it('keys override click target', () => {
    click();
    expect(input.getMoveTarget()).toEqual({ x: 5, z: 5 });
    key('keydown', 'ArrowUp');
    expect(input.getMoveTarget()).toBeNull();
    const v = input.getMoveVector();
    expect(v.x).toBeCloseTo(-Math.SQRT1_2, 6); // screen-up = world −X−Z
    expect(v.z).toBeCloseTo(-Math.SQRT1_2, 6);
    key('keyup', 'ArrowUp');
    expect(input.getMoveVector()).toEqual({ x: 0, z: 0 });
    expect(input.getMoveTarget()).toBeNull(); // target stays cleared
  });

  it('normalises diagonals and emits player:firstMove once', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyD');
    const v = input.getMoveVector();
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1, 6);
    input.getMoveVector();
    click();
    expect(firstMoves).toBe(1);
  });

  it('prevents page scroll on arrows/space', () => {
    expect(key('keydown', 'ArrowDown').defaultPrevented).toBe(true);
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
  });

  it('ignores keys typed in inputs and dialogs, except Escape', () => {
    const calls = [];
    input.onInteract(() => calls.push('interact'));
    input.onBack(() => calls.push('back'));
    const field = document.createElement('input');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    dialog.append(inner);
    document.body.append(field, dialog);
    key('keydown', 'Enter', field);
    key('keydown', 'ArrowUp', field);
    key('keydown', 'KeyE', inner);
    expect(calls).toEqual([]);
    expect(input.getMoveVector()).toEqual({ x: 0, z: 0 });
    key('keydown', 'Escape', field);
    key('keydown', 'Escape', inner);
    expect(calls).toEqual(['back', 'back']);
    field.remove();
    dialog.remove();
  });

  it('Enter/Space/E interact; held keys do not repeat', () => {
    let n = 0;
    input.onInteract(() => n++);
    key('keydown', 'Enter');
    key('keydown', 'Space');
    key('keydown', 'KeyE');
    key('keydown', 'Enter', window, { repeat: true });
    expect(n).toBe(3);
  });

  it('ignores movement unless EXPLORE, and drops held keys when leaving EXPLORE', () => {
    key('keydown', 'ArrowUp');
    click();
    appState.request('stand:open', { id: 'pay' });
    expect(input.getMoveVector()).toEqual({ x: 0, z: 0 });
    expect(input.getMoveTarget()).toBeNull();
    key('keydown', 'ArrowLeft');
    appState.request('stand:close');
    appState.request('stand:closed');
    expect(appState.is('EXPLORE')).toBe(true);
    expect(input.getMoveVector()).toEqual({ x: 0, z: 0 }); // nothing "stuck" held
  });

  it('stand click fires onStandClick and does not set a floor target', () => {
    input.destroy();
    input = createInput(canvas, { pickFloor: () => floorPick, pickStand: () => 'pay' });
    let id = null;
    input.onStandClick((x) => (id = x));
    click();
    expect(id).toBe('pay');
    expect(input.getMoveTarget()).toBeNull();
  });
});
