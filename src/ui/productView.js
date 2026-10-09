import gsap from 'gsap';
import { DUR, reducedMotion } from '../core/motion.js';
import { createChat } from './chat.js';
import { randySvg } from './randySvg.js';
import { avatarSvg, escapeHtml, trapTab } from './util.js';
import './hud.css';

const OPEN_S = 0.6;
const CLOSE_S = 0.36;
const CHAT_DELAY_S = 0.3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CLOSE_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false"><path d="M8 17l5 5 11-12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Right-half (desktop) / bottom-60% (mobile) product panel, revealed by a circular clip-path from the stand.
export function createProductView({ content, onRequestClose, onAction }) {
  const U = content.ui;
  const W = content.waitlist;

  const el = document.createElement('div');
  el.className = 'pv';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'pv-title');
  el.tabIndex = -1;
  el.hidden = true;
  document.body.append(el);

  let state = 'closed'; // closed | opening | open | closing
  let chat = null;
  let prevFocus = null;
  let tween = null;
  let chatTimer = null;
  let resolveOpen = null;
  let closing = null;
  let resolveClose = null;
  let originScreen = { x: 0, y: 0 };
  const clip = { r: 0, ox: 0, oy: 0, max: 0 };

  const applyClip = () => {
    el.style.clipPath = `circle(${clip.r}px at ${clip.ox}px ${clip.oy}px)`;
  };

  function measure() {
    const rect = el.getBoundingClientRect();
    clip.ox = originScreen.x - rect.left;
    clip.oy = originScreen.y - rect.top;
    const dx = Math.max(Math.abs(clip.ox), Math.abs(rect.width - clip.ox));
    const dy = Math.max(Math.abs(clip.oy), Math.abs(rect.height - clip.oy));
    clip.max = Math.hypot(dx, dy) + 2;
  }

  // ---------- content ----------
  function header({ name, tagline, accent, eyebrow, hostColor }) {
    return `
      <header class="pv__head pv__head--${accent}">
        <span class="pv__eyebrow">${hostColor ? avatarSvg(hostColor) : ''}<span>${escapeHtml(eyebrow)}</span></span>
        <h2 class="pv__title" id="pv-title">${escapeHtml(name)}</h2>
        <p class="pv__tagline">${escapeHtml(tagline)}</p>
        <button type="button" class="pv__close" aria-label="${escapeHtml(`${U.close} ${name}`)}">${CLOSE_ICON}</button>
      </header>`;
  }

  function waitlistForm() {
    return `
      <form class="wl" novalidate>
        <label class="wl__label" for="wl-email">${escapeHtml(W.label)}</label>
        <input class="wl__input" id="wl-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="${escapeHtml(W.placeholder)}" required aria-describedby="wl-error" />
        <p class="wl__error" id="wl-error" role="alert" hidden>${escapeHtml(W.invalid)}</p>
        <button type="submit" class="btn btn--primary btn--lg wl__submit">${escapeHtml(W.cta)}</button>
      </form>
      <div class="wl__mascot" aria-hidden="true">${randySvg}</div>`;
  }

  function wireWaitlist(body) {
    const form = body.querySelector('.wl');
    const input = body.querySelector('.wl__input');
    const error = body.querySelector('.wl__error');
    input.addEventListener('input', () => {
      error.hidden = true;
      input.removeAttribute('aria-invalid');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!EMAIL_RE.test(input.value.trim())) {
        error.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      // Visual only: nothing leaves the browser.
      body.innerHTML = `
        <div class="wl-done" role="status">
          <span class="wl-done__badge">${CHECK_ICON}</span>
          <p class="wl-done__text" tabindex="-1">${escapeHtml(W.thanks)}</p>
          <button type="button" class="btn btn--secondary btn--lg wl-done__back">${escapeHtml(U.back)}</button>
        </div>
        <div class="wl__mascot" aria-hidden="true">${randySvg}</div>`;
      body.querySelector('.wl-done__back').addEventListener('click', () => onRequestClose?.());
      body.querySelector('.wl-done__text').focus();
    });
  }

  function render(id) {
    const product = content.products.find((p) => p.id === id);
    let html;
    if (id === 'waitlist' || !product) {
      html = `<div class="pv__card pv--waitlist">
        ${header({ name: W.title, tagline: W.body, accent: 'yellow', eyebrow: W.eyebrow ?? W.title })}
        <div class="pv__body pv__body--waitlist">${waitlistForm()}</div>
      </div>`;
    } else {
      html = `<div class="pv__card">
        ${header({ name: product.name, tagline: product.tagline, accent: product.accent, eyebrow: `${U.hostedBy} ${product.host.name}`, hostColor: product.host.color })}
        <div class="pv__body"></div>
      </div>`;
    }
    el.innerHTML = html;
    el.querySelector('.pv__close').addEventListener('click', () => onRequestClose?.());
    const body = el.querySelector('.pv__body');
    if (id === 'waitlist' || !product) {
      wireWaitlist(body);
      chat = null;
    } else {
      chat = createChat(product.chat, body, { host: product.host, accent: product.accent, onAction: (a) => onAction?.(a) });
    }
  }

  // ---------- open / close ----------
  function open(id, origin = { x: window.innerWidth * 0.25, y: window.innerHeight * 0.5 }) {
    if (state !== 'closed') finishClosed(true);
    originScreen = { x: origin.x, y: origin.y };
    render(id);
    prevFocus = document.activeElement;
    el.style.pointerEvents = '';
    el.hidden = false;
    state = 'opening';
    el.focus({ preventScroll: true });

    return new Promise((resolve) => {
      resolveOpen = resolve;
      const done = () => {
        if (state !== 'opening') return;
        state = 'open';
        el.style.clipPath = 'none';
        resolveOpen = null;
        resolve();
      };
      if (reducedMotion()) {
        el.style.clipPath = 'none';
        tween = gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: DUR.fast, ease: 'none', onComplete: done });
        chat?.start();
        return;
      }
      measure();
      clip.r = 0;
      applyClip();
      tween = gsap.to(clip, { r: clip.max, duration: OPEN_S, ease: 'power3.out', onUpdate: applyClip, onComplete: done });
      chatTimer = gsap.delayedCall(CHAT_DELAY_S, () => chat?.start());
    });
  }

  function finishClosed(immediate = false) {
    tween?.kill();
    chatTimer?.kill();
    tween = chatTimer = null;
    chat?.destroy();
    chat = null;
    el.hidden = true;
    el.innerHTML = '';
    el.style.clipPath = '';
    el.style.opacity = '';
    el.style.pointerEvents = '';
    resolveOpen?.();
    resolveOpen = null;
    closing = null;
    resolveClose?.();
    resolveClose = null;
    state = 'closed';
    if (!immediate && prevFocus?.isConnected && !prevFocus.closest('[inert]')) prevFocus.focus({ preventScroll: true });
    if (!immediate) prevFocus = null;
  }

  function close() {
    if (state === 'closed') return Promise.resolve();
    if (state === 'closing') return closing;
    tween?.kill();
    chatTimer?.kill();
    resolveOpen?.(); // an interrupted open must not leave its caller hanging
    resolveOpen = null;
    state = 'closing';
    el.style.pointerEvents = 'none';

    closing = new Promise((resolve) => {
      resolveClose = resolve;
      const done = () => finishClosed();
      if (reducedMotion()) {
        el.style.clipPath = 'none';
        tween = gsap.to(el, { opacity: 0, duration: DUR.fast, ease: 'none', onComplete: done });
        return;
      }
      measure();
      const interrupted = el.style.clipPath !== 'none' && el.style.clipPath !== '';
      if (!interrupted) clip.r = clip.max; // fully open: clip-path was released, start from the full circle
      applyClip();
      tween = gsap.to(clip, { r: 0, duration: CLOSE_S, ease: 'power3.in', onUpdate: applyClip, onComplete: done });
    });
    return closing;
  }

  // ---------- keyboard, focus trap, click on the 3D side ----------
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onRequestClose?.();
    } else {
      trapTab(e, el);
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if ((state === 'opening' || state === 'open') && e.target?.id === 'scene') onRequestClose?.();
  });

  return { open, close };
}
