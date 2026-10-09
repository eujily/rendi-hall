import gsap from 'gsap';
import content from '../content/content.json';
import { DUR, reducedMotion } from '../core/motion.js';
import { escapeHtml, trapTab } from './util.js';
import './hud.css';

// "Skip the walk": small dialog that lists every stand. Arrow keys move, Enter picks, Esc closes.
export function createSkipList(products, onPick) {
  const U = content.ui;
  const root = document.createElement('div');
  root.className = 'skip';
  root.hidden = true;
  root.innerHTML = `
    <div class="skip__card" role="dialog" aria-modal="true" aria-labelledby="skip-title">
      <header class="skip__head">
        <h2 class="skip__title" id="skip-title">${escapeHtml(U.skip)}</h2>
        <p class="skip__sub">${escapeHtml(U.skipTitle)}</p>
      </header>
      <ul class="skip__list">
        ${products
          .map(
            (p, i) => `<li><button type="button" class="skip__item" data-id="${escapeHtml(p.id)}">
              <span class="skip__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
              <span class="skip__text"><span class="skip__name">${escapeHtml(p.name)}</span><span class="skip__tag">${escapeHtml(p.tagline ?? '')}</span></span>
              <span class="skip__go" aria-hidden="true">→</span>
            </button></li>`,
          )
          .join('')}
      </ul>
    </div>`;
  document.body.append(root);

  const card = root.querySelector('.skip__card');
  const items = [...root.querySelectorAll('.skip__item')];
  let isOpen = false;
  let prevFocus = null;

  const move = (from, step) => items[(items.indexOf(from) + step + items.length) % items.length]?.focus();

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(document.activeElement, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(document.activeElement, -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items.at(-1).focus();
    } else {
      trapTab(e, card);
    }
  });

  root.addEventListener('click', (e) => {
    if (e.target === root) return close(); // backdrop
    const item = e.target.closest('.skip__item');
    if (item) onPick?.(item.dataset.id);
  });

  function open() {
    if (isOpen) return;
    isOpen = true;
    prevFocus = document.activeElement;
    root.hidden = false;
    gsap.killTweensOf([root, card]);
    gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: DUR.fast, ease: 'power1.out' });
    if (!reducedMotion()) gsap.fromTo(card, { scale: 0.94, y: 8 }, { scale: 1, y: 0, duration: DUR.fast, ease: 'power3.out' });
    items[0].focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    gsap.killTweensOf([root, card]);
    gsap.to(root, {
      opacity: 0,
      duration: 0.12,
      ease: 'power1.in',
      onComplete: () => {
        if (!isOpen) root.hidden = true;
      },
    });
    if (prevFocus?.isConnected && !prevFocus.closest('[inert]')) prevFocus.focus();
    prevFocus = null;
  }

  return { open, close };
}
