/**
 * Empire Quest Semantic RenderBlock core types.
 *
 * A RenderBlock is a visual representation of a simulation object. The visual,
 * collision/navigation, structural, and simulation representations may differ,
 * but they must share identity and coordinates.
 */

export type RenderBlockType =
  | 'farm'
  | 'wall'
  | 'tower'
  | 'gate'
  | 'gatehouse'
  | 'keep'
  | 'bridge'
  | 'building'
  | 'village'
  | 'city'
  | 'port'
  | 'mine'
  | 'forest'
  | 'wagon'
  | 'convoy'
  | 'formation'
  | 'rubble'
  | 'effect'
  | 'terrain-detail';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RenderBlockAssetRef {
  /** Browser-loadable path, normally rooted under /renderblocks/. */
  src: string;
  width?: number;
  height?: number;
  bytes?: number;
}

export interface RenderBlockPassSet {
  beauty: RenderBlockAssetRef;
  alpha?: RenderBlockAssetRef;
  depth?: RenderBlockAssetRef;
  normal?: RenderBlockAssetRef;
  materialId?: RenderBlockAssetRef;
  semanticId?: RenderBlockAssetRef;
  damageMask?: RenderBlockAssetRef;
  occlusion?: RenderBlockAssetRef;
}

export interface DirectionalRenderBlockView {
  /** Degrees around the object. 0 is the authored forward direction. */
  azimuth: number;
  /** Degrees above/below the authored horizon. */
  elevation?: number;
  passes: RenderBlockPassSet;
}

export interface RenderBlockVisualState {
  /** Stable state key: healthy, dry, damaged-2, breached, snow, etc. */
  key: string;
  passes?: RenderBlockPassSet;
  directionalViews?: DirectionalRenderBlockView[];
}

export interface RenderBlockAnchor {
  id: string;
  position: Vec3;
  kind?: 'attachment' | 'door' | 'gate' | 'banner' | 'projectile-target' | 'ground' | 'custom';
}

export interface RenderBlockProxy {
  kind: 'rect' | 'circle' | 'polygon' | 'mesh';
  /** Normalized/local points for polygon proxies. */
  points?: Vec2[];
  width?: number;
  height?: number;
  radius?: number;
  meshSrc?: string;
}

export interface SemanticRegion {
  id: string;
  /** Structural/simulation identity associated with this visible region. */
  targetId: string;
  /** Optional normalized [0..1] polygon for lightweight Canvas picking. */
  polygon?: Vec2[];
  material?: string;
}

export interface RenderBlockSpatialData {
  /** Authored world footprint in Empire Quest map units. */
  width: number;
  height: number;
  depth?: number;
  /** Normalized image pivot. (0.5, 1) is bottom-center. */
  pivot: Vec2;
  anchors?: RenderBlockAnchor[];
  collisionProxy?: RenderBlockProxy;
  navProxy?: RenderBlockProxy;
}

export interface DamageSlot {
  id: string;
  regionId: string;
  acceptedDamage?: Array<'impact' | 'fire' | 'siege' | 'collapse' | 'weather'>;
}

export interface CollapseRule {
  id: string;
  whenIntegrityBelow: number;
  requiresFailedNodes?: string[];
  producesState: string;
  changesPassability?: boolean;
}

export interface RenderBlockStructuralData {
  nodeId: string;
  dependencies?: string[];
  damageSlots?: DamageSlot[];
  collapseRules?: CollapseRule[];
  semanticRegions?: SemanticRegion[];
}

export interface RenderBlockSimulationData {
  passability?: 'open' | 'restricted' | 'blocked';
  cover?: number;
  capacity?: number;
  productionId?: string;
  tags?: string[];
}

export interface RenderBlockDefinition {
  id: string;
  family: string;
  type: RenderBlockType;
  version: number;
  spatial: RenderBlockSpatialData;
  states: RenderBlockVisualState[];
  structural?: RenderBlockStructuralData;
  simulation?: RenderBlockSimulationData;
  metadata?: {
    authoringCamera?: string;
    lightDirection?: string;
    notes?: string;
  };
}

export interface RenderBlockInstanceState {
  instanceId: string;
  renderBlockId: string;
  worldPosition: Vec2;
  /** Visual state key selected by simulation: healthy, damaged-2, breached, etc. */
  stateKey: string;
  /** 0..1 where 1 is intact. Kept separate from stateKey for simulation authority. */
  integrity?: number;
  /** Camera-relative/object-relative view selection hint in degrees. */
  azimuth?: number;
  elevation?: number;
  scale?: number;
  ownerId?: string;
  visible?: boolean;
}

export interface RenderBlockManifest {
  schemaVersion: 1;
  blocks: RenderBlockDefinition[];
  featureBindings?: Record<string, string>;
}

export interface RenderBlockValidationIssue {
  blockId: string;
  severity: 'error' | 'warning';
  message: string;
}

export function damageStateFromIntegrity(integrity: number): string {
  const value = Math.max(0, Math.min(1, integrity));
  if (value <= 0.2) return 'collapsed';
  if (value <= 0.4) return 'critical';
  if (value <= 0.65) return 'damaged';
  if (value <= 0.85) return 'scarred';
  return 'intact';
}

export function nearestDirectionalView(
  views: DirectionalRenderBlockView[],
  azimuth = 0,
  elevation = 0,
): DirectionalRenderBlockView | undefined {
  if (!views.length) return undefined;

  const wrapAngle = (degrees: number): number => ((degrees % 360) + 360) % 360;
  const targetAzimuth = wrapAngle(azimuth);

  let best = views[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const view of views) {
    const viewAzimuth = wrapAngle(view.azimuth);
    const rawDelta = Math.abs(viewAzimuth - targetAzimuth);
    const azimuthDelta = Math.min(rawDelta, 360 - rawDelta);
    const elevationDelta = Math.abs((view.elevation ?? 0) - elevation);
    const score = azimuthDelta + elevationDelta * 1.5;
    if (score < bestScore) {
      best = view;
      bestScore = score;
    }
  }

  return best;
}
