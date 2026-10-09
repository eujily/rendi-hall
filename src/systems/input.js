// Keyboard + pointer input (docs/system-design.md §3–§4). Polled by main.js each frame.
import { appState } from '../core/appState.js';
import { bus } from '../core/events.js';

const S = Math.SQRT1_2;
// Screen direction → world. The iso camera looks along −X−Z, so screen-up = world (−1, −1)/√2.
const DIRS = {
  ArrowUp: [-S, -S], KeyW: [-S, -S],
  ArrowDown: [S, S], KeyS: [S, S],
  ArrowLeft: [-S, S], KeyA: [-S, S],
  ArrowRight: [S, -S], KeyD: [S, -S],
};
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
const INTERACT_KEYS = new Set(['Enter', 'Space', 'KeyE']);

const asElement = (t) => (t && typeof t.closest === 'function' ? t : null);
// Typing surfaces and modal content own the keyboard (Escape excepted).
const inTextOrDialog = (t) => !!asElement(t)?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]');
// Enter/Space on a focused control must activate that control, not the world.
const onControl = (t) => !!asElement(t)?.closest('button, a[href], summary, [role="button"]');

export function createInput(dom, { pickFloor, pickStand }) {
  const held = new Set();
  let target = null;
  let moved = false;
  const handlers = { interact: [], back: [], stand: [], floor: [] };
  const fire = (k, a) => handlers[k].forEach((fn) => fn(a));
  const firstMove = () => {
    if (!moved) {
      moved = true;
      bus.emit('player:firstMove', {});
    }
  };
  const explore = () => appState.is('EXPLORE');

  const toNdc = (e) => {
    const r = dom.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  };

  // ---- keyboard ----
  function onKeyDown(e) {
    const code = e.code;
    const isEsc = code === 'Escape';
    if (!isEsc && inTextOrDialog(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (DIRS[code]) {
      if (SCROLL_KEYS.has(code)) e.preventDefault();
      if (!explore()) return;
      held.add(code);
      target = null; // keys always win over a click target
      return;
    }
    if (INTERACT_KEYS.has(code)) {
      if (code !== 'KeyE' && onControl(e.target)) return; // let the focused control handle it
      if (code === 'Space') e.preventDefault(); // no page scroll
      if (!e.repeat) fire('interact');
      return;
    }
    if (isEsc && !e.repeat) fire('back');
  }
  const onKeyUp = (e) => held.delete(e.code);
  const clearHeld = () => held.clear();

  // ---- pointer ----
  function onPointerDown(e) {
    if (!explore() || (e.button !== undefined && e.button > 0)) return;
    const ndc = toNdc(e);
    const id = pickStand(ndc);
    if (id) {
      fire('stand', id);
      return;
    }
    const p = pickFloor(ndc);
    if (p) {
      target = p;
      firstMove();
      fire('floor', p);
    }
  }

  // Hover cursor: pickStand at most once per animation frame.
  let hoverEvt = null, hoverRaf = 0, hovering = false;
  const setCursor = (on) => {
    if (on !== hovering) {
      hovering = on;
      dom.style.cursor = on ? 'pointer' : '';
    }
  };
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
  const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
  function onPointerMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    hoverEvt = { clientX: e.clientX, clientY: e.clientY };
    if (hoverRaf) return;
    hoverRaf = raf(() => {
      hoverRaf = 0;
      const ev = hoverEvt;
      hoverEvt = null;
      setCursor(!!ev && explore() && !!pickStand(toNdc(ev)));
    });
  }
  const onPointerLeave = () => {
    hoverEvt = null;
    setCursor(false);
  };

  // Leaving EXPLORE drops held keys and any pending click target (nothing may walk on after a stand opens).
  const offMode = bus.on('mode', ({ to }) => {
    if (to !== 'EXPLORE') {
      held.clear();
      target = null;
      setCursor(false);
    }
  });

  dom.style.touchAction = 'none';
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearHeld);
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerleave', onPointerLeave);

  return {
    getMoveVector() {
      if (!explore() || held.size === 0) return { x: 0, z: 0 };
      let x = 0, z = 0;
      held.forEach((c) => {
        x += DIRS[c][0];
        z += DIRS[c][1];
      });
      target = null;
      const len = Math.hypot(x, z);
      if (len < 1e-9) return { x: 0, z: 0 }; // opposite keys cancel
      firstMove();
      return { x: x / len, z: z / len };
    },
    getMoveTarget() {
      if (!explore()) return null;
      if (held.size) target = null;
      return target;
    },
    setTarget(p) { target = p; },
    clearTarget() { target = null; },
    onInteract: (fn) => handlers.interact.push(fn),
    onBack: (fn) => handlers.back.push(fn),
    onStandClick: (fn) => handlers.stand.push(fn),
    onFloorClick: (fn) => handlers.floor.push(fn), // extra: lets main cancel a pending stand walk
    destroy() {
      offMode();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeld);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerleave', onPointerLeave);
      if (hoverRaf) caf(hoverRaf);
      setCursor(false);
    },
  };
}
