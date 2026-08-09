/**
 * SiegeStyleAdapter — wires the StyleResolver into the SHIPPED siege renderer
 * without touching its (compiled) source.
 *
 * The renderer already calls updateSegmentVisuals(segment, tierName) whenever a
 * segment takes damage. This adapter monkey-patches that method on the live
 * instance: it runs the original (so nothing regresses), then, if the castle
 * has a style equipped and the resolver covers this surface+stage, swaps in the
 * textured material. Remove the adapter and the game is byte-identical to today.
 *
 * When the real siege source lands, delete the patch and inline one call — the
 * SOURCE_HOOK constant below is the exact edit.
 */

import * as THREE from 'three';
import {
  StyleResolver, StylePackManifest, SegmentLike, WallTier, BlockArchetype, tierToArchetype,
} from './BlockStyle';

/** The one-line edit for when updateSegmentVisuals is editable in source. */
export const SOURCE_HOOK = `
// end of updateSegmentVisuals(segment, tierName), after the colour-lerp:
const _m = styleAdapter.resolver.materialFor(segment, tierName, styleAdapter.styleFor(this /*castleId*/));
if (_m) segment.mesh.material = _m;
`;

/* --------------------------- entitlement / equip --------------------------- */

/**
 * Owns which packs a player has bought (entitlements) and which is equipped,
 * globally or per-castle. This is the monetization state: equip is free to the
 * player only for owned packs; the shop grants entitlements.
 */
export class StyleEquipment {
  private owned = new Set<string>();
  private globalStyle: string | null = null;
  private perCastle = new Map<string, string>();

  grant(styleId: string): void { this.owned.add(styleId); }
  revoke(styleId: string): void {
    this.owned.delete(styleId);
    if (this.globalStyle === styleId) this.globalStyle = null;
    for (const [c, s] of this.perCastle) if (s === styleId) this.perCastle.delete(c);
  }
  owns(styleId: string): boolean { return this.owned.has(styleId); }
  ownedList(): string[] { return [...this.owned]; }

  /** Equip globally (default look for the empire). Rejected if not owned. */
  equipGlobal(styleId: string | null): boolean {
    if (styleId && !this.owned.has(styleId)) return false;
    this.globalStyle = styleId; return true;
  }
  /** Equip on one castle (e.g. a conquered capital shown in your siege style). */
  equipCastle(castleId: string, styleId: string | null): boolean {
    if (styleId && !this.owned.has(styleId)) return false;
    if (styleId) this.perCastle.set(castleId, styleId); else this.perCastle.delete(castleId);
    return true;
  }
  /** Resolved active style for a castle: per-castle override, else global. */
  activeFor(castleId: string | null): string | null {
    if (castleId && this.perCastle.has(castleId)) return this.perCastle.get(castleId)!;
    return this.globalStyle;
  }

  toJSON() { return { owned: [...this.owned], globalStyle: this.globalStyle, perCastle: [...this.perCastle] }; }
  static fromJSON(o: ReturnType<StyleEquipment['toJSON']>): StyleEquipment {
    const e = new StyleEquipment();
    o.owned.forEach(s => e.owned.add(s));
    e.globalStyle = o.globalStyle;
    o.perCastle.forEach(([c, s]) => e.perCastle.set(c, s));
    return e;
  }
}

/* ------------------------------ pack loader ------------------------------ */

export async function loadStylePack(baseUrl: string, resolver: StyleResolver): Promise<StylePackManifest> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/manifest.json`);
  if (!res.ok) throw new Error(`style pack ${baseUrl}: HTTP ${res.status}`);
  const manifest = await res.json() as StylePackManifest;
  if (!manifest.baseUrl) manifest.baseUrl = baseUrl;
  resolver.registerPack(manifest);
  return manifest;
}

/* -------------------------------- adapter -------------------------------- */

/** Minimal view of the shipped renderer the adapter needs. */
interface SiegeRendererLike {
  updateSegmentVisuals(segment: SegmentLike, tierName: WallTier): void;
  // castles keyed by id, each exposing which is "current" for equip lookup.
  currentCastleId?: string;
}

export class SiegeStyleAdapter {
  readonly resolver: StyleResolver;
  readonly equipment: StyleEquipment;
  private detach: (() => void) | null = null;

  constructor(resolver = new StyleResolver(), equipment = new StyleEquipment()) {
    this.resolver = resolver; this.equipment = equipment;
  }

  styleFor(castleId: string | null): string | null { return this.equipment.activeFor(castleId); }

  /**
   * Patch a live renderer instance. Returns a detach fn that restores the
   * original method. archetypeOf lets callers route gates/bridges/towers to the
   * right surface; defaults to tier→wall/keep.
   */
  attach(
    renderer: SiegeRendererLike,
    opts: { castleIdOf?: (r: SiegeRendererLike, seg: SegmentLike) => string | null;
            archetypeOf?: (tier: WallTier, seg: SegmentLike) => BlockArchetype } = {},
  ): () => void {
    const original = renderer.updateSegmentVisuals.bind(renderer);
    const self = this;
    const castleIdOf = opts.castleIdOf ?? ((r) => r.currentCastleId ?? null);
    const archetypeOf = opts.archetypeOf ?? ((tier) => tierToArchetype(tier));

    renderer.updateSegmentVisuals = function (segment: SegmentLike, tierName: WallTier) {
      original(segment, tierName);                       // keep sim behaviour
      const styleId = self.equipment.activeFor(castleIdOf(renderer, segment));
      if (!styleId) return;
      const mat = self.resolver.materialFor(segment, tierName, styleId, archetypeOf(tierName, segment));
      if (mat) segment.mesh.material = mat;              // skin only when covered
    };
    this.detach = () => { renderer.updateSegmentVisuals = original; };
    return this.detach;
  }

  dispose(): void { this.detach?.(); this.detach = null; }
}
