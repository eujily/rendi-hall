import content from '../content/content.json';
import { reducedMotion } from '../core/motion.js';
import { createChatEngine } from './chatEngine.js';
import { avatarSvg, escapeHtml } from './util.js';
import './hud.css';

const U = content.ui;
const TYPING_MIN = 400;
const TYPING_SPAN = 300; // typing indicator lasts 400-700 ms
const ECHO_BEFORE_ACTION = 420; // let the user see their own reply before the panel hands over

// Renders a scripted chat into `el`. Logic lives in chatEngine.js (pure).
export function createChat(script, el, { host = { name: 'Rendi', color: 'purple' }, accent, onAction } = {}) {
  const engine = createChatEngine(script);
  el.classList.add('chat');
  if (accent) el.dataset.accent = accent;
  el.innerHTML = `
    <div class="chat__log" role="log" aria-live="polite" aria-relevant="additions" aria-label="${escapeHtml(`${U.chatWith} ${host.name}`)}" tabindex="0"></div>
    <div class="chat__replies" role="group" aria-label="${escapeHtml(U.replies)}"></div>`;
  const log = el.querySelector('.chat__log');
  const repliesEl = el.querySelector('.chat__replies');

  let dead = false;
  let started = false;
  let lastFrom = null; // 'host' | 'randy' | null — groups consecutive host messages
  let replies = [];
  const timers = new Set();

  const sleep = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      timers.add(t);
    });

  const scroll = () => log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' });

  function hostRow(inner, first) {
    const row = document.createElement('div');
    row.className = 'msg msg--host';
    row.innerHTML = `${first ? avatarSvg(host.color) : '<span class="msg__spacer"></span>'}<div class="msg__col">${first ? `<span class="msg__name">${escapeHtml(host.name)}</span>` : ''}${inner}</div>`;
    return row;
  }

  function addTyping() {
    const row = hostRow(`<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>`, lastFrom !== 'host');
    row.classList.add('msg--typing');
    row.setAttribute('aria-hidden', 'true');
    log.append(row);
    scroll();
    return row;
  }

  function addMessage(from, text) {
    let row;
    if (from === 'host') {
      row = hostRow('<p class="msg__bubble"></p>', lastFrom !== 'host');
    } else {
      row = document.createElement('div');
      row.className = 'msg msg--randy';
      row.innerHTML = '<p class="msg__bubble"></p>';
    }
    row.querySelector('.msg__bubble').textContent = text;
    log.append(row);
    lastFrom = from;
    scroll();
  }

  async function showMessage({ from, text }) {
    if (from === 'host') {
      const typing = addTyping();
      await sleep(TYPING_MIN + Math.random() * TYPING_SPAN);
      typing.remove();
      if (dead) return;
    }
    addMessage(from, text);
    await sleep(from === 'host' ? 160 : 0);
  }

  function showReplies(list) {
    replies = list;
    repliesEl.replaceChildren(
      ...list.map((r, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn chat__reply ${r.action === 'waitlist' ? 'btn--primary' : 'btn--secondary'}`;
        b.style.setProperty('--i', i);
        b.textContent = r.label;
        b.addEventListener('click', () => pick(i));
        return b;
      }),
    );
    // Keep keyboard users in the flow: if focus was lost (clicked reply vanished) or still rests on the dialog, hand it to the first reply.
    const active = document.activeElement;
    const dialog = el.closest('[role="dialog"]');
    if (active === document.body || (dialog && active === dialog)) repliesEl.firstElementChild?.focus();
  }

  async function play(events) {
    for (const ev of events) {
      if (dead) return;
      if (ev.type === 'msg') await showMessage(ev);
      else if (ev.type === 'replies') showReplies(ev.replies);
      else if (ev.type === 'action') {
        await sleep(ECHO_BEFORE_ACTION);
        if (!dead) onAction?.(ev.action);
      }
    }
  }

  function pick(i) {
    const reply = replies[i];
    if (!reply || dead) return;
    replies = [];
    repliesEl.replaceChildren();
    const events = engine.choose(i);
    // An action reply has no Randy echo in the engine output; show it anyway so the click feels heard.
    if (events[0]?.type === 'action') addMessage('randy', reply.label);
    play(events);
  }

  return {
    start() {
      if (started || dead) return;
      started = true;
      play(engine.start());
    },
    destroy() {
      dead = true;
      timers.forEach(clearTimeout);
      timers.clear();
      el.replaceChildren();
      el.classList.remove('chat');
      delete el.dataset.accent;
    },
  };
}
