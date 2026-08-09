# Prototype RenderBlock Asset Contract

These are the first image-generation targets for the Semantic RenderBlock Engine.

## Global rules

Every render in a family must preserve:

- identical canvas dimensions
- identical object scale
- identical pivot / ground contact
- identical camera projection and angle
- identical light direction
- no cropping of the authored block
- no unrelated objects crossing the block boundary
- no text, UI, labels, frames, or borders
- clean alpha-compatible background

Default source recommendation: render larger than runtime size, then downsample and encode WebP/PNG after validation.

## Sunwell Farm

Required states:

```text
healthy
dry
harvested
snow
flooded
```

Target visual footprint in the current map: approximately 72 x 52 world units.

Author as one coherent farm block with readable rows/buildings at regional zoom. Avoid tiny detail that disappears at map scale.

## Northwell West Wall 04

Required states:

```text
intact
scarred
damaged
critical
breached
```

The wall must retain the same camera, exact attachment edges, and ground line in all five states.

The breached state must leave a visually and logically readable passage through the wall rather than replacing the whole wall with generic rubble.

### Semantic regions

At minimum preserve two addressable regions:

1. `northwell:west_wall_04`
2. `northwell:west_wall_04:battlement`

Companion semantic-ID imagery should use flat, non-antialiased region colors chosen by the asset pipeline and recorded in the future manifest metadata.

### Damage progression

- `intact`: structurally complete
- `scarred`: cosmetic/light impact evidence; route remains blocked
- `damaged`: meaningful cracks/missing stone; route remains blocked
- `critical`: unstable major fracture; route remains blocked unless simulation says otherwise
- `breached`: actual opening with persistent rubble; passability may change

Do not move the surrounding wall endpoints between states. State swaps must be spatially stable.

## Naming

File names are defined in `src/renderblocks/prototypeManifest.ts`. Do not silently rename source assets without updating the manifest in the same change.
