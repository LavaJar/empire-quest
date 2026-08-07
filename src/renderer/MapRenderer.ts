import { ArmyState, BiomeType, Camera, MapFeature, Position, SimulationState, Territory, WeatherState } from '../types';
import type { Convoy } from '../types/physicalEconomy';
import { SimplexNoise } from '../utils/noise';

/** Canvas 2D renderer for the Empire Quest strategic map. */
export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 1500;
export const TERRAIN_TILE_SIZE = 8;

export interface MapRendererOptions {
  seed?: number;
  onFeatureClick?: (feature: MapFeature | null) => void;
  onHover?: (feature: MapFeature | null, screenPosition: Position) => void;
  onCameraChange?: (camera: Camera) => void;
}

interface TerrainTile { biome: BiomeType; elevation: number; moisture: number; }
interface River { points: Position[]; width: number; }
interface WeatherParticle { x: number; y: number; vx: number; vy: number; size: number; phase: number; }

const BIOME_COLORS: Record<BiomeType, string> = {
  deep_water: '#0f2738', coastal: '#1e5568', lake: '#164a5e', grassland: '#4a6330',
  forest: '#234428', dense_forest: '#143018', mountain: '#5a5550', mountain_pass: '#7e7568',
  desert: '#a07838', marsh: '#3a5640', farmland: '#6a7a35', tundra: '#aab5ac',
};

const BIOME_COLORS_DARK: Record<BiomeType, string> = {
  deep_water: '#091a26', coastal: '#144050', lake: '#103848', grassland: '#3a5025',
  forest: '#1a3520', dense_forest: '#0e2512', mountain: '#4a4540', mountain_pass: '#6a6058',
  desert: '#8a6830', marsh: '#2e4835', farmland: '#5a6828', tundra: '#98a59c',
};

function polygonCentroid(polygon: Position[]): Position {
  let cx = 0, cy = 0;
  for (const p of polygon) { cx += p.x; cy += p.y; }
  return { x: cx / polygon.length, y: cy / polygon.length };
}

export const TERRITORIES: Territory[] = [
  { kingdomId: 'azure_coast', color: 'rgba(21,101,192,.18)', polygon: [{ x: 70, y: 170 }, { x: 570, y: 100 }, { x: 700, y: 560 }, { x: 430, y: 760 }, { x: 90, y: 620 }] },
  { kingdomId: 'ironpeak_hold', color: 'rgba(80,80,80,.22)', polygon: [{ x: 570, y: 100 }, { x: 1230, y: 70 }, { x: 1310, y: 460 }, { x: 920, y: 650 }, { x: 700, y: 560 }] },
  { kingdomId: 'whispering_weald', color: 'rgba(27,94,32,.20)', polygon: [{ x: 1310, y: 180 }, { x: 1910, y: 140 }, { x: 1920, y: 720 }, { x: 1510, y: 790 }, { x: 1310, y: 460 }] },
  { kingdomId: 'verdant_realm', color: 'rgba(46,125,50,.20)', polygon: [{ x: 430, y: 760 }, { x: 920, y: 650 }, { x: 1150, y: 1120 }, { x: 750, y: 1410 }, { x: 130, y: 1280 }] },
  { kingdomId: 'silver_crown', color: 'rgba(106,27,154,.18)', polygon: [{ x: 920, y: 650 }, { x: 1510, y: 790 }, { x: 1640, y: 1280 }, { x: 1150, y: 1420 }, { x: 1150, y: 1120 }] },
  { kingdomId: 'sands_of_zahar', color: 'rgba(230,81,0,.18)', polygon: [{ x: 1510, y: 790 }, { x: 1920, y: 720 }, { x: 1940, y: 1430 }, { x: 1640, y: 1280 }] },
];

export const KINGDOM_COLORS: Record<string, string> = {
  azure_coast: '#42a5f5', ironpeak_hold: '#b8b0a6', whispering_weald: '#4caf50',
  verdant_realm: '#d4b14d', silver_crown: '#bd72d1', sands_of_zahar: '#ff9b3d',
};

const KINGDOM_NAMES: Record<string, string> = {
  azure_coast: 'Azure Coast', ironpeak_hold: 'Ironpeak Hold', whispering_weald: 'Whispering Weald',
  verdant_realm: 'Verdant Realm', silver_crown: 'Silver Crown', sands_of_zahar: 'Sands of Zahar',
};

/**
 * Championship-quality strategic map renderer.
 * Features smooth terrain, atmospheric effects, detailed features,
 * animated weather, day/night cycle, seasonal tints, and convoy/army visualization.
 */
export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly noise: SimplexNoise;
  private terrain: TerrainTile[][] = [];
  private terrainCanvas: HTMLCanvasElement;
  private detailCanvas: HTMLCanvasElement;
  private rivers: River[] = [];
  private baseFeatures: MapFeature[] = [];
  private state: SimulationState | null = null;
  private camera: Camera = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, zoom: 0.55 };
  private targetCamera: Camera = { ...this.camera };
  private particles: WeatherParticle[] = [];
  private hoverFeature: MapFeature | null = null;
  private pointer = { x: 0, y: 0 };
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private canvasWidth = 0; // CSS pixels
  private canvasHeight = 0; // CSS pixels
  private dpr = 1;
  private animationFrame = 0;
  private lastTime = 0;
  private readonly options: MapRendererOptions;
  private readonly handlers: Array<[string, EventListener]> = [];
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapDirty = true;

  constructor(canvas: HTMLCanvasElement, options: MapRendererOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Empire Quest requires a Canvas 2D context.');
    this.canvas = canvas;
    this.ctx = ctx;
    this.options = options;
    this.noise = new SimplexNoise(options.seed ?? 42);
    this.terrainCanvas = document.createElement('canvas');
    this.detailCanvas = document.createElement('canvas');
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width = 256;
    this.minimapCanvas.height = 192;
    this.minimapCtx = this.minimapCanvas.getContext('2d');
    this.generateMap();
    this.bindEvents();
    this.resize();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  setSimulationState(state: SimulationState | null): void {
    this.state = state;
    this.minimapDirty = true;
  }
  setCamera(camera: Partial<Camera>, immediate = false): void {
    this.targetCamera = { ...this.targetCamera, ...camera, zoom: this.clamp(camera.zoom ?? this.targetCamera.zoom, 0.2, 3) };
    if (immediate) this.camera = { ...this.targetCamera };
    this.minimapDirty = true;
  }
  getCamera(): Camera { return { ...this.camera }; }
  getWorldPosition(screen: Position): Position { return this.screenToWorld(screen.x, screen.y); }
  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.handlers.forEach(([type, listener]) => this.canvas.removeEventListener(type, listener));
    this.handlers.length = 0;
  }

  // --- Map Generation ---

  private generateMap(): void {
    const columns = MAP_WIDTH / TERRAIN_TILE_SIZE;
    const rows = MAP_HEIGHT / TERRAIN_TILE_SIZE;
    this.terrain = Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => {
      const nx = x / columns, ny = y / rows;
      const edge = Math.min(nx, 1 - nx, ny, 1 - ny) * 2;
      const continent = this.noise.octave2D(nx * 2.2 + 13, ny * 2.2 - 7, 5, .52);
      const ridge = Math.max(0, this.noise.octave2D(nx * 5 - 2, ny * 5 + 4, 3) + .15) * .28;
      const elevation = continent * .44 + edge * .72 + ridge + (nx > .65 && ny < .5 ? .13 : 0);
      const moisture = (this.noise.octave2D(nx * 4 + 70, ny * 4 + 30, 4) + 1) / 2;
      return { elevation, moisture, biome: this.classifyBiome(elevation, moisture, nx, ny) };
    }));
    this.paintTerrain();
    this.paintTerrainDetails();
    this.rivers = this.generateRivers();
    this.baseFeatures = this.createFeatures();
  }

  private classifyBiome(e: number, m: number, x: number, y: number): BiomeType {
    if (e < .04) return 'deep_water';
    if (e < .12) return 'coastal';
    if (e > .62) return e > .7 ? 'mountain' : 'mountain_pass';
    if (x > .76 && y > .48 && m < .56) return 'desert';
    if (m > .78 && e < .28) return 'marsh';
    if (m > .65) return m > .79 ? 'dense_forest' : 'forest';
    if (x > .2 && x < .61 && y > .48 && y < .9 && m > .38) return 'farmland';
    return 'grassland';
  }

  private hexToRgb(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  }

  private paintTerrain(): void {
    const c = this.terrainCanvas;
    c.width = MAP_WIDTH; c.height = MAP_HEIGHT;
    const cctx = c.getContext('2d')!;

    // Paint each tile with per-tile color variation for organic look
    for (let y = 0; y < this.terrain.length; y++) {
      for (let x = 0; x < this.terrain[y].length; x++) {
        const tile = this.terrain[y][x];
        const [br, bg, bb] = this.hexToRgb(BIOME_COLORS[tile.biome]);
        // Per-tile noise variation (±12% brightness)
        const variation = (this.noise.noise2D(x * 0.3, y * 0.3) * 0.12 + 1);
        const [dr, dg, db] = this.hexToRgb(BIOME_COLORS_DARK[tile.biome]);
        const blend = (this.noise.noise2D(x * 0.5 + 100, y * 0.5 + 100) + 1) * 0.5;
        const r = (br * (1 - blend) + dr * blend) * variation;
        const g = (bg * (1 - blend) + dg * blend) * variation;
        const b = (bb * (1 - blend) + db * blend) * variation;
        cctx.fillStyle = this.rgbToHex(r, g, b);
        cctx.fillRect(x * TERRAIN_TILE_SIZE, y * TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE + 1, TERRAIN_TILE_SIZE + 1);
      }
    }

    // Water depth gradient for deep water
    cctx.globalAlpha = 0.15;
    for (let y = 0; y < this.terrain.length; y++) {
      for (let x = 0; x < this.terrain[y].length; x++) {
        const tile = this.terrain[y][x];
        if (tile.biome === 'deep_water') {
          const depth = 1 - tile.elevation / 0.04;
          cctx.fillStyle = `rgba(0, 20, 60, ${depth * 0.5})`;
          cctx.fillRect(x * TERRAIN_TILE_SIZE, y * TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE + 1, TERRAIN_TILE_SIZE + 1);
        }
      }
    }
    cctx.globalAlpha = 1;

    // Subtle parchment grain overlay
    cctx.globalAlpha = 0.06;
    for (let y = 0; y < MAP_HEIGHT; y += 16) {
      for (let x = 0; x < MAP_WIDTH; x += 16) {
        cctx.fillStyle = this.noise.noise2D(x / 28, y / 28) > 0 ? '#d8bf84' : '#0b1510';
        cctx.fillRect(x, y, 16, 16);
      }
    }
    cctx.globalAlpha = 1;
  }

  private paintTerrainDetails(): void {
    const c = this.detailCanvas;
    c.width = MAP_WIDTH; c.height = MAP_HEIGHT;
    const dc = c.getContext('2d')!;
    dc.globalAlpha = 0.7;

    // Forest tree clusters
    for (let y = 16; y < MAP_HEIGHT; y += 28) {
      for (let x = 16; x < MAP_WIDTH; x += 28) {
        const tile = this.terrain[Math.floor(y / 8)]?.[Math.floor(x / 8)];
        if (!tile) continue;
        const n = this.noise.noise2D(x * 0.02, y * 0.02);
        if ((tile.biome === 'forest' || tile.biome === 'dense_forest') && n > 0.1) {
          const size = tile.biome === 'dense_forest' ? 6 + n * 4 : 4 + n * 3;
          const shade = tile.biome === 'dense_forest' ? '#0a2210' : '#153018';
          dc.fillStyle = shade;
          dc.beginPath();
          // Tree shape: triangle crown + trunk
          dc.moveTo(x, y - size);
          dc.lineTo(x - size * 0.7, y + size * 0.3);
          dc.lineTo(x + size * 0.7, y + size * 0.3);
          dc.closePath();
          dc.fill();
          dc.fillStyle = '#3a2a1a';
          dc.fillRect(x - 1, y + size * 0.3, 2, size * 0.3);
        } else if (tile.biome === 'mountain' && n > 0.2) {
          // Mountain peak with snow cap
          const size = 8 + n * 5;
          dc.fillStyle = '#6a6560';
          dc.beginPath();
          dc.moveTo(x - size, y + size * 0.5);
          dc.lineTo(x, y - size);
          dc.lineTo(x + size, y + size * 0.5);
          dc.closePath();
          dc.fill();
          // Snow cap
          dc.fillStyle = '#d8d4ce';
          dc.beginPath();
          dc.moveTo(x - size * 0.3, y - size * 0.5);
          dc.lineTo(x, y - size);
          dc.lineTo(x + size * 0.3, y - size * 0.5);
          dc.closePath();
          dc.fill();
          // Shadow side
          dc.fillStyle = 'rgba(0,0,0,0.2)';
          dc.beginPath();
          dc.moveTo(x, y - size);
          dc.lineTo(x + size, y + size * 0.5);
          dc.lineTo(x, y + size * 0.5);
          dc.closePath();
          dc.fill();
        } else if (tile.biome === 'farmland') {
          // Farmland strip pattern
          dc.strokeStyle = 'rgba(100, 120, 40, 0.3)';
          dc.lineWidth = 1;
          for (let i = -8; i <= 8; i += 4) {
            dc.beginPath();
            dc.moveTo(x + i, y - 8);
            dc.lineTo(x + i, y + 8);
            dc.stroke();
          }
        } else if (tile.biome === 'marsh' && n > 0) {
          // Marsh reeds
          dc.strokeStyle = '#2a4a30';
          dc.lineWidth = 1;
          for (let i = 0; i < 3; i++) {
            const rx = x + (i - 1) * 4;
            dc.beginPath();
            dc.moveTo(rx, y + 4);
            dc.quadraticCurveTo(rx + (n > 0.3 ? 2 : -2), y - 2, rx + (n > 0.3 ? 3 : -3), y - 6);
            dc.stroke();
          }
        } else if (tile.biome === 'desert' && n > 0.15) {
          // Sand dune
          dc.fillStyle = 'rgba(160, 120, 50, 0.25)';
          dc.beginPath();
          dc.ellipse(x, y, 10 + n * 5, 4 + n * 2, 0, 0, Math.PI * 2);
          dc.fill();
        }
      }
    }
    dc.globalAlpha = 1;
  }

  private generateRivers(): River[] {
    const sources: Position[] = [{ x: 1060, y: 220 }, { x: 1190, y: 340 }, { x: 1450, y: 390 }, { x: 780, y: 280 }];
    return sources.map((source, index) => {
      const points = [source]; let current = source;
      for (let step = 0; step < 65; step++) {
        const candidates = [-1, 0, 1].map(dx => ({ x: current.x + dx * 22 + (index - 1) * 2, y: current.y + 20 }));
        const next = candidates.reduce((best, p) => this.elevationAt(p) < this.elevationAt(best) ? p : best, candidates[0]);
        current = { x: this.clamp(next.x, 12, MAP_WIDTH - 12), y: this.clamp(next.y, 12, MAP_HEIGHT - 12) };
        points.push(current);
        if (this.elevationAt(current) < .12 || current.y > MAP_HEIGHT - 35) break;
      }
      return { points, width: 4 + index * 1.3 };
    });
  }

  private elevationAt(p: Position): number {
    const x = this.clamp(Math.floor(p.x / TERRAIN_TILE_SIZE), 0, this.terrain[0].length - 1);
    const y = this.clamp(Math.floor(p.y / TERRAIN_TILE_SIZE), 0, this.terrain.length - 1);
    return this.terrain[y][x].elevation;
  }

  private createFeatures(): MapFeature[] {
    const f = (id: string, type: MapFeature['type'], name: string, x: number, y: number, kingdomId?: string): MapFeature =>
      ({ id, type, name, position: { x, y }, kingdomId, level: type === 'city' || type === 'castle' ? 3 : 1, icon: type });
    return [
      f('greenhaven', 'city', 'Greenhaven', 630, 1030, 'verdant_realm'), f('serenity', 'port', 'Port Serenity', 250, 380, 'azure_coast'),
      f('qamar', 'city', 'Qamar al-Nur', 1740, 1090, 'sands_of_zahar'), f('stoneforge', 'castle', 'Stoneforge', 1010, 310, 'ironpeak_hold'),
      f('eldertree', 'city', 'Eldertree', 1620, 450, 'whispering_weald'), f('argentis', 'city', 'Argentis', 1240, 990, 'silver_crown'),
      f('harvest-hollow', 'village', 'Harvest Hollow', 470, 1140, 'verdant_realm'), f('millbrook', 'village', 'Millbrook', 780, 880, 'verdant_realm'),
      f('iron-mine', 'mine', 'Black Anvil Mine', 1120, 220, 'ironpeak_hold'), f('timber-camp', 'forest', 'Oldgrowth Camp', 1510, 530, 'whispering_weald'),
      f('sunwell-farm', 'farm', 'Sunwell Estate', 710, 1170, 'verdant_realm'), f('river-bridge', 'bridge', 'Kingswater Bridge', 945, 710, 'silver_crown'),
      f('dune-watch', 'castle', 'Dune Watch', 1630, 940, 'sands_of_zahar'), f('azure-village', 'village', 'Saltmarsh', 420, 550, 'azure_coast'),
    ];
  }

  // --- Events ---

  private bindEvents(): void {
    const on = (type: string, listener: EventListener, opts?: AddEventListenerOptions) => {
      this.canvas.addEventListener(type, listener, opts);
      this.handlers.push([type, listener]);
    };
    on('wheel', ((event: WheelEvent) => {
      event.preventDefault();
      const before = this.screenToWorld(event.clientX - this.canvas.getBoundingClientRect().left, event.clientY - this.canvas.getBoundingClientRect().top);
      const zoom = this.clamp(this.targetCamera.zoom * Math.exp(-event.deltaY * .0012), .2, 3);
      this.targetCamera.zoom = zoom;
      const after = this.screenToWorld(event.clientX - this.canvas.getBoundingClientRect().left, event.clientY - this.canvas.getBoundingClientRect().top);
      this.targetCamera.x += before.x - after.x;
      this.targetCamera.y += before.y - after.y;
    }) as EventListener, { passive: false });
    on('pointerdown', ((e: PointerEvent) => {
      if (e.button === 1 || e.button === 2) { this.dragging = true; this.lastPointer = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
    }) as EventListener);
    on('pointermove', ((e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (this.dragging) {
        this.targetCamera.x -= (e.clientX - this.lastPointer.x) / this.targetCamera.zoom;
        this.targetCamera.y -= (e.clientY - this.lastPointer.y) / this.targetCamera.zoom;
        this.lastPointer = { x: e.clientX, y: e.clientY };
      } else this.updateHover();
    }) as EventListener);
    on('pointerup', ((e: PointerEvent) => { this.dragging = false; try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* */ } }) as EventListener);
    on('click', ((e: MouseEvent) => {
      if (e.button !== 0) return;
      const r = this.canvas.getBoundingClientRect();
      const world = this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      // Check minimap click first
      if (this.isMinimapClick(e.clientX - r.left, e.clientY - r.top)) {
        this.handleMinimapClick(world);
        return;
      }
      const feature = this.featureAt(world);
      this.options.onFeatureClick?.(feature);
    }) as EventListener);
    on('contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
  }

  // --- Render Loop ---

  private frame = (time: number): void => {
    const delta = Math.min(50, time - this.lastTime || 16);
    this.lastTime = time;
    // Smooth camera interpolation
    const lerp = Math.min(1, delta * .012);
    this.camera.x += (this.targetCamera.x - this.camera.x) * lerp;
    this.camera.y += (this.targetCamera.y - this.camera.y) * lerp;
    this.camera.zoom += (this.targetCamera.zoom - this.camera.zoom) * lerp;
    this.constrainCamera();
    this.draw(time);
    this.options.onCameraChange?.({ ...this.camera });
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private draw(time: number): void {
    this.resize();
    const { ctx, canvas } = this;

    // Clear with deep background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0e0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Map transform
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // Draw terrain layers
    ctx.drawImage(this.terrainCanvas, 0, 0);
    ctx.drawImage(this.detailCanvas, 0, 0);

    // Lakes
    this.drawLakes(ctx, time);
    // Territories with improved rendering
    this.drawTerritories(ctx);
    // Rivers with banks and flow
    this.drawRivers(ctx, time);
    // Roads with trade route animation
    this.drawRoads(ctx, time);
    // Terrain detail overlay (zoom-dependent)
    this.drawTerrainOverlay(ctx);

    // Features with proper icons
    this.features().forEach(feature => this.drawFeature(ctx, feature, time));

    // Armies with formation rendering
    Object.values(this.state?.armies ?? {}).forEach(army => this.drawArmy(ctx, army, time));

    // Convoys
    this.drawConvoys(ctx, time);

    ctx.restore();

    // Atmospheric overlays (screen-space)
    this.drawSeasonTint(ctx);
    this.drawDayNightOverlay(ctx);
    this.drawWeather(ctx, this.state?.weather, time);
    this.drawVignette(ctx);
    this.drawMinimap(ctx);
    this.drawTooltip(ctx);
  }

  // --- Terrain & Geography ---

  private drawLakes(ctx: CanvasRenderingContext2D, time: number): void {
    // Lake of Mirrors
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(1360, 670, 88, 50, -.25, 0, Math.PI * 2);
    // Water fill with gradient
    const lg = ctx.createRadialGradient(1350, 660, 10, 1360, 670, 88);
    lg.addColorStop(0, '#2a7090');
    lg.addColorStop(0.6, '#1b526a');
    lg.addColorStop(1, '#144050');
    ctx.fillStyle = lg;
    ctx.fill();
    // Animated shimmer
    ctx.strokeStyle = `rgba(127, 193, 212, ${0.4 + Math.sin(time / 800) * 0.15})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Internal wave lines
    ctx.strokeStyle = `rgba(127, 193, 212, ${0.15 + Math.sin(time / 600) * 0.08})`;
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      const wy = 655 + i * 12 + Math.sin(time / 500 + i) * 2;
      ctx.beginPath();
      ctx.moveTo(1310, wy);
      ctx.quadraticCurveTo(1360, wy + Math.sin(time / 400 + i) * 3, 1410, wy);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTerritories(ctx: CanvasRenderingContext2D): void {
    const territories = this.state?.territories?.length ? this.state.territories : TERRITORIES;
    for (const t of territories) {
      ctx.beginPath();
      t.polygon.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      // Gradient fill
      ctx.fillStyle = t.color;
      ctx.fill();
      // Solid border with kingdom color
      const kColor = KINGDOM_COLORS[t.kingdomId] ?? '#c8a44d';
      ctx.strokeStyle = kColor;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Kingdom name label at low zoom
      if (this.camera.zoom < 0.7) {
        const centroid = polygonCentroid(t.polygon);
        ctx.fillStyle = kColor;
        ctx.globalAlpha = 0.35;
        ctx.font = 'bold 18px Cinzel, Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText(KINGDOM_NAMES[t.kingdomId] ?? t.kingdomId, centroid.x, centroid.y);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawRivers(ctx: CanvasRenderingContext2D, time: number): void {
    for (const river of this.rivers) {
      // River bank (lighter edge)
      ctx.beginPath();
      river.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = 'rgba(60, 50, 35, 0.4)';
      ctx.lineWidth = river.width + 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Main river body with gradient
      ctx.beginPath();
      river.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      const rg = ctx.createLinearGradient(river.points[0].x, river.points[0].y, river.points[river.points.length - 1].x, river.points[river.points.length - 1].y);
      rg.addColorStop(0, '#2a7090');
      rg.addColorStop(0.5, '#1e5a78');
      rg.addColorStop(1, '#1a5070');
      ctx.strokeStyle = rg;
      ctx.lineWidth = river.width;
      ctx.stroke();

      // Animated flow lines
      ctx.strokeStyle = `rgba(120, 180, 210, ${0.2 + Math.sin(time / 700) * 0.1})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < river.points.length - 1; i += 3) {
        const p = river.points[i];
        const offset = Math.sin(time / 500 + i * 0.5) * 2;
        ctx.beginPath();
        ctx.moveTo(p.x - 2 + offset, p.y);
        ctx.lineTo(p.x + 2 + offset, p.y);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
    }
  }

  private drawRoads(ctx: CanvasRenderingContext2D, time: number): void {
    const major = this.features().filter(f => ['city', 'castle', 'port'].includes(f.type));
    const links = [[0, 1], [0, 5], [5, 2], [5, 4], [3, 4], [3, 1]];
    ctx.lineCap = 'round';
    for (const [a, b] of links) {
      const from = major[a], to = major[b];
      if (!from || !to) continue;
      const mx = (from.position.x + to.position.x) / 2, my = (from.position.y + to.position.y) / 2;
      // Road shadow
      ctx.beginPath();
      ctx.moveTo(from.position.x, from.position.y);
      ctx.quadraticCurveTo(mx + (from.position.y - to.position.y) * .08, my + (to.position.x - from.position.x) * .08, to.position.x, to.position.y);
      ctx.strokeStyle = '#1a1410';
      ctx.lineWidth = 9;
      ctx.stroke();
      // Road surface
      ctx.strokeStyle = '#8a7050';
      ctx.lineWidth = 4;
      ctx.stroke();
      // Road center line
      ctx.strokeStyle = 'rgba(140, 115, 70, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineCap = 'butt';

    // Animated trade route dots
    if (this.camera.zoom > 0.4) {
      for (const [a, b] of links) {
        const from = major[a], to = major[b];
        if (!from || !to) continue;
        const t = ((time / 3000) + a * 0.3) % 1;
        const x = from.position.x + (to.position.x - from.position.x) * t;
        const y = from.position.y + (to.position.y - from.position.y) * t;
        ctx.fillStyle = 'rgba(201, 168, 76, 0.5)';
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawTerrainOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.camera.zoom < 0.5) return;
    // Additional detail layer for zoomed-in view
    const alpha = Math.min(1, (this.camera.zoom - 0.5) * 2);
    ctx.globalAlpha = alpha * 0.4;

    // Mountain snow glow at higher zoom
    if (this.camera.zoom > 0.8) {
      for (let y = 20; y < MAP_HEIGHT; y += 40) {
        for (let x = 20; x < MAP_WIDTH; x += 40) {
          const tile = this.terrain[Math.floor(y / 8)]?.[Math.floor(x / 8)];
          if (tile?.biome === 'mountain' && tile.elevation > 0.7) {
            ctx.fillStyle = 'rgba(220, 215, 210, 0.3)';
            ctx.beginPath();
            ctx.arc(x, y - 5, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // --- Features ---

  private drawFeature(ctx: CanvasRenderingContext2D, f: MapFeature, time: number): void {
    const { x, y } = f.position;
    const color = f.kingdomId ? KINGDOM_COLORS[f.kingdomId] : '#d7b254';
    const glow = Math.sin(time / 1200 + x * 0.01) * 0.15 + 0.85;

    ctx.save();
    ctx.translate(x, y);

    // Shadow underneath
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    if (f.type === 'city' || f.type === 'castle') {
      this.drawCityCastle(ctx, f, color, glow, time);
    } else if (f.type === 'village') {
      this.drawVillage(ctx, color);
    } else if (f.type === 'port') {
      this.drawPort(ctx, color);
    } else if (f.type === 'bridge') {
      this.drawBridge(ctx);
    } else if (f.type === 'mine') {
      this.drawMine(ctx);
    } else if (f.type === 'farm') {
      this.drawFarm(ctx);
    } else if (f.type === 'forest') {
      this.drawForestIcon(ctx);
    } else {
      // Generic resource marker
      ctx.fillStyle = '#2a4a30';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6a9a60';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Name label
    if (this.camera.zoom > 0.55) {
      const alpha = Math.min(1, (this.camera.zoom - 0.55) * 3);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#eadcae';
      ctx.font = `${f.type === 'city' || f.type === 'castle' ? 'bold ' : ''}${12 + (f.level > 1 ? 2 : 0)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // Text background for readability
      const metrics = ctx.measureText(f.name);
      ctx.fillStyle = 'rgba(10, 14, 13, 0.6)';
      ctx.fillRect(-metrics.width / 2 - 3, 18, metrics.width + 6, 16);
      ctx.fillStyle = f.type === 'city' || f.type === 'castle' ? '#f0dfad' : '#c8b890';
      ctx.fillText(f.name, 0, 19);
    }

    // Hover highlight
    if (this.hoverFeature?.id === f.id) {
      ctx.strokeStyle = `rgba(232, 212, 139, ${glow})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private drawCityCastle(ctx: CanvasRenderingContext2D, f: MapFeature, color: string, glow: number, time: number): void {
    const isCity = f.type === 'city';
    const scale = 1 + (f.level - 1) * 0.2;
    const isCastle = f.type === 'castle';
    const s = scale;

    // Seed-based variation for visual diversity
    const seed = (f.position.x * 7 + f.position.y * 13) % 100;
    const hasExtraTowers = seed > 60;

    // === GROUND SHADOW (large soft shadow under entire structure) ===
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(2 * s, 8 * s, 26 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // === MOAT (castles only) ===
    if (isCastle) {
      const moatGrad = ctx.createRadialGradient(0, 6 * s, 4 * s, 0, 6 * s, 22 * s);
      moatGrad.addColorStop(0, 'rgba(20, 60, 100, 0.7)');
      moatGrad.addColorStop(0.6, 'rgba(30, 80, 120, 0.5)');
      moatGrad.addColorStop(1, 'rgba(40, 100, 140, 0.1)');
      ctx.fillStyle = moatGrad;
      ctx.beginPath();
      ctx.ellipse(0, 6 * s, 22 * s, 8 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      // Water ripple lines
      ctx.strokeStyle = 'rgba(80, 160, 200, 0.2)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 3; i++) {
        const rippleR = (8 + i * 4 + Math.sin(time / 800 + i) * 1.5) * s;
        ctx.beginPath();
        ctx.ellipse(0, 6 * s, rippleR, rippleR * 0.36, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Moat stone edge
      ctx.strokeStyle = 'rgba(90, 80, 65, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 6 * s, 22 * s, 8 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // === OUTER WALLS ===
    const wallW = isCity ? 28 : 22;
    const wallH = isCity ? 18 : 16;
    const wallX = -wallW / 2 * s;
    const wallY = -wallH / 2 * s;
    const wallWpx = wallW * s;
    const wallHpx = wallH * s;

    // Wall shadow offset
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(wallX + 3 * s, wallY + 3 * s, wallWpx, wallHpx);

    // Main wall body with gradient
    const wallGrad = ctx.createLinearGradient(wallX, wallY, wallX + wallWpx, wallY + wallHpx);
    wallGrad.addColorStop(0, '#7a7268');
    wallGrad.addColorStop(0.3, '#6a6258');
    wallGrad.addColorStop(0.7, '#5a5248');
    wallGrad.addColorStop(1, '#4a4238');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(wallX, wallY, wallWpx, wallHpx);

    // Stone texture on walls (horizontal lines)
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.5;
    for (let row = 0; row < Math.floor(wallHpx / 2.5); row++) {
      const ry = wallY + row * 2.5;
      ctx.beginPath();
      ctx.moveTo(wallX, ry);
      ctx.lineTo(wallX + wallWpx, ry);
      ctx.stroke();
    }

    // Random stone variation
    ctx.fillStyle = 'rgba(120, 110, 90, 0.15)';
    for (let i = 0; i < 8; i++) {
      const sx = wallX + ((seed * (i + 1) * 7) % Math.floor(wallWpx - 3));
      const sy = wallY + ((seed * (i + 1) * 11) % Math.floor(wallHpx - 3));
      ctx.fillRect(sx, sy, 2 + (i % 3), 1.5);
    }

    // Wall top highlight (sunlit edge)
    const topHighlight = ctx.createLinearGradient(wallX, wallY, wallX + wallWpx, wallY);
    topHighlight.addColorStop(0, 'rgba(200, 180, 150, 0.4)');
    topHighlight.addColorStop(0.5, 'rgba(200, 180, 150, 0.1)');
    topHighlight.addColorStop(1, 'rgba(200, 180, 150, 0.3)');
    ctx.fillStyle = topHighlight;
    ctx.fillRect(wallX, wallY, wallWpx, 2 * s);

    // Wall left highlight
    ctx.fillStyle = 'rgba(200, 180, 150, 0.2)';
    ctx.fillRect(wallX, wallY, 1.5 * s, wallHpx);

    // Wall outline
    ctx.strokeStyle = '#8a7a60';
    ctx.lineWidth = 1;
    ctx.strokeRect(wallX, wallY, wallWpx, wallHpx);

    // === CRELLATIONS (battlements along top wall) ===
    const numCren = isCity ? 14 : 11;
    const crenW = wallWpx / numCren;
    const crenH = 3 * s;

    for (let i = 0; i < numCren; i++) {
      if (i % 2 === 0) {
        // Merlon (solid part)
        const cx = wallX + i * crenW;
        const cGrad = ctx.createLinearGradient(cx, wallY - crenH, cx + crenW * 0.8, wallY);
        cGrad.addColorStop(0, '#8a8278');
        cGrad.addColorStop(1, '#6a6258');
        ctx.fillStyle = cGrad;
        ctx.fillRect(cx, wallY - crenH, crenW * 0.8, crenH);
        ctx.strokeStyle = '#9a9288';
        ctx.lineWidth = 0.3;
        ctx.strokeRect(cx, wallY - crenH, crenW * 0.8, crenH);
      }
      // Crenel (gap) — draw dark interior
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(20, 15, 10, 0.5)';
        ctx.fillRect(wallX + i * crenW, wallY - crenH * 0.5, crenW * 0.8, crenH * 0.5);
      }
    }

    // === SIDE WALL CRELLATIONS (left and right) ===
    const sideCrenH = 2.5 * s;
    for (let side = 0; side < 2; side++) {
      const numSide = Math.floor(wallHpx / (crenW * 1.5));
      for (let i = 0; i < numSide; i++) {
        if (i % 2 === 0) {
          const sy = wallY + i * (wallHpx / numSide);
          const sx = side === 0 ? wallX - sideCrenH : wallX + wallWpx;
          ctx.fillStyle = '#7a7268';
          ctx.fillRect(sx, sy, sideCrenH, (wallHpx / numSide) * 0.7);
        }
      }
    }

    // === CORNER TOWERS (cylindrical with conical roofs) ===
    const towerR = 4.5 * s;
    const towerH = 12 * s;
    const towerPositions = [
      { x: wallX - towerR * 0.5, y: wallY - towerH * 0.3 },
      { x: wallX + wallWpx - towerR * 0.5, y: wallY - towerH * 0.3 },
      { x: wallX - towerR * 0.5, y: wallY + wallHpx - towerH * 0.7 },
      { x: wallX + wallWpx - towerR * 0.5, y: wallY + wallHpx - towerH * 0.7 },
    ];

    for (const pos of towerPositions) {
      this.drawDetailedTower(ctx, pos.x, pos.y, towerR, towerH, color, glow, time, seed);
    }

    // === EXTRA MID-WALL TOWERS (some castles) ===
    if (hasExtraTowers) {
      const midTowerR = 3.5 * s;
      const midTowerH = 10 * s;
      // Top wall mid tower
      this.drawDetailedTower(ctx, wallX + wallWpx / 2 - midTowerR / 2, wallY - midTowerH * 0.3, midTowerR, midTowerH, color, glow, time, seed + 10);
      // Bottom wall mid tower (near gate)
      this.drawDetailedTower(ctx, wallX + wallWpx * 0.75 - midTowerR / 2, wallY + wallHpx - midTowerH * 0.7, midTowerR, midTowerH, color, glow, time, seed + 20);
    }

    // === CENTRAL KEEP ===
    const keepW = isCastle ? 12 : 9;
    const keepH = isCastle ? 16 : 12;
    const keepX = -keepW / 2 * s;
    const keepY = -keepH / 2 * s;
    const keepWpx = keepW * s;
    const keepHpx = keepH * s;

    // Keep shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(keepX + 2 * s, keepY + 2 * s, keepWpx, keepHpx);

    // Keep body
    const keepGrad = ctx.createLinearGradient(keepX, keepY, keepX + keepWpx, keepY + keepHpx);
    keepGrad.addColorStop(0, '#9a9080');
    keepGrad.addColorStop(0.3, '#8a8070');
    keepGrad.addColorStop(0.7, '#7a7060');
    keepGrad.addColorStop(1, '#6a6050');
    ctx.fillStyle = keepGrad;
    ctx.fillRect(keepX, keepY, keepWpx, keepHpx);

    // Keep stone texture
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    for (let row = 0; row < Math.floor(keepHpx / 3); row++) {
      const ry = keepY + row * 3;
      ctx.beginPath();
      ctx.moveTo(keepX, ry);
      ctx.lineTo(keepX + keepWpx, ry);
      ctx.stroke();
    }

    // Keep highlights
    ctx.fillStyle = 'rgba(220, 200, 160, 0.3)';
    ctx.fillRect(keepX, keepY, keepWpx, 1.5 * s);
    ctx.fillRect(keepX, keepY, 1.5 * s, keepHpx);

    // Keep outline
    ctx.strokeStyle = '#9a9080';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(keepX, keepY, keepWpx, keepHpx);

    // Keep crenellations
    const keepCrenW = keepWpx / 6;
    for (let i = 0; i < 6; i += 2) {
      ctx.fillStyle = '#8a8278';
      ctx.fillRect(keepX + i * keepCrenW, keepY - 2 * s, keepCrenW * 0.7, 2 * s);
    }

    // Keep roof (pyramid with multiple facets)
    const roofPeakY = keepY - 7 * s;
    const roofColors = [color];
    const darkerColor = this.darkenColor(color, 0.7);

    // Left facet
    ctx.fillStyle = darkerColor;
    ctx.globalAlpha = glow * 0.85;
    ctx.beginPath();
    ctx.moveTo(keepX - 2 * s, keepY);
    ctx.lineTo(keepX + keepWpx / 2, roofPeakY);
    ctx.lineTo(keepX + keepWpx / 2, keepY);
    ctx.closePath();
    ctx.fill();

    // Right facet
    ctx.fillStyle = color;
    ctx.globalAlpha = glow * 0.95;
    ctx.beginPath();
    ctx.moveTo(keepX + keepWpx / 2, keepY);
    ctx.lineTo(keepX + keepWpx / 2, roofPeakY);
    ctx.lineTo(keepX + keepWpx + 2 * s, keepY);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(keepX + keepWpx / 2, roofPeakY);
    ctx.lineTo(keepX + keepWpx / 2, keepY);
    ctx.stroke();

    // Keep windows (gothic arched)
    this.drawGothicWindows(ctx, keepX, keepY, keepWpx, keepHpx, s);

    // Keep door (gothic arch)
    const doorW = 3 * s;
    const doorH = 4 * s;
    const doorX = keepX + keepWpx / 2 - doorW / 2;
    const doorY = keepY + keepHpx - doorH;
    ctx.fillStyle = '#1a1410';
    ctx.beginPath();
    ctx.moveTo(doorX, doorY + doorH);
    ctx.lineTo(doorX, doorY + doorH * 0.4);
    ctx.bezierCurveTo(
      doorX, doorY, doorX + doorW, doorY,
      doorX + doorW, doorY + doorH * 0.4
    );
    ctx.lineTo(doorX + doorW, doorY + doorH);
    ctx.closePath();
    ctx.fill();
    // Door frame
    ctx.strokeStyle = '#5a5040';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // === GATE TOWER with portcullis ===
    const gateW = 7 * s;
    const gateH = 6 * s;
    const gateX = -gateW / 2;
    const gateY = wallY + wallHpx - gateH;

    // Gate tower body (extends above wall)
    const gateTowerGrad = ctx.createLinearGradient(gateX, gateY - 4 * s, gateX + gateW, gateY + gateH);
    gateTowerGrad.addColorStop(0, '#7a7268');
    gateTowerGrad.addColorStop(1, '#5a5248');
    ctx.fillStyle = gateTowerGrad;
    ctx.fillRect(gateX - 2 * s, gateY - 4 * s, gateW + 4 * s, gateH + 4 * s);
    ctx.strokeStyle = '#8a7a60';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(gateX - 2 * s, gateY - 4 * s, gateW + 4 * s, gateH + 4 * s);

    // Gate tower crenellations
    for (let i = 0; i < 4; i += 2) {
      ctx.fillStyle = '#8a8278';
      ctx.fillRect(gateX - 2 * s + i * (gateW + 4 * s) / 4, gateY - 6 * s, (gateW + 4 * s) / 4 * 0.7, 2 * s);
    }

    // Gate archway
    ctx.fillStyle = '#1a1410';
    ctx.beginPath();
    ctx.moveTo(gateX, gateY + gateH);
    ctx.lineTo(gateX, gateY + gateH * 0.3);
    ctx.arc(gateX + gateW / 2, gateY + gateH * 0.3, gateW / 2, Math.PI, 0);
    ctx.lineTo(gateX + gateW, gateY + gateH);
    ctx.closePath();
    ctx.fill();

    // Portcullis grid
    ctx.strokeStyle = '#5a5040';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      const bx = gateX + (i + 0.5) * (gateW / 4);
      ctx.beginPath();
      ctx.moveTo(bx, gateY + gateH * 0.05);
      ctx.lineTo(bx, gateY + gateH);
      ctx.stroke();
    }
    for (let j = 0; j < 3; j++) {
      const by = gateY + (j + 0.5) * (gateH / 3);
      ctx.beginPath();
      ctx.moveTo(gateX + 1, by);
      ctx.lineTo(gateX + gateW - 1, by);
      ctx.stroke();
    }

    // === DRAWBRIDGE ===
    const bridgeW = 9 * s;
    const bridgeH = 2 * s;
    const bridgeX = -bridgeW / 2;
    const bridgeY = gateY + gateH;
    ctx.fillStyle = '#6a5a40';
    ctx.fillRect(bridgeX, bridgeY, bridgeW, bridgeH);
    // Bridge planks
    ctx.strokeStyle = '#5a4a30';
    ctx.lineWidth = 0.3;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(bridgeX + i * bridgeW / 5, bridgeY);
      ctx.lineTo(bridgeX + i * bridgeW / 5, bridgeY + bridgeH);
      ctx.stroke();
    }

    // === BANNER (animated waving flag on keep) ===
    const poleX = keepX + keepWpx / 2;
    const poleBaseY = roofPeakY;
    const poleTopY = roofPeakY - 10 * s;
    const bannerWave = Math.sin(time / 250) * 3;
    const bannerWave2 = Math.sin(time / 250 + 1.5) * 2;
    const bannerWave3 = Math.sin(time / 250 + 3) * 1.5;

    // Flag pole
    ctx.strokeStyle = '#8a8070';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(poleX, poleBaseY);
    ctx.lineTo(poleX, poleTopY - 2 * s);
    ctx.stroke();

    // Pole finial (gold ball)
    ctx.fillStyle = '#d4a040';
    ctx.beginPath();
    ctx.arc(poleX, poleTopY - 2 * s, 1.2 * s, 0, Math.PI * 2);
    ctx.fill();

    // Waving banner
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(poleX, poleTopY);
    ctx.lineTo(poleX, poleTopY + 7 * s);
    ctx.quadraticCurveTo(
      poleX + 5 * s + bannerWave, poleTopY + 2 * s,
      poleX + 8 * s + bannerWave2, poleTopY + 3 * s
    );
    ctx.lineTo(poleX + 8 * s + bannerWave3, poleTopY + 5 * s);
    ctx.quadraticCurveTo(
      poleX + 5 * s + bannerWave * 0.5, poleTopY + 6 * s,
      poleX, poleTopY + 7 * s
    );
    ctx.closePath();
    ctx.fill();

    // Banner fold lines
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(poleX + 3 * s + bannerWave * 0.5, poleTopY + 1 * s);
    ctx.quadraticCurveTo(
      poleX + 5 * s + bannerWave * 0.8, poleTopY + 3 * s,
      poleX + 4 * s + bannerWave2 * 0.5, poleTopY + 6 * s
    );
    ctx.stroke();

    ctx.globalAlpha = 1;

    // === INNER BUILDINGS (city only) ===
    if (isCity) {
      this.drawInnerBuildings(ctx, wallX, wallY, wallWpx, wallHpx, color, glow, s, seed);
    }

    // === COURTYARD WELL (castles) ===
    if (isCastle) {
      const wellX = keepX + keepWpx + 4 * s;
      const wellY = keepY + keepHpx * 0.3;
      ctx.fillStyle = '#6a6258';
      ctx.beginPath();
      ctx.arc(wellX, wellY, 2 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a8278';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // Well water
      ctx.fillStyle = 'rgba(30, 70, 110, 0.6)';
      ctx.beginPath();
      ctx.arc(wellX, wellY, 1.2 * s, 0, Math.PI * 2);
      ctx.fill();
      // Well roof supports
      ctx.strokeStyle = '#5a4a30';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(wellX - 1.5 * s, wellY);
      ctx.lineTo(wellX - 1.5 * s, wellY - 3 * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(wellX + 1.5 * s, wellY);
      ctx.lineTo(wellX + 1.5 * s, wellY - 3 * s);
      ctx.stroke();
      // Roof beam
      ctx.beginPath();
      ctx.moveTo(wellX - 2 * s, wellY - 3 * s);
      ctx.lineTo(wellX + 2 * s, wellY - 3 * s);
      ctx.stroke();
    }

    // === COBBLESTONE PATH from gate ===
    const pathStartY = bridgeY + bridgeH;
    const pathEndY = pathStartY + 10 * s;
    const pathMidX = gateX + gateW / 2;
    ctx.fillStyle = 'rgba(90, 80, 65, 0.35)';
    ctx.beginPath();
    ctx.moveTo(pathMidX - 2 * s, pathStartY);
    ctx.lineTo(pathMidX - 4 * s, pathEndY);
    ctx.lineTo(pathMidX + 4 * s, pathEndY);
    ctx.lineTo(pathMidX + 2 * s, pathStartY);
    ctx.closePath();
    ctx.fill();

    // Cobblestone pattern
    ctx.fillStyle = 'rgba(110, 100, 80, 0.3)';
    for (let i = 0; i < 5; i++) {
      const py = pathStartY + i * 2 * s;
      const px = pathMidX + ((i % 2 === 0 ? -1 : 1) * s);
      ctx.beginPath();
      ctx.ellipse(px, py, 1.5 * s, 0.8 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private darkenColor(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
  }

  private drawGothicWindows(ctx: CanvasRenderingContext2D, kx: number, ky: number, kw: number, kh: number, s: number): void {
    const cols = kw > 10 ? 3 : 2;
    const rows = 2;
    const winW = 2 * s;
    const winH = 2.5 * s;
    const spacingX = kw / (cols + 1);
    const spacingY = kh / (rows + 1);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const wx = kx + (col + 1) * spacingX - winW / 2;
        const wy = ky + (row + 1) * spacingY - winH / 2;

        // Window recess (dark interior)
        ctx.fillStyle = '#1a1410';
        ctx.beginPath();
        ctx.moveTo(wx, wy + winH);
        ctx.lineTo(wx, wy + winH * 0.35);
        ctx.arc(wx + winW / 2, wy + winH * 0.35, winW / 2, Math.PI, 0);
        ctx.lineTo(wx + winW, wy + winH);
        ctx.closePath();
        ctx.fill();

        // Window frame
        ctx.strokeStyle = '#5a5040';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Window mullion (vertical divider)
        ctx.strokeStyle = '#4a4030';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(wx + winW / 2, wy);
        ctx.lineTo(wx + winW / 2, wy + winH);
        ctx.stroke();

        // Window sill
        ctx.fillStyle = '#7a7268';
        ctx.fillRect(wx - 0.5 * s, wy + winH, winW + s, 0.8 * s);

        // Warm glow (evening light)
        ctx.fillStyle = 'rgba(255, 200, 100, 0.08)';
        ctx.beginPath();
        ctx.moveTo(wx, wy + winH);
        ctx.lineTo(wx, wy + winH * 0.35);
        ctx.arc(wx + winW / 2, wy + winH * 0.35, winW / 2, Math.PI, 0);
        ctx.lineTo(wx + winW, wy + winH);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawDetailedTower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, h: number, color: string, glow: number, time: number, seed: number): void {
    const tw = r * 2;
    const th = h;

    // Tower shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(x + tw / 2 + 2, y + th + 2, tw / 2 + 1, th / 2 + 1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tower body (cylindrical look with gradient)
    const towerGrad = ctx.createLinearGradient(x, y, x + tw, y + th);
    towerGrad.addColorStop(0, '#8a8278');
    towerGrad.addColorStop(0.3, '#7a7268');
    towerGrad.addColorStop(0.7, '#6a6258');
    towerGrad.addColorStop(1, '#5a5248');
    ctx.fillStyle = towerGrad;
    ctx.fillRect(x, y, tw, th);

    // Tower stone texture
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    for (let row = 0; row < Math.floor(th / 3); row++) {
      ctx.beginPath();
      ctx.moveTo(x, y + row * 3);
      ctx.lineTo(x + tw, y + row * 3);
      ctx.stroke();
    }

    // Tower highlight
    ctx.fillStyle = 'rgba(200, 180, 150, 0.2)';
    ctx.fillRect(x, y, 1.5, th);

    // Tower outline
    ctx.strokeStyle = '#8a7a60';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, y, tw, th);

    // Tower roof (conical)
    const roofPeak = y - 5;
    ctx.fillStyle = color;
    ctx.globalAlpha = glow * 0.85;
    ctx.beginPath();
    ctx.moveTo(x - 1.5, y);
    ctx.lineTo(x + tw / 2, roofPeak);
    ctx.lineTo(x + tw + 1.5, y);
    ctx.closePath();
    ctx.fill();

    // Roof highlight
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(x + tw / 2, roofPeak);
    ctx.lineTo(x + tw + 1.5, y);
    ctx.lineTo(x + tw / 2, y);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;

    // Tower top crenellations
    for (let i = 0; i < 3; i += 2) {
      ctx.fillStyle = '#8a8278';
      ctx.fillRect(x + i * tw / 3, y - 1.5, tw / 3 * 0.7, 1.5);
    }

    // Tower windows (small, narrow)
    ctx.fillStyle = '#1a1410';
    const winY = y + th * 0.25;
    ctx.fillRect(x + tw / 2 - 0.5, winY, 1, 2);
    ctx.fillRect(x + tw / 2 - 0.5, winY + th * 0.3, 1, 2);

    // Tower window frames
    ctx.strokeStyle = '#5a5040';
    ctx.lineWidth = 0.3;
    ctx.strokeRect(x + tw / 2 - 0.7, winY - 0.2, 1.4, 2.4);
    ctx.strokeRect(x + tw / 2 - 0.7, winY + th * 0.3 - 0.2, 1.4, 2.4);

    // Tower banner (small flag)
    const tBannerWave = Math.sin(time / 350 + seed) * 1.5;
    ctx.strokeStyle = '#8a8070';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x + tw / 2, roofPeak);
    ctx.lineTo(x + tw / 2, roofPeak - 4);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x + tw / 2, roofPeak);
    ctx.lineTo(x + tw / 2, roofPeak - 4);
    ctx.quadraticCurveTo(x + tw / 2 + 3 + tBannerWave, roofPeak - 3, x + tw / 2 + 4 + tBannerWave, roofPeak - 1.5);
    ctx.lineTo(x + tw / 2, roofPeak - 1);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawInnerBuildings(ctx: CanvasRenderingContext2D, wallX: number, wallY: number, wallW: number, wallH: number, color: string, glow: number, s: number, seed: number): void {
    // Market square in center
    const cx = wallX + wallW / 2;
    const cy = wallY + wallH / 2;

    // Market stalls (colorful awnings)
    const stalls = [
      { x: cx - 6 * s, y: cy - 3 * s, color: '#c04040' },
      { x: cx + 2 * s, y: cy - 3 * s, color: '#4080c0' },
      { x: cx - 2 * s, y: cy + 3 * s, color: '#40a040' },
    ];

    for (const stall of stalls) {
      // Stall body
      ctx.fillStyle = '#5a4a38';
      ctx.fillRect(stall.x, stall.y, 4 * s, 3 * s);

      // Awning
      ctx.fillStyle = stall.color;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(stall.x - 0.5 * s, stall.y);
      ctx.lineTo(stall.x + 2 * s, stall.y - 2 * s);
      ctx.lineTo(stall.x + 4.5 * s, stall.y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Stall outline
      ctx.strokeStyle = '#7a6a50';
      ctx.lineWidth = 0.3;
      ctx.strokeRect(stall.x, stall.y, 4 * s, 3 * s);
    }

    // Houses along walls
    const houses = [
      { x: wallX + 2, y: wallY + 2, w: 5, h: 4, roofColor: '#8a5a30' },
      { x: wallX + wallW - 7, y: wallY + 2, w: 5, h: 4, roofColor: '#6a4a20' },
      { x: wallX + 2, y: wallY + wallH - 6, w: 5, h: 4, roofColor: '#7a5a30' },
      { x: wallX + wallW - 7, y: wallY + wallH - 6, w: 5, h: 4, roofColor: '#9a6a40' },
    ];

    for (const house of houses) {
      // House body
      const hGrad = ctx.createLinearGradient(house.x, house.y, house.x + house.w, house.y + house.h);
      hGrad.addColorStop(0, '#6a5a48');
      hGrad.addColorStop(1, '#5a4a38');
      ctx.fillStyle = hGrad;
      ctx.fillRect(house.x, house.y, house.w, house.h);

      // House roof
      ctx.fillStyle = house.roofColor;
      ctx.beginPath();
      ctx.moveTo(house.x - 1, house.y);
      ctx.lineTo(house.x + house.w / 2, house.y - 3);
      ctx.lineTo(house.x + house.w + 1, house.y);
      ctx.closePath();
      ctx.fill();

      // Chimney
      ctx.fillStyle = '#5a4a38';
      ctx.fillRect(house.x + house.w * 0.7, house.y - 4, 1.5, 2);

      // Door
      ctx.fillStyle = '#3a2510';
      ctx.fillRect(house.x + house.w / 2 - 0.5, house.y + house.h - 2, 1, 2);

      // Window
      ctx.fillStyle = 'rgba(255, 200, 100, 0.15)';
      ctx.fillRect(house.x + 0.5, house.y + 0.5, 1.5, 1.5);

      // House outline
      ctx.strokeStyle = '#7a6a50';
      ctx.lineWidth = 0.3;
      ctx.strokeRect(house.x, house.y, house.w, house.h);
    }

    // Town well in center
    ctx.fillStyle = '#6a6258';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(30, 70, 110, 0.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, 0.8 * s, 0, Math.PI * 2);
    ctx.fill();

    // Paths between buildings
    ctx.strokeStyle = 'rgba(100, 90, 70, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, wallY + 1);
    ctx.lineTo(cx, wallY + wallH - 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wallX + 1, cy);
    ctx.lineTo(wallX + wallW - 1, cy);
    ctx.stroke();
  }

  private drawVillage(ctx: CanvasRenderingContext2D, color: string): void {
    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(1, 8, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Three houses with detailed construction
    const houses = [
      { x: -10, y: 0, w: 7, h: 8, roofColor: '#a06030', chimney: true },
      { x: 1, y: -1, w: 7, h: 8, roofColor: '#8a5020', chimney: true },
      { x: -4, y: -3, w: 6, h: 7, roofColor: '#9a5a28', chimney: false },
    ];

    for (const house of houses) {
      // House shadow
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(house.x + 1, house.y + 1, house.w, house.h);

      // House body with gradient
      const hGrad = ctx.createLinearGradient(house.x, house.y, house.x + house.w, house.y + house.h);
      hGrad.addColorStop(0, '#7a6a58');
      hGrad.addColorStop(1, '#5a4a38');
      ctx.fillStyle = hGrad;
      ctx.fillRect(house.x, house.y, house.w, house.h);

      // Timber frame lines
      ctx.strokeStyle = '#4a3a28';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(house.x, house.y, house.w, house.h);
      // Horizontal timber
      ctx.beginPath();
      ctx.moveTo(house.x, house.y + house.h * 0.5);
      ctx.lineTo(house.x + house.w, house.y + house.h * 0.5);
      ctx.stroke();

      // Roof with overhang
      ctx.fillStyle = house.roofColor;
      ctx.beginPath();
      ctx.moveTo(house.x - 1.5, house.y);
      ctx.lineTo(house.x + house.w / 2, house.y - 5);
      ctx.lineTo(house.x + house.w + 1.5, house.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#6a4a20';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Chimney
      if (house.chimney) {
        ctx.fillStyle = '#5a4a38';
        ctx.fillRect(house.x + house.w * 0.7, house.y - 6, 2, 3);
        // Smoke
        ctx.fillStyle = 'rgba(180, 180, 180, 0.3)';
        ctx.beginPath();
        ctx.arc(house.x + house.w * 0.7 + 1, house.y - 8, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Door
      ctx.fillStyle = '#3a2510';
      ctx.fillRect(house.x + house.w / 2 - 1, house.y + house.h - 3, 2, 3);
      // Door knob
      ctx.fillStyle = '#8a7a50';
      ctx.beginPath();
      ctx.arc(house.x + house.w / 2 + 0.5, house.y + house.h - 1.5, 0.3, 0, Math.PI * 2);
      ctx.fill();

      // Window with warm glow
      ctx.fillStyle = 'rgba(255, 200, 100, 0.2)';
      ctx.fillRect(house.x + 1, house.y + 1.5, 2, 2);
      ctx.strokeStyle = '#4a3a28';
      ctx.lineWidth = 0.3;
      ctx.strokeRect(house.x + 1, house.y + 1.5, 2, 2);
      // Window cross
      ctx.beginPath();
      ctx.moveTo(house.x + 2, house.y + 1.5);
      ctx.lineTo(house.x + 2, house.y + 3.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(house.x + 1, house.y + 2.5);
      ctx.lineTo(house.x + 3, house.y + 2.5);
      ctx.stroke();
    }

    // Village well
    ctx.fillStyle = '#6a6258';
    ctx.beginPath();
    ctx.arc(8, 5, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a8278';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(30, 70, 110, 0.5)';
    ctx.beginPath();
    ctx.arc(8, 5, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Fence
    ctx.strokeStyle = '#6a5a40';
    ctx.lineWidth = 0.8;
    // Horizontal rails
    ctx.beginPath();
    ctx.moveTo(-14, 4);
    ctx.lineTo(14, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, 7);
    ctx.lineTo(14, 7);
    ctx.stroke();
    // Vertical posts
    for (let i = -12; i <= 12; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 2);
      ctx.lineTo(i, 9);
      ctx.stroke();
    }

    // Dirt path
    ctx.strokeStyle = 'rgba(120, 100, 70, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.quadraticCurveTo(3, 12, 0, 16);
    ctx.stroke();
  }

  private drawPort(ctx: CanvasRenderingContext2D, color: string): void {
    // Water shadow
    ctx.fillStyle = 'rgba(20, 50, 80, 0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 10, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dock platform
    const dockGrad = ctx.createLinearGradient(-14, 4, 14, 4);
    dockGrad.addColorStop(0, '#7a6a4a');
    dockGrad.addColorStop(0.5, '#8a7a5a');
    dockGrad.addColorStop(1, '#7a6a4a');
    ctx.fillStyle = dockGrad;
    ctx.fillRect(-14, 4, 28, 3);
    ctx.strokeStyle = '#6a5a3a';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(-14, 4, 28, 3);

    // Dock planks
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.3;
    for (let i = -12; i <= 12; i += 3) {
      ctx.beginPath();
      ctx.moveTo(i, 4);
      ctx.lineTo(i, 7);
      ctx.stroke();
    }

    // Dock pylons
    for (let px of [-12, -6, 0, 6, 12]) {
      ctx.fillStyle = '#5a4020';
      ctx.fillRect(px - 1, 7, 2, 8);
      // Pylon top cap
      ctx.fillStyle = '#6a5030';
      ctx.fillRect(px - 1.5, 6, 3, 2);
    }

    // Mooring posts
    ctx.fillStyle = '#4a3a20';
    ctx.beginPath();
    ctx.arc(-12, 5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(12, 5, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Ship hull
    ctx.fillStyle = '#5a3a1a';
    ctx.beginPath();
    ctx.moveTo(-10, 2);
    ctx.quadraticCurveTo(-12, -1, -8, -3);
    ctx.lineTo(8, -3);
    ctx.quadraticCurveTo(12, -1, 10, 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4a2a10';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Ship deck line
    ctx.strokeStyle = '#6a4a2a';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-9, -1);
    ctx.lineTo(9, -1);
    ctx.stroke();

    // Ship cabin
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(-4, -5, 6, 3);
    ctx.fillStyle = '#7a5a3a';
    ctx.beginPath();
    ctx.moveTo(-4.5, -5);
    ctx.lineTo(-1, -7);
    ctx.lineTo(2.5, -5);
    ctx.closePath();
    ctx.fill();

    // Main mast
    ctx.strokeStyle = '#5a4a30';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(0, -16);
    ctx.stroke();

    // Yard arm
    ctx.beginPath();
    ctx.moveTo(-6, -12);
    ctx.lineTo(6, -12);
    ctx.stroke();

    // Main sail
    ctx.fillStyle = '#e8dcc8';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(-5, -12);
    ctx.lineTo(5, -12);
    ctx.quadraticCurveTo(6, -7, 4, -4);
    ctx.lineTo(-4, -4);
    ctx.quadraticCurveTo(-6, -7, -5, -12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#c8bca8';
    ctx.lineWidth = 0.3;
    ctx.stroke();

    // Sail detail lines
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, -4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-4, -8);
    ctx.lineTo(4, -8);
    ctx.stroke();

    ctx.globalAlpha = 1;

    // Ship flag
    const flagWave = Math.sin(Date.now() / 300) * 1.5;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(0, -19);
    ctx.quadraticCurveTo(3 + flagWave, -18, 4 + flagWave, -17);
    ctx.lineTo(0, -17);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Lighthouse
    const lhGrad = ctx.createLinearGradient(14, -12, 18, -12);
    lhGrad.addColorStop(0, '#e8e0d0');
    lhGrad.addColorStop(1, '#c8c0b0');
    ctx.fillStyle = lhGrad;
    ctx.fillRect(14, -12, 4, 14);
    ctx.strokeStyle = '#a8a090';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(14, -12, 4, 14);

    // Lighthouse stripes
    ctx.fillStyle = '#c04040';
    ctx.fillRect(14, -10, 4, 2);
    ctx.fillRect(14, -6, 4, 2);
    ctx.fillRect(14, -2, 4, 2);

    // Lighthouse top
    ctx.fillStyle = '#4a4030';
    ctx.fillRect(13, -14, 6, 2);

    // Light beam
    ctx.fillStyle = 'rgba(255, 240, 180, 0.4)';
    ctx.beginPath();
    ctx.arc(16, -13, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 240, 180, 0.15)';
    ctx.beginPath();
    ctx.arc(16, -13, 5, 0, Math.PI * 2);
    ctx.fill();

    // Anchor chain
    ctx.strokeStyle = '#5a5040';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-8, 2);
    ctx.quadraticCurveTo(-9, 5, -8, 7);
    ctx.stroke();
  }

  private drawBridge(ctx: CanvasRenderingContext2D): void {
    // Bridge shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(1, 6, 16, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bridge deck
    const deckGrad = ctx.createLinearGradient(-16, -3, 16, -3);
    deckGrad.addColorStop(0, '#8a8070');
    deckGrad.addColorStop(0.5, '#9a9080');
    deckGrad.addColorStop(1, '#8a8070');
    ctx.fillStyle = deckGrad;
    ctx.fillRect(-16, -3, 32, 4);
    ctx.strokeStyle = '#7a7060';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(-16, -3, 32, 4);

    // Stone arch (main)
    ctx.fillStyle = '#6a6258';
    ctx.beginPath();
    ctx.moveTo(-12, 1);
    ctx.quadraticCurveTo(-6, -8, 0, -3);
    ctx.lineTo(0, 1);
    ctx.lineTo(-12, 1);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(12, 1);
    ctx.quadraticCurveTo(6, -8, 0, -3);
    ctx.lineTo(0, 1);
    ctx.lineTo(12, 1);
    ctx.closePath();
    ctx.fill();

    // Arch outline
    ctx.strokeStyle = '#9a9288';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-12, 1);
    ctx.quadraticCurveTo(0, -9, 12, 1);
    ctx.stroke();

    // Stone texture on arch
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.3;
    for (let i = -10; i <= 10; i += 3) {
      const archY = 1 - (1 - Math.abs(i) / 12) * 10;
      ctx.beginPath();
      ctx.moveTo(i, archY);
      ctx.lineTo(i, 1);
      ctx.stroke();
    }

    // Bridge railings
    ctx.strokeStyle = '#7a7060';
    ctx.lineWidth = 1;
    // Top rail
    ctx.beginPath();
    ctx.moveTo(-16, -4);
    ctx.lineTo(16, -4);
    ctx.stroke();

    // Railing posts
    for (let i = -14; i <= 14; i += 4) {
      ctx.fillStyle = '#6a6258';
      ctx.fillRect(i - 0.5, -6, 1, 3);
      // Post cap
      ctx.fillStyle = '#8a8278';
      ctx.beginPath();
      ctx.arc(i, -6, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Road surface
    ctx.fillStyle = 'rgba(120, 110, 90, 0.3)';
    ctx.fillRect(-15, -2, 30, 2);

    // Road center line
    ctx.strokeStyle = 'rgba(140, 130, 110, 0.4)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(-14, -1);
    ctx.lineTo(14, -1);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawMine(ctx: CanvasRenderingContext2D): void {
    // Mountain/hill base
    const mountainGrad = ctx.createLinearGradient(-12, -8, 12, 10);
    mountainGrad.addColorStop(0, '#5a5550');
    mountainGrad.addColorStop(0.5, '#4a4540');
    mountainGrad.addColorStop(1, '#3a3530');
    ctx.fillStyle = mountainGrad;
    ctx.beginPath();
    ctx.moveTo(-14, 10);
    ctx.lineTo(-10, -2);
    ctx.lineTo(-6, -6);
    ctx.lineTo(0, -8);
    ctx.lineTo(6, -6);
    ctx.lineTo(10, -2);
    ctx.lineTo(14, 10);
    ctx.closePath();
    ctx.fill();

    // Mountain rock texture
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(-4, -4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4, -2);
    ctx.lineTo(8, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-2, -6);
    ctx.lineTo(2, -3);
    ctx.stroke();

    // Mountain highlight
    ctx.fillStyle = 'rgba(150, 140, 120, 0.2)';
    ctx.beginPath();
    ctx.moveTo(-10, -2);
    ctx.lineTo(0, -8);
    ctx.lineTo(0, -4);
    ctx.lineTo(-6, -1);
    ctx.closePath();
    ctx.fill();

    // Mine entrance (arched)
    ctx.fillStyle = '#1a1510';
    ctx.beginPath();
    ctx.moveTo(-5, 6);
    ctx.lineTo(-5, 2);
    ctx.arc(0, 2, 5, Math.PI, 0);
    ctx.lineTo(5, 6);
    ctx.closePath();
    ctx.fill();

    // Entrance frame
    ctx.strokeStyle = '#5a5040';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5, 6);
    ctx.lineTo(-5, 2);
    ctx.arc(0, 2, 5, Math.PI, 0);
    ctx.lineTo(5, 6);
    ctx.stroke();

    // Wooden support beams
    ctx.fillStyle = '#4a3a20';
    ctx.fillRect(-6, 1, 1.5, 6);
    ctx.fillRect(4.5, 1, 1.5, 6);
    // Cross beam
    ctx.fillRect(-6, 0, 12, 1.5);

    // Lamp glow at entrance
    const lampGlow = ctx.createRadialGradient(0, 4, 0, 0, 4, 6);
    lampGlow.addColorStop(0, 'rgba(255, 180, 60, 0.8)');
    lampGlow.addColorStop(0.5, 'rgba(255, 160, 40, 0.3)');
    lampGlow.addColorStop(1, 'rgba(255, 140, 20, 0)');
    ctx.fillStyle = lampGlow;
    ctx.beginPath();
    ctx.arc(0, 4, 6, 0, Math.PI * 2);
    ctx.fill();

    // Lamp
    ctx.fillStyle = '#ff9828';
    ctx.beginPath();
    ctx.arc(0, 4, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Cart tracks
    ctx.strokeStyle = '#6a6050';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5, 6);
    ctx.lineTo(-12, 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5, 6);
    ctx.lineTo(12, 12);
    ctx.stroke();

    // Track ties
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      const tx = -5 - i * 2;
      const ty = 6 + i * 1.5;
      ctx.beginPath();
      ctx.moveTo(tx - 1, ty);
      ctx.lineTo(tx + 1, ty);
      ctx.stroke();
      const tx2 = 5 + i * 2;
      ctx.beginPath();
      ctx.moveTo(tx2 - 1, ty);
      ctx.lineTo(tx2 + 1, ty);
      ctx.stroke();
    }

    // Mine cart
    ctx.fillStyle = '#4a3a28';
    ctx.fillRect(-14, 10, 4, 3);
    ctx.strokeStyle = '#5a4a38';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(-14, 10, 4, 3);
    // Cart wheels
    ctx.fillStyle = '#3a2a18';
    ctx.beginPath();
    ctx.arc(-13, 13, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-11, 13, 1, 0, Math.PI * 2);
    ctx.fill();
    // Ore in cart
    ctx.fillStyle = '#6a6a70';
    ctx.fillRect(-13.5, 9, 1.5, 1.5);
    ctx.fillStyle = '#7a7a80';
    ctx.fillRect(-12, 9.5, 1.5, 1);
  }

  private drawFarm(ctx: CanvasRenderingContext2D): void {
    // Barn
    const barnGrad = ctx.createLinearGradient(-10, -6, -2, -6);
    barnGrad.addColorStop(0, '#a03020');
    barnGrad.addColorStop(1, '#802818');
    ctx.fillStyle = barnGrad;
    ctx.fillRect(-10, -6, 8, 8);

    // Barn roof
    ctx.fillStyle = '#6a5a40';
    ctx.beginPath();
    ctx.moveTo(-11, -6);
    ctx.lineTo(-6, -12);
    ctx.lineTo(-1, -6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#5a4a30';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Barn door
    ctx.fillStyle = '#3a2510';
    ctx.fillRect(-8, -2, 4, 6);
    // Barn door X
    ctx.strokeStyle = '#5a4a38';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-8, -2);
    ctx.lineTo(-4, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-4, -2);
    ctx.lineTo(-8, 4);
    ctx.stroke();

    // Hay loft window
    ctx.fillStyle = 'rgba(255, 220, 120, 0.2)';
    ctx.beginPath();
    ctx.arc(-6, -8, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a4a38';
    ctx.lineWidth = 0.3;
    ctx.stroke();

    // Plowed fields
    const fieldColors = ['#8a7a40', '#9a8a50', '#7a6a38'];
    for (let row = 0; row < 4; row++) {
      ctx.fillStyle = fieldColors[row % 3];
      ctx.fillRect(2 + row * 3, -8, 2, 16);
    }

    // Crop rows (green)
    ctx.fillStyle = '#6aaa30';
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const cx = 2.5 + row * 3;
        const cy = -6 + col * 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Fence
    ctx.strokeStyle = '#6a5a40';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-12, 4);
    ctx.lineTo(16, 4);
    ctx.stroke();
    for (let i = -12; i <= 16; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 2);
      ctx.lineTo(i, 6);
      ctx.stroke();
    }

    // Scarecrow
    ctx.strokeStyle = '#5a4a30';
    ctx.lineWidth = 1;
    // Pole
    ctx.beginPath();
    ctx.moveTo(8, -2);
    ctx.lineTo(8, 4);
    ctx.stroke();
    // Cross beam
    ctx.beginPath();
    ctx.moveTo(5, -1);
    ctx.lineTo(11, -1);
    ctx.stroke();
    // Hat
    ctx.fillStyle = '#4a3a20';
    ctx.fillRect(6.5, -4, 3, 1.5);
    // Body
    ctx.fillStyle = '#7a6a50';
    ctx.fillRect(7, -1, 2, 3);
  }

  private drawForestIcon(ctx: CanvasRenderingContext2D): void {
    // Multiple tree types for variety
    const trees = [
      { x: -6, y: -4, size: 10, type: 'pine', shade: '#1a3a20' },
      { x: 6, y: -2, size: 12, type: 'pine', shade: '#153018' },
      { x: 0, y: -6, size: 14, type: 'oak', shade: '#1a3520' },
      { x: -3, y: 4, size: 8, type: 'pine', shade: '#1e3e25' },
      { x: 4, y: 5, size: 9, type: 'oak', shade: '#153018' },
      { x: 0, y: 8, size: 7, type: 'pine', shade: '#1a3a20' },
    ];

    for (const tree of trees) {
      // Tree shadow
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.ellipse(tree.x + 2, tree.y + tree.size * 0.3 + 2, tree.size * 0.3, tree.size * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();

      if (tree.type === 'pine') {
        // Pine tree (layered triangles)
        for (let layer = 0; layer < 3; layer++) {
          const layerY = tree.y - tree.size * 0.2 + layer * tree.size * 0.25;
          const layerW = tree.size * 0.35 * (1 - layer * 0.2);
          const layerH = tree.size * 0.35;

          ctx.fillStyle = tree.shade;
          ctx.beginPath();
          ctx.moveTo(tree.x, layerY - layerH);
          ctx.lineTo(tree.x - layerW, layerY);
          ctx.lineTo(tree.x + layerW, layerY);
          ctx.closePath();
          ctx.fill();

          // Highlight on left side
          ctx.fillStyle = 'rgba(100, 180, 80, 0.1)';
          ctx.beginPath();
          ctx.moveTo(tree.x, layerY - layerH);
          ctx.lineTo(tree.x - layerW, layerY);
          ctx.lineTo(tree.x, layerY);
          ctx.closePath();
          ctx.fill();
        }

        // Trunk
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(tree.x - 1, tree.y + tree.size * 0.1, 2, tree.size * 0.2);
      } else {
        // Oak tree (round canopy)
        const canopyR = tree.size * 0.35;

        // Canopy shadow
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.beginPath();
        ctx.arc(tree.x + 1, tree.y - tree.size * 0.2 + 1, canopyR, 0, Math.PI * 2);
        ctx.fill();

        // Main canopy
        ctx.fillStyle = tree.shade;
        ctx.beginPath();
        ctx.arc(tree.x, tree.y - tree.size * 0.2, canopyR, 0, Math.PI * 2);
        ctx.fill();

        // Canopy highlights (lighter patches)
        ctx.fillStyle = 'rgba(80, 160, 60, 0.15)';
        ctx.beginPath();
        ctx.arc(tree.x - canopyR * 0.3, tree.y - tree.size * 0.2 - canopyR * 0.2, canopyR * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Trunk
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(tree.x - 1.5, tree.y, 3, tree.size * 0.2);
      }
    }

    // Ground detail (small grass tufts)
    ctx.strokeStyle = '#2a4a30';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      const gx = -8 + i * 4;
      const gy = 10;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx - 1, gy - 3, gx - 2, gy - 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + 1, gy - 3, gx + 2, gy - 5);
      ctx.stroke();
    }
  }

  // --- Armies ---

  private drawArmy(ctx: CanvasRenderingContext2D, army: ArmyState, time: number): void {
    const p = army.position;
    const color = KINGDOM_COLORS[army.kingdomId] ?? '#d6b260';
    const bob = Math.sin(time / 180 + p.x * 0.1) * 1.5;

    ctx.save();
    ctx.translate(p.x, p.y);

    // Morale-based tint
    const moraleAlpha = army.morale < 30 ? 0.3 : army.morale > 70 ? 0 : 0;
    if (moraleAlpha > 0) {
      ctx.fillStyle = `rgba(180, 30, 30, ${moraleAlpha})`;
      ctx.beginPath();
      ctx.arc(0, bob, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    // Army formation: group of soldiers
    const soldiers = army.composition.reduce((sum, c) => sum + c.count, 0);
    const formationSize = Math.min(5, Math.max(2, Math.floor(soldiers / 50)));

    for (let i = 0; i < formationSize; i++) {
      const sx = (i - (formationSize - 1) / 2) * 5;
      // Soldier body
      ctx.fillStyle = '#2a2218';
      ctx.fillRect(sx - 1.5, 2 + bob, 3, 5);
      // Helmet
      ctx.fillStyle = '#6a6050';
      ctx.beginPath();
      ctx.arc(sx, 1 + bob, 2, Math.PI, 0);
      ctx.fill();
    }

    // Supply wagons
    if (army.wagons > 0) {
      ctx.fillStyle = '#5a4020';
      ctx.fillRect(-formationSize * 3, 4 + bob, 4, 3);
      ctx.fillRect(formationSize * 3 - 4, 4 + bob, 4, 3);
    }

    // Banner
    ctx.strokeStyle = '#d6b260';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 1 + bob);
    ctx.lineTo(0, -14 + bob);
    ctx.stroke();

    // Flag (animated)
    const flagWave = Math.sin(time / 300 + p.x * 0.05) * 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -14 + bob);
    ctx.lineTo(10 + flagWave, -10 + bob);
    ctx.lineTo(0, -6 + bob);
    ctx.closePath();
    ctx.fill();

    // Status indicator
    if (army.currentOrder === 'siege') {
      ctx.fillStyle = '#ff4030';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚔', 0, -18 + bob);
    } else if (army.currentOrder === 'defending') {
      ctx.fillStyle = '#40a0ff';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🛡', 0, -18 + bob);
    }

    // Supply bar
    const supplyPct = army.supplies.food / (army.dailyConsumption.food * 30 || 1);
    const barW = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-barW / 2, 10 + bob, barW, 2);
    ctx.fillStyle = supplyPct > 0.5 ? '#40a040' : supplyPct > 0.25 ? '#c0a030' : '#c03030';
    ctx.fillRect(-barW / 2, 10 + bob, barW * Math.min(1, supplyPct), 2);

    ctx.restore();
  }

  // --- Convoys ---

  private drawConvoys(ctx: CanvasRenderingContext2D, time: number): void {
    const convoys = this.state?.convoys;
    if (!convoys) return;

    for (const convoy of Object.values(convoys)) {
      if (convoy.status !== 'traveling') continue;
      const c = convoy as Convoy;
      const pos = c.position;
      if (!pos) continue;

      ctx.save();
      ctx.translate(pos.x, pos.y);

      // Wagon
      ctx.fillStyle = '#5a4020';
      ctx.fillRect(-4, -2, 8, 5);
      // Wheels
      ctx.fillStyle = '#3a2a15';
      ctx.beginPath();
      ctx.arc(-3, 4, 2, 0, Math.PI * 2);
      ctx.arc(3, 4, 2, 0, Math.PI * 2);
      ctx.fill();
      // Canopy
      ctx.fillStyle = '#8a6a40';
      ctx.fillRect(-3, -4, 6, 2);

      // Trail (dotted path from origin)
      if (c.path && c.path.length > 1) {
        ctx.strokeStyle = 'rgba(140, 115, 70, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(c.path[0].x - pos.x, c.path[0].y - pos.y);
        ctx.lineTo(0, 0);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }
  }

  // --- Atmospheric Effects ---

  private drawDayNightOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.state) return;
    const hour = this.state.hour;
    let alpha = 0;
    let color = [0, 0, 0];

    if (hour >= 21 || hour < 4) {
      // Deep night
      alpha = 0.35;
      color = [10, 15, 30];
    } else if (hour >= 19 || hour < 5) {
      // Night
      alpha = 0.2;
      color = [15, 20, 35];
    } else if (hour >= 17 && hour < 19) {
      // Dusk
      const t = (hour - 17) / 2;
      alpha = 0.15 * (1 - t) + 0.2 * t;
      color = [30, 20, 40];
    } else if (hour >= 5 && hour < 7) {
      // Dawn
      const t = (hour - 5) / 2;
      alpha = 0.2 * (1 - t) + 0.1 * t;
      color = [40, 30, 20];
    } else if (hour >= 7 && hour < 8) {
      // Morning golden
      alpha = 0.05;
      color = [60, 45, 20];
    } else if (hour >= 18 && hour < 19) {
      // Evening golden
      alpha = 0.08;
      color = [50, 35, 15];
    }

    if (alpha > 0) {
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
      ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }
  }

  private drawSeasonTint(ctx: CanvasRenderingContext2D): void {
    if (!this.state) return;
    const season = this.state.season;
    const alpha = 0.06;

    const tints: Record<number, [number, number, number]> = {
      0: [40, 80, 40],    // Spring: fresh green
      1: [80, 70, 20],    // Summer: warm golden
      2: [100, 60, 20],   // Autumn: orange-brown
      3: [30, 40, 70],    // Winter: blue-white
    };

    const tint = tints[season];
    if (tint) {
      ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${alpha})`;
      ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }
  }

  private drawWeather(ctx: CanvasRenderingContext2D, weather?: WeatherState, time?: number): void {
    if (!weather || !['rain', 'storm', 'snow', 'blizzard', 'fog'].includes(weather.type)) return;
    const amount = Math.ceil(30 + weather.intensity * 1.2);
    if (this.particles.length !== amount) {
      this.particles = Array.from({ length: amount }, () => ({
        x: Math.random() * this.canvasWidth,
        y: Math.random() * this.canvasHeight,
        vx: -1 - Math.random() * 3,
        vy: 4 + Math.random() * 8,
        size: 1 + Math.random() * 3,
        phase: Math.random() * 10,
      }));
    }

    if (weather.type === 'fog') {
      ctx.fillStyle = `rgba(197, 211, 199, ${0.1 + weather.intensity / 600})`;
      ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
      return;
    }

    const isSnow = weather.type === 'snow' || weather.type === 'blizzard';
    ctx.strokeStyle = isSnow ? 'rgba(240, 248, 255, 0.85)' : 'rgba(145, 195, 220, 0.6)';
    ctx.fillStyle = ctx.strokeStyle;

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y > this.canvasHeight || p.x < -10) {
        p.x = Math.random() * (this.canvasWidth + 20);
        p.y = -10;
      }
      if (isSnow) {
        p.x += Math.sin(p.phase += .04) * 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2.5, p.y - p.vy * 2.5);
        ctx.lineWidth = p.size * 0.5;
        ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
  }

  private drawVignette(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(
      this.canvasWidth / 2, this.canvasHeight / 2,
      Math.min(this.canvasWidth, this.canvasHeight) * .2,
      this.canvasWidth / 2, this.canvasHeight / 2,
      Math.max(this.canvasWidth, this.canvasHeight) * .72
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.15)');
    g.addColorStop(1, 'rgba(4,8,7,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
  }

  // --- Minimap ---

  private drawMinimap(ctx: CanvasRenderingContext2D): void {
    const mc = this.minimapCanvas;
    const mctx = this.minimapCtx;
    if (!mctx) return;

    // Update minimap content periodically
    if (this.minimapDirty || Math.random() < 0.02) {
      this.renderMinimap(mctx);
      this.minimapDirty = false;
    }

    // Draw minimap to screen
    const mw = 200, mh = 150;
    const mx = this.canvasWidth - mw - 12;
    const my = this.canvasHeight - mh - 12;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(10, 14, 13, 0.9)';
    ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
    ctx.drawImage(mc, mx, my, mw, mh);
    ctx.strokeStyle = '#C9A84C';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mx - 2, my - 2, mw + 4, mh + 4);

    // Camera viewport rectangle
    const vx = (this.camera.x - this.canvasWidth / (2 * this.camera.zoom)) / MAP_WIDTH * mw;
    const vy = (this.camera.y - this.canvasHeight / (2 * this.camera.zoom)) / MAP_HEIGHT * mh;
    const vw = (this.canvasWidth / this.camera.zoom) / MAP_WIDTH * mw;
    const vh = (this.canvasHeight / this.camera.zoom) / MAP_HEIGHT * mh;
    ctx.strokeStyle = 'rgba(232, 212, 139, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mx + vx, my + vy, vw, vh);

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private renderMinimap(mctx: CanvasRenderingContext2D): void {
    const mw = this.minimapCanvas.width;
    const mh = this.minimapCanvas.height;
    const sx = mw / MAP_WIDTH;
    const sy = mh / MAP_HEIGHT;

    // Draw terrain (simplified)
    mctx.drawImage(this.terrainCanvas, 0, 0, mw, mh);

    // Territories
    const territories = this.state?.territories?.length ? this.state.territories : TERRITORIES;
    for (const t of territories) {
      mctx.beginPath();
      t.polygon.forEach((p, i) => i ? mctx.lineTo(p.x * sx, p.y * sy) : mctx.moveTo(p.x * sx, p.y * sy));
      mctx.closePath();
      mctx.fillStyle = t.color;
      mctx.fill();
      mctx.strokeStyle = KINGDOM_COLORS[t.kingdomId] ?? '#c8a44d';
      mctx.lineWidth = 1;
      mctx.stroke();
    }

    // Features
    for (const f of this.features()) {
      if (['city', 'castle', 'port'].includes(f.type)) {
        const color = f.kingdomId ? KINGDOM_COLORS[f.kingdomId] : '#d7b254';
        mctx.fillStyle = color;
        mctx.beginPath();
        mctx.arc(f.position.x * sx, f.position.y * sy, 3, 0, Math.PI * 2);
        mctx.fill();
      }
    }

    // Armies
    for (const army of Object.values(this.state?.armies ?? {})) {
      const color = KINGDOM_COLORS[army.kingdomId] ?? '#d6b260';
      mctx.fillStyle = color;
      mctx.beginPath();
      mctx.arc(army.position.x * sx, army.position.y * sy, 2, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  private isMinimapClick(sx: number, sy: number): boolean {
    const mw = 200, mh = 150;
    const mx = this.canvasWidth - mw - 12;
    const my = this.canvasHeight - mh - 12;
    return sx >= mx && sx <= mx + mw && sy >= my && sy <= my + mh;
  }

  private handleMinimapClick(worldPos: Position): void {
    const mw = 200, mh = 150;
    const mx = this.canvasWidth - mw - 12;
    const my = this.canvasHeight - mh - 12;
    const clickX = this.pointer.x;
    const clickY = this.pointer.y;
    const mapX = ((clickX - mx) / mw) * MAP_WIDTH;
    const mapY = ((clickY - my) / mh) * MAP_HEIGHT;
    this.targetCamera.x = this.clamp(mapX, 100, MAP_WIDTH - 100);
    this.targetCamera.y = this.clamp(mapY, 100, MAP_HEIGHT - 100);
  }

  // --- Tooltip ---

  private drawTooltip(ctx: CanvasRenderingContext2D): void {
    if (!this.hoverFeature) return;
    const text = this.hoverFeature.name;
    ctx.font = '13px Georgia, serif';
    const width = ctx.measureText(text).width + 20;
    const x = Math.min(this.canvasWidth - width - 8, this.pointer.x + 16);
    const y = this.pointer.y + 16;

    ctx.fillStyle = 'rgba(18, 14, 10, 0.92)';
    ctx.strokeStyle = '#c9a44f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, width, 28, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f0dfad';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 10, y + 14);
  }

  // --- Utilities ---

  private features(): MapFeature[] {
    const dynamic = Object.values(this.state?.mapFeatures ?? {});
    return dynamic.length
      ? [...this.baseFeatures, ...dynamic.filter(f => !this.baseFeatures.some(b => b.id === f.id))]
      : this.baseFeatures;
  }

  private updateHover(): void {
    const feature = this.featureAt(this.screenToWorld(this.pointer.x, this.pointer.y));
    if (feature?.id !== this.hoverFeature?.id) {
      this.hoverFeature = feature;
      this.canvas.style.cursor = feature ? 'pointer' : this.dragging ? 'grabbing' : 'default';
      this.options.onHover?.(feature, this.pointer);
    }
  }

  private featureAt(world: Position): MapFeature | null {
    const hitRadius = 22 / this.camera.zoom;
    let nearest: MapFeature | null = null;
    let nearestDistance = Infinity;
    for (const feature of this.features()) {
      const d = Math.hypot(feature.position.x - world.x, feature.position.y - world.y);
      if (d < hitRadius && d < nearestDistance) { nearest = feature; nearestDistance = d; }
    }
    return nearest;
  }

  private screenToWorld(x: number, y: number): Position {
    return {
      x: (x - this.canvasWidth / 2) / this.camera.zoom + this.camera.x,
      y: (y - this.canvasHeight / 2) / this.camera.zoom + this.camera.y,
    };
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvasWidth = Math.max(1, Math.round(rect.width));
    this.canvasHeight = Math.max(1, Math.round(rect.height));
    const physicalWidth = this.canvasWidth * this.dpr;
    const physicalHeight = this.canvasHeight * this.dpr;
    if (this.canvas.width !== physicalWidth || this.canvas.height !== physicalHeight) {
      this.canvas.width = physicalWidth;
      this.canvas.height = physicalHeight;
      // Scale the context so drawing coordinates match CSS pixels
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  private constrainCamera(): void {
    const halfW = this.canvasWidth / (2 * this.camera.zoom);
    const halfH = this.canvasHeight / (2 * this.camera.zoom);
    this.camera.x = this.clamp(this.camera.x, halfW, MAP_WIDTH - halfW);
    this.camera.y = this.clamp(this.camera.y, halfH, MAP_HEIGHT - halfH);
    this.targetCamera.x = this.clamp(this.targetCamera.x, halfW, MAP_WIDTH - halfW);
    this.targetCamera.y = this.clamp(this.targetCamera.y, halfH, MAP_HEIGHT - halfH);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

export default MapRenderer;