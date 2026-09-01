# Northwell Battle Theater — RenderBlock Integration

## Current floor

The live `Siege of Northwell Castle` screen is still produced by the legacy Battle Theater bundle. Its castle, terrain, troop formations, siege geometry, and camera modes are not yet consuming the Semantic RenderBlock Engine.

The repository history confirms that the Battle Theater was committed as built/minified browser assets rather than as an editable `src/battle` source tree. This means the RenderBlock foundation cannot safely be inserted into the current battle implementation by editing a normal TypeScript/React/Three source module: that module is not present in this GitHub snapshot.

Do **not** solve this by painting a high-quality image over the existing canvas. The replacement path must preserve authoritative simulation state, semantic structural identity, troop counts, hit resolution, navigation, and persistent destruction.

## Benchmark priority

Northwell Gate Breach is benchmark #1 for the RenderBlock architecture. The farm remains useful for low-risk map testing, but Battle Theater is where the visual gap is largest and where the hybrid representation method must prove itself.

## Required runtime ownership

The battle renderer should consume authoritative simulation inputs and ask `BattleRenderBlockAdapter` only which representation to draw.

```ts
battleRenderBlocks.setCameraMode(cameraMode);

const wallVisual = battleRenderBlocks.resolveStructure({
  nodeId: 'northwell:west_wall_04',
  renderBlockId: 'castle.northwell.west-wall.v1',
  integrity: westWall.integrity,
  worldPosition: westWall.position,
  passable: westWall.passable,
  burning: westWall.burning,
  selected: selectedNodeId === westWall.id,
  distanceToCamera,
  azimuth: cameraAzimuth,
  elevation: cameraElevation,
});
```

The adapter returns visual decisions only. It does **not** decide battle damage, wall HP, troop casualties, morale, route state, or victory.

## Formation rule

Strategic troop count and rendered-agent count are intentionally separate.

```ts
const attackerVisual = battleRenderBlocks.resolveFormation({
  formationId: attackingFormation.id,
  renderBlockId: attackingFormation.visualFamily,
  strategicCount: 19001,
  worldPosition: attackingFormation.position,
  distanceToCamera,
  selected: true,
});
```

If the adapter chooses 190 visible agents, the army still contains 19,001 troops. Visible agents are a representation budget, not a simulation shortcut.

## Camera mode representation policy

| Camera | Castle / structure | Formations | Main purpose |
|---|---|---|---|
| Strategic | depth card / directional block | directional impostors | battle geography and approach |
| Tactical | high-detail hybrid | instanced agents | formations, flanks, siege geometry |
| Formation | depth card | dense instanced agents | class density and movement |
| Siege | high-detail hybrid | instanced agents | trebuchets, projectiles, exact wall impacts |
| Wall | highest-detail hybrid | close instanced agents | masonry, battlements, ladders, cracks |
| Breach | highest-detail hybrid | close instanced agents | rubble, opening width, troops through breach |
| Overview | directional impostors | directional impostors | whole-battle summary |

A `high-detail-hybrid` may combine generated beauty/depth/normal/semantic passes with proxy geometry, dynamic projectiles, selective real 3D, particles, and local debris. The visible image and the physical simulation must share the same structural IDs.

## Northwell visual acceptance floor

`NorthwellBattleBenchmark.ts` turns the current visual problem into measurable gates.

Minimum targets:

- Strategic: castle >= 12% of viewport; >= 80 visible agents.
- Tactical: castle >= 18%; >= 160 agents; >= 24 close agents.
- Formation: >= 220 visible agents; >= 32 close agents.
- Siege: castle >= 24%; >= 140 visible agents; exact semantic hits + local damage + rubble.
- Wall: castle >= 36%; >= 70 visible agents; >= 36 close agents; local structural detail.
- Breach: castle >= 42%; >= 110 visible agents; >= 48 close agents; persistent rubble and passability visibly readable.
- Overview: persistent damage remains visible even at summary distance.

These are rendering budgets and visual legibility gates, not strategic troop-count caps.

## Exact destruction chain

```text
projectile / collision
  -> normalized hit point
  -> semantic region
  -> structural node ID
  -> authoritative damage resolver
  -> integrity changes
  -> RenderBlock state changes
  -> local debris animation
  -> settled persistent rubble
  -> collision/nav proxy update when authorized
  -> strategic breach state persists
```

For the first block:

```text
northwell:west_wall_04
  intact
  scarred
  damaged
  critical
  breached
```

A breach does not replace the whole castle. Adjacent towers, wall bays, gates, defenders, and terrain retain their own identities and states.

## Asset package for the first live upgrade

Northwell should be authored as modular machine-readable blocks, not one giant castle screenshot.

First asset tranche:

1. West wall bay 04: intact / scarred / damaged / critical / breached.
2. Battlement companion region.
3. Stable left/right attachment edges.
4. Beauty pass.
5. Alpha pass.
6. Depth pass.
7. Normal pass.
8. Semantic-ID pass.
9. Damage mask.
10. Collision/nav proxy.
11. 8 azimuth views for the first quality test, with the minimum view count adjusted after benchmark.
12. Rubble blocks and dust/impact particles that settle into persistent state.

Then extend the same contract to gatehouse, corner tower, connecting wall bays, keep, bridge/approach geometry, siege engine, cavalry, infantry formations, and defender formations.

## Repo source gap and correct next engineering step

The current GitHub history contains Battle Theater as compiled assets. The editable Battle Theater source needs to be restored from the authoring environment or reconstructed as source in this repository before the adapter can replace the live battle renderer safely.

Preferred order:

1. Restore/export the current editable Battle Theater source into GitHub if Pokee still has it.
2. Instantiate `BattleRenderBlockAdapter` in that renderer.
3. Bind the existing seven camera buttons to `setCameraMode()`.
4. Replace Northwell's monolithic low-detail castle representation with structural RenderBlocks.
5. Replace sparse troop markers with camera-budgeted formation/agent representations.
6. Feed exact collision hits into semantic structural targeting.
7. Persist damage/rubble/passability in the simulation/save layer.
8. Regenerate the production bundle and deploy through `main`/GitHub Pages.

If the editable Battle Theater source cannot be recovered, reconstruct a clean `src/battle/` renderer and use the existing compiled implementation only as behavioral reference. Do not hand-edit the ~1 MB production bundle as the primary architecture.

## Performance rule

Graphics quality may degrade by tier, but simulation fidelity may not.

Track at minimum:

- CPU frame time
- GPU frame time
- draw calls
- visible agents
- RenderBlocks visible/loaded
- image/depth/normal memory
- dynamic debris
- settled rubble
- particle count
- semantic picking cost

The benchmark should target a 16.7 ms frame budget on the chosen 60 FPS reference machine, with lower tiers reducing representation cost rather than changing the true battle state.
