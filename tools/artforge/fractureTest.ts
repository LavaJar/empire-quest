import { readFile, writeFile } from 'node:fs/promises';
import { extractFractureGraph, renderFractureOverlay } from './FractureForge';
const files = ['wall.outer_intact','wall.inner_intact','keep.keep_intact'];
for (const f of files) {
  const png = await readFile(`public/packs/byzantine_v1/${f}.png`);
  const g = await extractFractureGraph(png);
  console.log(`${f.padEnd(20)} cells=${String(g.cellCount).padStart(3)} adj=${String(g.adjacency.length).padStart(3)} anchors=${g.cells.filter(c=>c.anchor).length} jointAlignment=${g.jointAlignment}`);
  await writeFile(`/tmp/overlay_${f}.png`, await renderFractureOverlay(png, g));
  await writeFile(`public/packs/byzantine_v1/${f}.fracture.json`, JSON.stringify(g));
}
