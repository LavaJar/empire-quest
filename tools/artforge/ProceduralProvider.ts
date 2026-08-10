/**
 * ProceduralProvider — real, no-API masonry. Stack-bond brick grid with mortar
 * lines straddling all four tile edges (seamless by construction), per-brick
 * tonal variation, and damage that knocks out whole bricks + adds cracks +
 * darkens. Produces a crisp joint graph for FractureForge and passes the gate
 * (tileable / palette-consistent / damage-monotonic). Swap for an AI provider
 * later — the joint structure is exactly what art-conditioned fracture needs.
 */
import sharp from 'sharp';
import { ImageProvider } from './generateStylePack';
import { DamageStage } from '../../src/siege/BlockStyle';

const DAMAGE_LEVEL: Record<DamageStage, number> = {
  intact: 0.0, light: 0.15, cracked: 0.35, heavy: 0.6, breached: 0.82, collapsed: 1.0,
};
const hash = (n: number) => { let x = (n ^ 0x9e3779b9) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

export class ProceduralProvider implements ImageProvider {
  constructor(private base: [number, number, number] = [176, 152, 108], private seed = 7) {}

  private stageFromPrompt(p: string): DamageStage {
    const m: Array<[string, DamageStage]> = [
      ['pristine', 'intact'], ['light weathering', 'light'], ['visible cracks', 'cracked'],
      ['large fractures', 'heavy'], ['sections collapsed', 'breached'], ['broken rubble', 'collapsed'],
    ];
    return m.find(([f]) => p.includes(f))?.[1] ?? 'intact';
  }

  async generate(prompt: string, S: number): Promise<Buffer> {
    const stage = this.stageFromPrompt(prompt);
    const d = DAMAGE_LEVEL[stage];
    const [br, bg, bb] = this.base;

    const cols = 4, rows = 8;                 // stack-bond grid; divides S
    const pitchX = S / cols, pitchY = S / rows;
    const m2 = Math.max(1, Math.round(S / 128)); // half-mortar; lines straddle edges

    const buf = Buffer.alloc(S * S * 4);
    for (let y = 0; y < S; y++) {
      const inY = ((y % pitchY) + pitchY) % pitchY;
      const mortarY = inY < m2 || inY >= pitchY - m2;
      const row = Math.floor(y / pitchY);
      for (let x = 0; x < S; x++) {
        const inX = ((x % pitchX) + pitchX) % pitchX;
        const mortarX = inX < m2 || inX >= pitchX - m2;
        const col = Math.floor(x / pitchX);
        const brickId = row * cols + col;

        let l: number;
        if (mortarX || mortarY) {
          l = 0.24 + 0.04 * hash(x * 7 + y * 13);                 // recessed mortar
        } else if (hash(brickId * 131 + this.seed) < d * 0.7) {
          l = 0.13 + 0.09 * hash(x * 3 + y * 5);                  // knocked-out void
        } else {
          const tone = 0.60 + 0.17 * hash(brickId * 977 + this.seed);
          const grain = 0.05 * (hash(x * 131 + y * 977) - 0.5);
          const crack = hash(brickId * 31 + ((x >> 2) * 7) + (y >> 2)) < d * 0.12 ? -0.28 : 0;
          l = Math.max(0, Math.min(1, tone + grain + crack));
        }
        const dark = 1 - 0.35 * d;
        const i = (y * S + x) * 4;
        buf[i]     = Math.min(255, br * l * dark);
        buf[i + 1] = Math.min(255, bg * l * dark);
        buf[i + 2] = Math.min(255, bb * l * dark);
        buf[i + 3] = 255;
      }
    }
    return sharp(buf, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();
  }
}
