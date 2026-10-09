import { describe, it, expect } from 'vitest';
import { createAppState } from '../src/core/appState.js';

const make = () => {
  const log = [];
  const s = createAppState((type, p) => log.push(p));
  s.request('ready');
  return { s, log };
};

describe('appState', () => {
  it('runs the full open/close cycle', () => {
    const { s } = make();
    expect(s.request('stand:open', { id: 'pay' })).toBe(true);
    expect(s.mode).toBe('OPENING');
    expect(s.focusedId).toBe('pay');
    expect(s.request('stand:opened')).toBe(true);
    expect(s.request('stand:close')).toBe(true);
    expect(s.request('stand:closed')).toBe(true);
    expect(s.mode).toBe('EXPLORE');
    expect(s.focusedId).toBe(null);
  });

  it('close during OPENING → CLOSING, late "opened" is rejected', () => {
    const { s } = make();
    s.request('stand:open', { id: 'pay' });
    expect(s.request('stand:close')).toBe(true);
    expect(s.mode).toBe('CLOSING');
    expect(s.request('stand:opened')).toBe(false);
  });

  it('rejects invalid transitions and double open', () => {
    const { s } = make();
    expect(s.request('stand:close')).toBe(false);
    s.request('stand:open', { id: 'pay' });
    expect(s.request('stand:open', { id: 'learn' })).toBe(false);
    expect(s.focusedId).toBe('pay');
  });

  it('emits mode events', () => {
    const { s, log } = make();
    s.request('stand:open', { id: 'care' });
    expect(log.at(-1)).toMatchObject({ from: 'EXPLORE', to: 'OPENING', payload: { id: 'care' } });
  });

  it('travels between zones', () => {
    const { s } = make();
    expect(s.zone).toBe('town');
    expect(s.request('zone:leave', { zone: 'hall' })).toBe(true);
    expect(s.mode).toBe('TRAVEL');
    expect(s.zone).toBe('hall');
    expect(s.request('stand:open', { id: 'pay' })).toBe(false);
    expect(s.request('zone:entered')).toBe(true);
    expect(s.mode).toBe('EXPLORE');
    expect(s.request('zone:entered')).toBe(false);
  });

  it('cannot leave a zone while a stand is open', () => {
    const { s } = make();
    s.request('stand:open', { id: 'pay' });
    expect(s.request('zone:leave', { zone: 'hall' })).toBe(false);
    expect(s.zone).toBe('town');
  });
});
