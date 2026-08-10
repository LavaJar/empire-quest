import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { buildFractureFragments, computeCollapse } from '../../src/siege/NextGenSiege';
import type { FractureGraph } from './FractureForge';

const g: FractureGraph = JSON.parse(await readFile('public/packs/byzantine_v1/wall.outer.fracture.json', 'utf8'));
const mat = new THREE.MeshBasicMaterial();
const frags = buildFractureFragments(g, 10, 8, 1, mat);
const ok = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok  -', m); };

ok(frags.length === g.cellCount, `built ${frags.length} fragments (one per cell)`);
ok(frags.every(f => f.mesh.geometry instanceof THREE.BoxGeometry), 'each fragment is real BoxGeometry mesh');
const anchors = frags.filter(f => f.anchor).length;
ok(anchors > 0, `${anchors} anchor fragments touch the base`);

// Knock out the lowest non-anchor cells to punch a breach; see what loses support.
const sorted = [...frags].sort((a,b)=> a.mesh.position.y - b.mesh.position.y);
const destroyed = new Set<number>(sorted.slice(0, 4).map(f=>f.cellId));
const fall1 = computeCollapse(frags, destroyed);
const fall2 = computeCollapse(frags, destroyed);
ok(JSON.stringify([...fall1].sort())===JSON.stringify([...fall2].sort()), 'collapse is deterministic (identical across runs)');
ok([...fall1].every(id => !frags.find(f=>f.cellId===id)!.anchor), 'anchors never fall');

// Destroy every anchor -> everything unsupported must fall.
const allAnchors = new Set<number>(frags.filter(f=>f.anchor).map(f=>f.cellId));
const fallAll = computeCollapse(frags, allAnchors);
ok(fallAll.size === frags.length - allAnchors.size, 'removing all anchors drops the entire wall');

console.log(`\ncollapseProof: ALL PASS ✅  (cells=${g.cellCount}, jointAlignment=${g.jointAlignment})`);
