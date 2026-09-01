import { RenderBlockDefinition, damageStateFromIntegrity } from './RenderBlock';

/**
 * Resolve a simulation integrity value to a state that actually exists on the block.
 * Falls back from collapsed -> breached when the authored family uses a breach state.
 */
export function resolveIntegrityState(block: RenderBlockDefinition, integrity: number): string {
  const preferred = damageStateFromIntegrity(integrity);
  const available = new Set(block.states.map(state => state.key));

  if (available.has(preferred)) return preferred;
  if (preferred === 'collapsed' && available.has('breached')) return 'breached';
  if (preferred === 'critical' && available.has('damaged')) return 'damaged';
  if (preferred === 'scarred' && available.has('intact')) return 'intact';

  return block.states[0]?.key ?? preferred;
}

export interface FarmVisualInputs {
  cropHealth?: number;
  harvested?: boolean;
  flooded?: boolean;
  snowCovered?: boolean;
}

/** First deterministic farm visual-state policy for the Sunwell prototype. */
export function resolveFarmVisualState(inputs: FarmVisualInputs): string {
  if (inputs.flooded) return 'flooded';
  if (inputs.snowCovered) return 'snow';
  if (inputs.harvested) return 'harvested';
  if ((inputs.cropHealth ?? 1) < 0.45) return 'dry';
  return 'healthy';
}
