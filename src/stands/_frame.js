// Shared exhibit frame: an IT "app window" hung on the wall that is also a deep museum vitrine.
// Owned by the hall; stand dioramas are placed into `mount` (bottom-centre of the inner box).
// Frame local space: origin = wall inner face at floor level, front = +Z, up = +Y (see FRAME in layout.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, addOutline } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';
import { FRAME } from '../core/layout.js';

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const LINING = mix(COLORS.lavender, COLORS.white, 0.3);
const DOT = mix(COLORS.lavender, COLORS.black, 0.09);
const LINE = mix(COLORS.lavender, COLORS.black, 0.05);

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const prep = (g) => {
  const out = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(out.attributes)) if (n !== 'position' && n !== 'normal') out.deleteAttribute(n);
  return out;
};

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
    draw(canvas.getContext('2d'), w, h);
    tex.needsUpdate = true;
  };
  run();
  if (!nearest) {
    document.fonts?.load?.('italic 800 64px Montserrat').then(run).catch(() => {});
    document.fonts?.load?.('700 64px Montserrat').then(run).catch(() => {});
  }
  return tex;
}

function titleTexture(label, url) {
  return canvasTexture(1344, 192, (ctx, w, h) => {
    ctx.fillStyle = hex(COLORS.white);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(COLORS.black);
    ctx.fillRect(0, h - 8, w, 8);
    // traffic-light dots
    [COLORS.red, COLORS.yellow, COLORS.purple].forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(70 + i * 62, 90, 21, 0, Math.PI * 2);
      ctx.fillStyle = hex(c);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = hex(COLORS.black);
      ctx.stroke();
    });
    // product label
    ctx.fillStyle = hex(COLORS.black);
    ctx.font = '700 70px Montserrat, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 290, 94, 520);
    // url pill
    ctx.beginPath();
    ctx.roundRect(860, 40, 440, 100, 50);
    ctx.fillStyle = hex(COLORS.lavender);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = hex(COLORS.black);
    ctx.font = '700 46px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(url, 892, 92, 380);
  });
}

function nameTexture(label) {
  return canvasTexture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = hex(COLORS.white);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(COLORS.black);
    ctx.font = 'italic 800 104px Montserrat, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2 + 6, 900);
  });
}

function backTexture() {
  return canvasTexture(
    288,
    208,
    (ctx, w, h) => {
      ctx.fillStyle = hex(COLORS.lavender);
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = hex(LINE);
      for (let x = 0; x < w; x += 48) ctx.fillRect(x, 0, 1, h);
      for (let y = 0; y < h; y += 48) ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = hex(DOT);
      for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) ctx.fillRect(x - 1, y - 1, 3, 3);
    },
    { nearest: true },
  );
}

/**
 * @param {{ label: string, accent: number, url: string }} opts
 * @returns {{ root: THREE.Group, mount: THREE.Group }}
 */
export function createExhibitFrame({ label, accent, url }) {
  const { outerW: W, depth: D, bottomY: YB, innerW: IW, innerH: IH } = FRAME;
  const bar = (W - IW) / 2;
  const YT = YB + IH;
  const HEAD = 0.6;
  const BASE = YB - 0.25;
  const root = new THREE.Group();
  root.name = 'exhibit-frame';

  const parts = new Map();
  const put = (color, geo) => {
    if (!parts.has(color)) parts.set(color, []);
    parts.get(color).push(geo);
  };

  // bezel: side bars + title bar + cabinet below the window (white, thick = the vitrine walls)
  put(COLORS.white, box(bar, IH, D, -(IW / 2 + bar / 2), YB + IH / 2, D / 2));
  put(COLORS.white, box(bar, IH, D, IW / 2 + bar / 2, YB + IH / 2, D / 2));
  put(COLORS.white, box(W, HEAD, D, 0, YT + HEAD / 2, D / 2));
  put(COLORS.white, box(W, BASE, D, 0, BASE / 2, D / 2));

  // lavender lining of the box (sides, ceiling, floor)
  const lz0 = 0.05, lz1 = D - 0.06;
  const lLen = lz1 - lz0, lc = (lz0 + lz1) / 2;
  put(LINING, box(0.04, IH, lLen, -(IW / 2 - 0.02), YB + IH / 2, lc));
  put(LINING, box(0.04, IH, lLen, IW / 2 - 0.02, YB + IH / 2, lc));
  put(LINING, box(IW, 0.04, lLen, 0, YT - 0.02, lc));
  put(LINING, box(IW, 0.25, D - 0.04, 0, BASE + 0.125, (D - 0.04) / 2));

  // accent: sill shelf and stripe under the nameplate
  put(accent, box(IW + 0.5, 0.1, 0.14, 0, BASE - 0.02, D + 0.05));
  put(accent, box(IW + 0.1, 0.1, 0.04, 0, 0.08, D + 0.02));

  // cable from the title bar down the wall + two clips (thin: no outline)
  const cx = W / 2 + 0.3;
  put(COLORS.black, box(0.05, 0.3, 0.05, 1.4, YT + HEAD + 0.15, 0.04));
  put(COLORS.black, box(cx - 1.4 + 0.05, 0.05, 0.05, (cx + 1.4) / 2, YT + HEAD + 0.3, 0.04));
  put(COLORS.black, box(0.05, YT + HEAD + 0.3, 0.05, cx, (YT + HEAD + 0.3) / 2, 0.04));
  put(COLORS.black, box(0.2, 0.12, 0.06, cx, 0.35, 0.04));

  for (const [color, geos] of parts) {
    const mesh = toonMesh(mergeGeometries(geos.map(prep), false), color, {
      outline: color === COLORS.black ? 0 : 0.03,
      cast: true,
      receive: true,
    });
    mesh.name = `frame-${color.toString(16)}`;
    root.add(mesh);
  }

  // textured planes
  const title = new THREE.Mesh(
    new THREE.PlaneGeometry(W, HEAD),
    new THREE.MeshBasicMaterial({ map: titleTexture(label, url) }),
  );
  title.position.set(0, YT + HEAD / 2, D + 0.01);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(IW, IH), new THREE.MeshBasicMaterial({ map: backTexture() }));
  back.position.set(0, YB + IH / 2, 0.04);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.42), new THREE.MeshBasicMaterial({ map: nameTexture(label) }));
  plate.position.set(0, 0.37, D + 0.01);
  for (const m of [title, back, plate]) m.raycast = () => {};
  root.add(title, back, plate);

  // blinking status LED on the nameplate (alternates accent / white)
  const ledMat = new THREE.MeshBasicMaterial({ color: accent });
  const led = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 14).rotateX(Math.PI / 2), ledMat);
  led.position.set(W / 2 - 0.25, 0.37, D + 0.02);
  addOutline(led, 0.02);
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
