/**
 * PBRForge — derive a full, tileable PBR set from a single albedo tile.
 *   height  : luminance (bricks proud, mortar recessed), mild contrast curve
 *   normal  : from height gradient (wrap-aware) → carved relief under lighting
 *   ao      : cavity occlusion = height below local mean → soft contact shadow
 *   rough   : mortar rougher than brick face, derived from height
 * All ops wrap at tile edges so the derived maps tile exactly like the albedo.
 * This is what lifts the look from "flat sticker" to "lit stone": parallax and
 * normal detail on otherwise flat block faces. AI albedo drops straight in.
 */
import sharp from 'sharp';

interface Field { v: Float32Array; w: number; h: number; }

async function heightFromAlbedo(png: Buffer): Promise<Field> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, v = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    v[j] = Math.pow(lum, 1.2);               // gentle curve: deepen the mortar
  }
  return { v, w, h };
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;

function boxMeanWrap(f: Field, r: number): Float32Array {
  const { v, w, h } = f; const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let dx = -r; dx <= r; dx++) s += v[y * w + wrap(x + dx, w)];
    tmp[y * w + x] = s / win;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let dy = -r; dy <= r; dy++) s += tmp[wrap(y + dy, h) * w + x];
    out[y * w + x] = s / win;
  }
  return out;
}

async function encodeGray(v: Float32Array, w: number, h: number): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < v.length; i++) { const g = Math.max(0, Math.min(255, v[i] * 255)); buf[i*3]=buf[i*3+1]=buf[i*3+2]=g; }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

export interface PBRSet { height: Buffer; normal: Buffer; ao: Buffer; roughness: Buffer; }

export async function derivePBR(albedoPng: Buffer, strength = 2.2): Promise<PBRSet> {
  const H = await heightFromAlbedo(albedoPng);
  const { v, w, h } = H;
  const at = (x: number, y: number) => v[wrap(y, h) * w + wrap(x, w)];

  // normal via Sobel on height, wrap-aware
  const nbuf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = (at(x+1,y-1)+2*at(x+1,y)+at(x+1,y+1)) - (at(x-1,y-1)+2*at(x-1,y)+at(x-1,y+1));
    const gy = (at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1)) - (at(x-1,y-1)+2*at(x,y-1)+at(x+1,y-1));
    let nx = -gx * strength, ny = -gy * strength, nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz); nx *= inv; ny *= inv; nz *= inv;
    const i = (y * w + x) * 3;
    nbuf[i]   = (nx * 0.5 + 0.5) * 255;
    nbuf[i+1] = (ny * 0.5 + 0.5) * 255;
    nbuf[i+2] = (nz * 0.5 + 0.5) * 255;
  }
  const normal = await sharp(nbuf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();

  // AO: how far below the local mean each pixel sits (cavities occlude)
  const mean = boxMeanWrap(H, Math.max(2, Math.round(w / 32)));
  const ao = new Float32Array(w * h), rough = new Float32Array(w * h);
  for (let i = 0; i < v.length; i++) {
    ao[i] = Math.max(0, Math.min(1, 1 - (mean[i] - v[i]) * 3.0));
    rough[i] = Math.max(0.35, Math.min(1, 1 - 0.45 * v[i]));   // mortar rougher
  }
  return { height: await encodeGray(v, w, h), normal, ao: await encodeGray(ao, w, h), roughness: await encodeGray(rough, w, h) };
}
