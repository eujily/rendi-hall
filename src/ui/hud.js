// STUB — replaced by agent ⑥ (plan Task 6).
export function createHud({ onSkip } = {}) {
  const el = document.createElement('div');
  el.innerHTML = `<div class="hud-logo">Rendi</div><div class="loader">Making it click…</div>`;
  document.body.append(el);
  return { el, hideLoader() { const l = el.querySelector('.loader'); l.style.opacity = 0; setTimeout(() => l.remove(), 300); } };
}
