/**
 * FractureForge — art-conditioned fracture.
 *
 * The core innovation: destruction geometry is DERIVED FROM THE ART. Given a
 * masonry albedo tile, we recover the mortar-joint graph the generator drew and
 * build a fracture pattern whose cell boundaries follow those joints — so the
 * wall shatters along its own bricks, per style, deterministically.
 *
 * Pipeline (all deterministic; seeds come from the image, not RNG):
 *   1. luminance
 *   2. joint mask   — adaptive threshold: mortar is locally darker than brick
 *   3. distance xform (chamfer) from joints → brick "coreness"
 *   4. brick seeds  — non-max suppression of the distance field
 *   5. grid Voronoi — nearest-seed labelling; cell edges land on the joints
 *   6. graph        — cells (centroid, area, anchor), adjacency, joint-alignment
 *
 * Output feeds the runtime fracture: cells detach as fragments from a breach
 * outward, gravity-collapsing when they lose their path to an anchor row.
 */

import sharp from 'sharp';

export interface FractureCell {
  id: number; cx: number; cy: number; area: number;
  anchor: boolean;          // touches the base row → load-bearing to ground
  edge: boolean;            // touches a tile border → seam with neighbour tiles
}
export interface FractureGraph {
  tilePx: number;
  cellCount: number;
  cells: FractureCell[];
  adjacency: Array<[number, number]>;
  /** fraction of cell-boundary pixels that coincide with a joint pixel (0..1). */
  jointAlignment: number;
  seedCount: number;
}

interface Gray { l: Float32Array; w: number; h: number; }

async function luminance(buf: Buffer): Promise<Gray> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, l = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++)
    l[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return { l, w, h };
}

/** Mortar = locally darker than the mean of its neighbourhood by margin k. */
function jointMask(g: Gray, radius = 6, k = 10): Uint8Array {
  const { l, w, h } = g;
  const mask = new Uint8Array(w * h);
  // box-blur mean via separable prefix sums
  const mean = boxMean(l, w, h, radius);
  for (let i = 0; i < l.length; i++) mask[i] = l[i] < mean[i] - k ? 1 : 0;
  return mask;
}

function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = 0; x < w; x++) { acc += src[row + x]; if (x > 2 * r) acc -= src[row + x - 2 * r - 1];
      const c = x - r; if (c >= 0) tmp[row + c] = acc / Math.min(2 * r + 1, x + 1); }
    for (let x = w - r; x < w; x++) tmp[row + x] = tmp[row + w - r - 1];
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = 0; y < h; y++) { acc += tmp[y * w + x]; if (y > 2 * r) acc -= tmp[(y - 2 * r - 1) * w + x];
      const c = y - r; if (c >= 0) out[c * w + x] = acc / Math.min(2 * r + 1, y + 1); }
    for (let y = h - r; y < h; y++) out[y * w + x] = out[(h - r - 1) * w + x];
  }
  return out;
}

/** Chamfer distance transform: value = distance from each pixel to nearest joint. */
function distanceToJoint(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const at = (x: number, y: number) => d[y * w + x];
  const set = (x: number, y: number, v: number) => { d[y * w + x] = v; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = at(x, y);
    if (x > 0) v = Math.min(v, at(x - 1, y) + 1);
    if (y > 0) v = Math.min(v, at(x, y - 1) + 1);
    if (x > 0 && y > 0) v = Math.min(v, at(x - 1, y - 1) + 1.414);
    if (x < w - 1 && y > 0) v = Math.min(v, at(x + 1, y - 1) + 1.414);
    set(x, y, v);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    let v = at(x, y);
    if (x < w - 1) v = Math.min(v, at(x + 1, y) + 1);
    if (y < h - 1) v = Math.min(v, at(x, y + 1) + 1);
    if (x < w - 1 && y < h - 1) v = Math.min(v, at(x + 1, y + 1) + 1.414);
    if (x > 0 && y < h - 1) v = Math.min(v, at(x - 1, y + 1) + 1.414);
    set(x, y, v);
  }
  return d;
}

/** Brick centres = local maxima of the distance field (non-max suppression). */
function brickSeeds(dist: Float32Array, w: number, h: number, minDist = 4, nms = 5): Array<[number, number]> {
  const seeds: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = dist[y * w + x];
    if (v < minDist) continue;
    let isMax = true;
    for (let dy = -nms; dy <= nms && isMax; dy++) for (let dx = -nms; dx <= nms; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nv = dist[ny * w + nx];
      if (nv > v || (nv === v && (ny < y || (ny === y && nx < x)))) { isMax = false; break; }
    }
    if (isMax) seeds.push([x, y]);
  }
  return seeds;
}

/** Nearest-seed labelling (grid Voronoi). Cell edges fall between seeds → on joints. */
function voronoi(seeds: Array<[number, number]>, w: number, h: number): Int32Array {
  const label = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = 0, bd = Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const dx = x - seeds[s][0], dy = y - seeds[s][1], dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = s; }
    }
    label[y * w + x] = best;
  }
  return label;
}

export async function extractFractureGraph(
  albedoPng: Buffer,
  opts: { jointRadius?: number; jointK?: number; seedMinDist?: number } = {},
): Promise<FractureGraph> {
  const g = await luminance(albedoPng);
  const { w, h } = g;
  const mask = jointMask(g, opts.jointRadius ?? 6, opts.jointK ?? 10);
  const dist = distanceToJoint(mask, w, h);
  const seeds = brickSeeds(dist, w, h, opts.seedMinDist ?? 4, 5);
  const label = voronoi(seeds, w, h);

  // per-cell stats
  const n = seeds.length;
  const sx = new Float64Array(n), sy = new Float64Array(n), area = new Float64Array(n);
  const anchor = new Uint8Array(n), edge = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = label[y * w + x]; sx[c] += x; sy[c] += y; area[c]++;
    if (y === h - 1) anchor[c] = 1;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge[c] = 1;
  }

  // adjacency + joint-alignment: boundary pixel = neighbour label differs.
  const adj = new Set<string>();
  let boundary = 0, onJoint = 0;
  const near = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (mask[ny * w + nx]) return true;
    }
    return false;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = label[y * w + x];
    const r = x < w - 1 ? label[y * w + x + 1] : c;
    const d = y < h - 1 ? label[(y + 1) * w + x] : c;
    if (r !== c) { adj.add(c < r ? `${c},${r}` : `${r},${c}`); boundary++; if (near(x, y)) onJoint++; }
    if (d !== c) { adj.add(c < d ? `${c},${d}` : `${d},${c}`); boundary++; if (near(x, y)) onJoint++; }
  }

  const cells: FractureCell[] = [];
  for (let c = 0; c < n; c++) cells.push({
    id: c, cx: +(sx[c] / area[c]).toFixed(1), cy: +(sy[c] / area[c]).toFixed(1),
    area: area[c], anchor: !!anchor[c], edge: !!edge[c],
  });

  return {
    tilePx: w, cellCount: n, cells,
    adjacency: [...adj].map(s => s.split(',').map(Number) as [number, number]),
    jointAlignment: boundary ? +(onJoint / boundary).toFixed(3) : 0,
    seedCount: n,
  };
}

/** Debug overlay: cell boundaries in red, joints in cyan — visual proof of alignment. */
export async function renderFractureOverlay(albedoPng: Buffer, graph: FractureGraph): Promise<Buffer> {
  const g = await luminance(albedoPng); const { w, h } = g;
  const mask = jointMask(g);
  const dist = distanceToJoint(mask, w, h);
  const seeds = brickSeeds(dist, w, h);
  const label = voronoi(seeds, w, h);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const base = g.l[y * w + x] * 0.6;
    out[i] = base; out[i + 1] = base; out[i + 2] = base; out[i + 3] = 255;
    if (mask[y * w + x]) { out[i] = 0; out[i + 1] = 180; out[i + 2] = 200; }
    const c = label[y * w + x];
    const rDiff = x < w - 1 && label[y * w + x + 1] !== c;
    const dDiff = y < h - 1 && label[(y + 1) * w + x] !== c;
    if (rDiff || dDiff) { out[i] = 255; out[i + 1] = 40; out[i + 2] = 40; }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
