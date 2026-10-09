import gsap from 'gsap';
import { DUR } from '../core/motion.js';
import './hud.css';

// Pill chip above a stand: "Rendi Pay [Enter]". Positioned by transform only.
export function createPrompt() {
  const root = document.createElement('div');
  root.className = 'prompt';
  root.hidden = true;
  root.innerHTML = `<div class="prompt__pop"><button type="button" class="btn btn--secondary prompt__chip" aria-keyshortcuts="Enter"><span class="prompt__name"></span><kbd class="keycap">Enter</kbd></button></div>`;
  document.body.append(root);

  const pop = root.querySelector('.prompt__pop'); // gsap animates this wrapper so the button keeps its CSS press states
  const chip = root.querySelector('.prompt__chip');
  const name = root.querySelector('.prompt__name');
  let onClick = null;
  let visible = false;
  let positioned = false; // wait for the first setPosition so the chip never flashes at a stale spot
  let entered = false;
  let fallback = 0;
  let lastX = NaN;
  let lastY = NaN;

  chip.addEventListener('click', () => onClick?.());

  function enter() {
    if (entered || !visible) return;
    entered = true;
    clearTimeout(fallback);
    gsap.killTweensOf(pop);
    gsap.fromTo(pop, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: DUR.fast, ease: 'power2.out' });
  }

  return {
    show(label, cb) {
      onClick = cb;
      name.textContent = label;
      chip.setAttribute('aria-label', `Open ${label}`);
      if (visible) return;
      visible = true;
      entered = false;
      root.hidden = false;
      gsap.killTweensOf(pop);
      gsap.set(pop, { opacity: 0, scale: 0.9 });
      if (positioned) enter();
      else fallback = setTimeout(enter, 120);
    },
    hide() {
      if (!visible) return;
      visible = false;
      positioned = false;
      clearTimeout(fallback);
      gsap.killTweensOf(pop);
      gsap.to(pop, {
        opacity: 0,
        scale: 0.95,
        duration: 0.12,
        ease: 'power1.in',
        onComplete: () => {
          if (!visible) root.hidden = true;
        },
      });
    },
    setPosition(x, y) {
      positioned = true;
      const px = Math.round(x);
      const py = Math.round(y);
      if (px !== lastX || py !== lastY) {
        lastX = px;
        lastY = py;
        root.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      }
      if (visible) enter();
    },
  };
}
