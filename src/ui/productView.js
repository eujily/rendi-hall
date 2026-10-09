// STUB — replaced by agent ⑥ (plan Task 6).
export function createProductView({ content, onRequestClose, onAction }) {
  const el = document.createElement('div');
  el.className = 'panel'; el.hidden = true;
  document.body.append(el);
  return {
    open(id) {
      const p = content.products.find((x) => x.id === id) ?? { name: 'Waitlist', tagline: '' };
      el.innerHTML = `<h1>${p.name}</h1><p>${p.tagline}</p><button>Close</button>`;
      el.querySelector('button').onclick = onRequestClose;
      el.hidden = false;
      return Promise.resolve();
    },
    close() { el.hidden = true; return Promise.resolve(); },
  };
}
