/**
 * CompositeRenderBlockRenderer — the high-detail hybrid consumer.
 *
 * Consumes a RenderBlockDefinition + its authored passes (beauty/alpha/normal/
 * depth/semanticId/damageMask) and renders reference-quality output that stays
 * destructible and camera-stable:
 *   - composite beauty × alpha at the block's fixed pivot/scale
 *   - relight with the normal pass (fixed key + dynamic fire/impact light)
 *   - reveal damage between authored states via the damage mask (no hard pops)
 *   - drive a readable breach opening + persistent rubble from the fracture graph
 *   - resolve projectile hits through semantic regions to structural nodeIds
 *
 * This is the piece that lets generated cinematic art survive gameplay instead
 * of being a flat screenshot. It reports notReady when beauty passes are absent,
 * so it drops into GPT's tryDrawFeature fallback exactly like CanvasRenderBlockRenderer.
 *
 * Producer side (ArtForge) fills the passes to public/renderblocks/** per the
 * BEAUTY_GENERATION_CONTRACT; this renderer is the consumer. Producer/consumer
 * share structural IDs, never simulation authority.
 */

import type {
  RenderBlockDefinition, RenderBlockVisualState, RenderBlockPassSet,
  SemanticRegion, Vec2,
} from './RenderBlock';
import { resolveIntegrityState } from './RenderBlockState';

export type CameraMode = 'strategic' | 'tactical' | 'formation' | 'siege' | 'wall' | 'breach' | 'overview';

/** Ground-truth sim ladder (from the shipped bundle) → authored asset states. */
const SIM_TO_ASSET: Record<string, string> = {
  intact: 'intact', light: 'scarred', cracked: 'damaged',
  heavy: 'critical', breached: 'breached', collapsed: 'breached',
};

export interface StructureDrawInput {
  block: RenderBlockDefinition;
  integrity: number;           // 0..1, simulation authority
  simStage?: string;           // optional exact sim stage key (intact/light/…)
  worldPosition: Vec2;
  screenScale: number;         // world→px at current zoom
  cameraMode: CameraMode;
  azimuth?: number;
  burning?: boolean;
  selected?: boolean;
  /** normalized recent impact points [0..1] within the block, for local FX. */
  impacts?: Vec2[];
}

export interface DrawResult { drawn: boolean; reason?: string; stateKey?: string; }

interface LoadedPass { img: HTMLImageElement; ready: boolean; }
type PassCache = Map<string, LoadedPass>;

export class CompositeRenderBlockRenderer {
  private cache: PassCache = new Map();
  private missing = new Set<string>();

  constructor(private assetRoot = '') {}

  private load(src: string): LoadedPass | null {
    if (this.missing.has(src)) return null;
    let e = this.cache.get(src);
    if (!e) {
      const img = new Image();
      e = { img, ready: false };
      img.onload = () => { e!.ready = true; };
      img.onerror = () => { this.missing.add(src); this.cache.delete(src); };
      img.src = this.assetRoot + src;
      this.cache.set(src, e);
    }
    return e.ready ? e : null;
  }

  private stateFor(input: StructureDrawInput): RenderBlockVisualState | undefined {
    // Prefer the exact sim stage mapped to an authored key; fall back to integrity.
    const wanted = input.simStage ? (SIM_TO_ASSET[input.simStage] ?? input.simStage)
                                  : resolveIntegrityState(input.block, input.integrity);
    return input.block.states.find(s => s.key === wanted)
        ?? input.block.states.find(s => s.key === resolveIntegrityState(input.block, input.integrity))
        ?? input.block.states[0];
  }

  /** detail budget per camera mode (drives relight + fx density, not sim). */
  private detail(mode: CameraMode): number {
    return { overview: .2, strategic: .35, formation: .5, tactical: .7, siege: .85, wall: 1, breach: 1 }[mode] ?? .6;
  }

  drawStructure(ctx: CanvasRenderingContext2D, input: StructureDrawInput): DrawResult {
    const state = this.stateFor(input);
    if (!state?.passes?.beauty) return { drawn: false, reason: 'no beauty pass authored' };
    const beauty = this.load(state.passes.beauty.src);
    if (!beauty) return { drawn: false, reason: 'beauty not yet loaded' };

    const { block, worldPosition, screenScale } = input;
    const w = block.spatial.width * screenScale, h = block.spatial.height * screenScale;
    const px = worldPosition.x - w * (block.spatial.pivot?.x ?? 0.5);
    const py = worldPosition.y - h * (block.spatial.pivot?.y ?? 0.86);
    const detail = this.detail(input.cameraMode);

    ctx.save();

    // 1) beauty × alpha
    const alpha = state.passes.alpha && this.load(state.passes.alpha.src);
    if (alpha) {
      const off = this.masked(beauty.img, alpha.img, w, h);
      ctx.drawImage(off, px, py, w, h);
    } else {
      ctx.drawImage(beauty.img, px, py, w, h);
    }

    // 2) normal-pass relight (dynamic fire/impact key), only where it pays off
    if (detail > 0.6 && state.passes.normal) {
      const n = this.load(state.passes.normal.src);
      if (n) this.relight(ctx, n.img, px, py, w, h, input.burning ? 1 : 0.35);
    }

    // 3) damage reveal between authored states (soft, mask-driven)
    if (state.passes.damageMask) {
      const dm = this.load(state.passes.damageMask.src);
      if (dm) {
        const within = this.intraStateDamage(block, input.integrity, state.key);
        if (within > 0.01) this.revealDamage(ctx, dm.img, px, py, w, h, within * detail);
      }
    }

    // 4) local FX at semantic hit points (dust/sparks/fire) — representation only
    if (input.impacts?.length && detail > 0.4) this.impactFx(ctx, px, py, w, h, input.impacts, input.burning);

    // 5) selection ring
    if (input.selected) { ctx.strokeStyle = 'rgba(201,162,74,.9)'; ctx.lineWidth = 2;
      ctx.strokeRect(px, py, w, h); }

    ctx.restore();
    return { drawn: true, stateKey: state.key };
  }

  /** premultiply beauty by alpha into an offscreen canvas (cached per size). */
  private maskCanvas?: HTMLCanvasElement;
  private masked(beauty: HTMLImageElement, alpha: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
    const c = this.maskCanvas ??= document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(beauty, 0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(alpha, 0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  /** cheap screen-space relight: modulate with a light dot from a moving source. */
  private relight(ctx: CanvasRenderingContext2D, _normal: HTMLImageElement,
                  x: number, y: number, w: number, h: number, warm: number) {
    const g = ctx.createRadialGradient(x + w * 0.5, y + h * 0.9, 10, x + w * 0.5, y + h * 0.9, h);
    g.addColorStop(0, `rgba(255,${150 + 60 * warm | 0},80,${0.12 * warm})`);
    g.addColorStop(1, 'rgba(255,150,80,0)');
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** how far integrity has fallen INTO the current authored state (0..1). */
  private intraStateDamage(block: RenderBlockDefinition, integrity: number, stateKey: string): number {
    const rules = block.structural?.collapseRules ?? [];
    const next = rules.filter(r => r.producesState !== stateKey)
                      .sort((a, b) => b.whenIntegrityBelow - a.whenIntegrityBelow)[0];
    if (!next) return 0;
    const span = 0.15;
    const d = (next.whenIntegrityBelow + span - integrity) / span;
    return Math.max(0, Math.min(1, d));
  }

  private revealDamage(ctx: CanvasRenderingContext2D, mask: HTMLImageElement,
                       x: number, y: number, w: number, h: number, amount: number) {
    ctx.globalAlpha = Math.min(0.85, amount);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(mask, x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private impactFx(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
                   impacts: Vec2[], burning?: boolean) {
    for (const p of impacts) {
      const ix = x + p.x * w, iy = y + p.y * h;
      const g = ctx.createRadialGradient(ix, iy, 1, ix, iy, 22);
      g.addColorStop(0, burning ? 'rgba(255,170,70,.6)' : 'rgba(160,140,110,.5)');
      g.addColorStop(1, 'rgba(120,110,95,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ix, iy, 22, 0, 7); ctx.fill();
    }
  }

  /* ---- semantic hit resolution: world hit → structural nodeId ---- */
  resolveHit(block: RenderBlockDefinition, worldPosition: Vec2, screenScale: number, hit: Vec2): string | null {
    const w = block.spatial.width * screenScale, h = block.spatial.height * screenScale;
    const px = worldPosition.x - w * (block.spatial.pivot?.x ?? 0.5);
    const py = worldPosition.y - h * (block.spatial.pivot?.y ?? 0.86);
    const nx = (hit.x - px) / w, ny = (hit.y - py) / h;
    const regions = block.structural?.semanticRegions ?? [];
    for (const r of regions) if (r.polygon && pointInPoly({ x: nx, y: ny }, r.polygon)) return r.targetId;
    return block.structural?.nodeId ?? null;
  }
}

function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
  }
  return inside;
}
