# Empire Quest — Next-Gen Destructible Siege Engine

## Thesis
Every destructible-castle game keeps art and physics apart: artists paint a wall,
engineers write a fracture sim, blocks swap between a few authored damage stages.
We collapse that separation. The AI-generated masonry image does not merely color
the wall — its mortar-joint layout DEFINES how the wall fractures. Cracks follow
the bricks the model drew. Each architectural style shatters differently and
correctly, because the fracture graph is derived from the art itself.

## Five layers
1. Authoritative structural sim — integer, deterministic. Segments carry
   health/maxHealth/state/damageStage; ladder intact→light→cracked→heavy→
   breached→collapsed (absolute health), CRUMBLE_THRESHOLD=30. Shipped; we extend it.
2. Art-conditioned fracture (FractureForge) — recover the joint graph from a
   masonry albedo (adaptive joint mask → distance transform → brick-centre seeds →
   grid Voronoi) and emit cells + adjacency + anchors. Cell boundaries land on the
   mortar: measured jointAlignment 0.756 on the shipped procedural pack.
3. Neural PBR (PBRForge) — derive tileable height/normal/AO/roughness from albedo
   so flat faces read as carved stone. AI albedo drops straight in.
4. WebGPU/TSL render (NextGenSiege) — node material with parallax relief from the
   height map; fracture graph → per-cell fragment meshes; deterministic support
   solve (path-to-anchor) so fragments fall identically on every client. WebGL2
   fallback via capability check → StyleResolver standard-material path.
5. Progressive-enhancement seam (SiegeStyleAdapter) — wraps the live renderer's
   updateSegmentVisuals; equip a style per empire or per conquered castle. Remove
   it and the game is byte-identical to today.

## Determinism (why PvP survives)
No runtime image generation. Fracture seeds come from the image, not RNG. The
support solve is a pure function of (fragments, destroyed-set). Same authoritative
state → same shatter on every client. Generation and QA are entirely offline.

## Pipeline
brief → provider (procedural today, AI tomorrow — one class) → QA gate
(tileability ratio / chromaticity style-lock / damage monotonicity) → PBR derive →
fracture derive → signed manifest → runtime load + equip.

## Monetization asset
Infinite architectural variety at ~zero marginal art cost: style packs (whole-
empire look), per-castle equip for trophy ruins of conquered capitals in your own
siege style, siege spectacle. Cosmetic-on-structure — never touches PvP balance.

## Proven (headless)
- renderProof: resolver yields real distinct materials per stage, keyed on damageStage.
- proveGate: passes clean art; rejects seam(17.7)/palette(0.196)/monotonicity by cell.
- makeByzantinePack: 18 albedo + 72 PBR maps + 3 fracture graphs, gate-passed.
- collapseProof: deterministic collapse on the real graph; anchors never fall;
  removing all anchors drops the wall.

## Not yet
Wiring into the LIVE game needs the buildable siege source (only the compiled
bundle is in the repo). SiegeStyleAdapter + SOURCE_HOOK make that a one-line change.
GPU paths (parallax, fragment fall) validated by types + logic headless; final tuning
is in-browser.
