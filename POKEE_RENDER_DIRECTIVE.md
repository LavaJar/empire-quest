# Empire Quest — Pokee / Claude Rendering Directive

> **STATUS: LOCKED / READ FIRST**
>
> This file is the active rendering handoff for the current `main` branch. It applies to the whole game. It is not limited to Battle Theater.
>
> Current renderer baseline at the time of this handoff: Three.js strategic renderer with cinematic atmosphere, golden-hour sky dome, aerial haze/fog, low-sun shadows, bloom, warm grade, and vignette post-processing.

## 1. Non-negotiable product bar

Empire Quest must visually meet or exceed the three benchmark screens stored in `docs/visual-benchmarks/`.

- `rivermarch-gate-siege.jpg` — siege/combat/destruction benchmark.
- `ravenford-crossing-convoy.jpg` — convoy/bridge/logistics/town benchmark.
- `goldmere-fields-province.jpg` — province/farm/economy benchmark.

These are not mood boards and not distant stretch goals. They are the **minimum finished-game quality floor**.

Do not ship a weak intermediate scene and rely on hundreds of later “improve it” prompts to discover the quality target. The target is already defined here.

If a view is materially below the benchmark family that applies to it, reject it and rebuild/regenerate it before treating the feature as finished.

## 2. Scope: the entire game

The same standard applies to:

- world/realm map;
- province views;
- farms, mills, orchards, mines, timber, warehouses and industrial sites;
- towns, villages, ports and castles;
- bridges, roads, rivers and crossings;
- convoy, supply and escort operations;
- armies, formations, cavalry, archers, engineers and support staff;
- sieges, breaches and destruction;
- advisors, royal/king interfaces and operational panels;
- economy, morale, loyalty, food, water, trade and infrastructure status;
- weather, seasons, day/night, fire, flood, snow, mud and damage states;
- Battle Theater and close/micro views;
- UI/HUD/minimap/event feed/command controls.

A beautiful siege scene surrounded by low-grade province and logistics screens does not pass. The product must feel like one premium game.

## 3. Three canonical benchmark families

### A. Rivermarch Gate — combat / siege / destruction

Use for:

- castle assault;
- gate attack;
- wall/breach cameras;
- field battle adjacent to fortifications;
- siege engineering;
- local structural destruction.

Required visual characteristics:

- fortress fills meaningful screen area instead of becoming a tiny distant toy;
- readable individual wall bays, towers, gate sections, battlements and masonry;
- dense active attackers and defenders;
- visible ladders, siege engines, engineers, cavalry, infantry, archers and support activity when simulation state calls for them;
- coherent banners/heraldry/faction color;
- smoke, fire, embers, dust and debris with atmospheric depth;
- heavy physical breach presentation: fractured masonry, falling stone, exposed inner structure, persistent rubble;
- troops scale correctly against gates/walls/horses/siege engines;
- UI remains premium and legible over cinematic action;
- tactical state is visible in the world, not only represented by numbers.

### B. Ravenford Crossing — convoy / logistics / bridge / town

Use for:

- supply convoys;
- road/bridge movement;
- town entry;
- trade routes;
- escorts;
- route threats;
- river transport;
- crossing control.

Required visual characteristics:

- bridge is a real physical place with width, parapets, arches, road surface and structural presence;
- river has convincing depth, banks, reflections, shoreline and traffic where appropriate;
- wagons carry visible cargo and have believable horse teams;
- escorts visibly surround and protect the convoy;
- town gate, settlement, boats, workers and surrounding countryside create a lived-in scene;
- cargo, grain, tools, trade goods and troop escort information visually agrees with simulation state;
- traffic density must convey scale without becoming unreadable;
- route progress and threats are readable in the UI without hiding the world;
- logistics must feel physical: goods exist somewhere and move through actual infrastructure.

### C. Goldmere Fields — province / farm / economy / supply

Use for:

- agricultural provinces;
- food production;
- village economy;
- farms and mills;
- province health;
- local transport;
- seasonal state.

Required visual characteristics:

- broad readable landscape depth with mountains/hills/fields/roads/water;
- multiple distinct farm structures, not generic repeated boxes;
- visible people, horses, wagons, livestock and work activity;
- fields show crop/state variation, boundaries, paths and irrigation/drainage where appropriate;
- mills, water wheels, silos, barns and workshops have believable scale and materials;
- settlement density and road use communicate an operating economy;
- supply movement is visible;
- seasonal/weather changes materially affect the visual state;
- health/status panels correspond to what the player can see in the province.

## 4. Global quality gates

A major screen does not pass unless it reaches all of the following minimums:

- Environment fidelity: **9/10**
- Scene density: **9/10**
- UI polish: **9/10**
- Readability: **9/10**
- Physical/simulation believability: **9/10**
- Atmosphere/lighting/material response: **9/10**
- Overall premium finished-game feel: **9.5/10**

A 7/10 or 8/10 result is not “good enough for now.” It fails the visual gate.

## 5. Automatic rejection triggers

Reject/regenerate/rebuild any scene that has one or more of these characteristics:

- tiny castle or key structure surrounded by empty terrain;
- sparse battlefield where strategic troop numbers imply a major battle;
- obvious placeholder boxes/cylinders/primitives in a user-facing finished view;
- flat uniform ground with little terrain structure or material variation;
- repeated identical buildings with no believable settlement composition;
- underpopulated roads, farms, towns or fortifications;
- cargo/supplies existing only in UI while the world looks empty;
- low-detail walls where individual damage cannot be read;
- destruction represented only by an HP bar or a disappearing mesh;
- blurry, muddy, dark or unreadable camera treatment;
- UI that looks like a prototype/debug overlay rather than the benchmark product;
- visuals that contradict simulation state;
- random high-cost effects added without improving the benchmark comparison.

## 6. Current technical direction — build on the new Three.js main renderer

Do not revert the current Three.js visual overhaul to the old Canvas prototype.

Preserve and improve the current capabilities already on `main`:

- Three.js scene graph;
- perspective/isometric world camera;
- real directional/ambient/hemisphere lighting;
- shadows;
- ACES filmic tone mapping;
- cinematic post-processing;
- sky dome;
- fog/aerial haze;
- weather rendering;
- water;
- armies/convoys/buildings/terrain groups;
- simulation-driven state.

The RenderBlock work in draft PR #2 is an **architecture library / input method**, not permission to regress visual quality. Reconcile useful RenderBlock concepts into the current renderer selectively.

The core rule is:

> **Simulation remains the source of truth. Visual representations are derived from simulation state.**

Never make beauty pixels authoritative for troop totals, damage, passability, cargo, morale, ownership or production.

## 7. RenderBlock / hybrid representation doctrine

Use the RenderBlock method where it raises quality per development hour.

A RenderBlock may carry:

- beauty image / high-detail appearance;
- alpha;
- semantic/object-ID mask;
- depth;
- normals;
- material ID;
- damage mask;
- occlusion;
- anchors/pivots;
- structural IDs;
- simplified collision/nav proxy;
- damage-state variants;
- directional/impostor views;
- optional lightweight 3D proxy.

Recommended hybrid ladder:

### Realm / far strategic

- high-quality terrain composition;
- simplified structures/formation markers;
- atlases/decals/instancing;
- strong settlement silhouettes;
- no unnecessary close-detail cost.

### Province / regional

- high-fidelity generated/rendered building blocks;
- directional impostors or depth-aware cards for complex assets when useful;
- real 3D for roads, bridges, terrain, interaction-critical geometry;
- dense but controlled population/activity;
- persistent state overlays for snow, fire, flood, damage and production.

### Micro / Battle Theater

- lightweight but real 3D/proxy geometry where movement/collision/destruction requires it;
- high-detail hybrid surfaces/impostors/depth cards where they outperform raw geometry;
- instanced troops for density;
- selective high-detail agents near camera;
- dynamic debris/particles only where the player can perceive them;
- exact semantic structural targets for local destruction.

## 8. Image-first asset generation rules

When AI-generated imagery is used, do **not** generate arbitrary pretty images and then struggle to code them.

Generate assets intentionally for machine integration.

For every authored asset family keep stable:

- camera azimuth/elevation;
- field of view / projection;
- ground-contact plane;
- object scale;
- pivot;
- bounding dimensions;
- lighting direction/intensity unless state explicitly changes it;
- attachment edges/anchors;
- faction/heraldry rules;
- material identity;
- semantic region layout.

Prefer modular families such as:

- wall bay;
- battlement section;
- gatehouse;
- corner tower;
- keep;
- bridge span;
- wagon;
- farm cluster;
- mill;
- warehouse;
- mine entrance;
- formation group;
- siege engine;
- rubble set;
- scaffolding/repair set.

The generator should create **codeable components**, not only showcase paintings.

## 9. Destruction standard

Castle/bridge destruction must be local, persistent and simulation-linked.

Do not create a single global building HP disappearance.

Minimum wall lifecycle:

`intact -> scarred -> damaged -> critical -> breached -> rubble -> repairing -> rebuilt/patched`

Reusable destruction modules may include:

- hairline fractures;
- radial cracks;
- vertical/horizontal splits;
- chipped blocks;
- missing crenellations;
- impact craters;
- scorch;
- small holes;
- major holes;
- full breaches;
- collapsed parapets;
- broken arches;
- leaning sections;
- tower-top collapse;
- gate splintering;
- gate failure;
- rubble piles;
- dust clouds;
- fire states;
- exposed interior masonry;
- scaffolding;
- repair patches.

A projectile hit should resolve against a structural/semantic target, update authoritative integrity, trigger the appropriate visual state, create debris/rubble, and update navigation/passability only when the structural rule says it should.

## 10. Density and scale rules

The benchmark screens feel expensive because they are **occupied**.

Density must come from simulation, composition and LOD—not from random decoration.

Guidelines:

- major sieges: hundreds of visible agents where camera and hardware tier allow, with higher strategic counts preserved separately;
- regional convoy scenes: enough escorts/wagons/workers/traffic to communicate the actual operation;
- province views: fields, livestock, workers, wagons, roads and structures should imply functioning production;
- settlements: populate streets/gates/market/harbor activity according to population/economy state;
- never reduce strategic troop/cargo counts merely to match visible agent budgets.

Use instancing, impostors, batching and LOD to keep density high.

## 11. Camera composition standard

Camera placement is part of quality.

Do not default to a distant engineering overview when the player needs drama/readability.

For selected structures or high-focus operational scenes:

- make the selected castle/gate/bridge/farm/convoy large enough to read;
- preserve a useful foreground/midground/background hierarchy;
- show the relevant operation, not empty sky/ground;
- vary height and lens appropriately by view mode;
- keep enough environmental context for strategy.

Battle Theater camera modes may use distinct representation/detail policies:

- Strategic
- Tactical
- Formation
- Siege
- Wall
- Breach
- Overview

The closer Wall/Breach/Siege modes should substantially increase structure screen occupancy and local detail rather than merely changing a label.

## 12. Lighting / atmosphere standard

The new `main` cinematic atmosphere is a good base, not the finish line.

Maintain:

- directional key light with believable shadows;
- sky/hemisphere fill;
- atmospheric perspective;
- fog/haze that adds depth without hiding gameplay;
- ACES/tone-mapping discipline;
- restrained bloom;
- warm/cool grading appropriate to time/weather;
- readable dark areas;
- water response;
- fire/smoke illumination where present.

Weather and time of day must alter the world coherently rather than simply tinting the screen.

## 13. Materials and physical detail

At close/regional scale the following should read distinctly:

- rough limestone/stone;
- wet stone;
- timber beams;
- weathered planks;
- iron fittings;
- cloth banners;
- leather;
- soil/mud;
- grass/crops;
- water;
- roof tile/thatch;
- wagon canvas;
- rubble/dust;
- snow/ice when present.

Avoid one flat material/color per object class.

## 14. UI standard

The benchmark UI is part of the quality floor.

Keep one coherent Empire Quest language:

- dark premium panels;
- gold/bronze accents;
- blue/red/green status colors only where meaningful;
- consistent typography;
- consistent icon family;
- compact high-information panels;
- strong hierarchy;
- legible numbers/bars;
- map/minimap visual integration;
- tooltips and event feeds that do not cover critical action;
- no temporary debug styling in release views.

The UI must support the cinematic world, not fight it.

## 15. Simulation visibility doctrine

Whenever possible, turn important numbers into world evidence.

Examples:

- low food -> thinner stores/less market supply/strained farm state;
- healthy food -> full fields, active wagons, stocked granaries;
- damaged bridge -> restricted traffic, visible structural damage, repair crew;
- high morale -> orderly active troops/civilians;
- siege pressure -> smoke, damage, crowded gate, engineering activity;
- convoy cargo -> actual loaded wagons;
- flood -> altered roads/fields/crossings;
- winter -> snow/ice/vegetation/material changes;
- abandoned/ruined -> reduced activity and physical decay.

Do not fake simulation values from visuals; visuals read from simulation state.

## 16. Performance budget doctrine

Quality is mandatory, but brute force is not the architecture.

Track at minimum:

- CPU frame time;
- GPU frame time;
- draw calls;
- visible triangles/instances where relevant;
- texture memory;
- decoded asset memory;
- visible/loaded RenderBlocks;
- atlas count;
- active particles;
- dynamic debris;
- visible troop agents;
- shadow cost;
- post-processing cost.

Use quality tiers that change representation cost, not simulation truth.

Possible controls:

- terrain LOD;
- shadow distance/resolution;
- visible-agent budget;
- debris budget;
- particle budget;
- impostor vs mesh thresholds;
- texture resolution;
- post-processing quality;
- water/reflection quality.

The goal is benchmark-level composition on supported hardware, not unlimited expensive detail at all distances.

## 17. Priority implementation order

Do not scatter effort across hundreds of mediocre assets. Prove benchmark families deeply.

### Priority 1 — Goldmere-quality province slice

Build one province view to finished quality:

- terrain depth;
- farm families;
- roads;
- bridge/stream;
- wagons;
- workers/livestock;
- mill/silo/barns;
- seasonal states;
- province HUD;
- visible supply movement.

### Priority 2 — Ravenford-quality logistics slice

Build one crossing/convoy scene:

- high-detail bridge;
- river/boats;
- town gate;
- convoy formation;
- cargo;
- escorts;
- route progress;
- threat state;
- town activity;
- logistics HUD.

### Priority 3 — Rivermarch-quality siege slice

Build one siege to finished quality:

- fortress/gate;
- dense troops;
- siege engines;
- ladders;
- engineers;
- smoke/fire/debris;
- local structural damage;
- breach/rubble;
- tactical HUD;
- camera modes.

Once these three pass, clone the proven systems and asset grammar across the world.

## 18. Do not restart the game

The current simulation/game foundation is valuable.

Do not throw away:

- economy;
- convoys;
- castle destruction logic;
- kingdom status;
- communications delays;
- telemetry;
- map state;
- armies/resources;
- existing UI/game loops;
- current Three.js renderer.

Upgrade representations around the existing simulation-first game.

## 19. Agent acknowledgement protocol

Pokee AI, Claude, or any other agent modifying major visuals should leave a short repo-visible acknowledgement in `docs/VISUAL_IMPLEMENTATION_STATUS.md` before or with the implementation commit.

Record:

- agent/workflow name;
- date;
- starting commit;
- benchmark family being targeted;
- files/subsystems being changed;
- expected visible result;
- measured performance if available;
- self-score against the 7 quality gates;
- PASS / FAIL;
- next blocker if FAIL.

This lets multiple agents collaborate without losing the visual contract.

## 20. Definition of done

A visual feature is not done because code compiles or an object appears.

It is done when:

1. the gameplay/simulation state remains correct;
2. the scene reaches the appropriate benchmark quality;
3. world scale and density read correctly;
4. UI remains polished and readable;
5. camera composition communicates the operation;
6. state changes visibly and persistently affect the world;
7. performance is measured and acceptable for its quality tier;
8. no obvious placeholder visuals remain in the shipped view;
9. the result is recorded in the visual implementation status file.

## 21. One-line mandate

**Empire Quest must make its entire simulation visible at the Rivermarch / Ravenford / Goldmere visual quality level or better; preserve the current simulation and Three.js foundation, use hybrid RenderBlocks/3D/instancing/LOD where they improve quality, and reject any major playable screen that still looks like a sparse prototype.**
