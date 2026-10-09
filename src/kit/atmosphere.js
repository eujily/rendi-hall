import * as THREE from 'three';
import { COLORS, mix } from '../core/tokens.js';

// Per-zone atmosphere. Town: lavender -> warm cream sky, flat rounded clouds drifting behind the
// world, pollen + leaves floating near the camera. Hall: lavender background, dust motes.
// All drifting particles are animated in the vertex shader (no per-frame CPU work).

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const SKY_TOP = COLORS.lavender;
const SKY_MID = mix(COLORS.lavender, COLORS.yellow, 0.18);
const SKY_LOW = mix(COLORS.yellow, COLORS.white, 0.62); // warm cream

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, hex(SKY_TOP));
  grad.addColorStop(0.55, hex(SKY_MID));
  grad.addColorStop(1, hex(SKY_LOW));
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** Rounded flat cloud (bumpy top, flat bottom) with a soft inner highlight band; alpha-cut edge. */
function cloudTexture(fill) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = fill;
  g.beginPath();
  const blobs = [[110, 170, 70], [200, 130, 92], [310, 120, 100], [410, 160, 72], [256, 175, 80]];
  for (const [x, y, r] of blobs) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }
  g.rect(60, 170, 400, 56);
  g.fill();
  // flatten the bottom
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(0, 226, W, H - 226);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const POINT_VERT = /* glsl */ `
  attribute vec4 seed;      // x,y,z: base position in [0,1]^3; w: random
  attribute vec3 tint;
  uniform vec3 uLook;
  uniform float uTime, uSize, uPx, uBox, uHeight, uBase;
  uniform vec3 uDrift;
  varying vec3 vTint;
  varying float vSeed;
  varying float vAlpha;
  void main() {
    vec3 box = vec3( uBox, uHeight, uBox );
    vec3 p = seed.xyz + uDrift * uTime / box;
    p += vec3( sin( uTime * 0.6 + seed.w * 40.0 ) * 0.04, cos( uTime * 0.45 + seed.w * 31.0 ) * 0.05, cos( uTime * 0.5 + seed.w * 23.0 ) * 0.04 );
    p = fract( p );
    // box centred on the look point, wrapped so particles loop forever
    vec3 world = vec3( uLook.x, uBase, uLook.z ) + ( p - 0.5 ) * box + vec3( 0.0, uHeight * 0.5, 0.0 );
    vec4 mv = modelViewMatrix * vec4( world, 1.0 );
    gl_Position = projectionMatrix * mv;
    float edge = smoothstep( 0.0, 0.12, p.y ) * smoothstep( 1.0, 0.88, p.y ) * smoothstep( 0.0, 0.1, p.x ) * smoothstep( 1.0, 0.9, p.x ) * smoothstep( 0.0, 0.1, p.z ) * smoothstep( 1.0, 0.9, p.z );
    vAlpha = edge;
    vTint = tint;
    vSeed = seed.w;
    gl_PointSize = uSize * uPx * ( 0.7 + 0.6 * seed.w );
  }`;

const POINT_FRAG = /* glsl */ `
  uniform float uTime, uShape, uOpacity;
  varying vec3 vTint;
  varying float vSeed;
  varying float vAlpha;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float a;
    if ( uShape < 0.5 ) {
      // soft round mote / pollen
      float r = length( q ) * 2.0;
      a = smoothstep( 1.0, 0.35, r );
    } else {
      // leaf: rotated ellipse with a pointy tip
      float ang = uTime * ( 0.6 + vSeed ) + vSeed * 6.28;
      mat2 R = mat2( cos( ang ), -sin( ang ), sin( ang ), cos( ang ) );
      vec2 p = R * q * 2.0;
      float e = length( vec2( p.x * 0.8, p.y * 2.1 ) );
      a = 1.0 - smoothstep( 0.82, 1.0, e );
    }
    float tw = 0.75 + 0.25 * sin( uTime * 1.7 + vSeed * 50.0 );
    float alpha = a * vAlpha * uOpacity * tw;
    if ( alpha < 0.01 ) discard;
    gl_FragColor = vec4( vTint, alpha );
  }`;

function makeParticles({ count, colors, size, box, height, base, drift, shape, opacity, seedFn }) {
  const seed = new Float32Array(count * 4);
  const tint = new Float32Array(count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = seedFn ? seedFn(i) : [Math.random(), Math.random(), Math.random()];
    seed.set([r[0], r[1], r[2], Math.random()], i * 4);
    col.set(colors[i % colors.length]);
    tint.set([col.r, col.g, col.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const uniforms = {
    uLook: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uSize: { value: size },
    uPx: { value: 1 },
    uBox: { value: box },
    uHeight: { value: height },
    uBase: { value: base },
    uDrift: { value: new THREE.Vector3(...drift) },
    uShape: { value: shape },
    uOpacity: { value: opacity },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 10;
  pts.raycast = () => {};
  return pts;
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.OrthographicCamera} camera
 * @returns {{ update(t:number, dt:number, look:THREE.Vector3): void, setZone(zone:'town'|'hall'): void }}
 */
export function createAtmosphere(scene, camera) {
  const sky = skyTexture();
  const hallBg = new THREE.Color(COLORS.lavender);

  // ---- clouds: drawn first, behind the whole world (no depth test/write), alpha-cut + alpha-to-coverage
  const clouds = new THREE.Group();
  clouds.renderOrder = -10;
  const cloudTex = [cloudTexture(hex(COLORS.white)), cloudTexture(hex(mix(COLORS.yellow, COLORS.white, 0.35)))];
  const cloudDefs = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const m = new THREE.SpriteMaterial({
      map: cloudTex[i % 3 === 1 ? 1 : 0], transparent: false, alphaTest: 0.5, alphaToCoverage: true,
      depthTest: false, depthWrite: false, fog: false,
    });
    const s = new THREE.Sprite(m);
    s.renderOrder = -10 + i * 0.01;
    s.frustumCulled = false;
    s.raycast = () => {};
    clouds.add(s);
    cloudDefs.push({
      s,
      u: Math.random(), // horizontal position 0..1 across the view (wraps)
      v: 0.05 + Math.random() * 0.9,
      scale: 0.12 + Math.random() * 0.1, // fraction of view height
      speed: 0.004 + Math.random() * 0.006, // views per second
      par: 0.004 + Math.random() * 0.01, // parallax vs. camera look
    });
  }
  scene.add(clouds);

  // ---- floating bits
  const pollen = makeParticles({
    count: 70, colors: [COLORS.yellow, COLORS.white, COLORS.yellow, mix(COLORS.purple, COLORS.white, 0.4)],
    size: 9, box: 34, height: 7, base: 0.6, drift: [0.5, 0.25, -0.35], shape: 0, opacity: 0.85,
  });
  const leaves = makeParticles({
    count: 16, colors: [COLORS.sage, mix(COLORS.sage, COLORS.yellow, 0.4), mix(COLORS.yellow, COLORS.red, 0.25)],
    size: 17, box: 34, height: 9, base: 1.0, drift: [-0.9, -0.55, 0.7], shape: 1, opacity: 0.95,
  });
  const motes = makeParticles({
    count: 90, colors: [COLORS.white, mix(COLORS.yellow, COLORS.white, 0.5), COLORS.white],
    size: 8, box: 26, height: 9, base: 0.2, drift: [0.12, 0.2, 0.08], shape: 0, opacity: 0.6,
  });
  const townBits = new THREE.Group();
  townBits.add(pollen, leaves);
  const hallBits = new THREE.Group();
  hallBits.add(motes);
  scene.add(townBits, hallBits);

  const all = [pollen, leaves, motes];
  const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
  let zone = 'town';

  function setZone(z) {
    zone = z === 'hall' ? 'hall' : 'town';
    const town = zone === 'town';
    scene.background = town ? sky : hallBg;
    clouds.visible = town;
    townBits.visible = town;
    hallBits.visible = !town;
  }
  setZone('town');

  function update(t, dt, look) {
    const px = Math.min(window.devicePixelRatio || 1, 2);
    for (const p of all) {
      const u = p.material.uniforms;
      u.uTime.value = t;
      u.uPx.value = px * (camera.zoom || 1) ** 0.5; // bits grow a little when the camera zooms in
      u.uLook.value.copy(look);
    }
    if (zone !== 'town') return;

    // Clouds live on a plane facing the camera, sized in view units (ortho: distance only has to be in-frustum).
    camera.updateMatrixWorld();
    camera.matrixWorld.extractBasis(_right, _up, _fwd);
    const zoom = camera.zoom || 1;
    const vw = (camera.right - camera.left) / zoom, vh = (camera.top - camera.bottom) / zoom;
    const dist = (camera.near + camera.far) * 0.5;
    for (const c of cloudDefs) {
      c.u = (c.u + c.speed * dt) % 1;
      // parallax: clouds slide a little against the look point so they feel far away
      const sx = ((c.u + look.dot(_right) * c.par / Math.max(vw, 1)) % 1 + 1) % 1;
      const sy = c.v + look.dot(_up) * c.par * 0.5 / Math.max(vh, 1);
      const h = vh * c.scale;
      c.s.scale.set(h * 2, h, 1);
      // fade in/out is not possible with alpha-cut, so let the wrap happen off-screen (margin of one cloud width)
      const x = (sx * 1.5 - 0.75) * vw;
      const y = (sy - 0.5) * vh;
      c.s.position.copy(camera.position).addScaledVector(_fwd, -dist).addScaledVector(_right, x).addScaledVector(_up, y);
    }
  }

  return { update, setZone };
}
