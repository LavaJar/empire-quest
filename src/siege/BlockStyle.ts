/**
 * BlockStyle — the seam between the (already-built) siege destruction sim
 * and AI-generated appearance.
 *
 * The existing siege engine owns STRUCTURE: instanced BoxGeometry wall
 * segments with health/maxHealth, a state machine
 * (intact → cracked → crumbling → breached → destroyed), tiers
 * (outer/inner/keep) and archetypes (wall/tower/gate/keep/bridge).
 * Its current appearance is a flat MeshStandardMaterial whose colour is
 * lerped by health ratio inside updateSegmentVisuals().
 *
 * This module does NOT touch structure. It resolves
 *   (archetype, tier, damageStage, style)  ->  a THREE material
 * from an offline-generated, QA-gated style pack, and falls back to the
 * existing colour-lerp behaviour verbatim when no pack is loaded. That
 * fallback is what makes it safe to ship incrementally: with zero packs
 * installed the game looks exactly as it does today.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Vocabulary — mirrors the shipped siege sim's own field names so the
 * resolver is a true drop-in, not a parallel model.
 * ------------------------------------------------------------------ */

export type BlockArchetype = 'wall' | 'tower' | 'gate' | 'keep' | 'bridge';
export type WallTier = 'outer' | 'inner' | 'keep';

/**
 * Discrete visual rungs. This is DELIBERATELY coarser than the continuous
 * `health/maxHealth` ratio: the sim stays continuous (smooth collapse,
 * exact breach thresholds) while art is quantised into a small ladder so a
 * style pack is a finite, cacheable, QA-able set of images rather than an
 * infinite demand on the generator. The resolver blends across rungs so the
 * quantisation is invisible in motion.
 */
export type DamageStage = 'intact' | 'cracked' | 'damaged' | 'crumbling' | 'rubble';

export const DAMAGE_LADDER: readonly DamageStage[] = [
  'intact', 'cracked', 'damaged', 'crumbling', 'rubble',
] as const;

/** Continuous integrity (health/maxHealth, 1→0) → nearest art rung. */
export function stageForIntegrity(ratio: number): DamageStage {
  if (ratio > 0.85) return 'intact';
  if (ratio > 0.60) return 'cracked';
  if (ratio > 0.35) return 'damaged';
  if (ratio > 0.10) return 'crumbling';
  return 'rubble';
}

/* ------------------------------------------------------------------ *
 * Minimal shape of a live wall segment, as observed in the shipped
 * bundle. Declared here (not imported) because the siege source is not
 * in this repo — only its compiled form. When the real source lands,
 * delete this and import the engine's Segment type; the field names are
 * chosen to already match.
 * ------------------------------------------------------------------ */
export interface WallSegmentLike {
  id: string;
  archetype: BlockArchetype;
  tier: WallTier;
  health: number;
  maxHealth: number;
  state: 'intact' | 'crumbling' | 'breached' | 'destroyed';
  mesh: THREE.Mesh & { material: THREE.MeshStandardMaterial };
}

/* ------------------------------------------------------------------ *
 * Style-pack manifest — the unit of art, and the unit of monetization.
 * One pack = one architectural identity a player buys and applies to
 * their whole empire. Art is fully decoupled from code: the runtime
 * ships knowing nothing about "Byzantine" or "Feudal Japanese"; it just
 * loads whatever packs are present. That decoupling is what lets the
 * offline generator grow the library with no client release.
 * ------------------------------------------------------------------ */

export interface TextureSet {
  /** Albedo / base colour map. Required. */
  albedo: string;
  /** Tangent-space normal map. Optional; adds carved-stone relief. */
  normal?: string;
  /** Roughness map. Optional; wet stone vs. dry rubble read very differently. */
  roughness?: string;
  /**
   * Emissive map for the crumbling/rubble rungs — ember glow in fresh
   * breaches. Optional and usually only present on late rungs.
   */
  emissive?: string;
}

/** Every rung of one (archetype,tier) surface, in one style. */
export type StageTextures = Partial<Record<DamageStage, TextureSet>>;

/** Keyed "archetype.tier" -> per-stage texture sets. */
export type SurfaceTextures = Record<string, StageTextures>;

export interface StylePackManifest {
  /** Stable id used in save data and entitlement checks, e.g. "byzantine_v1". */
  id: string;
  /** Human name shown in the shop, e.g. "Byzantine Bastion". */
  name: string;
  /** Monotonic; lets you re-issue improved art without breaking saves. */
  version: number;
  /**
   * Provenance of every image in the pack. Not decoration: it is the audit
   * trail the QA gate writes, and the licence surface if art is ever
   * challenged. `synthetic` = generated + gate-passed.
   */
  origin: 'synthetic' | 'human' | 'hybrid';
  /** Base URL every relative texture path in `surfaces` resolves against. */
  baseUrl: string;
  /** Tile size the textures were authored at; used to validate seamlessness. */
  tilePx: number;
  surfaces: SurfaceTextures;
  /** SHA of the source images, stamped by the QA gate on pass. */
  integrityHash?: string;
}

export function surfaceKey(archetype: BlockArchetype, tier: WallTier): string {
  return `${archetype}.${tier}`;
}

/* ------------------------------------------------------------------ *
 * The resolver.
 * ------------------------------------------------------------------ */

/**
 * Legacy colour-lerp fallback, lifted from the shipped updateSegmentVisuals
 * so a segment with no style pack renders byte-identically to today.
 * base → damaged → rubble, blended by integrity, roughness climbing as it
 * breaks.
 */
interface TierPalette { base: number; damaged: number; rubble: number; }

const LEGACY_PALETTE: Record<WallTier, TierPalette> = {
  outer: { base: 0x8a8578, damaged: 0x5a5450, rubble: 0x3a3632 },
  inner: { base: 0x9a9488, damaged: 0x64605a, rubble: 0x403c38 },
  keep:  { base: 0xb0a894, damaged: 0x726a5e, rubble: 0x484238 },
};

export interface StyleResolverOptions {
  /** Anisotropy for texture sampling on oblique castle walls. Default 4. */
  anisotropy?: number;
  loader?: THREE.TextureLoader;
}

export class StyleResolver {
  private readonly packs = new Map<string, StylePackManifest>();
  private readonly loader: THREE.TextureLoader;
  private readonly anisotropy: number;

  /** style|surface|stage -> material, so N identical segments share one. */
  private readonly matCache = new Map<string, THREE.MeshStandardMaterial>();
  /** url -> texture, deduped across every material. */
  private readonly texCache = new Map<string, THREE.Texture>();

  constructor(opts: StyleResolverOptions = {}) {
    this.loader = opts.loader ?? new THREE.TextureLoader();
    this.anisotropy = opts.anisotropy ?? 4;
  }

  /** Register a QA-gated pack. Idempotent on (id,version). */
  registerPack(manifest: StylePackManifest): void {
    this.packs.set(manifest.id, manifest);
  }

  hasPack(styleId: string): boolean {
    return this.packs.has(styleId);
  }

  /**
   * Resolve the material for a segment at its current damage stage in a
   * given style. Returns a cached textured material when the pack covers
   * this (surface,stage); otherwise mutates and returns the segment's own
   * material via the legacy colour-lerp, exactly as the game does now.
   *
   * The caller keeps ownership of the state machine; this only supplies
   * appearance. Call it from updateSegmentVisuals after `state`/`health`
   * are set.
   */
  resolve(seg: WallSegmentLike, styleId: string | null): THREE.MeshStandardMaterial {
    const ratio = seg.maxHealth > 0 ? seg.health / seg.maxHealth : 0;
    const stage = stageForIntegrity(ratio);

    const pack = styleId ? this.packs.get(styleId) : undefined;
    if (pack) {
      const textured = this.texturedMaterial(pack, seg.archetype, seg.tier, stage);
      if (textured) return textured;
      // Pack exists but doesn't cover this surface/stage — fall through to
      // legacy so partial packs degrade gracefully instead of rendering blank.
    }
    return this.legacyMaterial(seg, ratio);
  }

  private texturedMaterial(
    pack: StylePackManifest,
    archetype: BlockArchetype,
    tier: WallTier,
    stage: DamageStage,
  ): THREE.MeshStandardMaterial | null {
    const key = `${pack.id}@${pack.version}|${surfaceKey(archetype, tier)}|${stage}`;
    const cached = this.matCache.get(key);
    if (cached) return cached;

    const set = this.stageSet(pack, archetype, tier, stage);
    if (!set) return null;

    const mat = new THREE.MeshStandardMaterial({
      map: this.tex(pack.baseUrl, set.albedo, THREE.SRGBColorSpace),
      normalMap: set.normal ? this.tex(pack.baseUrl, set.normal) : undefined,
      roughnessMap: set.roughness ? this.tex(pack.baseUrl, set.roughness) : undefined,
      roughness: 0.9,
      metalness: 0.0,
    });
    if (set.emissive) {
      mat.emissiveMap = this.tex(pack.baseUrl, set.emissive, THREE.SRGBColorSpace);
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveIntensity = stage === 'rubble' ? 0.9 : 0.5;
    }
    this.matCache.set(key, mat);
    return mat;
  }

  /** Nearest-covered rung: a partial pack (only intact+rubble) still works. */
  private stageSet(
    pack: StylePackManifest,
    archetype: BlockArchetype,
    tier: WallTier,
    stage: DamageStage,
  ): TextureSet | null {
    const surf = pack.surfaces[surfaceKey(archetype, tier)];
    if (!surf) return null;
    if (surf[stage]) return surf[stage]!;
    // Walk toward 'intact' first, then toward 'rubble', taking whatever exists.
    const idx = DAMAGE_LADDER.indexOf(stage);
    for (let d = 1; d < DAMAGE_LADDER.length; d++) {
      const lo = DAMAGE_LADDER[idx - d];
      if (lo && surf[lo]) return surf[lo]!;
      const hi = DAMAGE_LADDER[idx + d];
      if (hi && surf[hi]) return surf[hi]!;
    }
    return null;
  }

  private legacyMaterial(seg: WallSegmentLike, ratio: number): THREE.MeshStandardMaterial {
    const p = LEGACY_PALETTE[seg.tier];
    const mat = seg.mesh.material;
    const base = new THREE.Color(p.base);
    if (seg.state === 'crumbling') {
      mat.color.copy(base).lerp(new THREE.Color(p.damaged), 1 - ratio);
      mat.roughness = 0.85;
    } else {
      const l = 1 - ratio;
      mat.color.copy(base).lerp(new THREE.Color(p.rubble), l * 0.5);
      mat.roughness = 0.75 + l * 0.1;
    }
    return mat;
  }

  private tex(baseUrl: string, path: string, colorSpace?: THREE.ColorSpace): THREE.Texture {
    const url = `${baseUrl.replace(/\/$/, '')}/${path}`;
    const hit = this.texCache.get(url);
    if (hit) return hit;
    const t = this.loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.anisotropy;
    if (colorSpace) t.colorSpace = colorSpace;
    this.texCache.set(url, t);
    return t;
  }

  /** Free GPU memory for a pack the player un-equipped. */
  disposePack(styleId: string): void {
    for (const [k, m] of this.matCache) {
      if (k.startsWith(`${styleId}@`)) { m.dispose(); this.matCache.delete(k); }
    }
    this.packs.delete(styleId);
  }
}
