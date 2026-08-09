import {
  BattleCameraMode,
  BattleFormationDecision,
  BattleFormationInput,
  BattleRenderBlockAdapter,
  BattleSemanticHit,
  BattleStructureDecision,
  BattleStructureInput,
} from './BattleRenderBlockAdapter';
import { Vec2 } from './RenderBlock';

export interface NorthwellBattleRenderSnapshot {
  cameraMode: BattleCameraMode;
  structures: BattleStructureInput[];
  formations: BattleFormationInput[];
  selectedStructureId?: string;
  selectedFormationId?: string;
}

export interface NorthwellBattleFrame {
  cameraMode: BattleCameraMode;
  structures: BattleStructureDecision[];
  formations: BattleFormationDecision[];
  budgets: {
    visibleAgents: number;
    dynamicDebris: number;
    particles: number;
    terrainDetailTier: 0 | 1 | 2 | 3;
    structureDetailTier: 0 | 1 | 2 | 3;
  };
  selectedStructureScreenFraction?: { min: number; max: number };
}

export interface NorthwellBattleHitInput {
  renderBlockId: string;
  /** Coordinates normalized to the authored RenderBlock image/semantic space. */
  normalizedPoint: Vec2;
}

/**
 * Renderer-facing controller for the Northwell benchmark.
 *
 * The battle simulation supplies the snapshot. This controller only converts
 * that authoritative state into visual representation decisions. It never
 * mutates troop counts, wall integrity, casualties, morale, passability or
 * victory conditions.
 */
export class NorthwellBattleController {
  constructor(private readonly adapter: BattleRenderBlockAdapter) {}

  buildFrame(snapshot: NorthwellBattleRenderSnapshot): NorthwellBattleFrame {
    this.adapter.setCameraMode(snapshot.cameraMode);
    const policy = this.adapter.getPolicy();

    const structures = snapshot.structures
      .map(structure => this.adapter.resolveStructure({
        ...structure,
        selected: structure.selected || structure.nodeId === snapshot.selectedStructureId,
      }))
      .filter((structure): structure is BattleStructureDecision => Boolean(structure));

    const formations = snapshot.formations.map(formation => this.adapter.resolveFormation({
      ...formation,
      selected: formation.selected || formation.formationId === snapshot.selectedFormationId,
    }));

    return {
      cameraMode: snapshot.cameraMode,
      structures,
      formations,
      budgets: {
        visibleAgents: policy.visibleAgentBudget,
        dynamicDebris: policy.dynamicDebrisBudget,
        particles: policy.particleBudget,
        terrainDetailTier: policy.terrainDetailTier,
        structureDetailTier: policy.structureDetailTier,
      },
      selectedStructureScreenFraction: policy.selectedStructureScreenFraction,
    };
  }

  resolveHit(input: NorthwellBattleHitInput): BattleSemanticHit | undefined {
    return this.adapter.resolveSemanticHit(input.renderBlockId, input.normalizedPoint);
  }
}

/**
 * Convenience helper for telemetry/debug panels. This makes it obvious when
 * rendered density is not keeping up with the strategic battle state.
 */
export function summarizeNorthwellFrame(frame: NorthwellBattleFrame): {
  strategicTroops: number;
  visibleAgents: number;
  structures: number;
  breachedStructures: number;
  passableStructures: number;
} {
  const strategicTroops = frame.formations.reduce((sum, formation) => sum + formation.strategicCount, 0);
  const visibleAgents = frame.formations.reduce((sum, formation) => sum + formation.visibleAgentCount, 0);
  const breachedStructures = frame.structures.filter(structure => structure.stateKey === 'breached').length;
  const passableStructures = frame.structures.filter(structure => structure.passable).length;

  return {
    strategicTroops,
    visibleAgents,
    structures: frame.structures.length,
    breachedStructures,
    passableStructures,
  };
}
