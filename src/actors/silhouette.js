// Randy's body silhouette, sampled from the official mascot SVG (docs/ref/randy-body.svg).
// Pure math, no three.js — unit-tested in tests/blob.test.js.
//
// The body is the UNION of five rotated ellipses (the star petals) plus two flat
// "lens" paths. We sample that union radially: for every angle around the centre we
// take the furthest point still inside the union, which gives a simple, star-shaped
// outline that ExtrudeGeometry can triangulate without self-intersections.

// SVG coordinates (viewBox "229.5 17 137 128"), y down.
export const REF_ELLIPSES = [
  { cx: 297.038, cy: 63.4377, rx: 18.6074, ry: 39.107, rot: -12.0611 },
  { cx: 283.746, cy: 71.2658, rx: 15.8942, ry: 39.107, rot: -57.0611 },
  { cx: 315.559, cy: 90.0819, rx: 14.9777, ry: 39.107, rot: -57.0611 },
  { cx: 311.476, cy: 65.44, rx: 15.1495, ry: 39.107, rot: -147.061 },
  { cx: 295.421, cy: 94.0967, rx: 16.7794, ry: 39.107, rot: -147.061 },
];

// Each lens: closed path of cubic Bézier segments [p0, c1, c2, p1] (p1 = next p0).
export const REF_LENSES = [
  [
    [[285.351, 73.7976], [270.917, 83.6869], [252.844, 79.0099], [256.834, 90.4924]],
    [[256.834, 90.4924], [258.868, 96.3465], [276.504, 97.2438], [297.487, 92.1243]],
    [[297.487, 92.1243], [318.469, 87.0047], [334.288, 77.9736], [332.819, 71.9528]],
    [[332.819, 71.9528], [331.35, 65.932], [303.169, 61.5906], [285.351, 73.7976]],
  ],
  [
    [[313.904, 85.2532], [293.356, 91.9041], [272.638, 99.1848], [270.617, 92.9389]],
    [[270.617, 92.9389], [268.595, 86.693], [283.614, 76.2381], [304.163, 69.5873]],
    [[304.163, 69.5873], [324.712, 62.9365], [343.008, 62.6082], [345.03, 68.8542]],
    [[345.03, 68.8542], [347.052, 75.1001], [334.453, 78.6024], [313.904, 85.2532]],
  ],
];

// Face landmarks in the same SVG space (eyes from the SVG, pupils/smile from randy.png).
export const REF_FACE = {
  eyes: [
    { cx: 291.83, cy: 70.56, rx: 8.05, ry: 9.9, tiltDeg: 19.3, pupil: [2.4, 2.4] },
    { cx: 306.04, cy: 67.85, rx: 8.13, ry: 9.74, tiltDeg: 8.9, pupil: [-2.2, 2.4] },
  ],
  pupilR: 3.9,
  smile: [[293.113, 86.4287], [300.005, 87.02], [306.908, 85.4181], [312.835, 81.8519]],
};

// Deterministic PRNG (mulberry32) so a seed always gives the same blob.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cubic(p, t) {
  const [p0, c1, c2, p1] = p;
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
}

function lensPolygon(segments, perSegment = 12) {
  const pts = [];
  for (const seg of segments) for (let i = 0; i < perSegment; i++) pts.push(cubic(seg, i / perSegment));
  return pts;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInEllipse(x, y, e) {
  const dx = x - e.cx, dy = y - e.cy;
  const u = dx * e.cos + dy * e.sin;
  const v = -dx * e.sin + dy * e.cos;
  return (u * u) / (e.rx * e.rx) + (v * v) / (e.ry * e.ry) <= 1;
}

// Petal proportions vary with the seed (NPCs); seed 0 = exact reference.
function variedShapes(seed) {
  const rnd = seed ? mulberry32(seed) : () => 0.5;
  const ellipses = REF_ELLIPSES.map((e) => {
    const rot = ((e.rot + 14 * (rnd() - 0.5)) * Math.PI) / 180;
    return {
      cx: e.cx, cy: e.cy,
      rx: e.rx * (1 + 0.3 * (rnd() - 0.5)),
      ry: e.ry * (1 + 0.14 * (rnd() - 0.5)),
      cos: Math.cos(rot), sin: Math.sin(rot),
    };
  });
  const lenses = REF_LENSES.map((segs) => {
    const poly = lensPolygon(segs);
    const k = 1 + 0.2 * (rnd() - 0.5);
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
  });
  return { ellipses, lenses };
}

/**
 * Sample the body outline.
 * @returns {{ points: {x:number,y:number}[], frame: {cx:number, cy:number, h:number, w:number} }}
 *   points — CCW outline in body units: height normalised to 1, centred on the bbox centre, y up.
 *   frame  — maps SVG coords to body units: x = (sx - cx) / h, y = -(sy - cy) / h.
 */
export function sampleSilhouette({ seed = 0, samples = 160 } = {}) {
  const { ellipses, lenses } = variedShapes(seed);
  const inside = (x, y) => ellipses.some((e) => pointInEllipse(x, y, e)) || lenses.some((l) => pointInPolygon(x, y, l));

  // Provisional centre: mean of the ellipse centres (always well inside the union).
  const ox = ellipses.reduce((s, e) => s + e.cx, 0) / ellipses.length;
  const oy = ellipses.reduce((s, e) => s + e.cy, 0) / ellipses.length;

  const raw = [];
  const R_MAX = 90, STEP = 0.2;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    let last = 0;
    for (let r = 0; r <= R_MAX; r += STEP) if (inside(ox + r * ca, oy + r * sa)) last = r;
    raw.push([ox + last * ca, oy + last * sa]);
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of raw) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const h = maxY - minY;
  const frame = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, h, w: (maxX - minX) / h };
  // Flipping SVG's y-down axis reverses the winding, so reverse the list to keep it CCW.
  const points = raw.map(([x, y]) => svgToBody(frame, x, y)).reverse();
  return { points, frame };
}

export function svgToBody(frame, sx, sy) {
  return { x: (sx - frame.cx) / frame.h, y: -(sy - frame.cy) / frame.h };
}

// Number of petals = local maxima of the radius around the outline (used by tests).
export function countPetals(points) {
  const n = points.length;
  const r = points.map((p) => Math.hypot(p.x, p.y));
  let count = 0;
  for (let i = 0; i < n; i++) {
    const prev = r[(i - 1 + n) % n], next = r[(i + 1) % n];
    if (r[i] > prev && r[i] >= next) {
      // Must stand out from the neighbouring notch to count as a petal.
      let lo = r[i];
      for (let k = 1; k < n / 2; k++) lo = Math.min(lo, r[(i + k) % n]);
      if (r[i] - lo > 0.04) count++;
    }
  }
  return count;
}
