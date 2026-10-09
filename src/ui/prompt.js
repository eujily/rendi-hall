// STUB — replaced by agent ⑥ (plan Task 6).
export function createPrompt() {
  const el = document.createElement('button');
  el.className = 'prompt'; el.hidden = true;
  document.body.append(el);
  let cb = null;
  el.addEventListener('click', () => cb?.());
  return {
    show(label, onClick) { el.textContent = `${label} · Enter`; cb = onClick; el.hidden = false; },
    hide() { el.hidden = true; },
    setPosition(x, y) { el.style.left = `${x}px`; el.style.top = `${y}px`; },
  };
}
