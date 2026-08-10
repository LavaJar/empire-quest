/**
 * renderProof — headless proof that StyleResolver produces REAL, distinct
 * THREE.MeshStandardMaterial objects across the damage ladder, reads
 * segment.damageStage, and returns null (leave sim material alone) with no
 * pack. No browser: we inject a loader that returns stub textures so the
 * resolver's material logic runs against genuine three.js objects.
 */
import * as THREE from 'three';
import { StyleResolver, StylePackManifest, SegmentLike, DamageStage, DAMAGE_LADDER } from '../../src/siege/BlockStyle';

// loader stub: no network/DOM, returns a bare THREE.Texture per url.
const stubLoader = { load: (_url: string) => new THREE.Texture() } as unknown as THREE.TextureLoader;

function fakeManifest(): StylePackManifest {
  const surf: Record<string, any> = { 'wall.outer': {} };
  for (const s of DAMAGE_LADDER) surf['wall.outer'][s] = { albedo: `wall_outer_${s}.png` };
  return { id: 'test_v1', name: 'Test', version: 1, origin: 'synthetic',
           baseUrl: '/packs/test_v1', tilePx: 64, surfaces: surf };
}

function seg(health: number, stage: DamageStage): SegmentLike {
  return { id: 's1', health, maxHealth: 100, state: 'crumbling', damageStage: stage,
           mesh: { material: new THREE.MeshBasicMaterial() } as any };
}

function assert(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('ok  -', msg); }

const r = new StyleResolver({ loader: stubLoader });

// 1. no pack registered -> null (sim keeps its own material)
assert(r.materialFor(seg(100, 'intact'), 'outer', 'test_v1') === null, 'null when pack not loaded');

// 2. register pack -> distinct textured material per stage, all MeshStandard w/ a map
r.registerPack(fakeManifest());
const mats = new Map<DamageStage, THREE.MeshStandardMaterial>();
for (const s of DAMAGE_LADDER) {
  const m = r.materialFor(seg(50, s), 'outer', 'test_v1');
  assert(!!m && (m as any).isMeshStandardMaterial === true, `MeshStandardMaterial for stage '${s}'`);
  assert(!!m!.map, `stage '${s}' has an albedo map`);
  mats.set(s, m!);
}
assert(mats.get('intact') !== mats.get('collapsed'), 'intact and collapsed are different materials');

// 3. caching: same stage -> same material instance (no per-segment allocation)
const a = r.materialFor(seg(50, 'cracked'), 'outer', 'test_v1');
const b = r.materialFor(seg(41, 'cracked'), 'outer', 'test_v1');
assert(a === b, 'identical stage returns cached material instance');

// 4. reads damageStage, not health: two different healths, same stage -> same mat
const c = r.materialFor(seg(90, 'intact'), 'outer', 'test_v1');
const dmat = r.materialFor(seg(81, 'intact'), 'outer', 'test_v1');
assert(c === dmat, 'resolver keys on damageStage, not raw health');

// 5. unknown style id -> null
assert(r.materialFor(seg(50, 'heavy'), 'outer', 'nope_v9') === null, 'null for unowned/unknown style');

console.log('\nrenderProof: ALL PASS ✅');
