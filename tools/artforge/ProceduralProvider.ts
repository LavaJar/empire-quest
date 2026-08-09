/**
 * ProceduralProvider — a real ImageProvider that synthesises tileable masonry
 * with NO external API. It exists so the whole pipeline (generate → gate →
 * manifest → runtime load) runs end-to-end today and ships usable placeholder
 * art. Swap this one class for an AI-model provider and nothing else changes.
 *
 * Design constraints it satisfies so the gate passes:
 *  - tileable: every field is periodic over the tile (sines w/ integer
 *    wavenumbers + periodic value-noise), so opposing edges match.
 *  - palette-consistent: fixed ochre chromaticity across all stages; only
 *    brightness/roughness move with damage (which the gate now allows).
 *  - damage-monotonic: mortar crispness falls and irregular rubble rises with
 *    the stage's damage level, so structure score decreases down the ladder.
 */

import sharp from 'sharp';
import { ImageProvider } from './generateStylePack';
import { DamageStage } from '../../src/siege/BlockStyle';

const DAMAGE_LEVEL: Record<DamageStage, number> = {
  intact: 0.0, light: 0.2, cracked: 0.4, heavy: 0.6, breached: 0.8, collapsed: 1.0,
};

function periodicNoise(seed: number, size: number, G = 8) {
  const g: number[] = []; let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < G * G; i++) g.push(rnd());
  const at = (i: number, j: number) => g[(((j % G) + G) % G) * G + (((i % G) + G) % G)];
  return (x: number, y: number) => {
    const fx = x / size * G, fy = y / size * G;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
}

export class ProceduralProvider implements ImageProvider {
  /** base ochre stone in RGB; override for other style families. */
  constructor(private base: [number, number, number] = [172, 150, 108], seed = 20240607) {
    this.noise = periodicNoise(seed, 1); // re-seeded per size below
    this.seed = seed;
  }
  private noise: (x: number, y: number) => number;
  private seed: number;

  private stageFromPrompt(prompt: string): DamageStage {
    const m: Array<[string, DamageStage]> = [
      ['pristine', 'intact'], ['light weathering', 'light'], ['visible cracks', 'cracked'],
      ['large fractures', 'heavy'], ['sections collapsed', 'breached'], ['broken rubble', 'collapsed'],
    ];
    return m.find(([frag]) => prompt.includes(frag))?.[1] ?? 'intact';
  }

  async generate(prompt: string, sizePx: number): Promise<Buffer> {
    const S = sizePx;
    const stage = this.stageFromPrompt(prompt);
    const d = DAMAGE_LEVEL[stage];
    const noise = periodicNoise(this.seed + stage.length * 31, S);
    const [br, bg, bb] = this.base;

    // brick coursing: integer wavenumbers so the pattern tiles.
    const courses = 6, bricksPerCourse = 4;
    const buf = Buffer.alloc(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // smooth periodic mortar grid (crisp when intact, faded when damaged)
      const gridAmp = 1 - 0.85 * d;
      const grid = 0.5
        + 0.25 * Math.sin(2 * Math.PI * bricksPerCourse * x / S)
        + 0.25 * Math.sin(2 * Math.PI * courses * y / S);
      const rubble = noise(x, y);                 // periodic, irregular
      let l = 0.55 + gridAmp * (grid - 0.5) * 0.85 + d * (rubble - 0.5) * 0.9;
      l = Math.max(0, Math.min(1, l));

      const shade = 0.55 + 0.85 * l;              // luminance envelope
      const dark = 1 - 0.4 * d;                   // overall darkening with damage
      const i = (y * S + x) * 4;
      buf[i]     = Math.min(255, br * shade * dark);
      buf[i + 1] = Math.min(255, bg * shade * dark);
      buf[i + 2] = Math.min(255, bb * shade * dark);
      buf[i + 3] = 255;
    }
    return sharp(buf, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();
  }
}
