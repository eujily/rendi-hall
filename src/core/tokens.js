// Brand tokens — source: apprendi.io CSS + mascot SVG. The ONLY place for colours in JS.
export function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

const base = {
  lavender: 0xe7deed,
  yellow: 0xf5d360,
  purple: 0xb77ff5,
  purpleLink: 0xa04aff,
  red: 0xd63532,
  black: 0x000000,
  white: 0xffffff,
  mascot: 0xcba6f4, // Randy body fill from randy-body.svg
  // Orchestrator decision 09.10: the brand has no green; plants need one for the cosy mood.
  // Pastel sage at the same lightness as the brand pastels.
  sage: 0xa9c79a,
};

export const COLORS = {
  ...base,
  shadow: mix(base.lavender, base.black, 0.1), // mascot shadow = black @ 10% over lavender
  floorA: mix(base.lavender, base.black, 0.025),
  floorB: mix(base.lavender, base.white, 0.18),
  wall: mix(base.lavender, base.white, 0.55),
  wallTrim: base.mascot,
  wood: mix(base.yellow, base.black, 0.28),
};
