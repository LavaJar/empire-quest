import { CanvasRenderBlockDrawOptions, CanvasRenderBlockRenderer, RenderBlockDrawResult } from './CanvasRenderBlockRenderer';
import {
  RenderBlockInstanceState,
  RenderBlockManifest,
  RenderBlockValidationIssue,
  SemanticRegion,
  Vec2,
} from './RenderBlock';
import { RenderBlockRegistry } from './RenderBlockRegistry';

export interface RenderBlockFeatureLike {
  id: string;
  position: Vec2;
}

export interface RenderBlockFeatureState {
  stateKey: string;
  integrity?: number;
  azimuth?: number;
  elevation?: number;
  scale?: number;
  ownerId?: string;
  visible?: boolean;
}

export type RenderBlockStateResolver = (
  feature: RenderBlockFeatureLike,
  renderBlockId: string,
) => RenderBlockFeatureState;

/**
 * Small facade designed to be owned by MapRenderer.
 *
 * Intended integration:
 *
 *   const result = renderBlocks.tryDrawFeature(ctx, feature, cameraState);
 *   if (!result.drawn) drawFeatureProcedurally(...);
 *
 * The existing renderer therefore remains authoritative as a visual fallback
 * until each asset family passes quality/performance benchmarks.
 */
export class RenderBlockEngine {
  readonly registry: RenderBlockRegistry;
  readonly renderer: CanvasRenderBlockRenderer;

  private stateResolver: RenderBlockStateResolver = () => ({ stateKey: 'intact' });

  constructor(
    registry = new RenderBlockRegistry(),
    renderer = new CanvasRenderBlockRenderer(),
  ) {
    this.registry = registry;
    this.renderer = renderer;
  }

  registerManifest(manifest: RenderBlockManifest): RenderBlockValidationIssue[] {
    const issues = this.registry.registerManifest(manifest);
    if (!issues.some(issue => issue.severity === 'error')) {
      for (const block of manifest.blocks) this.renderer.preload(block);
    }
    return issues;
  }

  setStateResolver(resolver: RenderBlockStateResolver): void {
    this.stateResolver = resolver;
  }

  tryDrawFeature(
    ctx: CanvasRenderingContext2D,
    feature: RenderBlockFeatureLike,
    options: CanvasRenderBlockDrawOptions = {},
  ): RenderBlockDrawResult {
    const block = this.registry.getForFeature(feature.id);
    if (!block) return { drawn: false, pending: false };

    const resolved = this.stateResolver(feature, block.id);
    const stateKey = block.states.some(state => state.key === resolved.stateKey)
      ? resolved.stateKey
      : block.states[0]?.key;

    if (!stateKey) return { drawn: false, pending: false };

    const instance: RenderBlockInstanceState = {
      instanceId: `feature:${feature.id}`,
      renderBlockId: block.id,
      worldPosition: feature.position,
      stateKey,
      integrity: resolved.integrity,
      azimuth: resolved.azimuth,
      elevation: resolved.elevation,
      scale: resolved.scale,
      ownerId: resolved.ownerId,
      visible: resolved.visible,
    };

    return this.renderer.draw(ctx, block, instance, options);
  }

  pickFeatureSemanticRegion(
    feature: RenderBlockFeatureLike,
    worldPoint: Vec2,
  ): SemanticRegion | undefined {
    const block = this.registry.getForFeature(feature.id);
    if (!block) return undefined;

    const resolved = this.stateResolver(feature, block.id);
    const stateKey = block.states.some(state => state.key === resolved.stateKey)
      ? resolved.stateKey
      : block.states[0]?.key;
    if (!stateKey) return undefined;

    const instance: RenderBlockInstanceState = {
      instanceId: `feature:${feature.id}`,
      renderBlockId: block.id,
      worldPosition: feature.position,
      stateKey,
      integrity: resolved.integrity,
      azimuth: resolved.azimuth,
      elevation: resolved.elevation,
      scale: resolved.scale,
      ownerId: resolved.ownerId,
      visible: resolved.visible,
    };

    return this.renderer.pickSemanticRegion(block, instance, worldPoint);
  }
}
