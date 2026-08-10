# Beauty Generation Contract — reaching reference quality as engine assets

The reference frames are the visual target. That fidelity comes from a top-tier
text-to-image model, not procedural rendering. This contract makes the generated
beauty (a) look like the reference and (b) be engine-usable: modular, destructible,
camera-stable — so the same quality survives gameplay instead of being one flat
screenshot. Every image is authored FOR the RenderBlock engine, per GPT's
ASSET_CONTRACT. ArtForge derives the companion passes; the model produces beauty.

## Non-negotiable invariants (every image in a family)
- Fixed camera: three-quarter orthographic, ~35° elevation, ~30° azimuth. Identical across all states of a block.
- Fixed light: warm key from upper-left (northwest), overcast fill. Identical across states.
- Fixed scale + pivot + ground line. The block's endpoints DO NOT move between states.
- Clean alpha-separable background (flat neutral, no scene behind the block).
- No text, UI, borders, frames. No unrelated objects crossing the block boundary.
- Render at 2x runtime size, validate, downsample, encode WebP + alpha.

## Style anchor (shared prefix for every prompt)
"Cinematic game art, medieval siege, weathered limestone masonry, painterly
realism, dramatic overcast light with warm fire glow, high detail, muted earthen
palette with heraldic azure and crimson accents, ArtStation quality, 8k source."

## Northwell — modular blocks (benchmark #1)
Author these as SEPARATE blocks so destruction and camera moves stay high-fidelity.
Each block: 5 states intact/scarred/damaged/critical/breached (map to sim ladder
below). Beauty + alpha required; ArtForge adds normal/depth/AO/semanticID/damageMask.

### castle.northwell.west-wall.v1  (96x76 units)
- intact:   "<style anchor> a single fortified curtain wall bay, crenellated battlements, banners, defenders on the walkway, structurally complete, three-quarter ortho, flat background, alpha-clean"
- scarred:  same wall, "light impact scars, chipped stone, scorch marks, still whole, route blocked; identical camera/scale/light/endpoints"
- damaged:  same wall, "meaningful cracks, missing merlons, exposed rubble core, route still blocked; identical camera/scale/light/endpoints"
- critical: same wall, "major unstable fracture, large missing section leaning, dust, route still blocked; identical camera/scale/light/endpoints"
- breached: same wall, "a real readable opening punched through the middle, persistent rubble pile spilling forward, passage visible; wall endpoints unchanged; identical camera/scale/light"

### castle.northwell.gatehouse.v1, .corner-tower.v1, .wall-bay-{03,05}.v1
Same 5-state pattern, same camera family. Gatehouse adds a portcullis anchor + gate breach state.

### formations (camera-budgeted, not one-per-troop)
attacker.infantry.v1 / archer / cavalry, defender.* — authored as dense clustered
impostor sheets + a few close hero agents; ArtForge emits directional views (8 azimuths).

### effects
rubble.limestone.v1 (settled persistent debris), dust.impact.v1, fire.wall.v1 — as
sprite/particle sheets with alpha.

## Sim damage ladder (GROUND TRUTH — from the shipped bundle)
The shipped getDamageStage(health, absolute 0..100): >80 intact · >60 light ·
>40 cracked · >20 heavy · >0 breached · else collapsed.
Author-state -> sim-state mapping (so RenderBlockState.resolveIntegrityState is 1:1, not lossy):
  intact<-intact · scarred<-light · damaged<-cracked · critical<-heavy · breached<-breached/collapsed
Either author the 5 beauty states above and use this map, or author all 6. Do not
invent a third ladder — the sim's is authoritative.

## Companion passes (ArtForge, automatic from beauty+alpha)
- normal, depth(height), AO(occlusion): PBRForge, wrap-safe, for dynamic relight.
- semanticID: flat non-AA region colors (main wall / battlement / gate), from block layout.
- damageMask: FractureForge joint graph -> where damage concentrates; drives crack reveal + breach opening.
- collision/nav proxy: from the block's spatial polygon.

## Acceptance (per NorthwellBattleBenchmark)
A block passes when: states are spatially stable (endpoints fixed), alpha is clean,
semantic hit resolves to the right nodeId, breach leaves a readable passage, and the
composite renders at the camera-mode's viewport % + agent budget. Beauty that fails
spatial stability is rejected the same way the QA gate rejects a non-tiling texture.
