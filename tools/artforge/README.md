# ArtForge — AI style-pack pipeline for the siege block system

Skins the existing Three.js destructible-block siege sim with style-consistent,
QA-gated textures. Structure stays owned by the sim; this only supplies
appearance. Runtime never generates images — it loads gated packs and composites.

## Aligned to the shipped model
Reverse-read from the build, not guessed:
- segment: { health, maxHealth, state, damageStage, mesh, size, wallFace, ... }
- tiers: outer | inner | keep, each with a colorPalette
- damage ladder (getDamageStage, absolute health):
  >80 intact · >60 light · >40 cracked · >20 heavy · >0 breached · else collapsed
- CRUMBLE_THRESHOLD = 30
- hook: updateSegmentVisuals(segment, tierName)

## Files
Runtime (src/siege/):
- BlockStyle.ts        — StyleResolver. materialFor(seg,tier,style) -> THREE
                         material or null (null = leave sim material alone).
                         Reads segment.damageStage; never recomputes. Caches per
                         (style,surface,stage); dedups textures.
- SiegeStyleAdapter.ts — non-invasive: monkey-patches a live renderer's
                         updateSegmentVisuals to skin only when a style is
                         equipped and covered. Plus StyleEquipment (owns/equip,
                         global + per-castle) and loadStylePack(manifest fetch).
                         SOURCE_HOOK = the one-line edit for when source is editable.

Offline (tools/artforge/):
- generateStylePack.ts — fills surface×stage matrix, gates every image, emits a
                         signed StylePackManifest.
- ProceduralProvider.ts— real ImageProvider (no external API) making tileable
                         ochre masonry; swap for an AI provider, nothing else moves.
- makeByzantinePack.ts — generates public/packs/byzantine_v1 end-to-end.
- proveGate.ts         — good + 3 single-defect ladders through the real gate.
- renderProof.ts       — headless: resolver yields real distinct materials.

## QA gate (the defensible piece)
Rejects any image that fails:
- tileability  — opposing edges must wrap (mean edge diff normalised)
- style-lock   — chromaticity fingerprint near pack centroid (brightness-invariant,
                 so damage-darkening is allowed but a wrong-hue stage is caught)
- monotonicity — no rung may read more intact than the rung before it

## Verified
  renderProof     ALL PASS — real MeshStandardMaterials per stage, keys on
                  damageStage, cached, null without a pack
  proveGate       GOOD PASS; REJECT seam(0.079) / palette-outlier(0.196) /
                  monotonicity(breached>heavy)
  makeByzantine   gate PASS — 18 textures (wall.outer/wall.inner/keep.keep × 6),
                  manifest signed

## Run
  npm i three sharp tsx @types/node
  npx tsx tools/artforge/renderProof.ts
  npx tsx tools/artforge/proveGate.ts
  npx tsx tools/artforge/makeByzantinePack.ts

## Integrate (when siege source is buildable)
At the end of updateSegmentVisuals(segment, tierName), after the colour-lerp:
  const m = adapter.resolver.materialFor(segment, tierName, adapter.styleFor(castleId));
  if (m) segment.mesh.material = m;
Until then, adapter.attach(renderer) does the same by wrapping the instance.
