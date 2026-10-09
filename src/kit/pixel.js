// Pixel-art render mode: scene -> low-res target -> crisp nearest-neighbour upscale.
// The upscale pass also draws 1-low-res-pixel edge outlines (from the depth buffer) and
// optionally snaps colours to a brand palette with a light 4x4 Bayer dither.
//
// Orthographic cameras only (the game's iso rig). Anything else falls back to a plain render.
import * as THREE from 'three';
import { COLORS, mix } from '../core/tokens.js';

const PAD = 1; // extra low-res pixels rendered around the screen so sub-pixel scrolling never samples outside
const MAX_PALETTE = 64;

// ---------- pure helpers (unit-tested) ----------

/** Brand palette: each base colour plus 2 lighter + 2 darker steps (sRGB hex ints). */
export function defaultPalette() {
  const base = [COLORS.lavender, COLORS.yellow, COLORS.purple, COLORS.mascot, COLORS.red, COLORS.black, COLORS.white, COLORS.sage];
  const out = [];
  for (const c of base) {
    out.push(mix(c, COLORS.black, 0.5), mix(c, COLORS.black, 0.25), c, mix(c, COLORS.white, 0.25), mix(c, COLORS.white, 0.5));
  }
  return [...new Set(out)];
}

const hexToRgb = (h) => (typeof h === 'string' ? parseInt(h.replace('#', ''), 16) : h);

/** World units covered by one low-res pixel along one frustum axis. */
export function worldPerPixel(frustumSpan, zoom, drawPx, scale) {
  return ((frustumSpan / zoom) * scale) / drawPx;
}

/** Snap a coordinate to a grid. `shift` (-0.5..0.5 grid units) is how far the snapped value is past the true one. */
export function snapAxis(value, unit) {
  const snapped = Math.round(value / unit) * unit;
  return { snapped, shift: (snapped - value) / unit };
}

// ---------- shaders ----------

const VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uScale;      // device px per low-res px
uniform vec2  uShift;      // sub-pixel compensation, low-res px
uniform float uPad;
uniform float uNear, uFar;
uniform vec2  uWorldPerPx; // world units per low-res px (x, y)
uniform float uEdge;       // outline darkening 0..1 (0 = off)
uniform float uEdgeSil, uEdgeCrease;
uniform float uPalMix;     // 0 = no palette snapping
uniform float uDither;     // bayer amplitude (sRGB units)
uniform int   uPalN;
uniform vec3  uPalette[${MAX_PALETTE}];
uniform float uEncode;     // 1 = write sRGB

const float BAYER[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);

vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

float zAt(ivec2 p, ivec2 sz) {
  p = clamp(p, ivec2(0), sz - 1);
  float d = texelFetch(tDepth, p, 0).r;
  return uNear + d * (uFar - uNear); // orthographic: depth is linear
}

void main() {
  ivec2 sz = textureSize(tColor, 0);
  vec2 lc = gl_FragCoord.xy / uScale + vec2(uPad) - uShift;
  ivec2 ip = clamp(ivec2(floor(lc)), ivec2(0), sz - 1);

  gl_FragColor = vec4(texelFetch(tColor, ip, 0).rgb, 1.0);
  #include <tonemapping_fragment>
  vec3 col = gl_FragColor.rgb;
  col = mix(col, toSRGB(col), uEncode);

  // --- outlines from depth: silhouettes (big jump to a farther neighbour) and creases (depth laplacian) ---
  if (uEdge > 0.0) {
    float zc = zAt(ip, sz);
    float zl = zAt(ip + ivec2(-1, 0), sz), zr = zAt(ip + ivec2(1, 0), sz);
    float zu = zAt(ip + ivec2(0, 1), sz),  zd = zAt(ip + ivec2(0, -1), sz);
    float jump = max(max(zl, zr), max(zu, zd)) - zc;               // >0: a neighbour is farther -> we are the near edge
    float sil = step(uEdgeSil * uWorldPerPx.x, jump);
    float lap = max(abs(zl + zr - 2.0 * zc), abs(zu + zd - 2.0 * zc));
    // ignore laplacian that is just a silhouette on the far side of a neighbour
    float nearJump = max(abs(zl - zc), max(abs(zr - zc), max(abs(zu - zc), abs(zd - zc))));
    float crease = step(uEdgeCrease * uWorldPerPx.x, lap) * step(nearJump, uEdgeSil * uWorldPerPx.x * 2.0);
    float e = max(sil, crease) * uEdge;
    vec3 dark = mix(col * 0.5, vec3(0.10, 0.06, 0.16), 0.35);
    col = mix(col, dark, e);
  }

  // --- palette snap + ordered dither ---
  if (uPalMix > 0.0 && uPalN > 0) {
    ivec2 bp = ivec2(floor(lc)) & 3;
    float b = BAYER[bp.y * 4 + bp.x] / 16.0 - 0.5;
    vec3 q = clamp(col + b * uDither, 0.0, 1.0);
    vec3 best = uPalette[0];
    float bd = 1e9;
    for (int i = 0; i < ${MAX_PALETTE}; i++) {
      if (i >= uPalN) break;
      vec3 d = q - uPalette[i];
      float rm = 0.5 * (q.r + uPalette[i].r);
      float dist = (2.0 + rm) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - rm) * d.b * d.b; // "redmean" weighting
      if (dist < bd) { bd = dist; best = uPalette[i]; }
    }
    col = mix(col, best, uPalMix);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------- renderer ----------

export function createPixelRenderer(
  renderer,
  { pixelSize = 2, palette = null, outline = true, paletteStrength = 0.12, dither = 0, edgeStrength = 0.8 } = {},
) {
  let enabled = true;
  let size = Math.max(1, pixelSize);
  let outlineOn = !!outline;
  let target = null;
  let tw = 0, th = 0, lowW = 0, lowH = 0, lastScale = 0;
  const dbSize = new THREE.Vector2();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      uScale: { value: 3 },
      uShift: { value: new THREE.Vector2() },
      uPad: { value: PAD },
      uNear: { value: 0.1 },
      uFar: { value: 200 },
      uWorldPerPx: { value: new THREE.Vector2(0.05, 0.05) },
      uEdge: { value: 0 },
      uEdgeSil: { value: 5 }, // in world-units-per-pixel: depth jump that counts as a silhouette
      uEdgeCrease: { value: 1.7 }, // depth second difference that counts as a crease
      uPalMix: { value: 0 },
      uDither: { value: dither },
      uPalN: { value: 0 },
      uPalette: { value: Array.from({ length: MAX_PALETTE }, () => new THREE.Vector3()) },
      uEncode: { value: 1 },
    },
  });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(tri, material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function setPalette(p) {
    // false -> off; null/undefined -> brand default; array of hex -> custom
    const list = p === false ? [] : (p ?? defaultPalette()).slice(0, MAX_PALETTE).map(hexToRgb);
    const u = material.uniforms;
    list.forEach((hex, i) => {
      const v = u.uPalette.value[i];
      v.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
    });
    u.uPalN.value = list.length;
    u.uPalMix.value = list.length ? paletteStrength : 0;
  }
  setPalette(palette);

  function allocate(drawW, drawH, scale) {
    lowW = Math.ceil(drawW / scale);
    lowH = Math.ceil(drawH / scale);
    const w = lowW + 2 * PAD, h = lowH + 2 * PAD;
    if (target && w === tw && h === th) return;
    target?.dispose();
    target?.depthTexture?.dispose();
    tw = w;
    th = h;
    const gl = renderer.extensions;
    const type = gl.has('EXT_color_buffer_half_float') || gl.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    target = new THREE.WebGLRenderTarget(w, h, {
      type,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      samples: 0,
    });
    target.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    target.depthTexture.minFilter = THREE.NearestFilter;
    target.depthTexture.magFilter = THREE.NearestFilter;
  }

  function render(scene, camera) {
    if (!enabled || !camera.isOrthographicCamera) {
      renderer.render(scene, camera);
      return;
    }
    renderer.getDrawingBufferSize(dbSize);
    const drawW = dbSize.x, drawH = dbSize.y;
    const scale = Math.max(1, size * renderer.getPixelRatio());
    allocate(drawW, drawH, scale);
    lastScale = scale;

    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    right.set(e[0], e[1], e[2]);
    up.set(e[4], e[5], e[6]);

    const { left, right: cr, top, bottom, zoom } = camera;
    const ux = worldPerPixel(cr - left, zoom, drawW, scale);
    const uy = worldPerPixel(top - bottom, zoom, drawH, scale);

    // Snap the camera to the low-res pixel grid along its own right/up axes; the blit hands the remainder back.
    const px = camera.position.dot(right), py = camera.position.dot(up);
    const sx = snapAxis(px, ux), sy = snapAxis(py, uy);
    const savedPos = camera.position.clone();
    camera.position.addScaledVector(right, sx.snapped - px).addScaledVector(up, sy.snapped - py);
    camera.updateMatrixWorld(true);

    // Frustum covering [-PAD, low + PAD] low-res pixels, anchored at the original bottom-left corner.
    camera.left = left - PAD * ux * zoom;
    camera.right = left + (lowW + PAD) * ux * zoom;
    camera.bottom = bottom - PAD * uy * zoom;
    camera.top = bottom + (lowH + PAD) * uy * zoom;
    camera.updateProjectionMatrix();

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);

    // restore the caller's camera untouched
    camera.left = left; camera.right = cr; camera.top = top; camera.bottom = bottom;
    camera.position.copy(savedPos);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const u = material.uniforms;
    u.tColor.value = target.texture;
    u.tDepth.value = target.depthTexture;
    u.uScale.value = scale;
    u.uShift.value.set(sx.shift, sy.shift);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uWorldPerPx.value.set(ux, uy); // depth is in world units: thresholds scale with the pixel's world size
    u.uEdge.value = outlineOn ? edgeStrength : 0;
    u.uEncode.value = renderer.outputColorSpace === THREE.SRGBColorSpace ? 1 : 0;

    renderer.setRenderTarget(prevTarget);
    renderer.render(quadScene, quadCam);
  }

  return {
    render,
    /** CSS size, as given to renderer.setSize. The buffers are re-fitted lazily in render(), so this is only a hint. */
    setSize() {},
    setPixelSize(n) {
      size = Math.max(1, n);
    },
    setEnabled(v) {
      enabled = !!v;
    },
    get enabled() {
      return enabled;
    },
    get pixelSize() {
      return size;
    },
    setOutline(v) {
      outlineOn = !!v;
    },
    /** false = off, null = brand default, array of hex = custom. */
    setPalette,
    setPaletteStrength(v) {
      paletteStrength = v;
      if (material.uniforms.uPalN.value) material.uniforms.uPalMix.value = v;
    },
    setDither(v) {
      material.uniforms.uDither.value = v;
    },
    dispose() {
      target?.dispose();
      target?.depthTexture?.dispose();
      tri.dispose();
      material.dispose();
    },
    get lowRes() {
      return { w: lowW, h: lowH, scale: lastScale };
    },
  };
}
