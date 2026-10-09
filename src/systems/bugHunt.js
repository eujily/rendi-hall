import * as THREE from 'three';
import gsap from 'gsap';
import { BUGS, BUG_PICK_R, PLAZA, toWorld } from '../core/layout.js';
import { COLORS } from '../core/tokens.js';
import { bus } from '../core/events.js';
import { reducedMotion } from '../core/motion.js';
import { toonMesh } from '../kit/toon.js';
import { createBug } from '../actors/bug.js';
import content from '../content/content.json';
import '../ui/hud.css';

const FALLBACK_COMMITS = [
  'fix: stop guessing, start clicking',
  'chore: remove 3 tabs nobody asked for',
  'fix: off-by-one in the vibes',
  'refactor: make it click (again)',
  'fix: it worked on my machine',
  'perf: delete the loading spinner',
  'fix: null is not a personality',
  'docs: explain the thing, then un-explain it',
];
const COMMITS = Array.isArray(content?.ui?.commits) && content.ui.commits.length ? content.ui.commits : FALLBACK_COMMITS;

/** Pure pickup test: ids of unfixed bugs within `r` of (x, z). Each bug: { id, x, z, fixed? }. */
export function pickBugs(bugs, x, z, r = BUG_PICK_R) {
  const r2 = r * r;
  const out = [];
  for (const b of bugs) {
    if (b.fixed) continue;
    const dx = b.x - x;
    const dz = b.z - z;
    if (dx * dx + dz * dz <= r2) out.push(b.id);
  }
  return out;
}

const BRAND = ['#f5d360', '#b77ff5', '#d63532', '#a04aff', '#ffffff', '#cba6f4'];

function buildRocket() {
  const g = new THREE.Group();
  const body = toonMesh(new THREE.CylinderGeometry(0.34, 0.4, 1.5, 16), COLORS.white);
  body.position.y = 0.95;
  const nose = toonMesh(new THREE.ConeGeometry(0.34, 0.6, 16), COLORS.red);
  nose.position.y = 1.99;
  const win = toonMesh(new THREE.SphereGeometry(0.15, 12, 10), COLORS.purple, { outline: 0.03 });
  win.position.set(0, 1.2, 0.33);
  g.add(body, nose, win);
  for (let i = 0; i < 3; i++) {
    const fin = toonMesh(new THREE.BoxGeometry(0.08, 0.6, 0.5), i === 1 ? COLORS.red : COLORS.purple, { outline: 0.03 });
    const a = (i / 3) * Math.PI * 2;
    fin.position.set(Math.sin(a) * 0.46, 0.4, Math.cos(a) * 0.46);
    fin.rotation.y = a;
    g.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.9, 12), new THREE.MeshBasicMaterial({ color: COLORS.yellow }));
  flame.rotation.x = Math.PI;
  flame.position.y = -0.1;
  flame.name = 'flame';
  g.add(flame);
  return g;
}

export function createBugHunt({ scene, toScreen }) {
  const total = BUGS.length;
  let fixedCount = 0;
  let zone = 'town';
  let launched = false;
  let finalePending = false;

  const entries = BUGS.map((def, i) => {
    const w = toWorld(def.zone, def);
    const bug = createBug({ variant: i });
    bug.object3d.position.set(w.x, 0, w.z);
    scene.add(bug.object3d);
    return { id: def.id, zone: def.zone, x: w.x, z: w.z, bug, fixed: false };
  });

  // ---------------------------------------------------------------- DOM
  const counter = document.createElement('div');
  counter.className = 'bh-counter';
  counter.setAttribute('aria-live', 'polite');
  document.body.append(counter);
  const layer = document.createElement('div');
  layer.className = 'bh-layer';
  document.body.append(layer);

  const renderCounter = () => {
    counter.textContent = `🐞 Bugs ${fixedCount}/${total}`;
    counter.classList.toggle('bh-counter--done', fixedCount === total);
  };
  renderCounter();

  const toasts = [];
  function toast(pos, lines, { big = false, ms = 2200, fixedScreen = false } = {}) {
    const anchor = document.createElement('div');
    anchor.className = 'bh-anchor';
    const box = document.createElement('div');
    box.className = big ? 'bh-toast bh-toast--big' : 'bh-toast';
    for (const [cls, text] of lines) {
      const s = document.createElement('div');
      s.className = cls;
      s.textContent = text;
      box.append(s);
    }
    anchor.append(box);
    if (fixedScreen) anchor.classList.add('bh-anchor--screen');
    layer.append(anchor);
    const item = { anchor, pos, dead: false };
    toasts.push(item);
    if (!reducedMotion()) gsap.fromTo(box, { opacity: 0, y: 8, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: 'back.out(2)' });
    gsap.delayedCall(ms / 1000, () => {
      gsap.to(box, {
        opacity: 0,
        y: reducedMotion() ? 0 : -16,
        duration: 0.3,
        onComplete: () => {
          item.dead = true;
          anchor.remove();
          const i = toasts.indexOf(item);
          if (i >= 0) toasts.splice(i, 1);
        },
      });
    });
    return item;
  }

  function confetti() {
    if (reducedMotion()) return;
    const n = 70;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'bh-confetti';
      p.style.background = BRAND[i % BRAND.length];
      p.style.left = `${Math.random() * 100}vw`;
      p.style.width = `${6 + Math.random() * 6}px`;
      p.style.height = `${8 + Math.random() * 8}px`;
      layer.append(p);
      gsap.fromTo(
        p,
        { y: -20, rotation: Math.random() * 360, opacity: 1 },
        {
          y: window.innerHeight + 40,
          x: (Math.random() - 0.5) * 240,
          rotation: `+=${360 + Math.random() * 540}`,
          duration: 2.2 + Math.random() * 1.6,
          delay: Math.random() * 0.6,
          ease: 'power1.in',
          onComplete: () => p.remove(),
        },
      );
    }
  }

  // ---------------------------------------------------------------- rocket finale
  const puffs = [];
  const puffGeo = new THREE.IcosahedronGeometry(0.28, 1);
  function launchRocket() {
    if (launched) return;
    launched = true;
    const w = toWorld('town', PLAZA);
    const rocket = buildRocket();
    rocket.position.set(w.x, 0, w.z);
    scene.add(rocket);
    const flame = rocket.getObjectByName('flame');
    const state = { y: 0, lastPuff: 0 };
    const tl = gsap.timeline({
      onComplete: () => {
        scene.remove(rocket);
        rocket.traverse((o) => o.isMesh && o.geometry.dispose());
      },
    });
    if (reducedMotion()) {
      tl.to(state, { y: 22, duration: 1.2, ease: 'power2.in' });
    } else {
      tl.to(rocket.scale, { x: 1.08, y: 0.94, z: 1.08, duration: 0.5, yoyo: true, repeat: 1 }) // rumble
        .to(state, { y: 24, duration: 3, ease: 'power3.in' });
    }
    tl.eventCallback('onUpdate', () => {
      rocket.position.y = state.y;
      rocket.position.x = w.x + (state.y > 0.2 ? Math.sin(state.y * 9) * 0.015 : Math.sin(tl.time() * 60) * 0.02);
      flame.scale.set(1 + Math.random() * 0.2, 0.8 + Math.random() * 0.6, 1 + Math.random() * 0.2);
      if (state.y > 0 && state.y - state.lastPuff > 0.35) {
        state.lastPuff = state.y;
        spawnPuff(w.x, state.y - 0.2, w.z);
      } else if (state.y === 0 && Math.random() < 0.3) spawnPuff(w.x, 0.2, w.z);
    });
  }

  function spawnPuff(x, y, z) {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: COLORS.white, transparent: true, opacity: 0.95 }));
    m.position.set(x + (Math.random() - 0.5) * 0.3, Math.max(0.15, y), z + (Math.random() - 0.5) * 0.3);
    scene.add(m);
    const s = 0.6 + Math.random() * 0.5;
    m.scale.setScalar(s);
    puffs.push(m);
    gsap.to(m.scale, { x: s * 2.6, y: s * 2.6, z: s * 2.6, duration: 1.6, ease: 'power1.out' });
    gsap.to(m.material, {
      opacity: 0,
      duration: 1.6,
      ease: 'power1.in',
      onComplete: () => {
        scene.remove(m);
        m.material.dispose();
        const i = puffs.indexOf(m);
        if (i >= 0) puffs.splice(i, 1);
      },
    });
    gsap.to(m.position, { y: m.position.y + 0.8, duration: 1.6 });
  }

  function finale() {
    bus.emit('bug:all', {});
    toast(null, [['bh-toast__t', 'All bugs fixed. Deploying…']], { big: true, ms: 2400, fixedScreen: true });
    gsap.delayedCall(reducedMotion() ? 0.6 : 1.8, () => {
      toast(null, [['bh-toast__t', 'v1.0 shipped 🚀']], { big: true, ms: 4200, fixedScreen: true });
      confetti();
      if (zone === 'town') launchRocket();
      else finalePending = true;
    });
  }

  // ---------------------------------------------------------------- API
  const _v = new THREE.Vector3();
  function onFixed(e) {
    e.fixed = true;
    fixedCount++;
    renderCounter();
    const msg = COMMITS[Math.floor(Math.random() * COMMITS.length)];
    const body = e.bug.object3d.children[0];
    const pos = new THREE.Vector3(e.x + (body?.position.x ?? 0), 0.9, e.z + (body?.position.z ?? 0));
    toast(pos, [['bh-toast__t', 'fixed ✓'], ['bh-toast__c', msg]]);
    bus.emit('bug:fixed', { id: e.id, fixed: fixedCount, total });
    e.bug.fix();
    if (fixedCount === total) finale();
  }

  function setZone(z) {
    zone = z;
    for (const e of entries) e.bug.object3d.visible = e.zone === z && !e.fixed;
    if (z === 'town' && finalePending) {
      finalePending = false;
      launchRocket();
    }
  }
  setZone(zone);

  function update(t, dt, playerWorldPos, activeZone) {
    if (activeZone && activeZone !== zone) setZone(activeZone);
    for (const e of entries) {
      if (e.zone !== zone) continue;
      if (e.bug.object3d.visible) e.bug.update(t, dt);
    }
    if (playerWorldPos) {
      const live = entries.filter((e) => e.zone === zone && !e.fixed).map((e) => ({
        id: e.id,
        x: e.x + (e.bug.object3d.children[0]?.position.x ?? 0),
        z: e.z + (e.bug.object3d.children[0]?.position.z ?? 0),
      }));
      for (const id of pickBugs(live, playerWorldPos.x, playerWorldPos.z)) {
        onFixed(entries.find((e) => e.id === id));
      }
    }
    for (const item of toasts) {
      if (!item.pos) continue;
      const p = toScreen(_v.copy(item.pos));
      if (p) item.anchor.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
    }
  }

  return {
    update,
    setZone,
    get count() {
      return { fixed: fixedCount, total };
    },
    /** World positions of unfixed bugs in a zone (for the minimap). */
    live(z = zone) {
      return entries.filter((e) => e.zone === z && !e.fixed).map((e) => ({ x: e.x, z: e.z }));
    },
    dispose() {
      counter.remove();
      layer.remove();
    },
  };
}
