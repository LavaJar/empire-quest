import {
  RenderBlockDefinition,
  RenderBlockManifest,
  RenderBlockValidationIssue,
} from './RenderBlock';

/**
 * Runtime registry for image-first semantic rendering definitions.
 *
 * Feature bindings intentionally live outside MapRenderer so the existing
 * procedural renderer can remain a safe fallback during migration.
 */
export class RenderBlockRegistry {
  private readonly blocks = new Map<string, RenderBlockDefinition>();
  private readonly featureBindings = new Map<string, string>();

  register(block: RenderBlockDefinition): void {
    this.blocks.set(block.id, block);
  }

  registerMany(blocks: RenderBlockDefinition[]): void {
    for (const block of blocks) this.register(block);
  }

  registerManifest(manifest: RenderBlockManifest): RenderBlockValidationIssue[] {
    const issues = this.validateManifest(manifest);
    const hasErrors = issues.some(issue => issue.severity === 'error');
    if (hasErrors) return issues;

    this.registerMany(manifest.blocks);
    for (const [featureId, renderBlockId] of Object.entries(manifest.featureBindings ?? {})) {
      this.bindFeature(featureId, renderBlockId);
    }
    return issues;
  }

  bindFeature(featureId: string, renderBlockId: string): void {
    if (!this.blocks.has(renderBlockId)) {
      throw new Error(`Cannot bind feature ${featureId}: unknown RenderBlock ${renderBlockId}`);
    }
    this.featureBindings.set(featureId, renderBlockId);
  }

  unbindFeature(featureId: string): void {
    this.featureBindings.delete(featureId);
  }

  get(id: string): RenderBlockDefinition | undefined {
    return this.blocks.get(id);
  }

  getForFeature(featureId: string): RenderBlockDefinition | undefined {
    const blockId = this.featureBindings.get(featureId);
    return blockId ? this.blocks.get(blockId) : undefined;
  }

  getBoundRenderBlockId(featureId: string): string | undefined {
    return this.featureBindings.get(featureId);
  }

  has(id: string): boolean {
    return this.blocks.has(id);
  }

  list(): RenderBlockDefinition[] {
    return [...this.blocks.values()];
  }

  listBindings(): Array<{ featureId: string; renderBlockId: string }> {
    return [...this.featureBindings.entries()].map(([featureId, renderBlockId]) => ({ featureId, renderBlockId }));
  }

  clear(): void {
    this.blocks.clear();
    this.featureBindings.clear();
  }

  validateManifest(manifest: RenderBlockManifest): RenderBlockValidationIssue[] {
    const issues: RenderBlockValidationIssue[] = [];
    const ids = new Set<string>();

    if (manifest.schemaVersion !== 1) {
      issues.push({
        blockId: '__manifest__',
        severity: 'error',
        message: `Unsupported RenderBlock schema version: ${manifest.schemaVersion}`,
      });
    }

    for (const block of manifest.blocks) {
      if (!block.id.trim()) {
        issues.push({ blockId: block.id || '__missing__', severity: 'error', message: 'Block id is required.' });
      }
      if (ids.has(block.id)) {
        issues.push({ blockId: block.id, severity: 'error', message: 'Duplicate block id.' });
      }
      ids.add(block.id);

      if (block.version < 1) {
        issues.push({ blockId: block.id, severity: 'error', message: 'Block version must be >= 1.' });
      }
      if (block.spatial.width <= 0 || block.spatial.height <= 0) {
        issues.push({ blockId: block.id, severity: 'error', message: 'Spatial width and height must be positive.' });
      }
      if (block.spatial.pivot.x < 0 || block.spatial.pivot.x > 1 || block.spatial.pivot.y < 0 || block.spatial.pivot.y > 1) {
        issues.push({ blockId: block.id, severity: 'error', message: 'Pivot must be normalized to [0, 1].' });
      }
      if (!block.states.length) {
        issues.push({ blockId: block.id, severity: 'error', message: 'At least one visual state is required.' });
      }

      const stateKeys = new Set<string>();
      for (const state of block.states) {
        if (stateKeys.has(state.key)) {
          issues.push({ blockId: block.id, severity: 'error', message: `Duplicate state key: ${state.key}` });
        }
        stateKeys.add(state.key);

        if (!state.passes && !state.directionalViews?.length) {
          issues.push({ blockId: block.id, severity: 'error', message: `State ${state.key} has no renderable passes.` });
        }

        if (state.directionalViews?.length) {
          const viewKeys = new Set<string>();
          for (const view of state.directionalViews) {
            const key = `${view.azimuth}:${view.elevation ?? 0}`;
            if (viewKeys.has(key)) {
              issues.push({ blockId: block.id, severity: 'warning', message: `Duplicate directional view ${key} in ${state.key}.` });
            }
            viewKeys.add(key);
          }
        }
      }

      for (const region of block.structural?.semanticRegions ?? []) {
        if (region.polygon && region.polygon.some(point => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
          issues.push({
            blockId: block.id,
            severity: 'error',
            message: `Semantic region ${region.id} contains coordinates outside [0, 1].`,
          });
        }
      }
    }

    for (const [featureId, renderBlockId] of Object.entries(manifest.featureBindings ?? {})) {
      if (!ids.has(renderBlockId)) {
        issues.push({
          blockId: renderBlockId,
          severity: 'error',
          message: `Feature binding ${featureId} references an unknown block.`,
        });
      }
    }

    return issues;
  }
}
