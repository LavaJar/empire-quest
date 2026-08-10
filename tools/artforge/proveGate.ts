/**
 * proveGate — drives the real ArtForge gate with synthetic art:
 *   GOOD           : tileable, palette-consistent, damage-monotonic
 *   BROKEN_SEAM    : one stage carries a non-periodic gradient (won't tile)
 *   BROKEN_PALETTE : one stage rendered in the wrong hue (style outlier)
 *   BROKEN_MONOTON : 'crumbling' rendered crisper than 'cracked'
 * Every image is real RGBA encoded to PNG via sharp, so the gate runs its
 * actual pixel math — nothing is mocked below the provider boundary.
 */
import sharp from 'sharp';
import { generateStylePack, DEFAULT_THRESHOLDS, type ImageProvider, type StyleBrief } from './generateStylePack';
import { DAMAGE_LADDER, type DamageStage } from '../../src/siege/BlockStyle';

const S = 128;
type Mode = 'GOOD' | 'BROKEN_SEAM' | 'BROKEN_PALETTE' | 'BROKEN_MONOTON';

// Periodic value-noise so damage stays seamless (tiles over S).
function makeNoise(seed: number, G = 8): (x: number, y: number) => number {
  const g: number[] = [];
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < G * G; i++) g.push(rnd());
  const at = (i: number, j: number) => g[((j % G) + G) % G * G + ((i % G) + G) % G];
  return (x, y) => {
    const fx = x / S * G, fy = y / S * G;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
}
const noise = makeNoise(1337);

// Byzantine-ish ochre stone, darkening with damage.
function palette(d: number, hueSwap: boolean): [number, number, number] {
  if (hueSwap) return [40, 70, 140];              // wrong family: cold blue
  const k = 1 - 0.45 * d;
  return [170 * k, 150 * k, 110 * k];
}

function render(stage: DamageStage, mode: Mode): Promise<Buffer> {
  const sIdx = DAMAGE_LADDER.indexOf(stage);
  let d = sIdx / (DAMAGE_LADDER.length - 1);        // 0..1 damage

  // BROKEN_MONOTON: make 'crumbling' read crisper than 'cracked'.
  let gridAmp = 1 - d;                              // mortar crispness fades w/ damage
  if (mode === 'BROKEN_MONOTON' && stage === 'breached') { gridAmp = 1.0; d = 0.1; }

  const hueSwap = mode === 'BROKEN_PALETTE' && stage === 'heavy';
  const gradient = mode === 'BROKEN_SEAM' && stage === 'cracked';
  const [pr, pg, pb] = palette(d, hueSwap);
  const noiseAmp = d;                              // irregular rubble grows w/ damage

  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // smooth periodic masonry grid -> crisp regular edges when intact
    const grid = 0.5 + 0.25 * Math.sin(2 * Math.PI * 8 * x / S)
                     + 0.25 * Math.sin(2 * Math.PI * 7 * y / S);
    const n = noise(x, y);
    let l = 0.55 + gridAmp * (grid - 0.5) * 0.8 + noiseAmp * (n - 0.5) * 0.9;
    if (gradient) l += (x / S) * 0.6;               // non-periodic -> seam
    l = Math.max(0, Math.min(1, l));
    const i = (y * S + x) * 4;
    buf[i] = Math.min(255, pr * (0.6 + 0.8 * l));
    buf[i + 1] = Math.min(255, pg * (0.6 + 0.8 * l));
    buf[i + 2] = Math.min(255, pb * (0.6 + 0.8 * l));
    buf[i + 3] = 255;
  }
  return sharp(buf, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();
}

function providerFor(mode: Mode): ImageProvider {
  const marker: Array<[string, DamageStage]> = [
    ['pristine', 'intact'], ['light weathering', 'light'], ['visible cracks', 'cracked'],
    ['large fractures', 'heavy'], ['sections collapsed', 'breached'], ['broken rubble', 'collapsed'],
  ];
  return {
    async generate(prompt: string): Promise<Buffer> {
      const stage = marker.find(([frag]) => prompt.includes(frag))?.[1] ?? 'intact';
      // second-attempt retry text present? still same stage — honest mock.
      return render(stage, mode);
    },
  };
}

const brief: StyleBrief = {
  id: 'byzantine_v1', name: 'Byzantine Bastion',
  aesthetic: 'weathered ochre sandstone with gold inlay',
  tilePx: S,
  surfaces: [{ archetype: 'wall', tier: 'outer' }],
  stages: [...DAMAGE_LADDER],
};

async function run() {
  const modes: Mode[] = ['GOOD', 'BROKEN_SEAM', 'BROKEN_PALETTE', 'BROKEN_MONOTON'];
  for (const mode of modes) {
    const { report } = await generateStylePack(brief, providerFor(mode), `/tmp/pack_${mode}`, DEFAULT_THRESHOLDS);
    console.log(`\n=== ${mode} ===  gate ${report.passed ? 'PASS ✅' : 'REJECT ⛔'}`);
    for (const p of report.perImage)
      console.log(`  ${p.key.padEnd(20)} seam=${p.seam.toFixed(4)} style=${p.styleCos.toFixed(3)} struct=${p.structure.toFixed(2)}`);
    if (report.reasons.length) console.log('  reasons:\n    - ' + report.reasons.join('\n    - '));
  }
}
run().catch(e => { console.error(e); process.exit(1); });
