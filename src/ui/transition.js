import gsap from 'gsap';
import { reducedMotion } from '../core/motion.js';
import { randySvg } from './randySvg.js';
import './hud.css';

// Full-screen zone-change overlay: lavender circle wipe with a bouncing Randy and a caption.
// cover() grows the circle until the screen is hidden; reveal() shrinks it away again.
export function createTransition() {
  const root = document.createElement('div');
  root.className = 'xfade';
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `<div class="xfade__inner"><div class="xfade__randy">${randySvg}</div><p class="xfade__caption"></p></div>`;
  document.body.append(root);
  const caption = root.querySelector('.xfade__caption');
  const inner = root.querySelector('.xfade__inner');
  const circle = (r) => `circle(${r}% at 50% 50%)`;
  let covered = false;
  let tween = null;

  function run(toCovered) {
    tween?.kill();
    return new Promise((resolve) => {
      const done = () => {
        covered = toCovered;
        tween = null;
        if (!toCovered) root.hidden = true;
        resolve();
      };
      if (toCovered) root.hidden = false;
      if (reducedMotion()) {
        gsap.set(root, { clipPath: circle(150), opacity: toCovered ? 1 : 0 });
        gsap.set(inner, { opacity: 1 });
        return done();
      }
      const from = toCovered ? { clipPath: circle(0), opacity: 1 } : { clipPath: circle(150), opacity: 1 };
      if (!covered || !toCovered) gsap.set(root, from);
      tween = gsap.to(root, {
        clipPath: circle(toCovered ? 150 : 0),
        duration: toCovered ? 0.55 : 0.6,
        ease: toCovered ? 'power2.in' : 'power2.out',
        onComplete: done,
      });
    });
  }

  return {
    cover: () => run(true),
    reveal: () => (covered || !root.hidden ? run(false) : Promise.resolve()),
    setCaption(text) {
      caption.textContent = text ?? '';
    },
  };
}
