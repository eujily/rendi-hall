import * as THREE from 'three';
import { EXHIBITS, exhibitSpot } from '../core/layout.js';
import { COLORS } from '../core/tokens.js';
import { createExhibitFrame } from './_frame.js';
import { stubStand } from './_stub.js';
import learn from './learn.js';
import pay from './pay.js';
import flow from './flow.js';
import care from './care.js';
import home from './home.js';
import studio from './studio.js';

// 'waitlist' lives at the town post office now, not in the hall.
const DEFS = { learn, pay, flow, care, home, studio };
const META = {
  learn: { label: 'Rendi Learn', accent: COLORS.purple, url: 'rendi.app/learn' },
  pay: { label: 'Rendi Pay', accent: COLORS.yellow, url: 'rendi.app/pay' },
  flow: { label: 'Rendi Flow', accent: COLORS.black, url: 'rendi.app/flow' },
  care: { label: 'Rendi Care', accent: COLORS.red, url: 'rendi.app/care' },
  home: { label: 'Rendi Home', accent: COLORS.mascot, url: 'rendi.app/home' },
  studio: { label: 'Rendi Studio', accent: COLORS.yellow, url: 'rendi.app/studio' },
};

export function buildStands() {
  return EXHIBITS.map((e) => {
    const { id } = e;
    const meta = META[id] ?? { label: `Rendi ${id}`, accent: COLORS.purple, url: `rendi.app/${id}` };
    let def = DEFS[id];
    let diorama;
    try {
      diorama = def.build();
    } catch (err) {
      console.error(`[stand:${id}] build failed, using placeholder`, err);
      def = stubStand(id);
      diorama = def.build();
    }
    const { root, mount } = createExhibitFrame(meta);
    mount.add(diorama);
    const object3d = new THREE.Group();
    object3d.add(root);
    object3d.position.set(e.x, 0, e.z);
    object3d.rotation.y = e.rotY;
    object3d.traverse((o) => { o.userData.standId = id; });
    const spot = exhibitSpot(e);
    return { id, x: spot.x, z: spot.z, def, object3d, exhibit: e };
  });
}
