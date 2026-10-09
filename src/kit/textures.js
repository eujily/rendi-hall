import * as THREE from 'three';
import { COLORS, mix } from '../core/tokens.js';

// Procedural pixel-art texture kit. Hand-painted-looking, deterministic, tiny (32/64 px), crisp.
// Everything is painted into a plain RGB buffer first (`paintKind`, pure - testable in node),
// then wrapped in a CanvasTexture (Nearest filter, RepeatWrapping, sRGB) once per (kind, base, scale).

export const KINDS = [
  'roofShingles', 'roofTiles',
  'woodPlanks', 'woodVertical', 'logs',
  'brick', 'stoneWall', 'foundation',
  'grass', 'grassDark', 'dirt', 'cobble', 'sand',
  'water',
  'floorHerringbone', 'carpet', 'wallpaper', 'metal',
];

const CLAY = mix(mix(COLORS.red, COLORS.yellow, 0.3), COLORS.lavender, 0.1);
const SOIL = mix(mix(COLORS.yellow, COLORS.red, 0.35), COLORS.black, 0.5);
const STONE = mix(COLORS.lavender, COLORS.black, 0.3);

/** Default base colour per kind, so `texture('brick')` already looks right. */
export const DEFAULT_BASE = {
  roofShingles: COLORS.purple,
  roofTiles: CLAY,
  woodPlanks: COLORS.wood,
  woodVertical: COLORS.wood,
  logs: mix(COLORS.wood, SOIL, 0.45),
  brick: mix(COLORS.red, COLORS.lavender, 0.12),
  stoneWall: mix(COLORS.lavender, COLORS.black, 0.2),
  foundation: mix(COLORS.lavender, COLORS.black, 0.5),
  grass: COLORS.sage,
  grassDark: mix(COLORS.sage, COLORS.black, 0.22),
  dirt: SOIL,
  cobble: mix(COLORS.lavender, COLORS.black, 0.14),
  sand: mix(COLORS.yellow, COLORS.white, 0.5),
  water: mix(COLORS.purple, COLORS.lavender, 0.45),
  floorHerringbone: mix(COLORS.lavender, COLORS.white, 0.1),
  carpet: COLORS.red,
  wallpaper: COLORS.wall,
  metal: mix(COLORS.lavender, COLORS.black, 0.45),
};

// ---------------------------------------------------------------- pixel tools

const hash = (a, b = 0, s = 0) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const strHash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};
const mod = (n, m) => ((n % m) + m) % m;

class Pix {
  constructor(w, h, fill) {
    this.w = w; this.h = h;
    this.d = new Uint32Array(w * h).fill(fill);
  }
  set(x, y, c) { this.d[mod(y, this.h) * this.w + mod(x, this.w)] = c; }
  get(x, y) { return this.d[mod(y, this.h) * this.w + mod(x, this.w)]; }
  each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, fn(x, y)); }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  rgba() {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.d.length; i++) {
      const c = this.d[i];
      out[i * 4] = (c >> 16) & 255; out[i * 4 + 1] = (c >> 8) & 255; out[i * 4 + 2] = c & 255; out[i * 4 + 3] = 255;
    }
    return out;
  }
}

/** Tone ramp from one base colour: d2 darkest ... l2 lightest. */
const ramp = (b) => ({
  d2: mix(b, COLORS.black, 0.42),
  d: mix(b, COLORS.black, 0.2),
  m: b,
  l: mix(b, COLORS.white, 0.2),
  l2: mix(b, COLORS.white, 0.42),
});

/** Jittered-grid Voronoi on a torus. Returns per-pixel cell id + whether the pixel is a border (mortar). */
function voronoi(w, h, n, seed, jitter, mortar) {
  const sx = w / n, sy = h / n;
  const pts = [];
  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      const wi = mod(i, n), wj = mod(j, n);
      pts.push({
        x: (i + 0.5 + (hash(wi, wj, seed) - 0.5) * jitter) * sx,
        y: (j + 0.5 + (hash(wi, wj, seed + 7) - 0.5) * jitter) * sy,
        id: wj * n + wi,
      });
    }
  }
  const id = new Int32Array(w * h);
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (const p of pts) {
        const d = Math.hypot(p.x - x - 0.5, p.y - y - 0.5);
        if (d < d1) { d2 = d1; d1 = d; best = p.id; } else if (d < d2) d2 = d;
      }
      id[y * w + x] = best;
      edge[y * w + x] = d2 - d1 < mortar ? 1 : 0;
    }
  }
  return { id, edge };
}

/** Shade a Voronoi stone layout: mortar colour, stone tones by cell, light top edge / dark bottom edge. */
function paintStones(P, vor, tones, mortarC, lightC, darkC) {
  const { w, h } = P;
  const e = (x, y) => vor.edge[mod(y, h) * w + mod(x, w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (e(x, y)) { P.set(x, y, mortarC); continue; }
      const id = vor.id[y * w + x];
      let c = tones[Math.floor(hash(id, 3, 11) * tones.length)];
      if (e(x, y - 1)) c = lightC;
      else if (e(x, y + 1)) c = darkC;
      P.set(x, y, c);
    }
  }
}

// ---------------------------------------------------------------- painters

const PAINT = {
  roofShingles(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    const edge = [5, 6, 7, 8, 8, 7, 6, 5];
    for (let y = 0; y < 32; y++) {
      const row = y >> 3, ry = y & 7, off = (row & 1) * 4;
      for (let x = 0; x < 32; x++) {
        const gx = x - off, xl = mod(gx, 8), col = mod(Math.floor(gx / 8), 4);
        const tone = hash(col, row, 3) < 0.35 ? t.l : t.m;
        let c = tone;
        if (ry >= edge[xl]) c = t.d2;
        else if (ry === edge[xl] - 1) c = t.d;
        else if (xl === 0) c = t.d;
        else if (ry === 0) c = t.l2;
        else if (ry === 1 && tone === t.m) c = t.l;
        P.set(x, y, c);
      }
    }
    return P;
  },

  roofTiles(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    for (let y = 0; y < 32; y++) {
      const row = y >> 3, ry = y & 7, off = (row & 1) * 4;
      for (let x = 0; x < 32; x++) {
        const gx = x - off, xl = mod(gx, 8), col = mod(Math.floor(gx / 8), 4);
        const tone = hash(col, row, 5) < 0.3 ? t.d : t.m;
        let c = tone;
        if (xl === 7) c = t.d2;
        else if (xl === 1 || xl === 2) c = tone === t.m ? t.l : t.m;
        else if (xl === 6) c = t.d;
        if (ry === 7) c = t.d2;
        else if (ry === 6 && xl !== 7) c = t.d;
        else if (ry === 0 && xl !== 7) c = t.l;
        P.set(x, y, c);
      }
    }
    return P;
  },

  woodPlanks(b, vertical = false) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    for (let row = 0; row < 4; row++) {
      const j1 = Math.floor(hash(row, 1, 9) * 32), j2 = mod(j1 + 14 + Math.floor(hash(row, 2, 9) * 6), 32);
      const seg = (x) => (mod(x - j1, 32) < mod(j2 - j1, 32) ? 0 : 1);
      const tone = (x) => (hash(row, seg(x), 4) < 0.5 ? t.m : mix(t.m, t.d, 0.3));
      for (let x = 0; x < 32; x++) {
        const base = tone(x);
        for (let r = 0; r < 8; r++) {
          let c = base;
          if (r === 0) c = t.l;
          else if (r === 7) c = t.d;
          P.set(x, row * 8 + r, c);
        }
        if (x === j1 || x === j2) for (let r = 0; r < 8; r++) P.set(x, row * 8 + r, t.d2);
      }
      // grain dashes
      for (let k = 0; k < 3; k++) {
        const gx = Math.floor(hash(row, k, 21) * 32), gy = 2 + Math.floor(hash(row, k, 22) * 4), len = 3 + Math.floor(hash(row, k, 23) * 5);
        for (let i = 0; i < len; i++) {
          if (mod(gx + i - j1, 32) < 2 || mod(gx + i - j2, 32) < 2) continue;
          P.set(gx + i, row * 8 + gy, t.d);
        }
      }
      // nails beside joints
      for (const j of [j1, j2]) {
        P.set(j + 2, row * 8 + 3, t.d2);
        P.set(j - 2, row * 8 + 3, t.d2);
      }
    }
    return P;
  },

  woodVertical(b) {
    const H = PAINT.woodPlanks(b), P = new Pix(32, 32, 0);
    P.each((x, y) => H.get(y, x));
    return P;
  },

  logs(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    const prof = [t.d2, t.l, t.l, t.m, t.m, t.d, t.d, t.d2];
    for (let row = 0; row < 4; row++) {
      const j = Math.floor(hash(row, 5, 31) * 32);
      for (let x = 0; x < 32; x++) {
        for (let r = 0; r < 8; r++) P.set(x, row * 8 + r, prof[r]);
      }
      // bark dashes
      for (let k = 0; k < 4; k++) {
        const gx = Math.floor(hash(row, k, 41) * 32), gy = 3 + Math.floor(hash(row, k, 42) * 2), len = 2 + Math.floor(hash(row, k, 43) * 4);
        for (let i = 0; i < len; i++) P.set(gx + i, row * 8 + gy, t.d);
      }
      // cut end ring
      for (let r = 1; r < 7; r++) {
        P.set(j, row * 8 + r, t.d2);
        P.set(j + 1, row * 8 + r, r === 1 || r === 6 ? t.d : t.l2);
        P.set(j + 2, row * 8 + r, r === 1 || r === 6 ? t.d : t.l2);
      }
    }
    return P;
  },

  brick(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    const mortar = mix(COLORS.lavender, COLORS.black, 0.12);
    for (let y = 0; y < 32; y++) {
      const row = y >> 2, ry = y & 3, off = (row & 1) * 4;
      for (let x = 0; x < 32; x++) {
        const gx = x - off, xl = mod(gx, 8), col = mod(Math.floor(gx / 8), 4);
        const h0 = hash(col, row, 13);
        const tone = h0 < 0.25 ? t.d : h0 < 0.65 ? t.m : t.l;
        let c = tone;
        if (ry === 3 || xl === 7) c = mortar;
        else if (ry === 0) c = tone === t.l ? t.l2 : t.l;
        else if (ry === 2) c = tone === t.d ? t.d2 : t.d;
        P.set(x, y, c);
      }
    }
    return P;
  },

  stoneWall(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    paintStones(P, voronoi(32, 32, 3, 17, 0.8, 1.2), [t.m, t.m, t.l, t.d], t.d, t.l2, t.d);
    return P;
  },

  foundation(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    for (let row = 0; row < 4; row++) {
      const w1 = 9 + Math.floor(hash(row, 1, 51) * 6), j = Math.floor(hash(row, 2, 51) * 32);
      for (let x = 0; x < 32; x++) {
        const seg = mod(x - j, 32) < w1 ? 0 : 1;
        const tone = hash(row, seg, 52) < 0.4 ? t.d : t.m;
        for (let r = 0; r < 8; r++) {
          let c = tone;
          if (r === 0) c = t.l;
          else if (r === 7) c = t.d2;
          else if (r === 6) c = t.d;
          P.set(x, row * 8 + r, c);
        }
        if (x === j || x === mod(j + w1, 32)) for (let r = 0; r < 8; r++) P.set(x, row * 8 + r, t.d2);
      }
      for (let k = 0; k < 2; k++) P.set(Math.floor(hash(row, k, 53) * 32), row * 8 + 3 + k, t.l);
    }
    return P;
  },

  grass(b, extra = true) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    const dm = mix(b, COLORS.black, 0.08);
    P.each((x, y) => {
      const r = hash(x, y, 61);
      return r < 0.1 ? dm : r > 0.95 ? t.l : t.m;
    });
    for (let k = 0; k < 7; k++) {
      const x = Math.floor(hash(k, 1, 62) * 32), y = 3 + Math.floor(hash(k, 2, 62) * 28);
      P.set(x, y, t.d); P.set(x, y - 1, t.d);
      P.set(x - 1, y - 2, t.d); P.set(x + 1, y - 2, t.d);
      P.set(x + 1, y - 1, t.l);
    }
    if (extra) {
      const petals = [COLORS.white, COLORS.yellow, COLORS.purple];
      for (let k = 0; k < 3; k++) {
        const x = 3 + Math.floor(hash(k, 1, 63) * 26), y = 3 + Math.floor(hash(k, 2, 63) * 26);
        const p = petals[k % 3];
        P.set(x - 1, y, p); P.set(x + 1, y, p); P.set(x, y - 1, p); P.set(x, y + 1, p);
        P.set(x, y, k === 1 ? COLORS.white : COLORS.yellow);
      }
    }
    return P;
  },

  grassDark(b) { return PAINT.grass(b, false); },

  dirt(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    P.each((x, y) => {
      const r = hash(x, y, 71);
      return r < 0.12 ? t.d : r > 0.93 ? t.l : t.m;
    });
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(hash(k, 1, 72) * 32), y = Math.floor(hash(k, 2, 72) * 32);
      P.set(x, y, t.l2); P.set(x + 1, y, t.l); P.set(x, y + 1, t.d); P.set(x + 1, y + 1, t.d2);
    }
    for (let k = 0; k < 4; k++) {
      const x = Math.floor(hash(k, 3, 72) * 32), y = Math.floor(hash(k, 4, 72) * 32);
      for (let i = 0; i < 4; i++) P.set(x + i, y, t.d);
    }
    return P;
  },

  cobble(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    paintStones(P, voronoi(32, 32, 3, 29, 0.55, 1.7), [t.m, t.l, t.m], t.d, t.l2, t.d);
    return P;
  },

  sand(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    P.each((x, y) => {
      const r = hash(x, y, 81);
      return r < 0.035 ? t.d : r > 0.97 ? t.l2 : t.m;
    });
    for (let k = 0; k < 5; k++) {
      const x = Math.floor(hash(k, 1, 82) * 32), y = Math.floor(hash(k, 2, 82) * 32), len = 4 + Math.floor(hash(k, 3, 82) * 4);
      for (let i = 0; i < len; i++) { P.set(x + i, y, t.l); P.set(x + i + 1, y + 1, t.d); }
    }
    return P;
  },

  water(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    for (let y = 0; y < 32; y += 8) {
      for (let x = 0; x < 32; x++) if (hash(x >> 2, y, 91) < 0.35) P.set(x, y + 4, t.l);
    }
    for (let k = 0; k < 7; k++) {
      const x = Math.floor(hash(k, 1, 92) * 32), y = Math.floor(hash(k, 2, 92) * 32), len = 3 + Math.floor(hash(k, 3, 92) * 3);
      for (let i = 0; i < len; i++) P.set(x + i, y, t.l2);
      for (let i = 1; i < len - 1; i++) P.set(x + i - 2, y + 1, t.d);
    }
    return P;
  },

  floorHerringbone(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    const seam = mix(b, COLORS.black, 0.24);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const k = x & 15, yy = y + (k < 8 ? k : 15 - k), s = Math.floor(yy / 4), sy = yy & 3, run = x >> 3;
        const tone = hash(mod(s, 8), run, 101) < 0.5 ? t.m : mix(b, COLORS.black, 0.07);
        let c = tone;
        if (sy === 3) c = seam;
        else if (sy === 0) c = t.l;
        P.set(x, y, c);
      }
    }
    return P;
  },

  carpet(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = Math.abs(mod(x, 16) - 8), dy = Math.abs(mod(y, 16) - 8), d = dx + dy;
        let c = t.m;
        if (d <= 1) c = COLORS.yellow;
        else if (d === 4) c = t.l;
        else if (d === 8) c = t.d;
        else if (d === 12 || d === 16) c = t.d;
        else if ((x + y) % 2 === 0 && d > 4 && d < 8) c = t.d;
        P.set(x, y, c);
      }
    }
    return P;
  },

  wallpaper(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    const stripe = mix(b, COLORS.purple, 0.12), edge = mix(b, COLORS.black, 0.05);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const xl = x & 7;
        let c = xl < 4 ? t.m : stripe;
        if (xl === 0) c = edge;
        if (xl === 5 && (y & 7) === 3) c = t.l;
        if (xl === 5 && (y & 7) === 4) c = t.l;
        P.set(x, y, c);
      }
    }
    return P;
  },

  metal(b) {
    const t = ramp(b), P = new Pix(32, 32, t.m);
    for (let p = 0; p < 2; p++) {
      const y0 = p * 16;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 32; x++) {
          let c = t.m;
          if (y === 0) c = t.d2;
          else if (y === 1) c = t.l2;
          else if (y === 15) c = t.d;
          else if (x === 0) c = t.d2;
          else if (x === 1) c = t.l;
          P.set(x, y0 + y, c);
        }
      }
      // screws
      for (const [sx, sy] of [[3, 3], [28, 3], [3, 12], [28, 12]]) { P.set(sx, y0 + sy, t.d2); P.set(sx + 1, y0 + sy, t.l); }
      if (p === 0) {
        // vent slits
        for (let k = 0; k < 4; k++) {
          for (let x = 8; x < 24; x++) { P.set(x, y0 + 4 + k * 2, t.d2); P.set(x, y0 + 5 + k * 2, k === 3 ? t.m : t.l); }
        }
      } else {
        P.rect(7, y0 + 5, 18, 7, t.d);
        P.rect(8, y0 + 6, 16, 5, t.m);
        P.set(10, y0 + 8, COLORS.yellow); P.set(13, y0 + 8, COLORS.red); P.set(16, y0 + 8, COLORS.sage);
        for (let x = 19; x < 23; x++) P.set(x, y0 + 8, t.d);
      }
    }
    return P;
  },
};

/**
 * Paint a tile to a raw buffer. Pure and deterministic: no DOM, no THREE.
 * @returns {{ w:number, h:number, data:Uint8ClampedArray, px:Uint32Array }}
 */
export function paintKind(kind, base = DEFAULT_BASE[kind]) {
  const fn = PAINT[kind];
  if (!fn) throw new Error(`textures: unknown kind "${kind}"`);
  const P = fn(base);
  return { w: P.w, h: P.h, data: P.rgba(), px: P.d };
}

// ---------------------------------------------------------------- THREE textures

const texCache = new Map();

function build(kind, base, scale) {
  const { w, h, data } = paintKind(kind, base);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.repeat.set(scale, scale);
  tex.name = `tex:${kind}`;
  return tex;
}

/**
 * Cached CanvasTexture for a kind. `base` (0xRRGGBB) recolours it, `scale` multiplies the tile frequency
 * (texture.repeat). The returned texture is shared: clone() it before changing offset/repeat.
 */
export function texture(kind, { base = DEFAULT_BASE[kind], scale = 1 } = {}) {
  const key = `${kind}|${base}|${scale}`;
  if (!texCache.has(key)) texCache.set(key, build(kind, base, scale));
  return texCache.get(key);
}

// Identical to src/kit/toon.js: shade step 0.35 -> lit face 1.0, shaded face 0.35.
const SHADE_STEP = 0.35;
const gradientMap = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([Math.round(SHADE_STEP * 255), 255]), 2, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

const matCache = new Map();

/**
 * Textured version of toonMaterial: MeshToonMaterial, white colour, `map` carries the colour.
 * `repeat` is the extra tiling when geometry UVs are 0..1 per face; with boxUV() keep the default [1,1].
 */
export function texturedToon(kind, baseColor = DEFAULT_BASE[kind], { repeat = [1, 1] } = {}) {
  const key = `${kind}|${baseColor}|${repeat[0]}|${repeat[1]}`;
  if (!matCache.has(key)) {
    let map = texture(kind, { base: baseColor });
    if (repeat[0] !== 1 || repeat[1] !== 1) {
      map = map.clone();
      map.needsUpdate = true;
      map.repeat.set(repeat[0], repeat[1]);
    }
    matCache.set(key, new THREE.MeshToonMaterial({ color: 0xffffff, map, gradientMap }));
  }
  return matCache.get(key);
}

/**
 * Animated water: own texture instance whose UV offset steps one texel at a time (stays crisp).
 * Call update(timeSeconds) each frame. `material` is a ready MeshToonMaterial.
 */
export function animatedWater({ base = DEFAULT_BASE.water, repeat = [1, 1], speed = 2.5 } = {}) {
  const t = texture('water', { base }).clone();
  t.needsUpdate = true;
  t.repeat.set(repeat[0], repeat[1]);
  const material = new THREE.MeshToonMaterial({ color: 0xffffff, map: t, gradientMap });
  return {
    texture: t,
    material,
    update(time) {
      const step = Math.floor(time * speed);
      t.offset.set((step % 32) / 32, ((step >> 1) % 32) / 32);
    },
  };
}

// ---------------------------------------------------------------- UV helpers

const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Rewrite UVs to world-scale tiling: one texture repeat = `unitsPerRepeat` world units (number or [u, v]).
 * Each vertex is projected onto its own face plane (walls: u along the wall, v up; floors: u=x, v=z;
 * tilted roof planes: u horizontal, v along the slope), so nothing stretches on long walls.
 * Pass `matrix` (the transform you will later apply with applyMatrix4/ mesh matrix) to tile in WORLD space,
 * which also makes neighbouring boxes line up. Call it on the final-size geometry, before mergeGeometries.
 */
export function surfaceUV(geometry, unitsPerRepeat = 2, matrix = null) {
  const [su, sv] = Array.isArray(unitsPerRepeat) ? unitsPerRepeat : [unitsPerRepeat, unitsPerRepeat];
  const pos = geometry.getAttribute('position');
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const nor = geometry.getAttribute('normal');
  const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    if (matrix) { _p.applyMatrix4(matrix); _n.applyMatrix3(nm).normalize(); }
    if (Math.abs(_n.y) > 0.9999) {
      _t1.set(1, 0, 0); _t2.set(0, 0, 1);
    } else {
      _t1.crossVectors(UP, _n).normalize();
      _t2.crossVectors(_n, _t1);
      if (_t2.y < 0) { _t2.negate(); _t1.negate(); }
    }
    uv[i * 2] = _p.dot(_t1) / su;
    uv[i * 2 + 1] = _p.dot(_t2) / sv;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** BoxGeometry (or any hard-edged mesh) -> world-scale UVs. Alias of surfaceUV, kept for readability. */
export const boxUV = surfaceUV;
/** PlaneGeometry (already rotated, or pass `matrix`) -> world-scale UVs. */
export const planeUV = surfaceUV;
