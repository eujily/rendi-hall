import gsap from 'gsap';
import content from '../content/content.json';
import { bus } from '../core/events.js';
import { DUR } from '../core/motion.js';
import { randySvg } from './randySvg.js';
import './hud.css';

const U = content.ui;
const key = (label) => `<kbd class="keycap">${label}</kbd>`;
const BUSY = ['OPENING', 'FOCUSED', 'CLOSING'];

export function createHud({ onSkip } = {}) {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `
    <div class="hud__chrome">
      <button type="button" class="btn btn--secondary hud__skip" aria-haspopup="dialog">
        <span>${U.skip}</span>
        <svg class="hud__skip-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3 3l5 5-5 5M8 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="legend" role="group" aria-label="${U.hintKeys}">
        <span class="legend__item" aria-hidden="true">${key('↑')}${key('↓')}${key('←')}${key('→')}<span class="legend__or">${U.legend.or}</span>${key(U.legend.click)}<span class="legend__label">${U.legend.move}</span></span>
        <span class="legend__item" aria-hidden="true">${key('Enter')}<span class="legend__label">${U.legend.open}</span></span>
        <span class="legend__item" aria-hidden="true">${key('Esc')}<span class="legend__label">${U.legend.close}</span></span>
      </div>
    </div>
    <div class="hud__logo">Rendi</div>
    <div class="loader" role="status">
      <div class="loader__randy">
        <div class="loader__jump">${randySvg}</div>
        <div class="loader__ground"></div>
      </div>
      <p class="loader__text">${U.loading}</p>
    </div>`;
  document.body.prepend(el); // Skip the walk comes first in the tab order.

  const chrome = el.querySelector('.hud__chrome');
  const skip = el.querySelector('.hud__skip');
  const legend = el.querySelector('.legend');
  const loader = el.querySelector('.loader');
  let loading = true;
  let busy = false;

  const sync = () => {
    chrome.inert = loading || busy;
    chrome.classList.toggle('is-busy', busy);
  };
  sync();

  skip.addEventListener('click', () => onSkip?.());

  bus.on('player:firstMove', () => legend.classList.add('is-gone'));
  bus.on('mode', ({ to }) => {
    busy = BUSY.includes(to);
    sync();
  });

  return {
    el,
    hideLoader() {
      if (!loader.isConnected) return;
      loading = false;
      sync();
      gsap.to(loader, { opacity: 0, duration: DUR.base, ease: 'power1.out', onComplete: () => loader.remove() });
    },
  };
}
