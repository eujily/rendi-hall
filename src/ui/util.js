// Small DOM helpers shared by the UI modules.

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((n) => !n.closest('[hidden], [inert]') && n.getClientRects().length > 0);
}

// Keeps Tab / Shift+Tab inside `root`. Returns true when the event was handled.
export function trapTab(e, root) {
  if (e.key !== 'Tab') return false;
  const items = focusables(root);
  if (!items.length) {
    e.preventDefault();
    root.focus();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root || !root.contains(active))) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

export const colorVar = (name) => `var(--${name})`;

// Mini blob avatar: three overlapping petals (like Randy's body) in the host colour.
const PETALS = [-25, 35, 95];
export function avatarSvg(color) {
  const petals = (cls) => PETALS.map((a) => `<ellipse class="${cls}" cx="16" cy="16" rx="13" ry="9" transform="rotate(${a} 16 16)"/>`).join('');
  return `<svg class="avatar" viewBox="0 0 32 32" aria-hidden="true" focusable="false" style="--c:${colorVar(color)}">
    ${petals('avatar__ink')}${petals('avatar__fill')}
    <ellipse class="avatar__eye" cx="12" cy="14" rx="3.5" ry="4"/><ellipse class="avatar__eye" cx="20" cy="14" rx="3.5" ry="4"/>
    <circle class="avatar__pupil" cx="12.5" cy="14.5" r="1.5"/><circle class="avatar__pupil" cx="20.5" cy="14.5" r="1.5"/>
    <path class="avatar__smile" d="M12 21q4 3 8 0"/>
  </svg>`;
}

export const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
