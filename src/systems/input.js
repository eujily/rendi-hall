// STUB — replaced by agent ⑤ (plan Task 5).
import { appState } from '../core/appState.js';
import { bus } from '../core/events.js';

const S = Math.SQRT1_2;
const DIRS = { // screen direction → world (isometric camera looks along −X−Z)
  ArrowUp: [-S, -S], KeyW: [-S, -S], ArrowDown: [S, S], KeyS: [S, S],
  ArrowLeft: [-S, S], KeyA: [-S, S], ArrowRight: [S, -S], KeyD: [S, -S],
};

export function createInput(dom, { pickFloor, pickStand }) {
  const held = new Set();
  let target = null, moved = false;
  const handlers = { interact: [], back: [], stand: [] };
  const fire = (k, a) => handlers[k].forEach((fn) => fn(a));
  const firstMove = () => { if (!moved) { moved = true; bus.emit('player:firstMove', {}); } };

  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, [role="dialog"]') && e.code !== 'Escape') return;
    if (DIRS[e.code]) { held.add(e.code); target = null; e.preventDefault(); }
    if (['Enter', 'Space', 'KeyE'].includes(e.code)) fire('interact');
    if (e.code === 'Escape') fire('back');
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());

  dom.addEventListener('pointerdown', (e) => {
    if (!appState.is('EXPLORE')) return;
    const r = dom.getBoundingClientRect();
    const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    const id = pickStand(ndc);
    if (id) { fire('stand', id); return; }
    const p = pickFloor(ndc);
    if (p) { target = p; firstMove(); }
  });

  return {
    getMoveVector() {
      if (!appState.is('EXPLORE')) return { x: 0, z: 0 };
      let x = 0, z = 0;
      held.forEach((c) => { x += DIRS[c][0]; z += DIRS[c][1]; });
      const len = Math.hypot(x, z);
      if (len === 0) return { x: 0, z: 0 };
      firstMove();
      target = null;
      return { x: x / len, z: z / len };
    },
    getMoveTarget: () => (appState.is('EXPLORE') ? target : null),
    setTarget(p) { target = p; },
    clearTarget() { target = null; },
    onInteract: (fn) => handlers.interact.push(fn),
    onBack: (fn) => handlers.back.push(fn),
    onStandClick: (fn) => handlers.stand.push(fn),
  };
}
