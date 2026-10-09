import './ui/tokens.css';
import './ui/hud.css';
import * as THREE from 'three';
import gsap from 'gsap';
import { bus } from './core/events.js';
import { appState } from './core/appState.js';
import {
  ROOM, TOWN, TOWN_ORIGIN, PLAYER_SPEED, NPC_NEAR_R,
  EXHIBIT_NEAR_R, exhibitCenter, HALL_EXIT, HALL_SPAWN, HALL_VISITORS,
  PLACES, PLACE_NEAR_R, BUILDINGS, PRODUCTS_DOOR, TOWN_SPAWN, TOWN_FROM_HALL, TOWN_VILLAGERS, toWorld,
} from './core/layout.js';
import { DUR, reducedMotion } from './core/motion.js';
import { setupLights } from './kit/toon.js';
import { createPost } from './kit/post.js';
import { createAtmosphere } from './kit/atmosphere.js';
import { createHall } from './world/hall.js';
import { createTown } from './world/town.js';
import { createRandy } from './actors/randy.js';
import { createNpc } from './actors/npc.js';
import { buildStands } from './stands/index.js';
import { step, velocityToward } from './systems/movement.js';
import { createProximity } from './systems/proximity.js';
import { createInput } from './systems/input.js';
import { createCameraRig } from './systems/cameraRig.js';
import { createBugHunt } from './systems/bugHunt.js';
import { createHud } from './ui/hud.js';
import { createPrompt } from './ui/prompt.js';
import { createBubbles } from './ui/bubble.js';
import { createSkipList } from './ui/skipList.js';
import { createProductView } from './ui/productView.js';
import { createTransition } from './ui/transition.js';
import { createMinimap } from './ui/minimap.js';
import content from './content/content.json';

// Tweens follow wall-clock time even when frames are sparse (system-design §4).
gsap.ticker.lagSmoothing(0);

// ---------- scene ----------
const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const { followShadow } = setupLights(scene);

const rig = createCameraRig();
const atmosphere = createAtmosphere(scene, rig.camera);
const post = createPost(renderer, scene, rig.camera);
const toScreen = (v) => rig.toScreen(v);

// ---------- zones ----------
// Both zones live in one scene, far apart; only the active one is visible.
// Every position below is in WORLD space (town-local layout values go through toWorld).
const offsetCollider = (c, o) =>
  c.type === 'box'
    ? { ...c, minX: c.minX + o.x, maxX: c.maxX + o.x, minZ: c.minZ + o.z, maxZ: c.maxZ + o.z }
    : { ...c, x: c.x + o.x, z: c.z + o.z };
const offsetBounds = (b, o) => ({ minX: b.minX + o.x, maxX: b.maxX + o.x, minZ: b.minZ + o.z, maxZ: b.maxZ + o.z });

// Hall
const hall = createHall();
const stands = buildStands();
const standById = Object.fromEntries(stands.map((s) => [s.id, s]));
const hallGroup = new THREE.Group();
hallGroup.add(hall.object3d, ...stands.map((s) => s.object3d));
scene.add(hallGroup);

// Town
const town = createTown();
town.object3d.position.set(TOWN_ORIGIN.x, 0, TOWN_ORIGIN.z);
scene.add(town.object3d);

const placeName = (chatId) =>
  chatId === 'waitlist' ? content.waitlist.title : content.places?.find((p) => p.id === chatId)?.name ?? chatId;

const zones = {
  hall: {
    id: 'hall',
    group: hallGroup,
    bounds: ROOM,
    colliders: hall.colliders,
    spawn: HALL_SPAWN,
    npcs: HALL_VISITORS.map((v) => createNpc({ ...v, lookAt: stands.map((s) => ({ x: s.x, z: s.z })) })),
    spots: stands.map((s) => ({ id: s.id, kind: 'spot', x: s.x, z: s.z, r: EXHIBIT_NEAR_R })),
    door: { ...HALL_EXIT, to: 'town' },
  },
  town: {
    id: 'town',
    group: town.object3d,
    bounds: offsetBounds(TOWN, TOWN_ORIGIN),
    colliders: town.colliders.map((c) => offsetCollider(c, TOWN_ORIGIN)),
    spawn: toWorld('town', TOWN_SPAWN),
    npcs: TOWN_VILLAGERS.map((v) =>
      createNpc({
        ...v,
        waypoints: v.waypoints.map((p) => toWorld('town', p)),
        lookAt: PLACES.map((p) => toWorld('town', p)),
      }),
    ),
    spots: PLACES.map((p) => ({ id: p.chat, kind: 'spot', ...toWorld('town', p), r: PLACE_NEAR_R, place: p })),
    door: { ...toWorld('town', PRODUCTS_DOOR), r: PRODUCTS_DOOR.r, to: 'hall' },
  },
};
Object.values(zones).forEach((z) => z.npcs.forEach((n) => scene.add(n.object3d)));

// Spots (things that open a chat): hall exhibits + town places, looked up by chat id.
const spotById = {};
stands.forEach((s) => {
  const c = exhibitCenter(s.exhibit);
  const n = s.exhibit.normal;
  spotById[s.id] = {
    zone: 'hall',
    id: s.id,
    focusPoint: new THREE.Vector3(c.x, c.y, c.z),
    pose: { ...s.def.focusPose, zoom: 2.3, height: 0, dir: new THREE.Vector3(n.x, 0.18, n.z).normalize() },
    // Randy waits beside the vitrine, out of the frontal view.
    beside: { x: s.x - n.z * 2.6 + n.x * -0.6, z: s.z + n.x * 2.6 + n.z * -0.6 },
    front: { x: s.x, z: s.z },
    name: content.products.find((p) => p.id === s.id)?.name ?? s.id,
  };
});
PLACES.forEach((p) => {
  const b = BUILDINGS.find((x) => x.id === p.id);
  const door = toWorld('town', b?.door ?? p);
  const front = toWorld('town', p);
  spotById[p.chat] = {
    zone: 'town',
    id: p.chat,
    focusPoint: new THREE.Vector3(door.x, 1.6, door.z),
    pose: { height: 0, zoom: 1.45 },
    beside: { x: front.x - 1.4, z: front.z + 0.6 },
    front,
    name: placeName(p.chat),
  };
});

const randy = createRandy();
scene.add(randy.object3d);

let zone = zones.town;
let proximity = null;
let npcProximity = null;
let npcTargets = [];

function enterZone(id, at) {
  zone = zones[id];
  Object.values(zones).forEach((z) => {
    z.group.visible = z === zone;
    z.npcs.forEach((n) => (n.object3d.visible = z === zone));
  });
  randy.object3d.position.set(at.x, 0, at.z);
  proximity = createProximity(zone.spots);
  npcTargets = zone.npcs.map((n) => ({ id: n.id, kind: 'npc', x: n.position.x, z: n.position.z, r: NPC_NEAR_R }));
  npcProximity = createProximity(npcTargets);
  rig.setBounds(zone.bounds);
  rig.follow(randy.object3d);
  rig.snapTo(randy.object3d);
  hunt.setZone(id);
  minimap.setZone(id);
  appState.zone = id;
  atmosphere.setZone(id);
}

// ---------- UI ----------
const hud = createHud({ onSkip: () => skipList.open() });
const prompt = createPrompt();
const bubbles = createBubbles();
const transition = createTransition();
const hunt = createBugHunt({ scene, toScreen });
const minimap = createMinimap({
  onPick: (p) => {
    if (!appState.is('EXPLORE')) return;
    pendingSpot = null;
    input.setTarget(p);
  },
});
const skipList = createSkipList(
  [
    {
      group: 'Town',
      items: [
        ...(content.places ?? []).map((p) => ({ id: p.id, name: p.name, tagline: p.tagline })),
        { id: 'waitlist', name: content.waitlist.title, tagline: content.waitlist.body },
      ],
    },
    { group: 'Products', items: content.products.map((p) => ({ id: p.id, name: p.name, tagline: p.tagline })) },
  ],
  (id) => teleportAndOpen(id),
);
const view = createProductView({
  content,
  onRequestClose: () => closeSpot(),
  onAction: (action) => {
    if (action === 'waitlist') closeSpot().then(() => teleportAndOpen('waitlist'));
  },
});

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const standRoots = stands.map((s) => s.object3d);
const inBounds = (p, b) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
const input = createInput(canvas, {
  pickFloor(ndc) {
    raycaster.setFromCamera(ndc, rig.camera);
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(ground, p)) return null;
    return inBounds(p, zone.bounds) ? { x: p.x, z: p.z } : null;
  },
  pickStand(ndc) {
    if (zone.id !== 'hall') return null;
    raycaster.setFromCamera(ndc, rig.camera);
    const hit = raycaster.intersectObjects(standRoots, true)[0];
    return hit?.object.userData.standId ?? null;
  },
});

let pendingSpot = null;
let scriptedVel = { x: 0, z: 0 }; // walk animation while Randy is moved by a tween

input.onInteract(() => {
  const cur = proximity.current;
  if (appState.is('EXPLORE') && cur) openSpot(cur.id);
});
input.onBack(() => {
  if (appState.is('OPENING', 'FOCUSED')) closeSpot();
  else skipList.close();
});
input.onStandClick((id) => {
  if (proximity.current?.id === id) return openSpot(id);
  pendingSpot = id;
  input.setTarget(spotById[id].front);
});
input.onFloorClick(() => { pendingSpot = null; });

// ---------- open / close a chat spot (docs/system-design.md §5) ----------
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function openSpot(id) {
  const spot = spotById[id];
  if (!spot || !appState.request('stand:open', { id })) return;
  pendingSpot = null;
  input.clearTarget();
  prompt.hide();
  const pos = randy.object3d.position;
  const to = spot.beside;
  const dx = to.x - pos.x, dz = to.z - pos.z;
  const dur = reducedMotion() ? 0 : Math.min(0.5, Math.hypot(dx, dz) / PLAYER_SPEED);
  scriptedVel = dur ? { x: dx / dur, z: dz / dur } : { x: 0, z: 0 };
  gsap.to(pos, { x: to.x, z: to.z, duration: dur, ease: 'none', onComplete: () => {
    scriptedVel = { x: 0, z: 0 };
    randy.wave();
  } });
  if (spot.zone === 'town') minimap.markVisited(spot.id === 'waitlist' ? 'post' : spot.id);
  const origin = rig.toScreen(spot.focusPoint);
  history.replaceState(null, '', `#/${spot.zone === 'hall' ? 'product' : 'place'}/${id}`);

  const camera = rig.focus(spot.focusPoint, spot.pose);
  const panel = wait(reducedMotion() ? 0 : DUR.focus * 0.4).then(() =>
    appState.is('OPENING') ? view.open(id, origin) : null,
  );
  await Promise.all([camera, panel]);
  appState.request('stand:opened');
}

async function closeSpot() {
  if (!appState.request('stand:close')) return;
  history.replaceState(null, '', location.pathname + location.search);
  await Promise.all([view.close(), rig.release()]);
  appState.request('stand:closed');
  showPromptFor(proximity.current);
}

async function travel(to, at) {
  if (!appState.request('zone:leave', { zone: to })) return;
  prompt.hide();
  input.clearTarget();
  pendingSpot = null;
  transition.setCaption(to === 'hall' ? content.ui.entering : content.ui.leaving);
  await transition.cover();
  enterZone(to, at);
  if (to === 'hall') minimap.markVisited('products');
  await transition.reveal();
  appState.request('zone:entered');
}

async function teleportAndOpen(id) {
  const spot = spotById[id];
  if (!spot || !appState.is('EXPLORE')) return;
  skipList.close();
  if (spot.zone !== zone.id) await travel(spot.zone, spot.front);
  else randy.object3d.position.set(spot.front.x, 0, spot.front.z);
  proximity.update(spot.front);
  openSpot(id);
}

// ---------- proximity → UI ----------
function showPromptFor(cur) {
  if (!cur || !appState.is('EXPLORE')) return;
  const s = spotById[cur.id];
  if (s) prompt.show(s.name, () => openSpot(cur.id));
}
bus.on('proximity:enter', (t) => {
  if (t.kind === 'spot') showPromptFor(t);
  if (t.kind === 'npc') {
    const line = content.npcs.find((n) => n.id === t.id)?.line;
    if (line) bubbles.say(t.id, line);
  }
});
bus.on('proximity:leave', ({ kind }) => {
  if (kind === 'spot') prompt.hide();
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
      pendingSpot = null;
    } else {
      const target = input.getMoveTarget();
      if (target) {
        vel = velocityToward(pos, target, PLAYER_SPEED);
        if (!vel.x && !vel.z) input.clearTarget();
      }
    }
    const next = step(pos, vel, dt, zone.colliders, zone.bounds);
    pos.x = next.x;
    pos.z = next.z;

    // doors: walking onto them switches zone
    const d = zone.door;
    if (Math.hypot(pos.x - d.x, pos.z - d.z) < d.r) {
      travel(d.to, d.to === 'hall' ? HALL_SPAWN : toWorld('town', TOWN_FROM_HALL));
    }
  } else {
    vel = appState.is('TRAVEL') ? { x: 0, z: 0 } : scriptedVel;
  }
  randy.setVelocity(vel.x, vel.z);

  // 3. actors
  randy.update(dt);
  const focused = appState.focusedId && spotById[appState.focusedId];
  zone.npcs.forEach((n, i) => {
    n.update(dt);
    n.object3d.visible = !focused || Math.hypot(n.position.x - focused.front.x, n.position.z - focused.front.z) > 3.4;
    npcTargets[i].x = n.position.x;
    npcTargets[i].z = n.position.z;
  });
  town.update?.(elapsed, dt);
  hunt.update(elapsed, dt, pos, zone.id);

  // 4. proximity
  if (appState.is('EXPLORE')) {
    proximity.update(pos);
    npcProximity.update(pos);
  }
  if (pendingSpot && proximity.current?.id === pendingSpot && appState.is('EXPLORE')) openSpot(pendingSpot);

  // 5. exhibits
  if (zone.id === 'hall') {
    const near = proximity.current?.id;
    stands.forEach((s) => {
      const state = appState.focusedId === s.id ? 'focused' : near === s.id ? 'near' : 'idle';
      s.def.update(elapsed, dt, state);
    });
  }

  // 6. camera (+ the sun's shadow box follows the view)
  rig.update(dt);
  const look = rig.getLook();
  followShadow(look);
  atmosphere.update(elapsed, dt, look);

  // 7. screen anchors
  const cur = proximity.current;
  if (cur) {
    const s = spotById[cur.id];
    const p = rig.toScreen(tmp.set(s.front.x, 3.2, s.front.z));
    prompt.setPosition(p.x, p.y);
  }
  zone.npcs.forEach((n) => {
    if (!bubbles.isShowing(n.id)) return;
    const p = rig.toScreen(tmp.set(n.position.x, 2.1, n.position.z));
    bubbles.setPosition(n.id, p.x, p.y);
  });

  minimap.update(pos, { npcs: zone.npcs.map((n) => n.position), bugs: hunt.live(zone.id) });

  // 8. render
  post.render();
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  rig.resize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);

// ---------- boot ----------
enterZone('town', zones.town.spawn);
renderer.setAnimationLoop(frame);
const fontsReady = Promise.race([document.fonts.ready, wait(1.5)]);
fontsReady.then(() => wait(0.4)).then(() => {
  hud.hideLoader();
  appState.request('ready');
  const deep = location.hash.match(/^#\/(?:product|place)\/([\w-]+)$/)?.[1];
  if (deep && spotById[deep]) teleportAndOpen(deep);
});

if (import.meta.env.DEV) Object.assign(window, { __rendi: { THREE, scene, renderer, rig, appState, randy, stands, zones, enterZone, travel, openSpot } });
