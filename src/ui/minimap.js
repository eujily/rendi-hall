// Stardew-style minimap. Isometric-ish diamond matching the game camera:
// u = (x - z)/sqrt2 (screen right), v = (x + z)/sqrt2 (screen down).
import { TOWN, TOWN_ORIGIN, TOWN_SPAWN, BUILDINGS, PLAZA, PLACES, PRODUCTS_DOOR, ROOM, toWorld } from '../core/layout.js';

const SQ = Math.SQRT2;
const C = { lavender: '#E7DEED', yellow: '#F5D360', purple: '#B77FF5', mascot: '#CBA6F4', red: '#D63532', black: '#000', white: '#fff', sage: '#A9C79A' };
const BUILDING_FILL = { products: C.purple, about: C.yellow, how: C.mascot, news: C.red, post: C.white };

/** World-space bounds of a zone. */
export function zoneBounds(zone) {
  if (zone === 'hall') return { ...ROOM };
  return { minX: TOWN.minX + TOWN_ORIGIN.x, maxX: TOWN.maxX + TOWN_ORIGIN.x, minZ: TOWN.minZ + TOWN_ORIGIN.z, maxZ: TOWN.maxZ + TOWN_ORIGIN.z };
}

/** Frame fitting the zone diamond into a w x h canvas (CSS px) with padding. */
export function makeFrame(bounds, w, h, pad = 10) {
  const W = bounds.maxX - bounds.minX, D = bounds.maxZ - bounds.minZ;
  const ext = (W + D) / SQ; // diamond width == height in map units * scale
  const scale = Math.min((w - pad * 2) / ext, (h - pad * 2) / ext);
  return { w, h, scale, cx: (bounds.minX + bounds.maxX) / 2, cz: (bounds.minZ + bounds.maxZ) / 2, bounds };
}

/** World (x,z) -> mini canvas px {u,v}. */
export function worldToMini(frame, x, z) {
  const dx = x - frame.cx, dz = z - frame.cz;
  return { u: frame.w / 2 + (frame.scale * (dx - dz)) / SQ, v: frame.h / 2 + (frame.scale * (dx + dz)) / SQ };
}

/** Mini canvas px -> world (x,z). Inverse of worldToMini (not clamped). */
export function miniToWorld(frame, u, v) {
  const a = ((u - frame.w / 2) * SQ) / frame.scale; // dx - dz
  const b = ((v - frame.h / 2) * SQ) / frame.scale; // dx + dz
  return { x: frame.cx + (a + b) / 2, z: frame.cz + (b - a) / 2 };
}

export function clampToBounds(bounds, p) {
  return { x: Math.min(bounds.maxX, Math.max(bounds.minX, p.x)), z: Math.min(bounds.maxZ, Math.max(bounds.minZ, p.z)) };
}

function poly(ctx, frame, pts) {
  ctx.beginPath();
  pts.forEach(([x, z], i) => {
    const m = worldToMini(frame, x, z);
    if (i) ctx.lineTo(m.u, m.v); else ctx.moveTo(m.u, m.v);
  });
  ctx.closePath();
}
const rectPts = (cx, cz, w, d) => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
const boundsPts = (b) => [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]];

function dot(ctx, u, v, r, fill, stroke = C.black) {
  ctx.beginPath();
  ctx.arc(u, v, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.lineWidth = 1; ctx.strokeStyle = stroke; ctx.stroke(); }
}

const COBBLE = '#D9CDB8';
const LABELS = { products: 'Products', about: 'About', how: 'How we work', news: 'News', post: 'Post' };

function drawStatic(ctx, zone, frame) {
  if (zone !== 'town') return; // the hall has no minimap
  const b = zoneBounds(zone);
  const W = (x, z) => worldToMini(frame, x + TOWN_ORIGIN.x, z + TOWN_ORIGIN.z);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  poly(ctx, frame, boundsPts(b));
  ctx.fillStyle = C.sage; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = C.black; ctx.stroke();
  // trees along the edge
  const inset = 1.2, step = 4.4;
  const tree = (x, z) => { const m = W(x, z); dot(ctx, m.u, m.v, 2.2, '#7FA56F', 'rgba(0,0,0,0.55)'); };
  for (let x = TOWN.minX + inset; x <= TOWN.maxX - inset; x += step) { tree(x, TOWN.minZ + inset); tree(x + step / 2, TOWN.maxZ - inset); }
  for (let z = TOWN.minZ + inset + step; z < TOWN.maxZ - inset; z += step) { tree(TOWN.minX + inset, z); tree(TOWN.maxX - inset, z - step / 2); }
  // paths: spawn -> plaza, plaza -> each door
  const pts = (list) => list.map(([x, z]) => W(x, z));
  const path = (list) => {
    const p = pts(list);
    ctx.beginPath(); p.forEach((m, i) => (i ? ctx.lineTo(m.u, m.v) : ctx.moveTo(m.u, m.v)));
    ctx.lineWidth = Math.max(2.5, frame.scale * 1.4); ctx.strokeStyle = COBBLE; ctx.stroke();
  };
  path([[TOWN_SPAWN.x, TOWN_SPAWN.z], [PLAZA.x, PLAZA.z]]);
  path([[PLAZA.x, PLAZA.z], [PRODUCTS_DOOR.x, PRODUCTS_DOOR.z]]);
  for (const bd of BUILDINGS) {
    if (bd.id === 'products') continue;
    path([[PLAZA.x, PLAZA.z], [bd.door.x, PLAZA.z], [bd.door.x, bd.door.z]]);
  }
  // plaza
  const pc = W(PLAZA.x, PLAZA.z);
  ctx.beginPath(); ctx.arc(pc.u, pc.v, PLAZA.r * frame.scale * 1.1, 0, Math.PI * 2);
  ctx.fillStyle = C.lavender; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = C.black; ctx.stroke();
  for (const bd of BUILDINGS) {
    const w = toWorld('town', bd);
    poly(ctx, frame, rectPts(w.x, w.z, bd.w, bd.d));
    ctx.fillStyle = BUILDING_FILL[bd.id] || C.white; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = C.black; ctx.stroke();
  }
  const dm = W(PRODUCTS_DOOR.x, PRODUCTS_DOOR.z);
  dot(ctx, dm.u, dm.v, 3, C.white);
  for (const p of PLACES) { const m = W(p.x, p.z); dot(ctx, m.u, m.v, 2, C.yellow); }
  // labels (halo for legibility)
  ctx.font = 'italic 700 9px Montserrat, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.fillStyle = C.black;
  for (const bd of BUILDINGS) {
    const m = W(bd.x, bd.z);
    ctx.strokeText(LABELS[bd.id], m.u, m.v); ctx.fillText(LABELS[bd.id], m.u, m.v);
  }
}

export function createMinimap({ onPick } = {}) {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = typeof matchMedia === 'function' ? matchMedia('(max-width: 768px)') : { matches: false };

  const root = document.createElement('aside');
  root.className = 'minimap';
  root.setAttribute('aria-label', 'Minimap');
  const chip = document.createElement('span');
  chip.className = 'minimap__chip';
  chip.textContent = 'Town';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'minimap__toggle';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-label', 'Toggle minimap');
  toggle.textContent = '−';
  const canvas = document.createElement('canvas');
  canvas.className = 'minimap__canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Minimap');
  root.append(canvas, chip, toggle);
  document.body.appendChild(root);

  const visited = new Set();
  let zone = 'town', W = 200, H = 160, dpr = 1, frame = null, staticCv = null, last = null, collapsed = false;
  const ctx = canvas.getContext('2d');

  function rebuild() {
    W = small.matches ? 132 : 200;
    H = small.matches ? 104 : 160;
    dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    frame = makeFrame(zoneBounds(zone), W, H, small.matches ? 8 : 12);
    staticCv = document.createElement('canvas');
    staticCv.width = canvas.width; staticCv.height = canvas.height;
    const sctx = staticCv.getContext('2d');
    if (sctx) { sctx.scale(dpr, dpr); drawStatic(sctx, zone, frame); }
    chip.textContent = 'Town';
    if (last) draw();
  }

  function draw() {
    if (!ctx || collapsed) return;
    const { player, extras } = last;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (staticCv) ctx.drawImage(staticCv, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (zone === 'town') {
      const t0 = performance.now() / 1000, ph0 = reduced ? 0.5 : (t0 % 1.8) / 1.8;
      const spots = [...PLACES.map((p) => ({ id: p.id, ...toWorld('town', p) })), { id: 'products', ...toWorld('town', PRODUCTS_DOOR) }];
      for (const sp of spots) {
        if (visited.has(sp.id)) continue;
        const m = worldToMini(frame, sp.x, sp.z);
        ctx.beginPath(); ctx.arc(m.u, m.v, 4 + ph0 * 5, 0, Math.PI * 2);
        ctx.globalAlpha = 0.9 * (1 - ph0); ctx.lineWidth = 1.5; ctx.strokeStyle = C.red; ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    for (const n of extras.npcs || []) { const m = worldToMini(frame, n.x, n.z); dot(ctx, m.u, m.v, 2.5, C.white); }
    const t = performance.now() / 1000;
    const bugOn = reduced || Math.floor(t * 3) % 2 === 0;
    if (bugOn) for (const g of extras.bugs || []) { const m = worldToMini(frame, g.x, g.z); dot(ctx, m.u, m.v, 3, C.red); }
    if (player) {
      const m = worldToMini(frame, player.x, player.z);
      const ph = reduced ? 0.5 : (t % 1.4) / 1.4;
      ctx.beginPath(); ctx.arc(m.u, m.v, 4 + ph * 6, 0, Math.PI * 2);
      ctx.globalAlpha = 0.6 * (1 - ph); ctx.lineWidth = 1.5; ctx.strokeStyle = C.black; ctx.stroke(); ctx.globalAlpha = 1;
      dot(ctx, m.u, m.v, 4.5, C.mascot);
    }
  }

  function setCollapsed(c) {
    collapsed = c;
    root.classList.toggle('is-collapsed', c);
    toggle.setAttribute('aria-expanded', String(!c));
    toggle.textContent = c ? '+' : '−';
    if (!c && last) draw();
  }
  const onToggle = () => setCollapsed(!collapsed);
  toggle.addEventListener('click', onToggle);

  const onDown = (e) => {
    const r = canvas.getBoundingClientRect();
    const u = ((e.clientX - r.left) / r.width) * W, v = ((e.clientY - r.top) / r.height) * H;
    const p = clampToBounds(zoneBounds(zone), miniToWorld(frame, u, v));
    e.preventDefault(); e.stopPropagation();
    if (onPick) onPick(p);
  };
  canvas.addEventListener('pointerdown', onDown);
  const onMq = () => rebuild();
  small.addEventListener?.('change', onMq);

  setCollapsed(small.matches); // start collapsed on small screens
  rebuild();

  return {
    setZone(z) {
      if (z !== 'town' && z !== 'hall') return;
      zone = z;
      root.classList.toggle('is-hidden', z === 'hall');
      root.setAttribute('aria-hidden', String(z === 'hall'));
    },
    markVisited(id) { visited.add(id); },
    update(player, extras = {}) { if (zone !== 'town') return; last = { player, extras }; draw(); },
    destroy() {
      toggle.removeEventListener('click', onToggle);
      canvas.removeEventListener('pointerdown', onDown);
      small.removeEventListener?.('change', onMq);
      root.remove();
    },
  };
}
