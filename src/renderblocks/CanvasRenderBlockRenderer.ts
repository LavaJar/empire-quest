import {
  DirectionalRenderBlockView,
  RenderBlockDefinition,
  RenderBlockInstanceState,
  RenderBlockPassSet,
  SemanticRegion,
  Vec2,
  nearestDirectionalView,
} from './RenderBlock';

interface ImageCacheEntry {
  image?: HTMLImageElement;
  status: 'loading' | 'ready' | 'error';
}

export interface CanvasRenderBlockDrawOptions {
  /** Optional alpha multiplier for transitions/LOD blending. */
  alpha?: number;
  /** Draw authoring bounds/pivot and semantic regions. */
  debug?: boolean;
}

export interface RenderBlockDrawResult {
  drawn: boolean;
  pending: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

/**
 * Canvas 2D implementation of the first Empire Quest RenderBlock layer.
 *
 * It deliberately returns `drawn: false` when an asset is unavailable so
 * MapRenderer can fall back to the existing procedural feature renderer.
 */
export class CanvasRenderBlockRenderer {
  private readonly images = new Map<string, ImageCacheEntry>();

  preload(block: RenderBlockDefinition): void {
    for (const state of block.states) {
      if (state.passes) this.ensurePasses(state.passes);
      for (const view of state.directionalViews ?? []) this.ensurePasses(view.passes);
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    block: RenderBlockDefinition,
    instance: RenderBlockInstanceState,
    options: CanvasRenderBlockDrawOptions = {},
  ): RenderBlockDrawResult {
    if (instance.visible === false) return { drawn: false, pending: false };

    const state = block.states.find(candidate => candidate.key === instance.stateKey) ?? block.states[0];
    if (!state) return { drawn: false, pending: false };

    const directional = state.directionalViews?.length
      ? nearestDirectionalView(state.directionalViews, instance.azimuth, instance.elevation)
      : undefined;
    const passes = directional?.passes ?? state.passes;
    if (!passes) return { drawn: false, pending: false };

    const imageState = this.getImage(passes.beauty.src);
    if (imageState.status !== 'ready' || !imageState.image) {
      return { drawn: false, pending: imageState.status === 'loading' };
    }

    const image = imageState.image;
    const scale = instance.scale ?? 1;
    const width = block.spatial.width * scale;
    const height = block.spatial.height * scale;
    const x = instance.worldPosition.x - width * block.spatial.pivot.x;
    const y = instance.worldPosition.y - height * block.spatial.pivot.y;

    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, options.alpha ?? 1));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, x, y, width, height);

    if (options.debug) {
      this.drawDebug(ctx, block, { x, y, width, height });
    }
    ctx.restore();

    return { drawn: true, pending: false, bounds: { x, y, width, height } };
  }

  /**
   * Returns the semantic structural region under a world-space point.
   * Lightweight polygon picking is useful before a full semantic-ID texture
   * readback/WebGPU picking path exists.
   */
  pickSemanticRegion(
    block: RenderBlockDefinition,
    instance: RenderBlockInstanceState,
    worldPoint: Vec2,
  ): SemanticRegion | undefined {
    const scale = instance.scale ?? 1;
    const width = block.spatial.width * scale;
    const height = block.spatial.height * scale;
    const left = instance.worldPosition.x - width * block.spatial.pivot.x;
    const top = instance.worldPosition.y - height * block.spatial.pivot.y;

    if (worldPoint.x < left || worldPoint.x > left + width || worldPoint.y < top || worldPoint.y > top + height) {
      return undefined;
    }

    const normalized = {
      x: (worldPoint.x - left) / width,
      y: (worldPoint.y - top) / height,
    };

    const regions = block.structural?.semanticRegions ?? [];
    // Iterate backwards so later-authored regions can override broad regions.
    for (let index = regions.length - 1; index >= 0; index--) {
      const region = regions[index];
      if (!region.polygon?.length) continue;
      if (this.pointInPolygon(normalized, region.polygon)) return region;
    }
    return undefined;
  }

  isReady(src: string): boolean {
    return this.images.get(src)?.status === 'ready';
  }

  clearCache(): void {
    this.images.clear();
  }

  private ensurePasses(passes: RenderBlockPassSet): void {
    // Beauty is required to draw. Companion passes are deliberately queued as
    // image resources too so the cache contract is ready for semantic/depth use.
    const refs = [
      passes.beauty,
      passes.alpha,
      passes.depth,
      passes.normal,
      passes.materialId,
      passes.semanticId,
      passes.damageMask,
      passes.occlusion,
    ];
    for (const ref of refs) if (ref) this.getImage(ref.src);
  }

  private getImage(src: string): ImageCacheEntry {
    const existing = this.images.get(src);
    if (existing) return existing;

    const entry: ImageCacheEntry = { status: 'loading' };
    this.images.set(src, entry);

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      entry.image = image;
      entry.status = 'ready';
    };
    image.onerror = () => {
      entry.status = 'error';
    };
    image.src = src;
    return entry;
  }

  private drawDebug(
    ctx: CanvasRenderingContext2D,
    block: RenderBlockDefinition,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.9)';
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

    const pivotX = bounds.x + bounds.width * block.spatial.pivot.x;
    const pivotY = bounds.y + bounds.height * block.spatial.pivot.y;
    ctx.fillStyle = 'rgba(255, 255, 0, 0.95)';
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, 2, 0, Math.PI * 2);
    ctx.fill();

    for (const region of block.structural?.semanticRegions ?? []) {
      if (!region.polygon?.length) continue;
      ctx.beginPath();
      region.polygon.forEach((point, index) => {
        const x = bounds.x + point.x * bounds.width;
        const y = bounds.y + point.y * bounds.height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255, 128, 0, 0.8)';
      ctx.stroke();
    }
    ctx.restore();
  }

  private pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      const intersects =
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }
}
