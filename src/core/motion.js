export const DUR = { fast: 0.2, base: 0.3, focus: 0.9, close: 0.6 };

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let reduced = mq?.matches ?? false;
mq?.addEventListener('change', (e) => { reduced = e.matches; });

export const reducedMotion = () => reduced;
