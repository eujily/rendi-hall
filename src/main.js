import './ui/tokens.css';
import './ui/hud.css';
import * as THREE from 'three';
import { COLORS } from './core/tokens.js';
import { bus } from './core/events.js';
import { appState } from './core/appState.js';
import { STAND_COLLIDER_R, STAND_NEAR_R, NPC_NEAR_R, SPAWN, PLAYER_SPEED, VISITORS, ROOM } from './core/layout.js';
import { DUR, reducedMotion } from './core/motion.js';
import { setupLights } from './kit/toon.js';
import { createHall } from './world/hall.js';
import { createRandy } from './actors/randy.js';
import { createNpc } from './actors/npc.js';
import { buildStands } from './stands/index.js';
import { step, velocityToward } from './systems/movement.js';
import { createProximity } from './systems/proximity.js';
import { createInput } from './systems/input.js';
import { createCameraRig } from './systems/cameraRig.js';
import { createHud } from './ui/hud.js';
import { createPrompt } from './ui/prompt.js';
import { createBubbles } from './ui/bubble.js';
import { createSkipList } from './ui/skipList.js';
import { createProductView } from './ui/productView.js';
import content from './content/content.json';

// ---------- scene ----------
const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.lavender);
setupLights(scene);

const rig = createCameraRig();
const hall = createHall();
scene.add(hall.object3d);

const stands = buildStands();
const standById = Object.fromEntries(stands.map((s) => [s.id, s]));
stands.forEach((s) => scene.add(s.object3d));

const randy = createRandy();
randy.object3d.position.set(SPAWN.x, 0, SPAWN.z);
scene.add(randy.object3d);
rig.follow(randy.object3d);

const npcs = VISITORS.map((v) => createNpc(v));
npcs.forEach((n) => scene.add(n.object3d));

const colliders = [...hall.colliders, ...stands.map((s) => ({ x: s.x, z: s.z, r: STAND_COLLIDER_R }))];
const standProximity = createProximity(stands.map((s) => ({ id: s.id, kind: 'stand', x: s.x, z: s.z, r: STAND_NEAR_R })));
const npcTargets = npcs.map((n) => ({ id: n.id, kind: 'npc', x: 0, z: 0, r: NPC_NEAR_R }));
const npcProximity = createProximity(npcTargets);

// ---------- UI ----------
const productName = (id) => content.products.find((p) => p.id === id)?.name ?? content.waitlist.title;
const hud = createHud({ onSkip: () => skipList.open() });
const prompt = createPrompt();
const bubbles = createBubbles();
const skipList = createSkipList(
  [...content.products, { id: 'waitlist', name: content.waitlist.title, tagline: content.waitlist.body }],
  (id) => teleportAndOpen(id),
);
const view = createProductView({
  content,
  onRequestClose: () => closeStand(),
  onAction: (action) => {
    if (action === 'waitlist') closeStand().then(() => teleportAndOpen('waitlist'));
  },
});

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const standRoots = stands.map((s) => s.object3d);
const input = createInput(canvas, {
  pickFloor(ndc) {
    raycaster.setFromCamera(ndc, rig.camera);
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(ground, p)) return null;
    if (p.x < ROOM.minX || p.x > ROOM.maxX || p.z < ROOM.minZ || p.z > ROOM.maxZ) return null;
    return { x: p.x, z: p.z };
  },
  pickStand(ndc) {
    raycaster.setFromCamera(ndc, rig.camera);
    const hit = raycaster.intersectObjects(standRoots, true)[0];
    return hit?.object.userData.standId ?? null;
  },
});

// Point in front of a stand (stands face the camera, +X+Z), inside the "near" radius.
const frontOf = (s) => ({ x: s.x + 1.9 * Math.SQRT1_2, z: s.z + 1.9 * Math.SQRT1_2 });

let pendingStand = null;

input.onInteract(() => {
  const cur = standProximity.current;
  if (appState.is('EXPLORE') && cur) openStand(cur.id);
});
input.onBack(() => {
  if (appState.is('OPENING', 'FOCUSED')) closeStand();
  else skipList.close();
});
input.onStandClick((id) => {
  if (standProximity.current?.id === id) return openStand(id);
  pendingStand = id;
  input.setTarget(frontOf(standById[id]));
});

// ---------- open / close (docs/system-design.md §5) ----------
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function openStand(id) {
  if (!appState.request('stand:open', { id })) return;
  pendingStand = null;
  input.clearTarget();
  prompt.hide();
  randy.setVelocity(0, 0);
  randy.wave();
  const s = standById[id];
  const world = new THREE.Vector3(s.x, 0, s.z);
  const origin = rig.toScreen(world.clone().setY(s.def.focusPose.height));
  history.replaceState(null, '', `#/product/${id}`);

  const camera = rig.focus(world, s.def.focusPose);
  const panel = wait(reducedMotion() ? 0 : DUR.focus * 0.4).then(() =>
    appState.is('OPENING') ? view.open(id, origin) : null,
  );
  await Promise.all([camera, panel]);
  appState.request('stand:opened');
}

async function closeStand() {
  if (!appState.request('stand:close')) return;
  history.replaceState(null, '', location.pathname + location.search);
  await Promise.all([view.close(), rig.release()]);
  appState.request('stand:closed');
  const cur = standProximity.current;
  if (cur) prompt.show(productName(cur.id), () => openStand(cur.id));
}

function teleportAndOpen(id) {
  const s = standById[id];
  if (!s || !appState.is('EXPLORE')) return;
  skipList.close();
  const p = frontOf(s);
  randy.object3d.position.set(p.x, 0, p.z);
  standProximity.update(p);
  openStand(id);
}

// ---------- proximity → UI ----------
bus.on('proximity:enter', ({ kind, id }) => {
  if (kind === 'stand' && appState.is('EXPLORE')) prompt.show(productName(id), () => openStand(id));
  if (kind === 'npc') {
    const line = content.npcs.find((n) => n.id === id)?.line;
    if (line) bubbles.say(id, line);
  }
});
bus.on('proximity:leave', ({ kind }) => {
  if (kind === 'stand') prompt.hide();
});

// ---------- frame (docs/system-design.md §4) ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
let elapsed = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  elapsed += dt;
  const pos = randy.object3d.position;

  // 1–2. input → movement
  let vel = { x: 0, z: 0 };
  if (appState.is('EXPLORE')) {
    const dir = input.getMoveVector();
    if (dir.x || dir.z) {
      vel = { x: dir.x * PLAYER_SPEED, z: dir.z * PLAYER_SPEED };
      pendingStand = null;
    } else {
      const target = input.getMoveTarget();
      if (target) {
        vel = velocityToward(pos, target, PLAYER_SPEED);
        if (!vel.x && !vel.z) input.clearTarget();
      }
    }
    const next = step(pos, vel, dt, colliders, ROOM);
    pos.x = next.x;
    pos.z = next.z;
  }
  randy.setVelocity(vel.x, vel.z);

  // 3. actors
  randy.update(dt);
  npcs.forEach((n, i) => {
    n.update(dt);
    npcTargets[i].x = n.position.x;
    npcTargets[i].z = n.position.z;
  });

  // 4. proximity
  standProximity.update(pos);
  npcProximity.update(pos);
  if (pendingStand && standProximity.current?.id === pendingStand && appState.is('EXPLORE')) openStand(pendingStand);

  // 5. stands
  const near = standProximity.current?.id;
  stands.forEach((s) => {
    const state = appState.focusedId === s.id ? 'focused' : near === s.id ? 'near' : 'idle';
    s.def.update(elapsed, dt, state);
  });

  // 6. camera
  rig.update(dt);

  // 7. screen anchors
  if (near) {
    const s = standById[near];
    const p = rig.toScreen(tmp.set(s.x, 3.2, s.z));
    prompt.setPosition(p.x, p.y);
  }
  npcs.forEach((n) => {
    if (!bubbles.isShowing(n.id)) return;
    const p = rig.toScreen(tmp.set(n.position.x, 2.1, n.position.z));
    bubbles.setPosition(n.id, p.x, p.y);
  });

  // 8. render
  renderer.render(scene, rig.camera);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  rig.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);

// ---------- boot ----------
renderer.setAnimationLoop(frame);
const fontsReady = Promise.race([document.fonts.ready, wait(1.5)]);
fontsReady.then(() => wait(0.4)).then(() => {
  hud.hideLoader();
  appState.request('ready');
  const deep = location.hash.match(/^#\/product\/([\w-]+)$/)?.[1];
  if (deep && standById[deep]) teleportAndOpen(deep);
});

if (import.meta.env.DEV) Object.assign(window, { __rendi: { scene, renderer, rig, appState, randy, stands } });
