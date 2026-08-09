import { RenderBlockDefinition, SemanticRegion, Vec2 } from './RenderBlock';
import { RenderBlockRegistry } from './RenderBlockRegistry';
import { resolveIntegrityState } from './RenderBlockState';

/** Existing Battle Theater camera modes exposed by the Northwell UI. */
export type BattleCameraMode =
  | 'strategic'
  | 'tactical'
  | 'formation'
  | 'siege'
  | 'wall'
  | 'breach'
  | 'overview';

/**
 * Representation kinds are intentionally renderer-agnostic. The current
 * Battle Theater can map these decisions to Three/WebGL today and a future
 * WebGPU renderer later without changing the simulation contract.
 */
export type BattleRepresentationKind =
  | 'marker'
  | 'sprite'
  | 'directional-impostor'
  | 'depth-card'
  | 'mesh-proxy'
  | 'instanced-agents'
  | 'high-detail-hybrid';

export interface BattleCameraPolicy {
  mode: BattleCameraMode;
  structureRepresentation: BattleRepresentationKind;
  formationRepresentation: BattleRepresentationKind;
  terrainDetailTier: 0 | 1 | 2 | 3;
  structureDetailTier: 0 | 1 | 2 | 3;
  visibleAgentBudget: number;
  dynamicDebrisBudget: number;
  particleBudget: number;
  /** Preferred fraction of viewport occupied by the selected structure. */
  selectedStructureScreenFraction?: { min: number; max: number };
}

export interface BattleStructureInput {
  /** Strategic structural node identity; never a visual-only ID. */
  nodeId: string;
  renderBlockId: string;
  integrity: number;
  worldPosition: Vec2;
  passable: boolean;
  burning?: boolean;
  selected?: boolean;
  distanceToCamera?: number;
  azimuth?: number;
  elevation?: number;
}

export interface BattleStructureDecision {
  nodeId: string;
  renderBlockId: string;
  stateKey: string;
  representation: BattleRepresentationKind;
  detailTier: 0 | 1 | 2 | 3;
  worldPosition: Vec2;
  passable: boolean;
  burning: boolean;
  selected: boolean;
  azimuth: number;
  elevation: number;
  semanticRegions: SemanticRegion[];
  collisionProxy: RenderBlockDefinition['spatial']['collisionProxy'];
  navProxy: RenderBlockDefinition['spatial']['navProxy'];
}

export interface BattleFormationInput {
  formationId: string;
  renderBlockId?: string;
  strategicCount: number;
  worldPosition: Vec2;
  distanceToCamera?: number;
  selected?: boolean;
  stateKey?: string;
}

export interface BattleFormationDecision {
  formationId: string;
  renderBlockId?: string;
  strategicCount: number;
  /** Rendering budget only. It never changes strategic troop count. */
  visibleAgentCount: number;
  representation: BattleRepresentationKind;
  detailTier: 0 | 1 | 2 | 3;
  worldPosition: Vec2;
  selected: boolean;
  stateKey: string;
}

export interface BattleSemanticHit {
  nodeId: string;
  regionId: string;
  targetId: string;
  material?: string;
}

export const DEFAULT_BATTLE_CAMERA_POLICIES: Record<BattleCameraMode, BattleCameraPolicy> = {
  strategic: {
    mode: 'strategic',
    structureRepresentation: 'depth-card',
    formationRepresentation: 'directional-impostor',
    terrainDetailTier: 1,
    structureDetailTier: 1,
    visibleAgentBudget: 120,
    dynamicDebrisBudget: 24,
    particleBudget: 220,
  },
  tactical: {
    mode: 'tactical',
    structureRepresentation: 'high-detail-hybrid',
    formationRepresentation: 'instanced-agents',
    terrainDetailTier: 2,
    structureDetailTier: 2,
    visibleAgentBudget: 240,
    dynamicDebrisBudget: 80,
    particleBudget: 500,
  },
  formation: {
    mode: 'formation',
    structureRepresentation: 'depth-card',
    formationRepresentation: 'instanced-agents',
    terrainDetailTier: 2,
    structureDetailTier: 1,
    visibleAgentBudget: 320,
    dynamicDebrisBudget: 40,
    particleBudget: 320,
  },
  siege: {
    mode: 'siege',
    structureRepresentation: 'high-detail-hybrid',
    formationRepresentation: 'instanced-agents',
    terrainDetailTier: 2,
    structureDetailTier: 3,
    visibleAgentBudget: 220,
    dynamicDebrisBudget: 140,
    particleBudget: 800,
    selectedStructureScreenFraction: { min: 0.24, max: 0.55 },
  },
  wall: {
    mode: 'wall',
    structureRepresentation: 'high-detail-hybrid',
    formationRepresentation: 'instanced-agents',
    terrainDetailTier: 3,
    structureDetailTier: 3,
    visibleAgentBudget: 140,
    dynamicDebrisBudget: 220,
    particleBudget: 1000,
    selectedStructureScreenFraction: { min: 0.36, max: 0.72 },
  },
  breach: {
    mode: 'breach',
    structureRepresentation: 'high-detail-hybrid',
    formationRepresentation: 'instanced-agents',
    terrainDetailTier: 3,
    structureDetailTier: 3,
    visibleAgentBudget: 190,
    dynamicDebrisBudget: 260,
    particleBudget: 1200,
    selectedStructureScreenFraction: { min: 0.42, max: 0.78 },
  },
  overview: {
    mode: 'overview',
    structureRepresentation: 'directional-impostor',
    formationRepresentation: 'directional-impostor',
    terrainDetailTier: 1,
    structureDetailTier: 1,
    visibleAgentBudget: 90,
    dynamicDebrisBudget: 20,
    particleBudget: 180,
  },
};

/**
 * Converts authoritative Battle Theater state into render decisions.
 *
 * This adapter deliberately does not own HP, troop counts, passability, or
 * battle resolution. It only selects representations for the state supplied
 * by the simulation.
 */
export class BattleRenderBlockAdapter {
  private cameraMode: BattleCameraMode = 'strategic';

  constructor(
    private readonly registry: RenderBlockRegistry,
    private readonly policies = DEFAULT_BATTLE_CAMERA_POLICIES,
  ) {}

  setCameraMode(mode: BattleCameraMode): void {
    this.cameraMode = mode;
  }

  getCameraMode(): BattleCameraMode {
    return this.cameraMode;
  }

  getPolicy(mode = this.cameraMode): BattleCameraPolicy {
    return this.policies[mode];
  }

  resolveStructure(input: BattleStructureInput): BattleStructureDecision | undefined {
    const block = this.registry.get(input.renderBlockId);
    if (!block) return undefined;

    const policy = this.getPolicy();
    return {
      nodeId: input.nodeId,
      renderBlockId: input.renderBlockId,
      stateKey: resolveIntegrityState(block, input.integrity),
      representation: this.structureRepresentationForDistance(policy, input.distanceToCamera),
      detailTier: policy.structureDetailTier,
      worldPosition: input.worldPosition,
      passable: input.passable,
      burning: input.burning ?? false,
      selected: input.selected ?? false,
      azimuth: input.azimuth ?? 0,
      elevation: input.elevation ?? 0,
      semanticRegions: block.structural?.semanticRegions ?? [],
      collisionProxy: block.spatial.collisionProxy,
      navProxy: block.spatial.navProxy,
    };
  }

  resolveFormation(input: BattleFormationInput): BattleFormationDecision {
    const policy = this.getPolicy();
    const distanceFactor = this.distanceBudgetFactor(input.distanceToCamera);
    const selectedFactor = input.selected ? 1.18 : 1;
    const visibleAgentCount = Math.max(
      1,
      Math.min(
        input.strategicCount,
        Math.round(policy.visibleAgentBudget * distanceFactor * selectedFactor),
      ),
    );

    return {
      formationId: input.formationId,
      renderBlockId: input.renderBlockId,
      strategicCount: input.strategicCount,
      visibleAgentCount,
      representation: policy.formationRepresentation,
      detailTier: policy.terrainDetailTier,
      worldPosition: input.worldPosition,
      selected: input.selected ?? false,
      stateKey: input.stateKey ?? 'ready',
    };
  }

  /** Resolve a hit against a structural block without inventing battle HP. */
  resolveSemanticHit(renderBlockId: string, normalizedPoint: Vec2): BattleSemanticHit | undefined {
    const block = this.registry.get(renderBlockId);
    if (!block?.structural) return undefined;

    const regions = block.structural.semanticRegions ?? [];
    for (let index = regions.length - 1; index >= 0; index--) {
      const region = regions[index];
      if (!region.polygon?.length) continue;
      if (this.pointInPolygon(normalizedPoint, region.polygon)) {
        return {
          nodeId: block.structural.nodeId,
          regionId: region.id,
          targetId: region.targetId,
          material: region.material,
        };
      }
    }
    return undefined;
  }

  private structureRepresentationForDistance(
    policy: BattleCameraPolicy,
    distance?: number,
  ): BattleRepresentationKind {
    if (distance == null) return policy.structureRepresentation;
    if (distance > 1300) return 'directional-impostor';
    if (distance > 650 && policy.structureDetailTier < 3) return 'depth-card';
    if (distance < 220 && policy.structureDetailTier === 3) return 'high-detail-hybrid';
    return policy.structureRepresentation;
  }

  private distanceBudgetFactor(distance?: number): number {
    if (distance == null) return 1;
    if (distance < 180) return 1;
    if (distance < 450) return 0.82;
    if (distance < 900) return 0.55;
    return 0.28;
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
