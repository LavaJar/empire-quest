/**
 * BlockStyle — runtime seam between the shipped siege destruction sim and
 * AI-generated appearance. Structure stays owned by the sim; this only skins.
 *
 * Aligned to the ACTUAL shipped model (reverse-read from the build):
 *   segment = { id, health, maxHealth, state, damageStage, mesh, size,
 *               wallFace, rubbleMesh, adjacentIds }
 *   tier name ∈ 'outer' | 'inner' | 'keep'   (passed to updateSegmentVisuals)
 *   getDamageStage(h): h>80 intact · >60 light · >40 cracked · >20 heavy ·
 *                      >0 breached · else collapsed
 *   CRUMBLE_THRESHOLD = 30
 * The resolver reads segment.damageStage directly — it does NOT recompute —
 * so it can never drift from the sim's own quantisation.
 */

import * as THREE from 'three';

export type BlockArchetype = 'wall' | 'tower' | 'gate' | 'keep' | 'bridge';
export type WallTier = 'outer' | 'inner' | 'keep';

/** The game's own six-rung ladder. Matches getDamageStage return values. */
export type DamageStage = 'intact' | 'light' | 'cracked' | 'heavy' | 'breached' | 'collapsed';

export const DAMAGE_LADDER: readonly DamageStage[] = [
  'intact', 'light', 'cracked', 'heavy', 'breached', 'collapsed',
] as const;

/** Byte-for-byte mirror of the shipped getDamageStage(absolute health). */
export function gameDamageStage(health: number): DamageStage {
  if (health > 80) return 'intact';
  if (health > 60) return 'light';
  if (health > 40) return 'cracked';
  if (health > 20) return 'heavy';
  if (health > 0)  return 'breached';
  return 'collapsed';
}

/** outer/inner curtain walls are 'wall'; the keep is its own archetype. */
export function tierToArchetype(tier: WallTier): BlockArchetype {
  return tier === 'keep' ? 'keep' : 'wall';
}

/** Minimal shape of a live segment, matching the shipped record's fields. */
export interface SegmentLike {
  id: string | number;
  health: number;
  maxHealth: number;
  state: 'intact' | 'crumbling' | 'destroyed';
  damageStage: DamageStage;
  mesh: THREE.Mesh & { material: THREE.Material | THREE.Material[] };
}

/* ------------------------- style-pack manifest ------------------------- */

export interface TextureSet { albedo: string; normal?: string; roughness?: string; emissive?: string; }
export type StageTextures = Partial<Record<DamageStage, TextureSet>>;
export type SurfaceTextures = Record<string, StageTextures>;

export interface StylePackManifest {
  id: string; name: string; version: number;
  origin: 'synthetic' | 'human' | 'hybrid';
  baseUrl: string; tilePx: number;
  surfaces: SurfaceTextures;
  integrityHash?: string;
}

export function surfaceKey(archetype: BlockArchetype, tier: WallTier): string {
  return `${archetype}.${tier}`;
}

/* ------------------------------ resolver ------------------------------ */

export interface StyleResolverOptions { anisotropy?: number; loader?: THREE.TextureLoader; }

export class StyleResolver {
  private readonly packs = new Map<string, StylePackManifest>();
  private readonly loader: THREE.TextureLoader;
  private readonly anisotropy: number;
  private readonly matCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly texCache = new Map<string, THREE.Texture>();

  constructor(opts: StyleResolverOptions = {}) {
    this.loader = opts.loader ?? new THREE.TextureLoader();
    this.anisotropy = opts.anisotropy ?? 4;
  }

  registerPack(m: StylePackManifest): void { this.packs.set(m.id, m); }
  hasPack(id: string): boolean { return this.packs.has(id); }
  loadedPacks(): string[] { return [...this.packs.keys()]; }

  /**
   * Return the textured material for a segment at its CURRENT stage in a
   * style, or null when the style/pack doesn't cover it. Null means "leave
   * the sim's own material alone" — so a missing pack degrades to today's
   * look with zero extra code. Reads segment.damageStage; never recomputes.
   */
  materialFor(
    seg: SegmentLike, tier: WallTier, styleId: string | null,
    archetype: BlockArchetype = tierToArchetype(tier),
  ): THREE.MeshStandardMaterial | null {
    const pack = styleId ? this.packs.get(styleId) : undefined;
    if (!pack) return null;
    const stage = seg.damageStage ?? gameDamageStage(seg.health);
    const key = `${pack.id}@${pack.version}|${surfaceKey(archetype, tier)}|${stage}`;
    const hit = this.matCache.get(key);
    if (hit) return hit;
    const set = this.nearestSet(pack, archetype, tier, stage);
    if (!set) return null;
    const params: THREE.MeshStandardMaterialParameters = {
      map: this.tex(pack.baseUrl, set.albedo, THREE.SRGBColorSpace),
      roughness: 0.9, metalness: 0.0,
    };
    if (set.normal) params.normalMap = this.tex(pack.baseUrl, set.normal);
    if (set.roughness) params.roughnessMap = this.tex(pack.baseUrl, set.roughness);
    const mat = new THREE.MeshStandardMaterial(params);
    if (set.emissive) {
      mat.emissiveMap = this.tex(pack.baseUrl, set.emissive, THREE.SRGBColorSpace);
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveIntensity = stage === 'collapsed' ? 0.9 : stage === 'breached' ? 0.6 : 0.4;
    }
    this.matCache.set(key, mat);
    return mat;
  }

  /** Nearest covered rung so partial packs (e.g. intact+collapsed only) still work. */
  private nearestSet(pack: StylePackManifest, a: BlockArchetype, t: WallTier, stage: DamageStage): TextureSet | null {
    const surf = pack.surfaces[surfaceKey(a, t)];
    if (!surf) return null;
    if (surf[stage]) return surf[stage]!;
    const idx = DAMAGE_LADDER.indexOf(stage);
    for (let d = 1; d < DAMAGE_LADDER.length; d++) {
      const lo = DAMAGE_LADDER[idx - d]; if (lo && surf[lo]) return surf[lo]!;
      const hi = DAMAGE_LADDER[idx + d]; if (hi && surf[hi]) return surf[hi]!;
    }
    return null;
  }

  private tex(baseUrl: string, path: string, cs?: THREE.ColorSpace): THREE.Texture {
    const url = `${baseUrl.replace(/\/$/, '')}/${path}`;
    const hit = this.texCache.get(url); if (hit) return hit;
    const t = this.loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = this.anisotropy;
    if (cs) t.colorSpace = cs;
    this.texCache.set(url, t); return t;
  }

  disposePack(styleId: string): void {
    for (const [k, m] of this.matCache) if (k.startsWith(`${styleId}@`)) { m.dispose(); this.matCache.delete(k); }
    this.packs.delete(styleId);
  }
}
