# ArtForge — AI style-pack pipeline for the siege block system

Offline generator + QA gate that skins the existing Three.js destructible-block
siege sim with AI-generated, style-consistent textures. Runtime code never
generates images; it loads QA-gated packs and composites them.

- `src/siege/BlockStyle.ts` — runtime seam. Resolves (archetype,tier,damageStage,
  style) -> THREE material; falls back to the current colour-lerp when no pack is
  loaded, so installing it changes nothing until a pack drops.
- `tools/artforge/generateStylePack.ts` — offline generator + gate. Fills the
  surface×damage matrix, rejects any image that fails: tileability (seam wrap),
  style-lock (chromaticity outlier), damage-monotonicity (a rung reading more
  intact than the one before it). Emits a signed StylePackManifest.
- `tools/artforge/proveGate.ts` — proof harness. Drives the gate with one good
  and three single-defect ladders; passes the good, rejects each defect by cell.

Run the proof:  `npm i three sharp tsx @types/node && npx tsx tools/artforge/proveGate.ts`

Gate results (verified):
  GOOD            PASS   style 1.000 across ladder, seam < 0.033, struct monotonic
  BROKEN_SEAM     REJECT cracked seam 0.090 > 0.06
  BROKEN_PALETTE  REJECT damaged style 0.243 < 0.90 (hue outlier, that cell only)
  BROKEN_MONOTON  REJECT 'crumbling' reads more intact than 'damaged'
