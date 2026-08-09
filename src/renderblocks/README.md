# Empire Quest Semantic RenderBlocks

This folder contains the first code implementation of the image-first hybrid rendering architecture tracked in GitHub issue #1.

## Rule

A RenderBlock is **not** the simulation object. It is a visual representation tied to the same stable identity and coordinates as the simulation object.

Visual truth, collision truth, navigation truth, and simulation truth may use different representations, but they must remain synchronized.

## Current modules

- `RenderBlock.ts` — core schema, states, passes, semantic regions, structural metadata, directional-view selection.
- `RenderBlockRegistry.ts` — registration, feature binding, manifest validation.
- `CanvasRenderBlockRenderer.ts` — first Canvas 2D renderer, image cache, semantic polygon picking, debug overlays.
- `RenderBlockEngine.ts` — small facade intended to be owned by `MapRenderer`.
- `prototypeManifest.ts` — first concrete asset contracts for Sunwell Farm and Northwell west-wall R&D.

## Safe MapRenderer integration

The existing procedural renderer stays as fallback.

Conceptual hook inside `MapRenderer.drawFeature(...)`:

```ts
const renderBlockResult = this.renderBlocks.tryDrawFeature(ctx, feature);
if (renderBlockResult.drawn) return;

// Existing procedural drawFeature logic remains unchanged below.
```

At initialization:

```ts
this.renderBlocks.registerManifest(PROTOTYPE_RENDERBLOCK_MANIFEST);
```

Do not remove procedural drawing until the replacement asset family passes visual and performance benchmarks.

## Prototype asset root

Place authored prototype assets under:

```text
public/renderblocks/prototype/
  farm/
    sunwell_healthy.webp
    sunwell_healthy_alpha.webp
    sunwell_dry.webp
    sunwell_dry_alpha.webp
    sunwell_harvested.webp
    sunwell_harvested_alpha.webp
    sunwell_snow.webp
    sunwell_snow_alpha.webp
    sunwell_flooded.webp
    sunwell_flooded_alpha.webp

  northwell/
    west_wall_intact.webp
    west_wall_intact_alpha.webp
    west_wall_semantic.webp
    west_wall_damage_mask.webp
    west_wall_scarred.webp
    west_wall_scarred_alpha.webp
    west_wall_damaged.webp
    west_wall_damaged_alpha.webp
    west_wall_critical.webp
    west_wall_critical_alpha.webp
    west_wall_breached.webp
    west_wall_breached_alpha.webp
```

The renderer deliberately returns `drawn: false` while these assets are absent or unavailable, preserving current procedural rendering.

## Authoring contract

Generated source imagery should be created **for the engine**, not treated as arbitrary art that the engine must reverse-engineer later.

For each family keep fixed or explicitly declared:

- camera/projection
- scale
- light direction
- object orientation
- pivot/ground contact
- transparent or easily segmented background
- full object visibility
- attachment boundaries
- state naming
- deterministic dimensions

Where useful, generate companion passes:

- beauty
- alpha
- semantic ID
- material ID
- depth
- normals
- damage mask
- occlusion

## First benchmark

### Sunwell Farm

Success means:

1. image-derived farm appears at the existing `sunwell-farm` feature coordinates;
2. zoom/position remain stable;
3. simulation can select at least three visual condition states;
4. procedural farm remains fallback;
5. no strategic simulation regression.

### Northwell wall

Success means:

1. wall block renders at deterministic coordinates;
2. a world-space hit resolves to `northwell:west_wall_04` or its battlement region;
3. integrity maps to local visual damage states;
4. breach can change passability;
5. resulting state is persistable by the simulation/save layer;
6. procedural castle remains fallback until the full castle family is ready.

## Next code step

Wire `RenderBlockEngine` into `MapRenderer` with the smallest possible fallback hook, then add the first actual generated Sunwell asset set. Do not broaden scope until that one farm renders correctly.
