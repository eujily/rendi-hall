import { bus } from './events.js';

// Single owner of the app mode (docs/system-design.md §3).
const TRANSITIONS = {
  LOADING: { ready: 'EXPLORE' },
  EXPLORE: { 'stand:open': 'OPENING', 'zone:leave': 'TRAVEL' },
  TRAVEL: { 'zone:entered': 'EXPLORE' },
  OPENING: { 'stand:opened': 'FOCUSED', 'stand:close': 'CLOSING' },
  FOCUSED: { 'stand:close': 'CLOSING' },
  CLOSING: { 'stand:closed': 'EXPLORE' },
};

export function createAppState(emit = (t, p) => bus.emit(t, p)) {
  const state = {
    mode: 'LOADING',
    focusedId: null,
    zone: 'town', // 'town' | 'hall'; set from payload.zone on 'zone:leave'
    is: (...modes) => modes.includes(state.mode),
    request(event, payload = {}) {
      const to = TRANSITIONS[state.mode]?.[event];
      if (!to) return false;
      const from = state.mode;
      state.mode = to;
      if (event === 'stand:open') state.focusedId = payload.id;
      if (event === 'zone:leave' && payload.zone) state.zone = payload.zone;
      if (to === 'EXPLORE') state.focusedId = null;
      emit('mode', { from, to, event, payload });
      return true;
    },
  };
  return state;
}

export const appState = createAppState();
