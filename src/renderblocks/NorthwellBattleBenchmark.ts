import { BattleCameraMode } from './BattleRenderBlockAdapter';

export const NORTHWELL_BATTLE_ID = 'northwell-gate-breach';

export const NORTHWELL_STRUCTURAL_BINDINGS = {
  westWall04: {
    nodeId: 'northwell:west_wall_04',
    renderBlockId: 'castle.northwell.west-wall.v1',
  },
} as const;

export interface NorthwellCameraBenchmark {
  mode: BattleCameraMode;
  purpose: string;
  minimumCastleScreenFraction: number;
  minimumVisibleAgents: number;
  minimumCloseAgents: number;
  requiresSemanticPicking: boolean;
  requiresLocalDamage: boolean;
  requiresPersistentRubble: boolean;
}

/**
 * Acceptance targets for replacing the low-detail Northwell Battle Theater
 * presentation. These are visual budgets, never strategic troop counts.
 */
export const NORTHWELL_CAMERA_BENCHMARKS: NorthwellCameraBenchmark[] = [
  {
    mode: 'strategic',
    purpose: 'Read army approach, castle position, roads, terrain and siege geometry at a glance.',
    minimumCastleScreenFraction: 0.12,
    minimumVisibleAgents: 80,
    minimumCloseAgents: 0,
    requiresSemanticPicking: false,
    requiresLocalDamage: false,
    requiresPersistentRubble: false,
  },
  {
    mode: 'tactical',
    purpose: 'Read formations, flanks, cavalry, siege engines, walls and immediate terrain.',
    minimumCastleScreenFraction: 0.18,
    minimumVisibleAgents: 160,
    minimumCloseAgents: 24,
    requiresSemanticPicking: true,
    requiresLocalDamage: true,
    requiresPersistentRubble: false,
  },
  {
    mode: 'formation',
    purpose: 'Make army density, class composition, spacing and movement visibly legible.',
    minimumCastleScreenFraction: 0.10,
    minimumVisibleAgents: 220,
    minimumCloseAgents: 32,
    requiresSemanticPicking: false,
    requiresLocalDamage: false,
    requiresPersistentRubble: false,
  },
  {
    mode: 'siege',
    purpose: 'Show trebuchets/projectiles, defender positions, impact smoke and exact wall sections.',
    minimumCastleScreenFraction: 0.24,
    minimumVisibleAgents: 140,
    minimumCloseAgents: 28,
    requiresSemanticPicking: true,
    requiresLocalDamage: true,
    requiresPersistentRubble: true,
  },
  {
    mode: 'wall',
    purpose: 'Inspect masonry, battlements, defenders, ladders, cracks and impact points at close range.',
    minimumCastleScreenFraction: 0.36,
    minimumVisibleAgents: 70,
    minimumCloseAgents: 36,
    requiresSemanticPicking: true,
    requiresLocalDamage: true,
    requiresPersistentRubble: true,
  },
  {
    mode: 'breach',
    purpose: 'Put the player into the physical breach with rubble, opening width, troops and route state clearly visible.',
    minimumCastleScreenFraction: 0.42,
    minimumVisibleAgents: 110,
    minimumCloseAgents: 48,
    requiresSemanticPicking: true,
    requiresLocalDamage: true,
    requiresPersistentRubble: true,
  },
  {
    mode: 'overview',
    purpose: 'Summarize the whole battle while keeping formations, damage and terrain readable.',
    minimumCastleScreenFraction: 0.10,
    minimumVisibleAgents: 60,
    minimumCloseAgents: 0,
    requiresSemanticPicking: false,
    requiresLocalDamage: true,
    requiresPersistentRubble: true,
  },
];

export interface NorthwellBenchmarkSnapshot {
  mode: BattleCameraMode;
  castleScreenFraction: number;
  visibleAgents: number;
  closeAgents: number;
  semanticPickingWorking: boolean;
  localDamageWorking: boolean;
  persistentRubbleWorking: boolean;
}

export interface NorthwellBenchmarkResult {
  passed: boolean;
  score: number;
  failures: string[];
}

/**
 * Cheap deterministic gate that can later be fed by telemetry/screenshots.
 * A score below 100 means the camera mode is not yet visually benchmark-complete.
 */
export function scoreNorthwellBenchmark(snapshot: NorthwellBenchmarkSnapshot): NorthwellBenchmarkResult {
  const target = NORTHWELL_CAMERA_BENCHMARKS.find(candidate => candidate.mode === snapshot.mode);
  if (!target) return { passed: false, score: 0, failures: [`Unknown camera mode: ${snapshot.mode}`] };

  const checks: Array<[boolean, string]> = [
    [
      snapshot.castleScreenFraction >= target.minimumCastleScreenFraction,
      `castle footprint ${snapshot.castleScreenFraction.toFixed(2)} < ${target.minimumCastleScreenFraction.toFixed(2)}`,
    ],
    [
      snapshot.visibleAgents >= target.minimumVisibleAgents,
      `visible agents ${snapshot.visibleAgents} < ${target.minimumVisibleAgents}`,
    ],
    [
      snapshot.closeAgents >= target.minimumCloseAgents,
      `close agents ${snapshot.closeAgents} < ${target.minimumCloseAgents}`,
    ],
    [
      !target.requiresSemanticPicking || snapshot.semanticPickingWorking,
      'semantic structural picking unavailable',
    ],
    [
      !target.requiresLocalDamage || snapshot.localDamageWorking,
      'localized structural damage unavailable',
    ],
    [
      !target.requiresPersistentRubble || snapshot.persistentRubbleWorking,
      'persistent rubble/navigation state unavailable',
    ],
  ];

  const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
  const score = Math.round((checks.length - failures.length) / checks.length * 100);
  return { passed: failures.length === 0, score, failures };
}
