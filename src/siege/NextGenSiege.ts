/**
 * NextGenSiege — the WebGPU/TSL render layer.
 *
 *  - createSiegeNodeMaterial: a WebGPU MeshStandard node material driven by the
 *    derived PBR set, with PARALLAX relief from the height map so flat block
 *    faces gain real depth (mortar sinks, bricks stand proud) without geometry.
 *  - buildFractureFragments: turns an art-conditioned FractureGraph into per-cell
 *    fragment meshes positioned on a wall face, so the sim can detach and
 *    gravity-collapse individual bricks along the joints the art defined.
 *  - pickRenderer: WebGPU when available, else a WebGL2 fallback flag so callers
 *    route to the StyleResolver's standard-material path — no hard dependency.
 *
 * GPU code paths run in the browser; this module is written against three's
 * WebGPU/TSL API and degrades to WebGL2 by capability check.
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { texture, uv, normalMap as normalMapNode, positionView, normalView, float, vec2 } from 'three/tsl';
import type { FractureGraph } from '../../tools/artforge/FractureForge';

export interface SiegePBRMaps {
  albedo: THREE.Texture;
  normal?: THREE.Texture;
  height?: THREE.Texture;
  ao?: THREE.Texture;
  roughness?: THREE.Texture;
}

/**
 * Parallax-offset UV: shift sampling along the view direction by (h-0.5)*scale,
 * so the height map displaces the apparent surface. Cheap single-step parallax;
 * upgradeable to full POM per style budget.
 */
function parallaxUv(maps: SiegePBRMaps, scale = 0.04) {
  const baseUv = uv();
  if (!maps.height) return baseUv;
  const h = texture(maps.height, baseUv).r.sub(float(0.5));
  const viewDir = positionView.normalize();
  return baseUv.add(viewDir.xy.mul(h).mul(float(scale)));
}

export function createSiegeNodeMaterial(maps: SiegePBRMaps): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial();
  const puv = parallaxUv(maps);
  mat.colorNode = texture(maps.albedo, puv);
  if (maps.roughness) mat.roughnessNode = texture(maps.roughness, puv).r;
  if (maps.ao) mat.aoNode = texture(maps.ao, puv).r;
  if (maps.normal) mat.normalNode = normalMapNode(texture(maps.normal, puv));
  mat.metalness = 0.0;
  return mat;
}

/* ------------------------ fracture graph → fragments ------------------------ */

export interface FragmentMesh {
  cellId: number;
  mesh: THREE.Mesh;
  anchor: boolean;                 // load-bearing to the base row
  neighbors: number[];            // adjacency for support propagation
}

/**
 * Lay fragment meshes across a wall face of size (faceW × faceH), one per
 * fracture cell, positioned from the graph's normalised cell centroids. Each
 * fragment is a thin box sized to its cell area; the sim reparents/drops these
 * instead of swapping a texture, so destruction follows the art's joints.
 */
export function buildFractureFragments(
  graph: FractureGraph, faceW: number, faceH: number, depth: number,
  material: THREE.Material,
): FragmentMesh[] {
  const adj = new Map<number, number[]>();
  for (const [a, b] of graph.adjacency) {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const px = graph.tilePx;
  const totalArea = graph.cells.reduce((s, c) => s + c.area, 0) || 1;
  const avgCellW = Math.sqrt((faceW * faceH) * (1 / graph.cellCount));

  return graph.cells.map(c => {
    // normalised centroid → face-local position (origin at face centre)
    const nx = c.cx / px, ny = c.cy / px;
    const x = (nx - 0.5) * faceW;
    const y = (0.5 - ny) * faceH;                 // image y-down → world y-up
    const cellFrac = c.area / totalArea;
    const w = Math.max(avgCellW * 0.6, Math.sqrt(cellFrac) * faceW);
    const h = w;
    const geo = new THREE.BoxGeometry(w, h, depth);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, 0);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.cellId = c.id;
    return { cellId: c.id, mesh, anchor: c.anchor, neighbors: adj.get(c.id) ?? [] };
  });
}

/**
 * Deterministic support solve: a fragment survives iff it has a path through
 * still-attached neighbours to an anchor (base) fragment. Same input → same
 * result on every client, so PvP stays in sync. Returns the set of cellIds that
 * should fall given a set of destroyed cells.
 */
export function computeCollapse(fragments: FragmentMesh[], destroyed: Set<number>): Set<number> {
  const byId = new Map(fragments.map(f => [f.cellId, f]));
  const supported = new Set<number>();
  const queue: number[] = [];
  for (const f of fragments) if (f.anchor && !destroyed.has(f.cellId)) { supported.add(f.cellId); queue.push(f.cellId); }
  while (queue.length) {
    const id = queue.pop()!;
    for (const n of byId.get(id)!.neighbors) {
      if (destroyed.has(n) || supported.has(n)) continue;
      supported.add(n); queue.push(n);
    }
  }
  const falling = new Set<number>();
  for (const f of fragments) if (!destroyed.has(f.cellId) && !supported.has(f.cellId)) falling.add(f.cellId);
  return falling;
}

/* ------------------------------ renderer pick ------------------------------ */

export interface RendererChoice { mode: 'webgpu' | 'webgl2'; }

export function pickRenderer(): RendererChoice {
  const hasWebGPU = typeof navigator !== 'undefined' && (navigator as any).gpu != null;
  return { mode: hasWebGPU ? 'webgpu' : 'webgl2' };
}
