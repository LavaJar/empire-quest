/**
 * makeByzantinePack — generates a REAL, gate-passing style pack using the
 * procedural provider and writes it under public/packs/byzantine_v1 so the
 * runtime can load it. Swap ProceduralProvider for an AI provider to get AI art
 * through the identical gate.
 */
import { generateStylePack, DEFAULT_THRESHOLDS, type StyleBrief } from './generateStylePack';
import { ProceduralProvider } from './ProceduralProvider';
import { DAMAGE_LADDER } from '../../src/siege/BlockStyle';

const brief: StyleBrief = {
  id: 'byzantine_v1',
  name: 'Byzantine Bastion',
  aesthetic: 'weathered ochre sandstone with gold mosaic inlay',
  tilePx: 256,
  surfaces: [
    { archetype: 'wall', tier: 'outer' },
    { archetype: 'wall', tier: 'inner' },
    { archetype: 'keep', tier: 'keep' },
  ],
  stages: [...DAMAGE_LADDER],
};

async function main() {
  const provider = new ProceduralProvider();
  const outDir = 'public/packs/byzantine_v1';
  const { manifest, report } = await generateStylePack(brief, provider, outDir, DEFAULT_THRESHOLDS);
  console.log(`gate: ${report.passed ? 'PASS ✅' : 'REJECT ⛔'}  (${report.perImage.length} images)`);
  if (!report.passed) { console.log('reasons:\n  - ' + report.reasons.join('\n  - ')); process.exit(1); }
  console.log(`pack: ${manifest.name}  surfaces=${Object.keys(manifest.surfaces).length}  hash=${manifest.integrityHash?.slice(0,12)}`);
  console.log(`wrote ${outDir}/manifest.json + ${report.perImage.length} textures`);
}
main().catch(e => { console.error(e); process.exit(1); });
