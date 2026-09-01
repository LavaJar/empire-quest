# Empire Quest — Visual Implementation Status

> Agents working on major visual systems must append/update an entry here so the rendering contract is visible across Pokee AI, Claude, ChatGPT, and human review.

## Locked benchmark families

- **Rivermarch Gate** — siege / combat / structural destruction.
- **Ravenford Crossing** — convoy / bridge / logistics / town operations.
- **Goldmere Fields** — province / farm / economy / supply movement.

See root `POKEE_RENDER_DIRECTIVE.md` and `docs/GLOBAL_VISUAL_QUALITY_GATE.md`.

## Current baseline

- Renderer: Three.js strategic renderer on `main`.
- Current known visual upgrade: cinematic atmosphere, golden-hour sky dome, aerial haze/fog, low-sun shadows, bloom, warm grade and vignette post-processing.
- Global quality target: benchmark quality or better across the whole game.

## Agent acknowledgement template

Copy this section for each substantial visual implementation:

```md
### YYYY-MM-DD — <agent/workflow> — <feature>
- Starting commit:
- Benchmark family: Rivermarch / Ravenford / Goldmere
- Subsystems/files changed:
- Expected visible result:
- Simulation/state preserved: yes/no
- Performance measured: yes/no
- Environment fidelity: /10
- Scene density: /10
- UI polish: /10
- Readability: /10
- Physical/simulation believability: /10
- Atmosphere/material response: /10
- Overall premium feel: /10
- Gate result: PASS / FAIL
- Remaining blocker:
```

## Gate rule

A major screen is not complete unless the corresponding benchmark-family comparison passes the locked minimums. Code completion alone is not a visual pass.
