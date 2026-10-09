// Shared exhibit frame: an IT "app window" hung on the wall that is also a deep museum vitrine.
// Owned by the hall; stand dioramas are placed into `mount` (bottom-centre of the inner box).
// Frame local space: origin = wall inner face at floor level, front = +Z, up = +Y (see FRAME in layout.js).
//
// Detail pass: bevelled rounded bezel (clean flat white), slim black inner border, glass pane with a
// diagonal reflection, tabbed title bar + url pill, status strip with tiny icons, accent glow line,
// a lamp arm, and a museum info plaque on the wall.
// Draw calls per frame: ~12 (3 merged colour buckets + outlines + 7 painted planes + LED).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, addOutline } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';
import { FRAME } from '../core/layout.js';

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const LINING = mix(COLORS.lavender, COLORS.white, 0.3);
const LINE = mix(COLORS.lavender, COLORS.black, 0.06);
const DOT = mix(COLORS.lavender, COLORS.black, 0.12);
const INK = mix(COLORS.lavender, COLORS.black, 0.45); // muted text / placeholder tone

const box = (w, h, d, x, y, z, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  return g.translate(x, y, z);
};
const prep = (g) => {
  const out = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(out.attributes)) if (n !== 'position' && n !== 'normal') out.deleteAttribute(n);
  return out;
};

// ---------- canvas helpers ----------
function canvasTexture(w, h, draw, { nearest = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (nearest) {
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  } else {
    tex.anisotropy = 8;
  }
  const run = () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h);
    tex.needsUpdate = true;
  };
  run();
  if (!nearest) {
    document.fonts?.load?.('italic 800 64px Montserrat').then(run).catch(() => {});
    document.fonts?.load?.('700 64px Montserrat').then(run).catch(() => {});
  }
  return tex;
}

const rrect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

/** Tiny line icons, drawn in a 0..1 box scaled by `s` at (x, y) = centre. */
const ICONS = {
  wifi(ctx, x, y, s) {
    ctx.beginPath();
    for (const r of [0.5, 0.34, 0.18]) {
      ctx.moveTo(x - r * s * 0.9, y + 0.12 * s - r * s * 0.35);
      ctx.arc(x, y + 0.3 * s, r * s, Math.PI * 1.22, Math.PI * 1.78);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 0.3 * s, 0.045 * s, 0, Math.PI * 2);
    ctx.fill();
  },
  battery(ctx, x, y, s) {
    rrect(ctx, x - 0.5 * s, y - 0.22 * s, 0.95 * s, 0.44 * s, 0.08 * s);
    ctx.stroke();
    ctx.fillRect(x + 0.47 * s, y - 0.08 * s, 0.07 * s, 0.16 * s);
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 0.4 * s + i * 0.26 * s, y - 0.14 * s, 0.2 * s, 0.28 * s);
  },
  bell(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x - 0.36 * s, y + 0.28 * s);
    ctx.quadraticCurveTo(x - 0.32 * s, y + 0.1 * s, x - 0.3 * s, y - 0.08 * s);
    ctx.bezierCurveTo(x - 0.3 * s, y - 0.55 * s, x + 0.3 * s, y - 0.55 * s, x + 0.3 * s, y - 0.08 * s);
    ctx.quadraticCurveTo(x + 0.32 * s, y + 0.1 * s, x + 0.36 * s, y + 0.28 * s);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 0.42 * s, 0.09 * s, 0, Math.PI * 2);
    ctx.fill();
  },
  cloud(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x - 0.42 * s, y + 0.24 * s);
    ctx.arc(x - 0.24 * s, y + 0.04 * s, 0.2 * s, Math.PI * 0.6, Math.PI * 1.45);
    ctx.arc(x + 0.02 * s, y - 0.12 * s, 0.26 * s, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(x + 0.3 * s, y + 0.06 * s, 0.18 * s, Math.PI * 1.5, Math.PI * 0.5);
    ctx.closePath();
    ctx.stroke();
  },
  lock(ctx, x, y, s) {
    rrect(ctx, x - 0.3 * s, y - 0.06 * s, 0.6 * s, 0.46 * s, 0.07 * s);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - 0.06 * s, 0.2 * s, Math.PI, 0);
    ctx.stroke();
  },
  chevron(ctx, x, y, s, dir = 1) {
    ctx.beginPath();
    ctx.moveTo(x - 0.16 * s * dir, y - 0.3 * s);
    ctx.lineTo(x + 0.16 * s * dir, y);
    ctx.lineTo(x - 0.16 * s * dir, y + 0.3 * s);
    ctx.stroke();
  },
  reload(ctx, x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 0.3 * s, Math.PI * 0.3, Math.PI * 1.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 0.18 * s, y - 0.44 * s);
    ctx.lineTo(x + 0.34 * s, y - 0.2 * s);
    ctx.lineTo(x + 0.04 * s, y - 0.18 * s);
    ctx.closePath();
    ctx.fill();
  },
};

// 3.64 x 0.6 plane  (1456 x 240 px)
function titleTexture(label, url, accent) {
  const dotAccent = accent === COLORS.black ? COLORS.purple : accent;
  return canvasTexture(1456, 240, (ctx, w, h) => {
    ctx.fillStyle = hex(COLORS.white);
    ctx.fillRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // soft lavender wash behind the tab strip, hairline under the bar
    ctx.fillStyle = hex(mix(COLORS.lavender, COLORS.white, 0.55));
    ctx.fillRect(0, 22, w, h - 28);
    ctx.fillStyle = hex(COLORS.black);
    ctx.fillRect(0, h - 7, w, 7);
    // traffic-light dots
    [COLORS.red, COLORS.yellow, COLORS.purple].forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(62 + i * 54, 124, 16, 0, Math.PI * 2);
      ctx.fillStyle = hex(c);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = hex(COLORS.black);
      ctx.stroke();
    });
    // browser tab (rounded top corners, merges into the bar below)
    const tx = 250, tw = 560, ty = 52, th = h - 7 - ty;
    ctx.beginPath();
    ctx.moveTo(tx - 24, h - 7);
    ctx.quadraticCurveTo(tx, h - 7, tx, h - 7 - 24);
    ctx.lineTo(tx, ty + 30);
    ctx.quadraticCurveTo(tx, ty, tx + 30, ty);
    ctx.lineTo(tx + tw - 30, ty);
    ctx.quadraticCurveTo(tx + tw, ty, tx + tw, ty + 30);
    ctx.lineTo(tx + tw, h - 7 - 24);
    ctx.quadraticCurveTo(tx + tw, h - 7, tx + tw + 24, h - 7);
    ctx.fillStyle = hex(COLORS.white);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = hex(COLORS.black);
    ctx.stroke();
    ctx.fillStyle = hex(COLORS.white);
    ctx.fillRect(tx - 20, h - 11, tw + 40, 8); // open the tab into the page
    // favicon + label + close
    ctx.beginPath();
    ctx.arc(tx + 56, ty + th / 2 + 2, 20, 0, Math.PI * 2);
    ctx.fillStyle = hex(dotAccent);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = hex(COLORS.black);
    ctx.stroke();
    ctx.fillStyle = hex(COLORS.black);
    ctx.font = '700 62px Montserrat, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tx + 96, ty + th / 2 + 6, 370);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(tx + tw - 70, ty + th / 2 - 12);
    ctx.lineTo(tx + tw - 46, ty + th / 2 + 12);
    ctx.moveTo(tx + tw - 46, ty + th / 2 - 12);
    ctx.lineTo(tx + tw - 70, ty + th / 2 + 12);
    ctx.stroke();
    // new-tab plus
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(tx + tw + 70, 120);
    ctx.lineTo(tx + tw + 110, 120);
    ctx.moveTo(tx + tw + 90, 100);
    ctx.lineTo(tx + tw + 90, 140);
    ctx.stroke();
    // nav arrows + reload
    ctx.lineWidth = 7;
    ICONS.chevron(ctx, 960, 124, 60, -1);
    ICONS.chevron(ctx, 1030, 124, 60, 1);
    ICONS.reload(ctx, 1100, 124, 58);
    // url pill
    rrect(ctx, 1150, 70, 262, 108, 54);
    ctx.fillStyle = hex(COLORS.lavender);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = hex(COLORS.black);
    ctx.strokeStyle = hex(COLORS.black);
    ctx.lineWidth = 5;
    ICONS.lock(ctx, 1192, 112, 40);
    ctx.font = '700 34px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(url, 1222, 126, 172);
  });
}

// 3.64 x 0.5 plane (1456 x 200 px): label on the left, status icons on the right
function statusTexture(label, accent) {
  const pill = accent === COLORS.black ? COLORS.purple : accent;
  return canvasTexture(1456, 200, (ctx, w, h) => {
    ctx.fillStyle = hex(COLORS.white);
    ctx.fillRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    rrect(ctx, 8, 14, w - 16, h - 28, 40);
    ctx.fillStyle = hex(mix(COLORS.lavender, COLORS.white, 0.5));
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = hex(COLORS.black);
    ctx.stroke();
    // LED socket (the real blinking LED mesh sits on top of it)
    ctx.beginPath();
    ctx.arc(70, h / 2, 30, 0, Math.PI * 2);
    ctx.fillStyle = hex(COLORS.white);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = hex(COLORS.black);
    ctx.font = 'italic 800 92px Montserrat, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 130, h / 2 + 6, 640);
    // right side: LIVE pill + tiny icons + version
    rrect(ctx, 830, 58, 150, 84, 42);
    ctx.fillStyle = hex(pill);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = hex(pill === COLORS.red ? COLORS.white : COLORS.black);
    ctx.font = '800 44px Montserrat, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LIVE', 905, 102);
    ctx.fillStyle = hex(COLORS.black);
    ctx.strokeStyle = hex(COLORS.black);
    ctx.lineWidth = 6;
    ICONS.wifi(ctx, 1066, 84, 74);
    ICONS.cloud(ctx, 1150, 100, 66);
    ICONS.bell(ctx, 1228, 98, 62);
    ICONS.battery(ctx, 1318, 100, 70);
    ctx.fillStyle = hex(INK);
    ctx.font = '700 28px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('v1.0', w - 30, 168);
  });
}

// glass: transparent, diagonal reflection streaks + faint edge falloff
function glassTexture() {
  return canvasTexture(512, 384, (ctx, w, h) => {
    const streak = (x0, x1, skew, alpha) => {
      const g = ctx.createLinearGradient(x0, 0, x1 + skew, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0 + skew, 0);
      ctx.lineTo(x1 + skew, 0);
      ctx.lineTo(x1, h);
      ctx.lineTo(x0, h);
      ctx.closePath();
      ctx.fill();
    };
    streak(w * 0.5, w * 0.7, w * 0.36, 0.2);
    streak(w * 0.76, w * 0.8, w * 0.36, 0.22);
    streak(w * 0.28, w * 0.31, w * 0.36, 0.1);
    // corner sheen
    const c = ctx.createRadialGradient(w * 0.06, h * 0.06, 0, w * 0.06, h * 0.06, w * 0.45);
    c.addColorStop(0, 'rgba(255,255,255,0.16)');
    c.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, w, h);
    // edge falloff (a hint of lavender at the rim)
    const e = ctx.createLinearGradient(0, h, 0, h * 0.7);
    e.addColorStop(0, 'rgba(180,150,210,0.10)');
    e.addColorStop(1, 'rgba(180,150,210,0)');
    ctx.fillStyle = e;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  });
}

// accent line along the window sill with a soft halo (transparent)
function glowTexture(accent) {
  const glow = accent === COLORS.black ? COLORS.purple : accent;
  return canvasTexture(1024, 128, (ctx, w, h) => {
    const y = h * 0.3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = hex(glow);
    ctx.shadowColor = hex(glow);
    ctx.shadowBlur = 34;
    ctx.lineWidth = 9;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(70, y);
      ctx.lineTo(w - 70, y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = hex(accent);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(70, y);
    ctx.lineTo(w - 70, y);
    ctx.stroke();
  });
}

function backTexture() {
  return canvasTexture(288, 208, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, hex(mix(COLORS.lavender, COLORS.white, 0.25)));
    g.addColorStop(1, hex(COLORS.lavender));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(LINE);
    for (let x = 0; x < w; x += 48) ctx.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 48) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = hex(DOT);
    for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) ctx.fillRect(x - 1, y - 1, 3, 3);
  });
}

// info plaque, 0.5 x 0.72 plane (256 x 368 px)
function plaqueTexture(label, accent, index) {
  const tone = accent === COLORS.black ? COLORS.purple : accent;
  return canvasTexture(256, 368, (ctx, w, h) => {
    ctx.fillStyle = hex(COLORS.white);
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 6;
    ctx.strokeStyle = hex(COLORS.black);
    rrect(ctx, 6, 6, w - 12, h - 12, 22);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = hex(DOT);
    rrect(ctx, 16, 16, w - 32, h - 32, 14);
    ctx.stroke();
    ctx.fillStyle = hex(INK);
    ctx.font = '700 22px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`EXHIBIT ${String(index).padStart(2, '0')}`, 34, 48);
    ctx.fillStyle = hex(tone);
    rrect(ctx, 34, 70, 70, 10, 5);
    ctx.fill();
    ctx.fillStyle = hex(COLORS.black);
    ctx.font = 'italic 800 40px Montserrat, system-ui, sans-serif';
    const words = label.split(' ');
    ctx.fillText(words[0], 34, 124, 190);
    ctx.fillText(words.slice(1).join(' ') || '', 34, 170, 190);
    // two placeholder lines of "text"
    ctx.fillStyle = hex(LINE);
    for (const [y, lw] of [[226, 186], [256, 140]]) {
      rrect(ctx, 34, y, lw, 14, 7);
      ctx.fill();
    }
    ctx.fillStyle = hex(LINE);
    rrect(ctx, 34, 286, 96, 14, 7);
    ctx.fill();
    // tiny QR-ish tile
    ctx.fillStyle = hex(COLORS.black);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if ((i * 5 + j * 3 + index) % 3 !== 0) ctx.fillRect(166 + i * 12, 288 + j * 12, 10, 10);
  });
}

// ---------- geometry helpers ----------
function rrPath(p, x, y, w, h, [tl, tr, br, bl]) {
  p.moveTo(x + bl, y);
  p.lineTo(x + w - br, y);
  if (br) p.quadraticCurveTo(x + w, y, x + w, y + br);
  else p.lineTo(x + w, y);
  p.lineTo(x + w, y + h - tr);
  p.quadraticCurveTo(x + w, y + h, x + w - tr, y + h);
  p.lineTo(x + tl, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - tl);
  p.lineTo(x, y + bl);
  if (bl) p.quadraticCurveTo(x, y, x + bl, y);
  else p.lineTo(x, y);
  return p;
}

/** Bevelled rounded bezel: rounded-rect slab with the window opening cut out, front face at z = depth. */
function bezelGeometry(W, TOP, depth, hole) {
  const bt = 0.07;
  const shape = rrPath(new THREE.Shape(), -W / 2, 0, W, TOP, [0.3, 0.3, 0.05, 0.05]);
  shape.holes.push(rrPath(new THREE.Path(), hole.x, hole.y, hole.w, hole.h, [0.1, 0.1, 0.1, 0.1]));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bt * 2,
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: bt,
    bevelOffset: -bt,
    bevelSegments: 3,
    curveSegments: 8,
    steps: 1,
  });
  g.translate(0, 0, bt);
  return g;
}

/** Thin flat ring (rounded rect with rounded hole) for the inner border. */
function ringGeometry(x, y, w, h, grow, thick, z) {
  const s = rrPath(new THREE.Shape(), x - grow, y - grow, w + grow * 2, h + grow * 2, [0.1 + grow, 0.1 + grow, 0.1 + grow, 0.1 + grow]);
  s.holes.push(rrPath(new THREE.Path(), x, y, w, h, [0.1, 0.1, 0.1, 0.1]));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 8 });
  return g.translate(0, 0, z);
}

/**
 * @param {{ label: string, accent: number, url: string, index?: number }} opts
 * @returns {{ root: THREE.Group, mount: THREE.Group }}
 */
export function createExhibitFrame({ label, accent, url, index = 1 }) {
  const { outerW: W, depth: D, bottomY: YB, innerW: IW, innerH: IH } = FRAME;
  const YT = YB + IH;
  const HEAD = 0.6;
  const TOP = YT + HEAD;
  const BASE = YB - 0.25; // bottom of the window opening (lining floor fills up to YB)
  const root = new THREE.Group();
  root.name = 'exhibit-frame';

  const parts = new Map();
  const put = (color, geo) => {
    if (!parts.has(color)) parts.set(color, []);
    parts.get(color).push(geo);
  };

  // bezel: one bevelled rounded slab with the window cut out (clean flat white, thick = the vitrine walls)
  put(COLORS.white, bezelGeometry(W, TOP, D, { x: -IW / 2, y: BASE, w: IW, h: YT - BASE }));

  // lavender lining of the box (sides, ceiling, floor)
  const lz0 = 0.075, lz1 = D - 0.06;
  const lLen = lz1 - lz0, lc = (lz0 + lz1) / 2;
  put(LINING, box(0.04, IH, lLen, -(IW / 2 - 0.02), YB + IH / 2, lc));
  put(LINING, box(0.04, IH, lLen, IW / 2 - 0.02, YB + IH / 2, lc));
  put(LINING, box(IW, 0.04, lLen, 0, YT - 0.02, lc));
  put(LINING, box(IW, 0.25, lLen + 0.02, 0, BASE + 0.125, lc + 0.01));

  // slim black inner border around the opening
  put(COLORS.black, ringGeometry(-IW / 2, BASE, IW, YT - BASE, 0.07, 0.03, D - 0.005));

  // lamp: wall plate, arm + brace, shade tilted toward the floor pool
  const LAMP_Y = 4.4, LAMP_Z = 2.5;
  put(COLORS.black, box(0.3, 0.26, 0.05, 0, LAMP_Y, 0.025));
  put(COLORS.black, box(0.06, 0.06, LAMP_Z, 0, LAMP_Y + 0.04, LAMP_Z / 2));
  put(COLORS.black, box(0.04, 0.04, 1.6, 0, 4.21, 0.8, -0.3));
  const shade = new THREE.CylinderGeometry(0.1, 0.21, 0.3, 16).rotateX(-0.2).translate(0, LAMP_Y - 0.1, LAMP_Z);
  put(COLORS.white, shade);

  // cable climbing from the title bar up to the cable tray (thin: no outline)
  put(COLORS.black, box(0.05, 5.06 - TOP, 0.05, -1.4, (5.06 + TOP) / 2, 0.04));
  put(COLORS.black, box(0.16, 0.08, 0.06, -1.4, TOP + 0.35, 0.04));
  put(COLORS.black, box(0.16, 0.08, 0.06, -1.4, TOP + 0.7, 0.04));

  // museum plaque on the wall to the (viewer's) right of the frame
  const PX = W / 2 + 0.3;
  put(COLORS.white, box(0.56, 0.78, 0.04, PX, 2.0, 0.045));
  for (const [dx, dy] of [[-0.22, 0.34], [0.22, 0.34], [-0.22, -0.34], [0.22, -0.34]]) {
    put(COLORS.black, box(0.025, 0.025, 0.05, PX + dx, 2.0 + dy, 0.07));
  }

  for (const [color, geos] of parts) {
    const mesh = toonMesh(mergeGeometries(geos.map(prep), false), color, {
      outline: color === COLORS.black || color === LINING ? 0 : 0.03,
      cast: color !== LINING,
      receive: true,
    });
    mesh.name = `frame-${color.toString(16)}`;
    root.add(mesh);
  }

  // painted planes
  const plane = (w, h, tex, x, y, z, { transparent = false, order = 0, name } = {}) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent, depthWrite: !transparent }),
    );
    m.position.set(x, y, z);
    m.renderOrder = order;
    m.raycast = () => {};
    if (name) m.name = name;
    root.add(m);
    return m;
  };
  const PW = W - 0.56;
  plane(PW, HEAD, titleTexture(label, url, accent), 0, YT + HEAD / 2, D + 0.012, { name: 'frame-title' });
  plane(IW, IH + 0.25, backTexture(), 0, BASE + (IH + 0.25) / 2, 0.07, { name: 'frame-back' });
  plane(PW, 0.5, statusTexture(label, accent), 0, 0.37, D + 0.012, { name: 'frame-status' });
  plane(IW, YT - BASE, glassTexture(), 0, (YT + BASE) / 2, D - 0.02, { transparent: true, order: 3, name: 'frame-glass' });
  plane(W - 0.3, 0.5, glowTexture(accent), 0, 0.6, D + 0.02, { transparent: true, order: 2, name: 'frame-glow' });
  plane(0.5, 0.72, plaqueTexture(label, accent, index), PX, 2.0, 0.071, { name: 'frame-plaque' });

  // blinking status LED in the strip's socket (alternates accent / white)
  const ledMat = new THREE.MeshBasicMaterial({ color: accent });
  const led = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.04, 14).rotateX(Math.PI / 2), ledMat);
  led.position.set(-PW / 2 + 70 / 400, 0.37, D + 0.03);
  led.raycast = () => {};
  led.onBeforeRender = () => {
    ledMat.color.setHex(Math.floor(performance.now() / 700) % 2 ? COLORS.white : accent);
  };
  root.add(led);

  const mount = new THREE.Group();
  mount.name = 'exhibit-mount';
  mount.position.set(0, YB, D / 2 + 0.1);
  root.add(mount);

  return { root, mount };
}
