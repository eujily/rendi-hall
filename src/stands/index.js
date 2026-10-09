import * as THREE from 'three';
import { STANDS } from '../core/layout.js';
import { stubStand } from './_stub.js';
import learn from './learn.js';
import pay from './pay.js';
import flow from './flow.js';
import care from './care.js';
import home from './home.js';
import studio from './studio.js';
import waitlist from './waitlist.js';

const DEFS = { learn, pay, flow, care, home, studio, waitlist };
// Stands are built facing local +Z; this turns them toward the isometric camera (+X+Z).
const FACE_CAMERA = Math.PI / 4;

export function buildStands() {
  return STANDS.map(({ id, x, z }) => {
    let def = DEFS[id];
    let group;
    try {
      group = def.build();
    } catch (err) {
      console.error(`[stand:${id}] build failed, using placeholder`, err);
      def = stubStand(id);
      group = def.build();
    }
    const object3d = new THREE.Group();
    object3d.add(group);
    object3d.position.set(x, 0, z);
    object3d.rotation.y = FACE_CAMERA;
    object3d.traverse((o) => { o.userData.standId = id; });
    return { id, x, z, def, object3d };
  });
}
