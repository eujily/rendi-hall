import gsap from 'gsap';
import { DUR } from '../core/motion.js';
import './hud.css';

// Comic speech bubbles for NPC visitors. Anchor = bottom-centre (the tail points at x, y).
export function createBubbles() {
  const layer = document.createElement('div');
  layer.className = 'bubbles';
  layer.setAttribute('aria-live', 'polite');
  document.body.append(layer);

  const items = new Map();

  function get(id) {
    let b = items.get(id);
    if (b) return b;
    const anchor = document.createElement('div');
    anchor.className = 'bubble-anchor';
    anchor.hidden = true;
    const box = document.createElement('div');
    box.className = 'bubble';
    anchor.append(box);
    layer.append(anchor);
    b = { anchor, box, showing: false, timer: 0, lastX: NaN, lastY: NaN };
    items.set(id, b);
    return b;
  }

  function hide(b) {
    clearTimeout(b.timer);
    if (!b.showing) return;
    b.showing = false;
    gsap.killTweensOf(b.box);
    gsap.to(b.box, {
      opacity: 0,
      scale: 0.95,
      duration: 0.16,
      ease: 'power1.in',
      onComplete: () => {
        if (!b.showing) b.anchor.hidden = true;
      },
    });
  }

  return {
    say(id, text, ms = 3000) {
      const b = get(id);
      clearTimeout(b.timer);
      b.box.textContent = text;
      if (!b.showing) {
        b.showing = true;
        b.anchor.hidden = false;
        b.anchor.style.visibility = 'hidden'; // revealed by the first setPosition
        gsap.killTweensOf(b.box);
        gsap.fromTo(b.box, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: DUR.fast, ease: 'power2.out' });
      }
      b.timer = setTimeout(() => hide(b), ms);
    },
    setPosition(id, x, y) {
      const b = items.get(id);
      if (!b || !b.showing) return;
      const px = Math.round(x);
      const py = Math.round(y);
      if (px !== b.lastX || py !== b.lastY) {
        b.lastX = px;
        b.lastY = py;
        b.anchor.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      }
      b.anchor.style.visibility = 'visible';
    },
    isShowing: (id) => Boolean(items.get(id)?.showing),
  };
}
