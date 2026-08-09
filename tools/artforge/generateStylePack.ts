/**
 * ArtForge — offline style-pack generator + QA gate.
 *
 * Runs on a server/box, never in the frame loop. It fills the full
 * (surface × damageStage) matrix for one architectural style, subjects every
 * image to an automated gate, and emits a StylePackManifest the runtime
 * StyleResolver can load. Nothing here is deterministic-per-frame; determinism
 * lives in the sim, which this never touches.
 *
 * The generator (which image model, which prompt) is behind an interface on
 * purpose — swap providers without touching the gate. The gate is the asset:
 * free-form image gen will happily produce a "Byzantine damaged wall" that
 * doesn't tile, doesn't match the intact wall's palette, and looks MORE intact
 * than the cracked one. The gate rejects all three failure classes before an
 * image is ever allowed near a player.
 *
 * Requires: sharp (image decode) — dev/build-time dependency only.
 */

import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';

import {
  BlockArchetype, WallTier, DamageStage, DAMAGE_LADDER,
  StylePackManifest, SurfaceTextures, TextureSet, surfaceKey,
} from '../../src/siege/BlockStyle';

/* ------------------------------------------------------------------ *
 * Provider seam — implement against whatever image model you use.
 * ------------------------------------------------------------------ */

export interface ImageProvider {
  /** Return raw PNG/JPEG bytes for a prompt at a fixed square size. */
  generate(prompt: string, sizePx: number): Promise<Buffer>;
}

/* ------------------------------------------------------------------ *
 * Style brief — the human-authored intent for one pack.
 * ------------------------------------------------------------------ */

export interface StyleBrief {
  id: string;                 // "byzantine_v1"
  name: string;               // "Byzantine Bastion"
  /** Prose identity shared by every prompt — the style-lock anchor. */
  aesthetic: string;          // "weathered ochre sandstone, gold mosaic inlay, ..."
  tilePx: number;             // 512 recommended
  /** Which (archetype,tier) surfaces this pack covers. */
  surfaces: Array<{ archetype: BlockArchetype; tier: WallTier }>;
  /** Rungs to generate. Fewer = cheaper pack; resolver interpolates gaps. */
  stages: DamageStage[];
}

const DAMAGE_LANGUAGE: Record<DamageStage, string> = {
  intact:    'pristine, fully intact, sharp mortar lines, no damage',
  light:     'light weathering, a few surface chips, structurally whole',
  cracked:   'visible cracks and spalling, mortar loss, still standing',
  heavy:     'large fractures, missing chunks, exposed inner core',
  breached:  'sections collapsed, gap punched through, rebar/timber exposed, scorch',
  collapsed: 'reduced to broken rubble and dust, barely recognizable',
};

function buildPrompt(brief: StyleBrief, archetype: BlockArchetype, tier: WallTier, stage: DamageStage): string {
  return [
    `Seamless tileable texture, top-down orthographic, flat even lighting.`,
    `Subject: ${tier} ${archetype} surface of a fortress.`,
    `Style: ${brief.aesthetic}.`,
    `Condition: ${DAMAGE_LANGUAGE[stage]}.`,
    `Must tile seamlessly on all four edges. No perspective, no vignette,`,
    `no lettering, no border. Square. Consistent palette across the set.`,
  ].join(' ');
}

/* ================================================================== *
 * THE QA GATE
 * ================================================================== */

interface Rgba { data: Buffer; w: number; h: number; }

async function decode(buf: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const px = (img: Rgba, x: number, y: number): [number, number, number] => {
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

/* --- Check 1: TILEABILITY -----------------------------------------
 * Under RepeatWrapping the right edge abuts the left edge and bottom abuts
 * top. A seam is visible iff those opposing edges differ. Measure mean
 * absolute per-channel difference across both wrap boundaries, normalise to
 * 0..1. Low = seamless.
 */
export function seamError(img: Rgba): number {
  let acc = 0, n = 0;
  for (let y = 0; y < img.h; y++) {
    const a = px(img, 0, y), b = px(img, img.w - 1, y);
    for (let c = 0; c < 3; c++) { acc += Math.abs(a[c] - b[c]); n++; }
  }
  for (let x = 0; x < img.w; x++) {
    const a = px(img, x, 0), b = px(img, x, img.h - 1);
    for (let c = 0; c < 3; c++) { acc += Math.abs(a[c] - b[c]); n++; }
  }
  return acc / n / 255;
}

/* --- Check 2: STYLE-LOCK ------------------------------------------
 * Every texture in a pack must belong to the same visual family. Fingerprint
 * each image as a coarse 4×4×4 RGB histogram (64 bins, L1-normalised), then
 * require each image's cosine similarity to the pack CENTROID to clear a
 * floor. Outliers — the one image the model rendered in the wrong palette —
 * get rejected even if they tile perfectly.
 */
export function paletteFingerprint(img: Rgba): Float64Array {
  // Bin CHROMATICITY (r,g fractions of total), 8×8 = 64 bins. This is
  // luminance-invariant on purpose: a style's identity is its hue family, and
  // the damage ladder is SUPPOSED to darken from bright stone to dark rubble.
  // Binning raw RGB would reject that legitimate darkening as a palette drift;
  // binning chromaticity lets brightness move freely while still catching an
  // image rendered in the wrong hue (a cold-blue stage in an ochre pack).
  const N = 8;
  const bins = new Float64Array(N * N);
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const sum = r + g + b + 1;
    const cr = Math.min(N - 1, (r / sum * N) | 0);
    const cg = Math.min(N - 1, (g / sum * N) | 0);
    bins[cr * N + cg]++;
  }
  let s = 0; for (const v of bins) s += v;
  if (s > 0) for (let i = 0; i < bins.length; i++) bins[i] /= s;
  return bins;
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/* --- Check 3: DAMAGE MONOTONICITY --------------------------------
 * The damage ladder must READ as a ladder: intact→rubble should lose
 * structure, not gain it. Proxy structure by edge-energy density (Sobel
 * magnitude mean): intact masonry has crisp, dense, regular edges; rubble is
 * higher-entropy but structurally LOWER — so we score "intactness" as edge
 * REGULARITY (variance of local edge energy is low when intact, high when
 * shattered). Require the intactness score to be non-increasing along the
 * ladder within a tolerance. Catches the classic failure where "crumbling"
 * looks tidier than "cracked".
 */
export function structureScore(img: Rgba): number {
  // Sobel magnitude on luminance, then return NEGATIVE spatial variance of it
  // (high, uniform edge density -> intact -> high score).
  const lum = new Float64Array(img.w * img.h);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++)
    lum[j] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  const at = (x: number, y: number) => lum[y * img.w + x];
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < img.h - 1; y++) for (let x = 1; x < img.w - 1; x++) {
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
             - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
             - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    const m = Math.hypot(gx, gy);
    sum += m; sumSq += m * m; n++;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  // Intact = dense edges (high mean) with low variance (regular). Combine.
  return mean / (1 + Math.sqrt(Math.max(variance, 0)));
}

export interface GateThresholds {
  maxSeamError: number;      // 0.06 ≈ imperceptible seam
  minStyleCosine: number;    // 0.90 to the pack centroid
  monotonicTolerance: number;// fraction a rung may exceed its predecessor
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  maxSeamError: 0.06,
  minStyleCosine: 0.90,
  monotonicTolerance: 0.08,
};

export interface GateReport {
  passed: boolean;
  reasons: string[];
  perImage: Array<{ key: string; seam: number; styleCos: number; structure: number }>;
}

/* ================================================================== *
 * Orchestration
 * ================================================================== */

interface Candidate {
  archetype: BlockArchetype; tier: WallTier; stage: DamageStage;
  buf: Buffer; img: Rgba; fp: Float64Array; key: string;
}

export async function generateStylePack(
  brief: StyleBrief,
  provider: ImageProvider,
  outDir: string,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): Promise<{ manifest: StylePackManifest; report: GateReport }> {
  const stages = brief.stages.length ? brief.stages : [...DAMAGE_LADDER];

  // 1. Generate every cell (with one retry on a per-image tileability miss).
  const cands: Candidate[] = [];
  for (const s of brief.surfaces) for (const stage of stages) {
    const key = `${surfaceKey(s.archetype, s.tier)}|${stage}`;
    let buf = await provider.generate(buildPrompt(brief, s.archetype, s.tier, stage), brief.tilePx);
    let img = await decode(buf);
    if (seamError(img) > thresholds.maxSeamError) {
      buf = await provider.generate(
        buildPrompt(brief, s.archetype, s.tier, stage) + ' Edges must wrap perfectly.',
        brief.tilePx,
      );
      img = await decode(buf);
    }
    cands.push({ ...s, stage, buf, img, fp: paletteFingerprint(img), key });
  }

  // 2. Pack style centroid, for style-lock scoring.
  const centroid = new Float64Array(64);
  for (const c of cands) for (let i = 0; i < 64; i++) centroid[i] += c.fp[i];
  for (let i = 0; i < 64; i++) centroid[i] /= cands.length;

  // 3. Gate: tileability + style-lock (per image) then monotonicity (per surface).
  const report: GateReport = { passed: true, reasons: [], perImage: [] };
  for (const c of cands) {
    const seam = seamError(c.img);
    const styleCos = cosine(c.fp, centroid);
    const structure = structureScore(c.img);
    report.perImage.push({ key: c.key, seam, styleCos, structure });
    if (seam > thresholds.maxSeamError)
      report.reasons.push(`${c.key}: seam ${seam.toFixed(3)} > ${thresholds.maxSeamError}`);
    if (styleCos < thresholds.minStyleCosine)
      report.reasons.push(`${c.key}: style ${styleCos.toFixed(3)} < ${thresholds.minStyleCosine} (palette outlier)`);
  }
  for (const s of brief.surfaces) {
    const ladder = stages
      .map(st => report.perImage.find(p => p.key === `${surfaceKey(s.archetype, s.tier)}|${st}`))
      .filter(Boolean) as GateReport['perImage'];
    for (let i = 1; i < ladder.length; i++) {
      const prev = ladder[i - 1].structure, cur = ladder[i].structure;
      if (cur > prev * (1 + thresholds.monotonicTolerance))
        report.reasons.push(
          `${surfaceKey(s.archetype, s.tier)}: '${stages[i]}' reads more intact than '${stages[i - 1]}'`);
    }
  }
  report.passed = report.reasons.length === 0;
  if (!report.passed) return { manifest: emptyManifest(brief), report };

  // 4. Passed — write images and assemble the manifest.
  await mkdir(outDir, { recursive: true });
  const surfaces: SurfaceTextures = {};
  const hash = createHash('sha256');
  for (const c of cands) {
    const rel = `${c.key.replace('|', '_')}.png`;
    await writeFile(path.join(outDir, rel), c.buf);
    hash.update(c.buf);
    const skey = surfaceKey(c.archetype, c.tier);
    (surfaces[skey] ??= {})[c.stage] = { albedo: rel } satisfies TextureSet;
  }

  const manifest: StylePackManifest = {
    id: brief.id, name: brief.name, version: 1, origin: 'synthetic',
    baseUrl: `/packs/${brief.id}`, tilePx: brief.tilePx, surfaces,
    integrityHash: hash.digest('hex'),
  };
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, report };
}

function emptyManifest(brief: StyleBrief): StylePackManifest {
  return { id: brief.id, name: brief.name, version: 0, origin: 'synthetic',
           baseUrl: '', tilePx: brief.tilePx, surfaces: {} };
}
