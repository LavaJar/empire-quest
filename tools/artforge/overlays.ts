import { readFile, writeFile } from 'node:fs/promises';
import { extractFractureGraph, renderFractureOverlay } from './FractureForge';
for (const f of ['wall.outer','wall.inner','keep.keep']) {
  const png = await readFile(`public/packs/byzantine_v1/${f}_intact.png`);
  const g = await extractFractureGraph(png);
  await writeFile(`/home/claude/out/fracture_${f}.png`, await renderFractureOverlay(png, g));
  console.log(`${f}: cells=${g.cellCount} jointAlignment=${g.jointAlignment} anchors=${g.cells.filter(c=>c.anchor).length}`);
}
