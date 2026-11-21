import * as THREE from 'three';

/**
 * Procedural texture generators for Empire Quest.
 * All textures are generated on canvas at runtime — no external assets.
 * Each generator returns a THREE.CanvasTexture ready for MeshStandardMaterial.
 */

// --- Seeded RNG for deterministic textures ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --- Noise helpers ---
function valueNoise2D(ctx: CanvasRenderingContext2D, size: number, scale: number, seed: number, amount: number): void {
  // Cheap per-pixel value noise via ImageData
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const rng = mulberry32(seed);
  const grid = 16;
  const cells: number[] = [];
  for (let i = 0; i < grid * grid; i++) cells.push(rng());
  const cell = (x: number, y: number) => cells[((y % grid) + grid) % grid * grid + ((x % grid) + grid) % grid];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * scale, gy = (y / size) * scale;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = smooth(gx - x0), fy = smooth(gy - y0);
      const v = cell(x0, y0) * (1 - fx) * (1 - fy) + cell(x0 + 1, y0) * fx * (1 - fy) +
                cell(x0, y0 + 1) * (1 - fx) * fy + cell(x0 + 1, y0 + 1) * fx * fy;
      const i = (y * size + x) * 4;
      const m = 1 + (v - 0.5) * 2 * amount;
      d[i] = Math.min(255, d[i] * m);
      d[i + 1] = Math.min(255, d[i + 1] * m);
      d[i + 2] = Math.min(255, d[i + 2] * m);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Stone masonry texture: staggered block courses with mortar, per-block
 * color variation, soot streaks from top, and edge wear.
 */
export function createStoneMasonryTexture(seed = 7, size = 256): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  // Mortar base
  ctx.fillStyle = '#5a554c';
  ctx.fillRect(0, 0, size, size);

  const rows = 8;
  const rowH = size / rows;
  const blockW = size / 4;

  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * (blockW / 2);
    for (let col = -1; col < 5; col++) {
      const x = col * blockW + offset;
      const y = row * rowH;
      const w = blockW - 3;
      const h = rowH - 3;

      // Per-block stone color (warm limestone range)
      const base = 128 + rng() * 40;
      const warm = rng() * 14;
      const r = base + warm;
      const g = base + warm * 0.6;
      const b = base * 0.82;

      // Block gradient (top-lit)
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, `rgb(${r + 22},${g + 20},${b + 14})`);
      grad.addColorStop(0.5, `rgb(${r},${g},${b})`);
      grad.addColorStop(1, `rgb(${r - 26},${g - 24},${b - 18})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1.5, y + 1.5, w, h);

      // Block surface noise
      for (let s = 0; s < 14; s++) {
        const sx = x + 2 + rng() * (w - 4);
        const sy = y + 2 + rng() * (h - 4);
        const sr = 1 + rng() * 3;
        ctx.fillStyle = rng() > 0.5 ? 'rgba(255,250,235,0.06)' : 'rgba(30,25,20,0.08)';
        ctx.beginPath();
        ctx.ellipse(sx, sy, sr, sr * 0.7, rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Chip on a few block corners
      if (rng() > 0.8) {
        ctx.fillStyle = 'rgba(60,55,48,0.9)';
        const cx = rng() > 0.5 ? x + w : x;
        const cy = rng() > 0.5 ? y + h : y;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (cx > x ? -6 : 6), cy);
        ctx.lineTo(cx, cy + (cy > y ? -6 : 6));
        ctx.closePath();
        ctx.fill();
      }

      // Highlight top edge, shadow bottom edge
      ctx.fillStyle = 'rgba(255,245,225,0.18)';
      ctx.fillRect(x + 1.5, y + 1.5, w, 1.5);
      ctx.fillStyle = 'rgba(20,16,12,0.3)';
      ctx.fillRect(x + 1.5, y + h, w, 1.5);
    }
  }

  // Soot streaks from the top
  for (let s = 0; s < 10; s++) {
    const sx = rng() * size;
    const sw = 4 + rng() * 14;
    const sh = 20 + rng() * 70;
    const grad = ctx.createLinearGradient(0, 0, 0, sh);
    grad.addColorStop(0, 'rgba(25,20,15,0.35)');
    grad.addColorStop(1, 'rgba(25,20,15,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(sx - sw / 2, 0, sw, sh);
  }

  // Overall grain
  valueNoise2D(ctx, size, 8, seed + 100, 0.12);

  return toTexture(c, 2, 1);
}

/**
 * Vertical stone for towers: tall blocks, weathered.
 */
export function createTowerStoneTexture(seed = 11, size = 128): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  ctx.fillStyle = '#565148';
  ctx.fillRect(0, 0, size, size);

  const rows = 6;
  const rowH = size / rows;
  for (let row = 0; row < rows; row++) {
    const y = row * rowH;
    const base = 120 + rng() * 30;
    const grad = ctx.createLinearGradient(0, y, 0, y + rowH);
    grad.addColorStop(0, `rgb(${base + 24},${base + 20},${base + 10})`);
    grad.addColorStop(1, `rgb(${base - 22},${base - 20},${base - 14})`);
    ctx.fillStyle = grad;
    ctx.fillRect(1.5, y + 1.5, size - 3, rowH - 3);
    // Vertical weathering streaks
    for (let s = 0; s < 5; s++) {
      const sx = rng() * size;
      ctx.fillStyle = 'rgba(30,25,20,0.07)';
      ctx.fillRect(sx, y + 2, 2 + rng() * 3, rowH - 4);
    }
    ctx.fillStyle = 'rgba(255,245,225,0.15)';
    ctx.fillRect(1.5, y + 1.5, size - 3, 1.2);
    ctx.fillStyle = 'rgba(20,16,12,0.35)';
    ctx.fillRect(1.5, y + rowH - 2, size - 3, 1.2);
  }

  valueNoise2D(ctx, size, 6, seed + 50, 0.14);
  return toTexture(c, 1, 2);
}

/**
 * Terracotta roof tiles: scalloped rows with per-tile variation.
 */
export function createRoofTileTexture(baseColor = '#a05a38', seed = 21, size = 256): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  ctx.fillStyle = '#3a2a20';
  ctx.fillRect(0, 0, size, size);

  const rows = 8;
  const rowH = size / rows;
  const cols = 10;
  const colW = size / cols;

  const cr = parseInt(baseColor.slice(1, 3), 16);
  const cg = parseInt(baseColor.slice(3, 5), 16);
  const cb = parseInt(baseColor.slice(5, 7), 16);

  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * (colW / 2);
    for (let col = -1; col < cols + 1; col++) {
      const x = col * colW + offset;
      const y = row * rowH;
      const v = (rng() - 0.5) * 26;
      const r = Math.min(255, cr + v);
      const g = Math.min(255, cg + v * 0.8);
      const b = Math.min(255, cb + v * 0.6);

      // Tile: rounded scallop shape
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.moveTo(x + 1, y);
      ctx.lineTo(x + colW - 1, y);
      ctx.lineTo(x + colW - 1, y + rowH * 0.7);
      ctx.quadraticCurveTo(x + colW / 2, y + rowH + 3, x + 1, y + rowH * 0.7);
      ctx.closePath();
      ctx.fill();

      // Highlight top, shadow bottom curve
      ctx.fillStyle = 'rgba(255,235,210,0.2)';
      ctx.fillRect(x + 1, y, colW - 2, 2);
      ctx.fillStyle = 'rgba(20,12,8,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + colW / 2, y + rowH * 0.75, colW / 2 - 2, 3, 0, 0, Math.PI);
      ctx.fill();
    }
  }

  valueNoise2D(ctx, size, 7, seed + 77, 0.15);
  return toTexture(c, 2, 2);
}

/**
 * Weathered wood planks (horizontal).
 */
export function createWoodTexture(baseColor = '#6a4a2a', seed = 31, size = 128): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  const cr = parseInt(baseColor.slice(1, 3), 16);
  const cg = parseInt(baseColor.slice(3, 5), 16);
  const cb = parseInt(baseColor.slice(5, 7), 16);

  const planks = 6;
  const pH = size / planks;
  for (let p = 0; p < planks; p++) {
    const y = p * pH;
    const v = (rng() - 0.5) * 20;
    const grad = ctx.createLinearGradient(0, y, size, y);
    grad.addColorStop(0, `rgb(${cr + v},${cg + v * 0.8},${cb + v * 0.6})`);
    grad.addColorStop(0.5, `rgb(${cr + v + 12},${cg + v * 0.8 + 10},${cb + v * 0.6 + 6})`);
    grad.addColorStop(1, `rgb(${cr + v - 8},${cg + v * 0.8 - 6},${cb + v * 0.6 - 4})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, size, pH);

    // Grain lines
    ctx.strokeStyle = 'rgba(30,18,8,0.25)';
    ctx.lineWidth = 0.8;
    for (let g = 0; g < 4; g++) {
      const gy = y + 2 + rng() * (pH - 4);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= size; x += 16) {
        ctx.lineTo(x, gy + Math.sin(x * 0.05 + rng() * 6) * 1.5);
      }
      ctx.stroke();
    }
    // Knot
    if (rng() > 0.6) {
      const kx = rng() * size, ky = y + pH / 2;
      ctx.fillStyle = 'rgba(40,24,10,0.5)';
      ctx.beginPath();
      ctx.ellipse(kx, ky, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Plank seam
    ctx.fillStyle = 'rgba(15,10,5,0.6)';
    ctx.fillRect(0, y, size, 1.5);
  }

  valueNoise2D(ctx, size, 5, seed + 99, 0.1);
  return toTexture(c, 2, 1);
}

/**
 * Grass/ground texture: mottled green with blades.
 */
export function createGrassTexture(baseColor = '#4a6330', seed = 41, size = 128): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  const cr = parseInt(baseColor.slice(1, 3), 16);
  const cg = parseInt(baseColor.slice(3, 5), 16);
  const cb = parseInt(baseColor.slice(5, 7), 16);

  ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
  ctx.fillRect(0, 0, size, size);

  // Mottled patches
  for (let i = 0; i < 60; i++) {
    const x = rng() * size, y = rng() * size;
    const r = 4 + rng() * 12;
    const v = (rng() - 0.5) * 30;
    ctx.fillStyle = `rgba(${cr + v},${cg + v},${cb + v * 0.5},0.35)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Individual grass blades
  for (let i = 0; i < 400; i++) {
    const x = rng() * size, y = rng() * size;
    const h = 2 + rng() * 4;
    const v = (rng() - 0.5) * 40;
    ctx.strokeStyle = `rgba(${cr + v},${cg + v + 10},${cb + v * 0.4},0.5)`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rng() - 0.5) * 2, y - h * 0.6, x + (rng() - 0.5) * 3, y - h);
    ctx.stroke();
  }

  // Dirt specks
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(90,75,50,0.25)';
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 0.5 + rng() * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  return toTexture(c, 8, 8);
}

/**
 * Cobblestone road texture.
 */
export function createCobblestoneTexture(seed = 51, size = 128): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  ctx.fillStyle = '#4a453e';
  ctx.fillRect(0, 0, size, size);

  const cell = 16;
  for (let y = 0; y < size / cell; y++) {
    for (let x = 0; x < size / cell; x++) {
      const px = x * cell + (y % 2) * (cell / 4);
      const py = y * cell;
      const v = (rng() - 0.5) * 30;
      const base = 100 + v;
      const grad = ctx.createRadialGradient(px + cell / 2, py + cell / 2, 1, px + cell / 2, py + cell / 2, cell / 2);
      grad.addColorStop(0, `rgb(${base + 18},${base + 14},${base + 8})`);
      grad.addColorStop(1, `rgb(${base - 14},${base - 12},${base - 8})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(px + cell / 2, py + cell / 2, cell / 2 - 1.5, cell / 2 - 2, rng() * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  valueNoise2D(ctx, size, 6, seed + 33, 0.12);
  return toTexture(c, 4, 4);
}

/**
 * Rocky mountain texture.
 */
export function createRockTexture(seed = 61, size = 128): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  ctx.fillStyle = '#5a5550';
  ctx.fillRect(0, 0, size, size);

  // Faceted rock cracks
  for (let i = 0; i < 24; i++) {
    const x = rng() * size, y = rng() * size;
    const v = (rng() - 0.5) * 40;
    const r = 8 + rng() * 20;
    ctx.fillStyle = `rgba(${90 + v},${85 + v},${78 + v},0.5)`;
    ctx.beginPath();
    const pts = 5 + Math.floor(rng() * 3);
    for (let p = 0; p < pts; p++) {
      const a = (p / pts) * Math.PI * 2;
      const rr = r * (0.6 + rng() * 0.4);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Crack lines
  ctx.strokeStyle = 'rgba(25,22,18,0.4)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    let x = rng() * size, y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (rng() - 0.5) * 30;
      y += (rng() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  valueNoise2D(ctx, size, 5, seed + 11, 0.2);
  return toTexture(c, 4, 4);
}

/**
 * Sand/desert texture.
 */
export function createSandTexture(seed = 71, size = 128): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  ctx.fillStyle = '#a07838';
  ctx.fillRect(0, 0, size, size);

  // Dune ripples
  for (let i = 0; i < 30; i++) {
    const y = rng() * size;
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(220,180,110,0.2)' : 'rgba(120,85,40,0.2)';
    ctx.lineWidth = 1.5 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 8) {
      ctx.lineTo(x, y + Math.sin(x * 0.08 + i) * 3);
    }
    ctx.stroke();
  }

  // Speckles
  for (let i = 0; i < 300; i++) {
    const v = (rng() - 0.5) * 40;
    ctx.fillStyle = `rgba(${160 + v},${120 + v * 0.8},${56 + v * 0.5},0.4)`;
    ctx.fillRect(rng() * size, rng() * size, 1.5, 1.5);
  }

  return toTexture(c, 6, 6);
}

/**
 * Neutral grayscale ground detail (multiplies with vertex colors without
 * shifting biome hue). Also usable as a bump map for micro-relief.
 */
export function createGroundDetailTexture(seed = 101, size = 256): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  // Mid-gray base
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // Large soft patches
  for (let i = 0; i < 50; i++) {
    const x = rng() * size, y = rng() * size;
    const r = 8 + rng() * 30;
    const v = 100 + Math.floor(rng() * 60);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${v},${v},${v},0.3)`);
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine speckle
  for (let i = 0; i < 1500; i++) {
    const v = 90 + Math.floor(rng() * 80);
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }

  const tex = toTexture(c, 16, 12, false);
  return tex;
}

/**
 * Water surface texture: soft moving ripples (used as map + bump).
 */
export function createWaterTexture(seed = 81, size = 128): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#2a6a80');
  grad.addColorStop(0.5, '#1e5568');
  grad.addColorStop(1, '#164a5e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Ripple highlights
  for (let i = 0; i < 40; i++) {
    const x = rng() * size, y = rng() * size;
    const r = 3 + rng() * 10;
    ctx.strokeStyle = `rgba(180,220,235,${0.06 + rng() * 0.1})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = toTexture(c, 12, 9);
  return tex;
}

/**
 * Copper dome texture (oxidized patina) for grand buildings.
 */
export function createCopperDomeTexture(seed = 91, size = 128): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rng = mulberry32(seed);

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#4a8a78');
  grad.addColorStop(0.5, '#3a7a68');
  grad.addColorStop(1, '#2a5a4e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Patina variation
  for (let i = 0; i < 30; i++) {
    const x = rng() * size, y = rng() * size;
    const r = 5 + rng() * 18;
    const v = rng();
    ctx.fillStyle = v > 0.5 ? 'rgba(120,190,170,0.15)' : 'rgba(30,70,60,0.18)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Vertical panel seams
  ctx.strokeStyle = 'rgba(20,50,44,0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * size;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  return toTexture(c, 2, 1);
}