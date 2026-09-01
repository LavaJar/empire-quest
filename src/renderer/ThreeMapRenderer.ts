import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ArmyState, BiomeType, Camera, MapFeature, Position, SimulationState, Territory, WeatherState } from '../types';
import type { Convoy } from '../types/physicalEconomy';
import { SimplexNoise } from '../utils/noise';

/** Three.js 3D isometric renderer for the Empire Quest strategic map. */
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

// --- Biome colors (same palette as 2D renderer) ---
const BIOME_HEX: Record<BiomeType, string> = {
  deep_water: '#0f2738', coastal: '#1e5568', lake: '#164a5e', grassland: '#4a6330',
  forest: '#234428', dense_forest: '#143018', mountain: '#5a5550', mountain_pass: '#7e7568',
  desert: '#a07838', marsh: '#3a5640', farmland: '#6a7a35', tundra: '#aab5ac',
};

const BIOME_COLORS: Record<BiomeType, THREE.Color> = {} as Record<BiomeType, THREE.Color>;
for (const [k, v] of Object.entries(BIOME_HEX)) BIOME_COLORS[k as BiomeType] = new THREE.Color(v);

const BIOME_COLORS_DARK: Record<BiomeType, THREE.Color> = {} as Record<BiomeType, THREE.Color>;
const BIOME_HEX_DARK: Record<BiomeType, string> = {
  deep_water: '#091a26', coastal: '#144050', lake: '#103848', grassland: '#3a5025',
  forest: '#1a3520', dense_forest: '#0e2512', mountain: '#4a4540', mountain_pass: '#6a6058',
  desert: '#8a6830', marsh: '#2e4835', farmland: '#5a6828', tundra: '#98a59c',
};
for (const [k, v] of Object.entries(BIOME_HEX_DARK)) BIOME_COLORS_DARK[k as BiomeType] = new THREE.Color(v);

// --- Kingdom colors ---
export const KINGDOM_COLORS: Record<string, string> = {
  azure_coast: '#42a5f5', ironpeak_hold: '#b8b0a6', whispering_weald: '#4caf50',
  verdant_realm: '#d4b14d', silver_crown: '#bd72d1', sands_of_zahar: '#ff9b3d',
};

const KINGDOM_NAMES: Record<string, string> = {
  azure_coast: 'Azure Coast', ironpeak_hold: 'Ironpeak Hold', whispering_weald: 'Whispering Weald',
  verdant_realm: 'Verdant Realm', silver_crown: 'Silver Crown', sands_of_zahar: 'Sands of Zahar',
};

// --- Territories ---
export const TERRITORIES: Territory[] = [
  { kingdomId: 'azure_coast', color: 'rgba(21,101,192,.18)', polygon: [{ x: 70, y: 170 }, { x: 570, y: 100 }, { x: 700, y: 560 }, { x: 430, y: 760 }, { x: 90, y: 620 }] },
  { kingdomId: 'ironpeak_hold', color: 'rgba(80,80,80,.22)', polygon: [{ x: 570, y: 100 }, { x: 1230, y: 70 }, { x: 1310, y: 460 }, { x: 920, y: 650 }, { x: 700, y: 560 }] },
  { kingdomId: 'whispering_weald', color: 'rgba(27,94,32,.20)', polygon: [{ x: 1310, y: 180 }, { x: 1910, y: 140 }, { x: 1920, y: 720 }, { x: 1510, y: 790 }, { x: 1310, y: 460 }] },
  { kingdomId: 'verdant_realm', color: 'rgba(46,125,50,.20)', polygon: [{ x: 430, y: 760 }, { x: 920, y: 650 }, { x: 1150, y: 1120 }, { x: 750, y: 1410 }, { x: 130, y: 1280 }] },
  { kingdomId: 'silver_crown', color: 'rgba(106,27,154,.18)', polygon: [{ x: 920, y: 650 }, { x: 1510, y: 790 }, { x: 1640, y: 1280 }, { x: 1150, y: 1420 }, { x: 1150, y: 1120 }] },
  { kingdomId: 'sands_of_zahar', color: 'rgba(230,81,0,.18)', polygon: [{ x: 1510, y: 790 }, { x: 1920, y: 720 }, { x: 1940, y: 1430 }, { x: 1640, y: 1280 }] },
];

function polygonCentroid(polygon: Position[]): Position {
  let cx = 0, cy = 0;
  for (const p of polygon) { cx += p.x; cy += p.y; }
  return { x: cx / polygon.length, y: cy / polygon.length };
}

// --- Elevation-to-height mapping ---
const ELEVATION_HEIGHT_SCALE = 80; // max height for mountains

function elevationToHeight(e: number): number {
  if (e < 0.04) return -2; // deep water below sea level
  if (e < 0.12) return 0;  // coastal at sea level
  return (e - 0.12) * ELEVATION_HEIGHT_SCALE;
}

// --- Cinematic post-processing grade: warm color grade + soft vignette ---
const CinematicGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uWarmth: { value: 0.35 },        // warm color grading strength
    uVignette: { value: 0.45 },      // vignette strength
    uContrast: { value: 1.06 },      // gentle contrast lift
    uSunGlow: { value: new THREE.Vector2(0.72, 0.35) }, // screen-space sun position (0..1)
    uSunStrength: { value: 0.12 },   // subtle anamorphic sun glow
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uWarmth;
    uniform float uVignette;
    uniform float uContrast;
    uniform vec2 uSunGlow;
    uniform float uSunStrength;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec3 c = color.rgb;

      // Gentle contrast around mid-gray
      c = (c - 0.5) * uContrast + 0.5;

      // Warm cinematic grade: lift reds/golds, cool the shadows slightly
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 warm = vec3(1.06, 1.0, 0.9);
      vec3 cool = vec3(0.94, 0.97, 1.05);
      vec3 grade = mix(cool, warm, smoothstep(0.0, 0.7, luma));
      c = mix(c, c * grade, uWarmth);

      // Subtle sun glow in the sky region (upper right)
      float sunDist = distance(vUv, uSunGlow);
      c += vec3(1.0, 0.85, 0.6) * uSunStrength * exp(-sunDist * 3.0);

      // Soft cinematic vignette
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * (uVignette * 2.2);
      c *= clamp(vig, 0.0, 1.0);

      gl_FragColor = vec4(c, color.a);
    }
  `,
};

/**
 * 3D Isometric Map Renderer using Three.js.
 * Renders terrain, buildings, armies, convoys, weather, and atmospheric effects.
 */
export class ThreeMapRenderer {
  readonly canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2 = new THREE.Vector2();

  private noise: SimplexNoise;
  private terrain: TerrainTile[][] = [];
  private rivers: River[] = [];
  private baseFeatures: MapFeature[] = [];

  private state: SimulationState | null = null;
  private cameraState: Camera = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, zoom: 0.55 };
  private targetCamera: Camera = { ...this.cameraState };

  private particles: WeatherParticle[] = [];
  private hoverFeature: MapFeature | null = null;
  private pointer = { x: 0, y: 0 };
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private canvasWidth = 0;
  private canvasHeight = 0;
  private dpr = 1;
  private animationFrame = 0;
  private lastTime = 0;
  private readonly options: MapRendererOptions;
  private readonly handlers: Array<[string, EventListener]> = [];

  // 3D scene groups
  private terrainGroup: THREE.Group;
  private buildingGroup: THREE.Group;
  private featureGroup: THREE.Group;
  private armyGroup: THREE.Group;
  private convoyGroup: THREE.Group;
  private waterGroup: THREE.Group;
  private weatherGroup: THREE.Group;
  private territoryGroup: THREE.Group;
  private overlayGroup: THREE.Group;

  // Clickable feature meshes for raycasting
  private featureMeshes: Map<string, THREE.Mesh> = new Map();

  // Minimap
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapDirty = true;

  // Lighting
  private sunLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;

  // Post-processing
  private composer: EffectComposer | null = null;
  private gradePass: ShaderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  // Sky dome (gradient, follows camera)
  private skyDome: THREE.Mesh | null = null;
  private skyUniforms: { top: { value: THREE.Color }; bottom: { value: THREE.Color }; offset: { value: number }; exponent: { value: number } } | null = null;

  // Water mesh
  private waterMesh: THREE.Mesh | null = null;

  // Weather particle system
  private weatherPoints: THREE.Points | null = null;

  constructor(canvas: HTMLCanvasElement, options: MapRendererOptions = {}) {
    this.canvas = canvas;
    this.options = options;
    this.noise = new SimplexNoise(options.seed ?? 42);

    // --- Three.js Setup ---
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    // Warm atmospheric haze (golden-hour base) — replaced per-frame by updateAtmosphere
    this.scene.background = new THREE.Color('#bcd3e8');
    this.scene.fog = new THREE.FogExp2('#d8c9a8', 0.00042);

    // Perspective camera for 3D isometric view
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);

    // Raycaster
    this.raycaster = new THREE.Raycaster();

    // Groups
    this.terrainGroup = new THREE.Group();
    this.buildingGroup = new THREE.Group();
    this.featureGroup = new THREE.Group();
    this.armyGroup = new THREE.Group();
    this.convoyGroup = new THREE.Group();
    this.waterGroup = new THREE.Group();
    this.weatherGroup = new THREE.Group();
    this.territoryGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group();

    this.scene.add(this.terrainGroup);
    this.scene.add(this.waterGroup);
    this.scene.add(this.territoryGroup);
    this.scene.add(this.buildingGroup);
    this.scene.add(this.featureGroup);
    this.scene.add(this.armyGroup);
    this.scene.add(this.convoyGroup);
    this.scene.add(this.weatherGroup);
    this.scene.add(this.overlayGroup);

    // Lighting
    this.setupLighting();
    this.buildSkyDome();

    // Minimap
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width = 256;
    this.minimapCanvas.height = 192;
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    // Generate map data
    this.generateMap();

    // Build 3D scene
    this.buildTerrain();
    this.buildWater();
    this.buildTerritories();
    this.buildFeatures();
    this.buildRivers();
    this.buildRoads();

    // Events
    this.bindEvents();
    this.resize();
    this.setupPostProcessing();

    // Start render loop
    this.animationFrame = requestAnimationFrame(this.frame.bind(this));
  }

  // --- Lighting ---

  private setupLighting(): void {
    // Ambient light - soft fill
    this.ambientLight = new THREE.AmbientLight(0x404050, 0.4);
    this.scene.add(this.ambientLight);

    // Hemisphere light - sky/ground color blend
    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5a20, 0.5);
    this.scene.add(this.hemiLight);

    // Directional light (sun) with shadows — low golden-hour angle
    this.sunLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
    this.sunLight.position.set(1100, 380, 1350);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 5000;
    this.sunLight.shadow.camera.left = -1500;
    this.sunLight.shadow.camera.right = 1500;
    this.sunLight.shadow.camera.top = 1500;
    this.sunLight.shadow.camera.bottom = -1500;
    this.sunLight.shadow.bias = -0.001;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Subtle rim light from opposite side
    const rimLight = new THREE.DirectionalLight(0x6080a0, 0.3);
    rimLight.position.set(-600, -400, 800);
    this.scene.add(rimLight);
  }

  // --- Sky Dome (gradient horizon-to-zenith, follows camera) ---

  private buildSkyDome(): void {
    this.skyUniforms = {
      top: { value: new THREE.Color('#5a8fd0') },
      bottom: { value: new THREE.Color('#f0e0c0') },
      offset: { value: 20 },
      exponent: { value: 0.6 },
    };
    const skyGeo = new THREE.SphereGeometry(4000, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 top;
        uniform vec3 bottom;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float t = pow(max(h, 0.0), exponent);
          gl_FragColor = vec4(mix(bottom, top, t), 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.renderOrder = -1;
    this.scene.add(this.skyDome);
  }

  // --- Post-processing: bloom + cinematic grade + vignette ---

  private setupPostProcessing(): void {
    const w = this.canvasWidth || 800;
    const h = this.canvasHeight || 600;
    const pr = Math.min(this.dpr, 2);

    const renderTarget = new THREE.WebGLRenderTarget(w * pr, h * pr, {
      samples: 4, // MSAA for clean edges
      type: THREE.HalfFloatType, // HDR for bloom
    });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Bloom: bright sunlit surfaces, glowing windows, sun glow
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.6, 0.85);
    this.composer.addPass(this.bloomPass);

    // Cinematic grade + vignette
    this.gradePass = new ShaderPass(CinematicGradeShader);
    this.composer.addPass(this.gradePass);

    // Final output (tone mapping + sRGB)
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  // --- Map Generation (same data as 2D renderer) ---

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

  private elevationAt(p: Position): number {
    const x = this.clamp(Math.floor(p.x / TERRAIN_TILE_SIZE), 0, this.terrain[0].length - 1);
    const y = this.clamp(Math.floor(p.y / TERRAIN_TILE_SIZE), 0, this.terrain.length - 1);
    return this.terrain[y][x].elevation;
  }

  private biomeAt(p: Position): BiomeType {
    const x = this.clamp(Math.floor(p.x / TERRAIN_TILE_SIZE), 0, this.terrain[0].length - 1);
    const y = this.clamp(Math.floor(p.y / TERRAIN_TILE_SIZE), 0, this.terrain.length - 1);
    return this.terrain[y][x].biome;
  }

  private generateRivers(): River[] {
    const sources: Position[] = [{ x: 1060, y: 220 }, { x: 1190, y: 340 }, { x: 1450, y: 390 }, { x: 780, y: 280 }];
    return sources.map((source, index) => {
      const points: Position[] = [source];
      let current = { ...source };
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

  private createFeatures(): MapFeature[] {
    const f = (id: string, type: MapFeature['type'], name: string, x: number, y: number, kingdomId?: string): MapFeature =>
      ({ id, type, name, position: { x, y }, kingdomId, level: type === 'city' || type === 'castle' ? 3 : 1, icon: type });
    return [
      f('greenhaven', 'city', 'Greenhaven', 630, 1030, 'verdant_realm'),
      f('serenity', 'port', 'Port Serenity', 250, 380, 'azure_coast'),
      f('qamar', 'city', 'Qamar al-Nur', 1740, 1090, 'sands_of_zahar'),
      f('stoneforge', 'castle', 'Stoneforge', 1010, 310, 'ironpeak_hold'),
      f('eldertree', 'city', 'Eldertree', 1620, 450, 'whispering_weald'),
      f('argentis', 'city', 'Argentis', 1240, 990, 'silver_crown'),
      f('harvest-hollow', 'village', 'Harvest Hollow', 470, 1140, 'verdant_realm'),
      f('millbrook', 'village', 'Millbrook', 780, 880, 'verdant_realm'),
      f('iron-mine', 'mine', 'Black Anvil Mine', 1120, 220, 'ironpeak_hold'),
      f('timber-camp', 'forest', 'Oldgrowth Camp', 1510, 530, 'whispering_weald'),
      f('sunwell-farm', 'farm', 'Sunwell Estate', 710, 1170, 'verdant_realm'),
      f('river-bridge', 'bridge', 'Kingswater Bridge', 945, 710, 'silver_crown'),
      f('dune-watch', 'castle', 'Dune Watch', 1630, 940, 'sands_of_zahar'),
      f('azure-village', 'village', 'Saltmarsh', 420, 550, 'azure_coast'),
    ];
  }// --- 3D Terrain ---

  private buildTerrain(): void {
    const cols = this.terrain[0].length; // 250 tiles wide
    const rows = this.terrain.length;     // 187 tiles tall

    // Use a lower-resolution grid for performance, then subdivide
    const step = 4; // sample every 4th tile
    const gridCols = Math.ceil(cols / step);
    const gridRows = Math.ceil(rows / step);

    const geometry = new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT, gridCols - 1, gridRows - 1);
    geometry.rotateX(-Math.PI / 2); // Make it horizontal

    const positions = geometry.attributes.position.array as Float32Array;
    const colors = new Float32Array(positions.length); // 3 components per vertex

    for (let i = 0; i < positions.length; i += 3) {
      const wx = positions[i] + MAP_WIDTH / 2; // center the plane
      const wz = positions[i + 2] + MAP_HEIGHT / 2;

      // Sample terrain at this world position
      const tileX = this.clamp(Math.floor(wx / TERRAIN_TILE_SIZE), 0, cols - 1);
      const tileZ = this.clamp(Math.floor(wz / TERRAIN_TILE_SIZE), 0, rows - 1);
      const tile = this.terrain[tileZ]?.[tileX];

      if (tile) {
        // Height from elevation
        positions[i + 1] = elevationToHeight(tile.elevation);

        // Vertex color from biome
        const baseColor = BIOME_COLORS[tile.biome];
        const darkColor = BIOME_COLORS_DARK[tile.biome];

        // Per-tile variation
        const variation = (this.noise.noise2D(tileX * 0.3, tileZ * 0.3) * 0.12 + 1);
        const blend = (this.noise.noise2D(tileX * 0.5 + 100, tileZ * 0.5 + 100) + 1) * 0.5;

        colors[i] = (baseColor.r * (1 - blend) + darkColor.r * blend) * variation;
        colors[i + 1] = (baseColor.g * (1 - blend) + darkColor.g * blend) * variation;
        colors[i + 2] = (baseColor.b * (1 - blend) + darkColor.b * blend) * variation;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    // Add slight displacement for mountains
    this.displaceMountainVertices(geometry);

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: false,
    });

    const terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.receiveShadow = true;
    terrainMesh.name = 'terrain';
    this.terrainGroup.add(terrainMesh);

    // Add terrain detail overlay (smaller displaced mesh for texture feel)
    this.buildTerrainDetail();
  }

  private buildTerrainDetail(): void {
    // Secondary terrain layer for fine detail - smaller scale displacement
    const step = 8;
    const cols = this.terrain[0].length;
    const rows = this.terrain.length;
    const gridCols = Math.ceil(cols / step);
    const gridRows = Math.ceil(rows / step);

    const geometry = new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT, gridCols - 1, gridRows - 1);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < positions.length; i += 3) {
      const wx = positions[i] + MAP_WIDTH / 2;
      const wz = positions[i + 2] + MAP_HEIGHT / 2;
      const tileX = this.clamp(Math.floor(wx / TERRAIN_TILE_SIZE), 0, cols - 1);
      const tileZ = this.clamp(Math.floor(wz / TERRAIN_TILE_SIZE), 0, rows - 1);
      const tile = this.terrain[tileZ]?.[tileX];

      if (tile) {
        positions[i + 1] = elevationToHeight(tile.elevation) + 0.5; // slightly above main terrain
      }
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.06,
      roughness: 1,
      metalness: 0,
      depthWrite: false,
    });

    const detailMesh = new THREE.Mesh(geometry, material);
    detailMesh.receiveShadow = true;
    this.terrainGroup.add(detailMesh);
  }

  private displaceMountainVertices(geometry: THREE.BufferGeometry): void {
    const positions = geometry.attributes.position.array as Float32Array;
    const cols = this.terrain[0].length;
    const rows = this.terrain.length;

    for (let i = 0; i < positions.length; i += 3) {
      const wx = positions[i] + MAP_WIDTH / 2;
      const wz = positions[i + 2] + MAP_HEIGHT / 2;
      const tileX = this.clamp(Math.floor(wx / TERRAIN_TILE_SIZE), 0, cols - 1);
      const tileZ = this.clamp(Math.floor(wz / TERRAIN_TILE_SIZE), 0, rows - 1);
      const tile = this.terrain[tileZ]?.[tileX];

      if (tile && tile.biome === 'mountain' && tile.elevation > 0.65) {
        // Extra height displacement for mountains
        const extra = (tile.elevation - 0.65) * 40;
        const noise = this.noise.noise2D(tileX * 0.15, tileZ * 0.15);
        positions[i + 1] += extra * (0.7 + noise * 0.3);
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  // --- Water ---

  private buildWater(): void {
    // Water plane at sea level (y = 0)
    const waterGeometry = new THREE.PlaneGeometry(MAP_WIDTH * 1.5, MAP_HEIGHT * 1.5);
    waterGeometry.rotateX(-Math.PI / 2);

    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a5070,
      transparent: true,
      opacity: 0.75,
      roughness: 0.1,
      metalness: 0.3,
      depthWrite: false,
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.position.set(MAP_WIDTH / 2, -0.5, MAP_HEIGHT / 2);
    this.waterMesh.receiveShadow = true;
    this.waterGroup.add(this.waterMesh);

    // Lake of Mirrors
    this.buildLake(1360, 670, 88, 50);
  }

  private buildLake(cx: number, cy: number, rx: number, ry: number): void {
    const lakeGeo = new THREE.CircleGeometry(Math.max(rx, ry), 32);
    lakeGeo.rotateX(-Math.PI / 2);

    const lakeMat = new THREE.MeshStandardMaterial({
      color: 0x2a7090,
      transparent: true,
      opacity: 0.8,
      roughness: 0.05,
      metalness: 0.4,
    });

    const lake = new THREE.Mesh(lakeGeo, lakeMat);
    lake.position.set(cx, 0.5, cy);
    lake.scale.set(rx / Math.max(rx, ry), 1, ry / Math.max(rx, ry));
    this.waterGroup.add(lake);
  }

  // --- Territories ---

  private buildTerritories(): void {
    const territories = this.state?.territories?.length ? this.state.territories : TERRITORIES;

    for (const t of territories) {
      const shape = new THREE.Shape();
      const pts = t.polygon;
      if (pts.length < 3) continue;

      shape.moveTo(pts[0].x - MAP_WIDTH / 2, -(pts[0].y - MAP_HEIGHT / 2));
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i].x - MAP_WIDTH / 2, -(pts[i].y - MAP_HEIGHT / 2));
      }
      shape.closePath();

      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);

      // Parse territory color
      const colorMatch = t.color.match(/[\d.]+/g);
      const r = colorMatch?.[0] ? parseInt(colorMatch[0]) / 255 : 0.5;
      const g = colorMatch?.[1] ? parseInt(colorMatch[1]) / 255 : 0.5;
      const b = colorMatch?.[2] ? parseInt(colorMatch[2]) / 255 : 0.5;
      const a = colorMatch?.[3] ? parseFloat(colorMatch[3]) : 0.18;

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b),
        transparent: true,
        opacity: a,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 2; // slightly above terrain
      mesh.receiveShadow = true;
      this.territoryGroup.add(mesh);

      // Territory border line
      const borderPoints = pts.map(p => new THREE.Vector3(p.x, 3, p.y));
      borderPoints.push(borderPoints[0]);
      const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints);
      const kColor = KINGDOM_COLORS[t.kingdomId] ?? '#c8a44d';
      const borderMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(kColor),
        transparent: true,
        opacity: 0.6,
        linewidth: 2,
      });
      const borderLine = new THREE.Line(borderGeo, borderMat);
      this.territoryGroup.add(borderLine);
    }
  }

  // --- Rivers ---

  private buildRivers(): void {
    for (const river of this.rivers) {
      const points = river.points.map(p => {
        const h = elevationToHeight(this.elevationAt(p));
        return new THREE.Vector3(p.x, Math.max(h, 0.5) + 1, p.y);
      });

      // Create a smooth curve
      const curve = new THREE.CatmullRomCurve3(points);
      const tubePoints = curve.getPoints(200);

      const riverGeo = new THREE.BufferGeometry().setFromPoints(tubePoints);
      const riverMat = new THREE.LineBasicMaterial({
        color: 0x2a7090,
        transparent: true,
        opacity: 0.8,
        linewidth: 1,
      });
      const riverLine = new THREE.Line(riverGeo, riverMat);
      this.waterGroup.add(riverLine);

      // Wider river body
      const ribbonPoints: THREE.Vector3[] = [];
      for (let i = 0; i < tubePoints.length; i++) {
        const p = tubePoints[i];
        const next = tubePoints[Math.min(i + 1, tubePoints.length - 1)];
        const dir = new THREE.Vector3().subVectors(next, p).normalize();
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);
        const w = river.width * 0.5;
        ribbonPoints.push(
          new THREE.Vector3(p.x + perp.x * w, p.y, p.z + perp.z * w),
          new THREE.Vector3(p.x - perp.x * w, p.y, p.z - perp.z * w),
        );
      }

      if (ribbonPoints.length > 4) {
        const ribbonGeo = new THREE.BufferGeometry();
        const ribbonPos = new Float32Array(ribbonPoints.length * 3);
        const ribbonIdx: number[] = [];
        for (let i = 0; i < ribbonPoints.length; i += 2) {
          const base = i / 2;
          ribbonPos[i * 3] = ribbonPoints[i].x;
          ribbonPos[i * 3 + 1] = ribbonPoints[i].y;
          ribbonPos[i * 3 + 2] = ribbonPoints[i].z;
          ribbonPos[(i + 1) * 3] = ribbonPoints[i + 1].x;
          ribbonPos[(i + 1) * 3 + 1] = ribbonPoints[i + 1].y;
          ribbonPos[(i + 1) * 3 + 2] = ribbonPoints[i + 1].z;
          if (i < ribbonPoints.length - 2) {
            ribbonIdx.push(base, base + 1, base + 2);
            ribbonIdx.push(base + 1, base + 3, base + 2);
          }
        }
        ribbonGeo.setAttribute('position', new THREE.BufferAttribute(ribbonPos, 3));
        ribbonGeo.setIndex(ribbonIdx);
        ribbonGeo.computeVertexNormals();

        const ribbonMat = new THREE.MeshStandardMaterial({
          color: 0x2a7090,
          transparent: true,
          opacity: 0.6,
          roughness: 0.1,
          metalness: 0.2,
          depthWrite: false,
        });
        const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
        this.waterGroup.add(ribbon);
      }
    }
  }

  // --- Roads ---

  private buildRoads(): void {
    const major = this.baseFeatures.filter(f => ['city', 'castle', 'port'].includes(f.type));
    const links = [[0, 1], [0, 5], [5, 2], [5, 4], [3, 4], [3, 1]];

    for (const [a, b] of links) {
      const from = major[a], to = major[b];
      if (!from || !to) continue;

      const fromH = elevationToHeight(this.elevationAt(from.position));
      const toH = elevationToHeight(this.elevationAt(to.position));

      const start = new THREE.Vector3(from.position.x, Math.max(fromH, 0) + 1.5, from.position.y);
      const end = new THREE.Vector3(to.position.x, Math.max(toH, 0) + 1.5, to.position.y);

      // Curved road
      const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
      mid.y = Math.max(start.y, end.y) + 5;
      mid.x += (from.position.y - to.position.y) * 0.04;

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const roadPoints = curve.getPoints(60);

      const roadGeo = new THREE.BufferGeometry().setFromPoints(roadPoints);
      const roadMat = new THREE.LineBasicMaterial({
        color: 0x8a7050,
        transparent: true,
        opacity: 0.7,
      });
      const roadLine = new THREE.Line(roadGeo, roadMat);
      this.featureGroup.add(roadLine);
    }
  }// --- 3D Buildings (Castles, Cities, Villages, etc.) ---

  private buildFeatures(): void {
    for (const feature of this.baseFeatures) {
      const building = this.createBuilding(feature);
      if (building) {
        this.buildingGroup.add(building);

        // Store reference for raycasting
        building.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.userData.featureId = feature.id;
            this.featureMeshes.set(feature.id, child);
          }
        });
      }

      // Add label sprite
      this.addLabel(feature);
    }
  }

  private createBuilding(feature: MapFeature): THREE.Group {
    const group = new THREE.Group();
    const { x, y } = feature.position;
    const h = elevationToHeight(this.elevationAt(feature.position));
    const color = feature.kingdomId ? KINGDOM_COLORS[feature.kingdomId] : '#d7b254';
    const colorObj = new THREE.Color(color);

    group.position.set(x, Math.max(h, 0), y);

    switch (feature.type) {
      case 'city':
        this.buildCity(group, feature, colorObj);
        break;
      case 'castle':
        this.buildCastle(group, feature, colorObj);
        break;
      case 'village':
        this.buildVillage(group, colorObj);
        break;
      case 'port':
        this.buildPort(group, colorObj);
        break;
      case 'mine':
        this.buildMine(group);
        break;
      case 'farm':
        this.buildFarm(group);
        break;
      case 'bridge':
        this.buildBridge(group);
        break;
      case 'forest':
        this.buildForestCamp(group);
        break;
    }

    return group;
  }

  /** Build a detailed 3D castle with walls, towers, keep, gate, and banners */
  private buildCastle(group: THREE.Group, feature: MapFeature, color: THREE.Color): void {
    const scale = 1 + (feature.level - 1) * 0.15;
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x6a6258,
      roughness: 0.9,
      metalness: 0.05,
    });
    const stoneLightMat = new THREE.MeshStandardMaterial({
      color: 0x8a8070,
      roughness: 0.85,
      metalness: 0.05,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: color.clone().multiplyScalar(0.8),
      roughness: 0.7,
      metalness: 0.1,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x2a2015,
      roughness: 0.95,
      metalness: 0,
    });

    // --- Moat ---
    const moatGeo = new THREE.RingGeometry(18 * scale, 22 * scale, 32);
    moatGeo.rotateX(-Math.PI / 2);
    const moatMat = new THREE.MeshStandardMaterial({
      color: 0x1a5070,
      transparent: true,
      opacity: 0.7,
      roughness: 0.05,
      metalness: 0.2,
    });
    const moat = new THREE.Mesh(moatGeo, moatMat);
    moat.position.y = 0.3;
    group.add(moat);

    // --- Outer walls ---
    const wallW = 20 * scale;
    const wallH = 14 * scale;
    const wallD = 2 * scale;

    // Four walls
    const wallGeo = new THREE.BoxGeometry(wallW, wallH, wallD);
    const positions: Array<{ pos: [number, number, number]; rot: [number, number, number] }> = [
      { pos: [0, wallH / 2, -wallW / 2], rot: [0, 0, 0] },
      { pos: [0, wallH / 2, wallW / 2], rot: [0, 0, 0] },
      { pos: [-wallW / 2, wallH / 2, 0], rot: [0, Math.PI / 2, 0] },
      { pos: [wallW / 2, wallH / 2, 0], rot: [0, Math.PI / 2, 0] },
    ];

    for (const wp of positions) {
      const wall = new THREE.Mesh(wallGeo, stoneMat);
      wall.position.set(wp.pos[0], wp.pos[1], wp.pos[2]);
      wall.rotation.set(wp.rot[0], wp.rot[1], wp.rot[2]);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);

      // Crenellations on top
      const numCren = 10;
      const crenW = wallW / numCren;
      for (let i = 0; i < numCren; i += 2) {
        const crenGeo = new THREE.BoxGeometry(crenW * 0.7, 2.5 * scale, wallD + 0.5);
        const cren = new THREE.Mesh(crenGeo, stoneLightMat);
        const offset = -wallW / 2 + i * crenW + crenW / 2;
        if (wp.rot[1] === 0) {
          cren.position.set(offset, wallH + 1.25 * scale, wp.pos[2]);
        } else {
          cren.position.set(wp.pos[0], wallH + 1.25 * scale, offset);
        }
        cren.castShadow = true;
        group.add(cren);
      }
    }

    // --- Corner towers ---
    const towerPositions = [
      [-wallW / 2 - 1, 0, -wallW / 2 - 1],
      [wallW / 2 + 1, 0, -wallW / 2 - 1],
      [-wallW / 2 - 1, 0, wallW / 2 + 1],
      [wallW / 2 + 1, 0, wallW / 2 + 1],
    ];

    for (const tp of towerPositions) {
      this.buildTower(group, tp[0], tp[2], 4 * scale, 10 * scale, stoneMat, roofMat);
    }

    // --- Central keep ---
    const keepW = 10 * scale;
    const keepH = 16 * scale;
    const keepD = 10 * scale;

    const keepGeo = new THREE.BoxGeometry(keepW, keepH, keepD);
    const keep = new THREE.Mesh(keepGeo, stoneLightMat);
    keep.position.set(0, keepH / 2, 0);
    keep.castShadow = true;
    keep.receiveShadow = true;
    group.add(keep);

    // Keep roof (pyramid)
    const roofGeo = new THREE.ConeGeometry(keepW * 0.8, 6 * scale, 4);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, keepH + 3 * scale, 0);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    // Keep windows
    for (let row = 0; row < 3; row++) {
      for (let col = -1; col <= 1; col += 2) {
        const winGeo = new THREE.BoxGeometry(1.5 * scale, 2 * scale, 0.5);
        const win = new THREE.Mesh(winGeo, darkMat);
        win.position.set(col * 3 * scale, keepH * 0.3 + row * 4 * scale, keepD / 2 + 0.25);
        group.add(win);
      }
    }

    // --- Gate ---
    const gateW = 5 * scale;
    const gateH = 5 * scale;
    const gateGeo = new THREE.BoxGeometry(gateW, gateH, wallD + 1);
    const gate = new THREE.Mesh(gateGeo, darkMat);
    gate.position.set(0, gateH / 2, wallW / 2);
    group.add(gate);

    // Gate arch
    const archGeo = new THREE.TorusGeometry(gateW / 2, 0.5, 8, 12, Math.PI);
    const arch = new THREE.Mesh(archGeo, stoneMat);
    arch.position.set(0, gateH, wallW / 2);
    group.add(arch);

    // --- Banner on keep ---
    this.buildBanner(group, 0, keepH + 6 * scale, 0, color);

    // --- Cobblestone path ---
    const pathGeo = new THREE.PlaneGeometry(4 * scale, 10 * scale);
    pathGeo.rotateX(-Math.PI / 2);
    const pathMat = new THREE.MeshStandardMaterial({
      color: 0x645a4b,
      roughness: 0.95,
      metalness: 0,
    });
    const path = new THREE.Mesh(pathGeo, pathMat);
    path.position.set(0, 0.2, wallW / 2 + 5 * scale);
    group.add(path);
  }

  /** Build a 3D tower with cylindrical body and conical roof */
  private buildTower(
    parent: THREE.Group,
    x: number,
    z: number,
    radius: number,
    height: number,
    stoneMat: THREE.MeshStandardMaterial,
    roofMat: THREE.MeshStandardMaterial
  ): void {
    // Tower body
    const towerGeo = new THREE.CylinderGeometry(radius * 0.8, radius, height, 12);
    const tower = new THREE.Mesh(towerGeo, stoneMat);
    tower.position.set(x, height / 2, z);
    tower.castShadow = true;
    tower.receiveShadow = true;
    parent.add(tower);

    // Tower roof (conical)
    const roofGeo = new THREE.ConeGeometry(radius * 1.2, 5, 12);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, height + 2.5, z);
    roof.castShadow = true;
    parent.add(roof);

    // Tower window
    const winGeo = new THREE.BoxGeometry(1, 1.5, 0.5);
    const winMat = new THREE.MeshStandardMaterial({ color: 0x2a2015, roughness: 0.95 });
    const win = new THREE.Mesh(winGeo, winMat);
    win.position.set(x, height * 0.4, z + radius * 0.8);
    parent.add(win);
  }

  /** Build a 3D city with walls, buildings, and towers */
  private buildCity(group: THREE.Group, feature: MapFeature, color: THREE.Color): void {
    const scale = 1 + (feature.level - 1) * 0.15;
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x6a6258,
      roughness: 0.9,
      metalness: 0.05,
    });

    // City walls (larger than castle)
    const wallW = 28 * scale;
    const wallH = 12 * scale;
    const wallD = 1.5 * scale;

    const wallGeo = new THREE.BoxGeometry(wallW, wallH, wallD);
    const wallPositions: Array<{ pos: [number, number, number]; rot: [number, number, number] }> = [
      { pos: [0, wallH / 2, -wallW / 2], rot: [0, 0, 0] },
      { pos: [0, wallH / 2, wallW / 2], rot: [0, 0, 0] },
      { pos: [-wallW / 2, wallH / 2, 0], rot: [0, Math.PI / 2, 0] },
      { pos: [wallW / 2, wallH / 2, 0], rot: [0, Math.PI / 2, 0] },
    ];

    for (const wp of wallPositions) {
      const wall = new THREE.Mesh(wallGeo, stoneMat);
      wall.position.set(wp.pos[0], wp.pos[1], wp.pos[2]);
      wall.rotation.set(wp.rot[0], wp.rot[1], wp.rot[2]);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    }

    // Corner towers
    const towerPositions = [
      [-wallW / 2, 0, -wallW / 2],
      [wallW / 2, 0, -wallW / 2],
      [-wallW / 2, 0, wallW / 2],
      [wallW / 2, 0, wallW / 2],
    ];

    const roofMat = new THREE.MeshStandardMaterial({
      color: color.clone().multiplyScalar(0.8),
      roughness: 0.7,
      metalness: 0.1,
    });

    for (const tp of towerPositions) {
      this.buildTower(group, tp[0], tp[2], 3.5 * scale, 8 * scale, stoneMat, roofMat);
    }

    // Central keep (smaller than castle)
    const keepW = 8 * scale;
    const keepH = 10 * scale;
    const keepGeo = new THREE.BoxGeometry(keepW, keepH, keepW);
    const keepMat = new THREE.MeshStandardMaterial({
      color: 0x7a7060,
      roughness: 0.85,
      metalness: 0.05,
    });
    const keep = new THREE.Mesh(keepGeo, keepMat);
    keep.position.set(0, keepH / 2, 0);
    keep.castShadow = true;
    keep.receiveShadow = true;
    group.add(keep);

    // Keep roof
    const roofGeo = new THREE.ConeGeometry(keepW * 0.7, 5 * scale, 4);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, keepH + 2.5 * scale, 0);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    // Inner buildings (houses)
    const houseMat = new THREE.MeshStandardMaterial({
      color: 0x5a4a38,
      roughness: 0.9,
      metalness: 0,
    });
    const houseRoofMat = new THREE.MeshStandardMaterial({
      color: 0x8a6a40,
      roughness: 0.8,
      metalness: 0,
    });

    const housePositions = [
      [-8, 0, -8], [8, 0, -8], [-8, 0, 8], [8, 0, 8],
      [-4, 0, -12], [4, 0, -12], [-4, 0, 12], [4, 0, 12],
    ];

    for (const hp of housePositions) {
      // House body
      const houseGeo = new THREE.BoxGeometry(4 * scale, 3 * scale, 3 * scale);
      const house = new THREE.Mesh(houseGeo, houseMat);
      house.position.set(hp[0], 1.5 * scale, hp[2]);
      house.castShadow = true;
      group.add(house);

      // House roof
      const hRoofGeo = new THREE.ConeGeometry(3 * scale, 2 * scale, 4);
      const hRoof = new THREE.Mesh(hRoofGeo, houseRoofMat);
      hRoof.position.set(hp[0], 4 * scale, hp[2]);
      hRoof.rotation.y = Math.PI / 4;
      hRoof.castShadow = true;
      group.add(hRoof);
    }

    // Banner
    this.buildBanner(group, 0, keepH + 5 * scale, 0, color);
  }

  /** Build a 3D village with small houses */
  private buildVillage(group: THREE.Group, color: THREE.Color): void {
    const houseMat = new THREE.MeshStandardMaterial({
      color: 0x5a3a20,
      roughness: 0.9,
      metalness: 0,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0xa06030,
      roughness: 0.8,
      metalness: 0,
    });

    const houses = [
      { x: -5, z: 0, w: 4, d: 3 },
      { x: 5, z: 0, w: 4, d: 3 },
      { x: 0, z: -3, w: 3.5, d: 3 },
    ];

    for (const h of houses) {
      // House body
      const bodyGeo = new THREE.BoxGeometry(h.w, 3.5, h.d);
      const body = new THREE.Mesh(bodyGeo, houseMat);
      body.position.set(h.x, 1.75, h.z);
      body.castShadow = true;
      group.add(body);

      // Roof
      const roofGeo = new THREE.ConeGeometry(Math.max(h.w, h.d) * 0.7, 2.5, 4);
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.set(h.x, 4.75, h.z);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);
    }

    // Door on center house
    const doorGeo = new THREE.BoxGeometry(1.2, 2.5, 0.3);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2510, roughness: 0.95 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 1.25, -1.5);
    group.add(door);
  }

  /** Build a 3D port with dock, ship, and lighthouse */
  private buildPort(group: THREE.Group, color: THREE.Color): void {
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x8a6a3a,
      roughness: 0.85,
      metalness: 0,
    });
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x5a4020,
      roughness: 0.9,
      metalness: 0,
    });

    // Dock platform
    const dockGeo = new THREE.BoxGeometry(24, 0.5, 4);
    const dock = new THREE.Mesh(dockGeo, woodMat);
    dock.position.set(0, 1, 6);
    dock.castShadow = true;
    group.add(dock);

    // Dock pylons
    for (let i = -2; i <= 2; i++) {
      const pylonGeo = new THREE.CylinderGeometry(0.3, 0.4, 4, 6);
      const pylon = new THREE.Mesh(pylonGeo, darkWoodMat);
      pylon.position.set(i * 5, -0.5, 6);
      group.add(pylon);
    }

    // Ship hull
    const hullGeo = new THREE.BoxGeometry(16, 3, 5);
    const hull = new THREE.Mesh(hullGeo, darkWoodMat);
    hull.position.set(0, 1.5, 0);
    hull.castShadow = true;
    group.add(hull);

    // Ship bow (pointed front)
    const bowGeo = new THREE.ConeGeometry(2.5, 4, 4);
    bowGeo.rotateZ(Math.PI / 2);
    bowGeo.rotateY(Math.PI / 2);
    const bow = new THREE.Mesh(bowGeo, darkWoodMat);
    bow.position.set(10, 1.5, 0);
    group.add(bow);

    // Mast
    const mastGeo = new THREE.CylinderGeometry(0.2, 0.3, 12, 6);
    const mast = new THREE.Mesh(mastGeo, woodMat);
    mast.position.set(0, 7.5, 0);
    group.add(mast);

    // Sail
    const sailGeo = new THREE.PlaneGeometry(6, 8);
    const sailMat = new THREE.MeshStandardMaterial({
      color: color.clone().multiplyScalar(0.7),
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const sail = new THREE.Mesh(sailGeo, sailMat);
    sail.position.set(3, 8, 0);
    group.add(sail);

    // Lighthouse
    const lhGeo = new THREE.CylinderGeometry(1.2, 1.5, 10, 8);
    const lhMat = new THREE.MeshStandardMaterial({
      color: 0xd8d0c0,
      roughness: 0.7,
      metalness: 0.1,
    });
    const lighthouse = new THREE.Mesh(lhGeo, lhMat);
    lighthouse.position.set(12, 5, 8);
    lighthouse.castShadow = true;
    group.add(lighthouse);

    // Lighthouse top
    const lhTopGeo = new THREE.CylinderGeometry(1.5, 1.2, 2, 8);
    const lhTopMat = new THREE.MeshStandardMaterial({
      color: 0xff6030,
      roughness: 0.6,
      metalness: 0.1,
    });
    const lhTop = new THREE.Mesh(lhTopGeo, lhTopMat);
    lhTop.position.set(12, 11, 8);
    group.add(lhTop);
  }

  /** Build a 3D mine entrance */
  private buildMine(group: THREE.Group): void {
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x3a3530,
      roughness: 0.95,
      metalness: 0,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1a1510,
      roughness: 1,
      metalness: 0,
    });

    // Mountain/hill shape
    const hillGeo = new THREE.ConeGeometry(10, 8, 8);
    const hill = new THREE.Mesh(hillGeo, rockMat);
    hill.position.set(0, 4, 0);
    hill.castShadow = true;
    group.add(hill);

    // Mine entrance
    const entranceGeo = new THREE.CircleGeometry(3, 8);
    const entrance = new THREE.Mesh(entranceGeo, darkMat);
    entrance.position.set(0, 2, 5);
    group.add(entrance);

    // Cart tracks
    const trackMat = new THREE.LineBasicMaterial({ color: 0x5a5040 });
    const trackPoints1 = [
      new THREE.Vector3(-3, 0.5, 5),
      new THREE.Vector3(-8, 0.5, 10),
    ];
    const trackPoints2 = [
      new THREE.Vector3(3, 0.5, 5),
      new THREE.Vector3(8, 0.5, 10),
    ];
    const trackGeo1 = new THREE.BufferGeometry().setFromPoints(trackPoints1);
    const trackGeo2 = new THREE.BufferGeometry().setFromPoints(trackPoints2);
    group.add(new THREE.Line(trackGeo1, trackMat));
    group.add(new THREE.Line(trackGeo2, trackMat));

    // Lamp glow
    const lampGeo = new THREE.SphereGeometry(0.5, 8, 8);
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffa028,
      emissive: 0xffa028,
      emissiveIntensity: 0.5,
    });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(0, 3, 5.5);
    group.add(lamp);
  }

  /** Build a 3D farm with fields */
  private buildFarm(group: THREE.Group): void {
    // Plowed fields
    const fieldMat = new THREE.MeshStandardMaterial({
      color: 0xa09050,
      roughness: 0.95,
      metalness: 0,
    });

    for (let i = -2; i <= 2; i++) {
      const rowGeo = new THREE.BoxGeometry(1.5, 0.3, 16);
      const row = new THREE.Mesh(rowGeo, fieldMat);
      row.position.set(i * 3.5, 0.15, 0);
      row.receiveShadow = true;
      group.add(row);
    }

    // Crop rows
    const cropMat = new THREE.MeshStandardMaterial({
      color: 0x8aaa40,
      roughness: 0.9,
      metalness: 0,
    });

    for (let i = -2; i <= 2; i++) {
      for (let j = -3; j <= 3; j++) {
        const cropGeo = new THREE.ConeGeometry(0.3, 1.5, 4);
        const crop = new THREE.Mesh(cropGeo, cropMat);
        crop.position.set(i * 3.5, 0.9, j * 2);
        group.add(crop);
      }
    }
  }

  /** Build a 3D bridge */
  private buildBridge(group: THREE.Group): void {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x7a7060,
      roughness: 0.9,
      metalness: 0.05,
    });

    // Bridge deck
    const deckGeo = new THREE.BoxGeometry(28, 0.8, 4);
    const deck = new THREE.Mesh(deckGeo, stoneMat);
    deck.position.set(0, 2, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    // Arch supports
    for (let i = -1; i <= 1; i += 2) {
      const archGeo = new THREE.CylinderGeometry(0.5, 0.5, 4, 8);
      const arch = new THREE.Mesh(archGeo, stoneMat);
      arch.position.set(i * 10, 1, 0);
      arch.rotation.z = Math.PI / 2;
      group.add(arch);
    }

    // Railings
    const railMat = new THREE.LineBasicMaterial({ color: 0x9a8a70 });
    for (let side = -1; side <= 1; side += 2) {
      const railPoints = [
        new THREE.Vector3(-14, 3.5, side * 2),
        new THREE.Vector3(14, 3.5, side * 2),
      ];
      const railGeo = new THREE.BufferGeometry().setFromPoints(railPoints);
      group.add(new THREE.Line(railGeo, railMat));
    }
  }

  /** Build a 3D forest camp */
  private buildForestCamp(group: THREE.Group): void {
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0x1a3a20,
      roughness: 0.9,
      metalness: 0,
    });
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a1a,
      roughness: 0.95,
      metalness: 0,
    });

    const treePositions = [
      [0, 0, -4], [-5, 0, 0], [5, 0, 0], [-3, 0, 4], [3, 0, 4],
      [-7, 0, -3], [7, 0, -3], [-2, 0, -7], [2, 0, -7],
    ];

    for (const tp of treePositions) {
      // Trunk
      const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 4, 6);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(tp[0], 2, tp[2]);
      trunk.castShadow = true;
      group.add(trunk);

      // Foliage (multiple layers)
      for (let layer = 0; layer < 3; layer++) {
        const foliageGeo = new THREE.ConeGeometry(2.5 - layer * 0.5, 2, 8);
        const foliage = new THREE.Mesh(foliageGeo, treeMat);
        foliage.position.set(tp[0], 4 + layer * 1.5, tp[2]);
        foliage.castShadow = true;
        group.add(foliage);
      }
    }
  }

  /** Build a waving banner flag */
  private buildBanner(group: THREE.Group, x: number, y: number, z: number, color: THREE.Color): void {
    // Flag pole
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 8, 6);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x8a8070,
      roughness: 0.7,
      metalness: 0.2,
    });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, y + 4, z);
    group.add(pole);

    // Flag cloth (will be animated)
    const flagGeo = new THREE.PlaneGeometry(4, 3, 8, 6);
    const flagMat = new THREE.MeshStandardMaterial({
      color: color.clone(),
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(x + 2, y + 6.5, z);
    flag.userData.isFlag = true;
    group.add(flag);
  }

  /** Add a text label sprite for a feature */
  private addLabel(feature: MapFeature): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;

    ctx.fillStyle = 'rgba(10, 14, 13, 0.7)';
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 56, 8);
    ctx.fill();

    ctx.fillStyle = feature.type === 'city' || feature.type === 'castle' ? '#f0dfad' : '#c8b890';
    ctx.font = `${feature.type === 'city' || feature.type === 'castle' ? 'bold ' : ''}24px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(feature.name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(feature.position.x, 25, feature.position.y);
    sprite.scale.set(20, 5, 1);
    this.featureGroup.add(sprite);
  }// --- Armies ---

  private updateArmies(): void {
    // Clear existing army meshes
    while (this.armyGroup.children.length > 0) {
      const child = this.armyGroup.children[0];
      if (child instanceof THREE.Mesh || child instanceof THREE.Group) {
        child.traverse((obj) => {
          if (obj instanceof THREE.BufferGeometry) obj.dispose();
          if (obj instanceof THREE.Material) obj.dispose();
        });
      }
      this.armyGroup.remove(child);
    }

    const armies = this.state?.armies;
    if (!armies) return;

    for (const army of Object.values(armies)) {
      this.drawArmy(army);
    }
  }

  private drawArmy(army: ArmyState): void {
    const group = new THREE.Group();
    const { x, y } = army.position;
    const h = elevationToHeight(this.elevationAt(army.position));
    group.position.set(x, Math.max(h, 0) + 0.5, y);

    const color = KINGDOM_COLORS[army.kingdomId] ?? '#d6b260';
    const colorObj = new THREE.Color(color);

    // Soldiers
    const soldiers = army.composition.reduce((sum, c) => sum + c.count, 0);
    const formationSize = Math.min(5, Math.max(2, Math.floor(soldiers / 50)));

    const soldierMat = new THREE.MeshStandardMaterial({
      color: 0x2a2218,
      roughness: 0.9,
      metalness: 0.1,
    });
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0x6a6050,
      roughness: 0.7,
      metalness: 0.3,
    });

    for (let i = 0; i < formationSize; i++) {
      const sx = (i - (formationSize - 1) / 2) * 4;

      // Body
      const bodyGeo = new THREE.BoxGeometry(1.5, 3, 1);
      const body = new THREE.Mesh(bodyGeo, soldierMat);
      body.position.set(sx, 1.5, 0);
      body.castShadow = true;
      group.add(body);

      // Helmet
      const helmetGeo = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const helmet = new THREE.Mesh(helmetGeo, helmetMat);
      helmet.position.set(sx, 3, 0);
      group.add(helmet);
    }

    // Banner pole
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 14, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd6b260, metalness: 0.3 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(0, 7, 0);
    group.add(pole);

    // Flag
    const flagGeo = new THREE.PlaneGeometry(6, 4, 6, 4);
    const flagMat = new THREE.MeshStandardMaterial({
      color: colorObj,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(3, 12, 0);
    flag.userData.isFlag = true;
    group.add(flag);

    // Supply wagons
    if (army.wagons > 0) {
      const wagonMat = new THREE.MeshStandardMaterial({
        color: 0x5a4020,
        roughness: 0.9,
      });

      for (let w = -1; w <= 1; w += 2) {
        const wagonGeo = new THREE.BoxGeometry(3, 2, 2);
        const wagon = new THREE.Mesh(wagonGeo, wagonMat);
        wagon.position.set(w * (formationSize * 2 + 2), 1, 0);
        wagon.castShadow = true;
        group.add(wagon);

        // Wheels
        const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.2, 8);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x3a2a15 });
        for (let side = -1; side <= 1; side += 2) {
          const wheel = new THREE.Mesh(wheelGeo, wheelMat);
          wheel.position.set(w * (formationSize * 2 + 2), 0.6, side * 1.1);
          wheel.rotation.x = Math.PI / 2;
          group.add(wheel);
        }
      }
    }

    // Status indicator
    if (army.currentOrder === 'siege') {
      const indicatorGeo = new THREE.SphereGeometry(1, 8, 8);
      const indicatorMat = new THREE.MeshStandardMaterial({
        color: 0xff4030,
        emissive: 0xff4030,
        emissiveIntensity: 0.3,
      });
      const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
      indicator.position.set(0, 16, 0);
      group.add(indicator);
    } else if (army.currentOrder === 'defending') {
      const indicatorGeo = new THREE.OctahedronGeometry(1);
      const indicatorMat = new THREE.MeshStandardMaterial({
        color: 0x40a0ff,
        emissive: 0x40a0ff,
        emissiveIntensity: 0.3,
      });
      const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
      indicator.position.set(0, 16, 0);
      group.add(indicator);
    }

    // Supply bar (3D)
    const supplyPct = army.supplies.food / (army.dailyConsumption.food * 30 || 1);
    const barW = 12;
    const barGeo = new THREE.BoxGeometry(barW, 0.5, 0.5);

    // Background
    const bgMat = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.5 });
    const bgBar = new THREE.Mesh(barGeo, bgMat);
    bgBar.position.set(0, -1, 0);
    group.add(bgBar);

    // Fill
    const fillColor = supplyPct > 0.5 ? 0x40a040 : supplyPct > 0.25 ? 0xc0a030 : 0xc03030;
    const fillMat = new THREE.MeshStandardMaterial({ color: fillColor, emissive: fillColor, emissiveIntensity: 0.2 });
    const fillGeo = new THREE.BoxGeometry(barW * Math.min(1, supplyPct), 0.5, 0.5);
    const fillBar = new THREE.Mesh(fillGeo, fillMat);
    fillBar.position.set(-barW / 2 + (barW * Math.min(1, supplyPct)) / 2, -1, 0);
    group.add(fillBar);

    this.armyGroup.add(group);
  }

  // --- Convoys ---

  private updateConvoys(): void {
    while (this.convoyGroup.children.length > 0) {
      const child = this.convoyGroup.children[0];
      if (child instanceof THREE.Mesh || child instanceof THREE.Group) {
        child.traverse((obj) => {
          if (obj instanceof THREE.BufferGeometry) obj.dispose();
          if (obj instanceof THREE.Material) obj.dispose();
        });
      }
      this.convoyGroup.remove(child);
    }

    const convoys = this.state?.convoys;
    if (!convoys) return;

    for (const convoy of Object.values(convoys)) {
      if (convoy.status !== 'traveling') continue;
      const c = convoy as Convoy;
      const pos = c.position;
      if (!pos) continue;

      this.drawConvoy(pos);
    }
  }

  private drawConvoy(pos: Position): void {
    const group = new THREE.Group();
    const h = elevationToHeight(this.elevationAt(pos));
    group.position.set(pos.x, Math.max(h, 0) + 0.5, pos.y);

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x5a4020,
      roughness: 0.9,
    });
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x8a6a40,
      roughness: 0.85,
    });
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a15,
      roughness: 0.95,
    });

    // Wagon body
    const bodyGeo = new THREE.BoxGeometry(6, 3, 3);
    const body = new THREE.Mesh(bodyGeo, woodMat);
    body.position.set(0, 1.5, 0);
    body.castShadow = true;
    group.add(body);

    // Canopy
    const canopyGeo = new THREE.BoxGeometry(5, 0.5, 3.5);
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 3.25, 0);
    group.add(canopy);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.3, 8);
    for (let x = -1; x <= 1; x += 2) {
      for (let z = -1; z <= 1; z += 2) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(x * 2, 0.8, z * 1.6);
        wheel.rotation.x = Math.PI / 2;
        group.add(wheel);
      }
    }

    this.convoyGroup.add(group);
  }

  // --- Weather ---

  private updateWeather(): void {
    const weather = this.state?.weather;
    if (!weather || !['rain', 'storm', 'snow', 'blizzard', 'fog'].includes(weather.type)) {
      if (this.weatherPoints) {
        this.weatherGroup.remove(this.weatherPoints);
        this.weatherPoints = null;
      }
      return;
    }

    const amount = Math.ceil(500 + weather.intensity * 2);
    const isSnow = weather.type === 'snow' || weather.type === 'blizzard';

    const positions = new Float32Array(amount * 3);
    const colors = new Float32Array(amount * 3);

    for (let i = 0; i < amount; i++) {
      positions[i * 3] = Math.random() * MAP_WIDTH;
      positions[i * 3 + 1] = Math.random() * 200;
      positions[i * 3 + 2] = Math.random() * MAP_HEIGHT;

      if (isSnow) {
        colors[i * 3] = 0.94;
        colors[i * 3 + 1] = 0.97;
        colors[i * 3 + 2] = 1.0;
      } else {
        colors[i * 3] = 0.57;
        colors[i * 3 + 1] = 0.76;
        colors[i * 3 + 2] = 0.86;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: isSnow ? 2 : 1.5,
      vertexColors: true,
      transparent: true,
      opacity: isSnow ? 0.85 : 0.6,
      depthWrite: false,
    });

    if (this.weatherPoints) {
      this.weatherGroup.remove(this.weatherPoints);
      this.weatherPoints.geometry.dispose();
      const mat = this.weatherPoints.material as THREE.PointsMaterial;
      mat.dispose();
    }

    this.weatherPoints = new THREE.Points(geo, mat);
    this.weatherGroup.add(this.weatherPoints);

    // Fog effect
    if (weather.type === 'fog') {
      this.scene.fog = new THREE.FogExp2('#c5d3c7', 0.001 + weather.intensity / 300000);
    } else {
      this.scene.fog = new THREE.FogExp2('#0a0e0d', 0.0003);
    }
  }

  private updateWeatherParticles(time: number): void {
    if (!this.weatherPoints || !this.state?.weather) return;

    const weather = this.state.weather;
    const positions = this.weatherPoints.geometry.attributes.position.array as Float32Array;
    const isSnow = weather.type === 'snow' || weather.type === 'blizzard';
    const amount = positions.length / 3;

    for (let i = 0; i < amount; i++) {
      const ix = i * 3;
      const iy = i * 3 + 1;
      const iz = i * 3 + 2;

      if (isSnow) {
        positions[ix] += Math.sin(time / 1000 + i) * 0.1;
        positions[iy] -= 0.3;
        positions[iz] += 0.05;
      } else {
        positions[ix] -= 1 + Math.random() * 2;
        positions[iy] -= 3 + Math.random() * 5;
        positions[iz] += 0.2;
      }

      // Reset particles that fall below terrain
      if (positions[iy] < -5) {
        positions[ix] = Math.random() * MAP_WIDTH;
        positions[iy] = 150 + Math.random() * 50;
        positions[iz] = Math.random() * MAP_HEIGHT;
      }
    }

    this.weatherPoints.geometry.attributes.position.needsUpdate = true;
  }

  // --- Atmospheric Effects ---

  private updateAtmosphere(time: number): void {
    if (!this.state) return;
    const hour = this.state.hour;
    const season = this.state.season;

    // --- Sky keyframes across the day (golden-hour cinematic palette) ---
    // Each: [skyTop, skyHorizon, sunColor, sunIntensity, ambient, fogColor, fogDensity]
    type SkyKey = { top: string; horizon: string; sun: number; sunI: number; amb: number; fog: string; fogD: number };
    const keys: SkyKey[] = [
      { top: '#0a1228', horizon: '#1a2438', sun: 0x4060a0, sunI: 0.12, amb: 0.18, fog: '#141c2e', fogD: 0.0006 }, // 00 night
      { top: '#14203c', horizon: '#3a3a58', sun: 0x6078b8, sunI: 0.25, amb: 0.28, fog: '#2a3048', fogD: 0.0005 }, // 04 pre-dawn
      { top: '#4a6a9a', horizon: '#f0a860', sun: 0xffb060, sunI: 1.1, amb: 0.5, fog: '#e8b880', fogD: 0.00045 }, // 06 sunrise
      { top: '#5a8fd0', horizon: '#f0e0c0', sun: 0xffe8c0, sunI: 1.35, amb: 0.55, fog: '#d8c9a8', fogD: 0.00042 }, // 08 morning
      { top: '#4a90e0', horizon: '#cfe4f0', sun: 0xfff4e0, sunI: 1.5, amb: 0.6, fog: '#c8d8e0', fogD: 0.00038 }, // 12 noon
      { top: '#4a80c8', horizon: '#e8d8b0', sun: 0xffe0a0, sunI: 1.4, amb: 0.55, fog: '#d8c898', fogD: 0.00042 }, // 16 afternoon
      { top: '#5a6a9a', horizon: '#ffb050', sun: 0xff9840, sunI: 1.3, amb: 0.5, fog: '#e0a860', fogD: 0.00048 }, // 18 golden hour
      { top: '#3a3a6a', horizon: '#e06838', sun: 0xff6830, sunI: 0.8, amb: 0.35, fog: '#c06840', fogD: 0.00052 }, // 20 sunset
      { top: '#141a34', horizon: '#4a3a58', sun: 0x6058a0, sunI: 0.3, amb: 0.24, fog: '#3a3050', fogD: 0.00055 }, // 22 dusk
    ];
    // key hours: 0, 4, 6, 8, 12, 16, 18, 20, 22
    const keyHours = [0, 4, 6, 8, 12, 16, 18, 20, 22];

    const h = ((hour % 24) + 24) % 24;
    let a = 0, b = 1, t = 0;
    for (let i = 0; i < keyHours.length - 1; i++) {
      if (h >= keyHours[i] && h <= keyHours[i + 1]) {
        a = i; b = i + 1;
        t = (h - keyHours[i]) / (keyHours[i + 1] - keyHours[i]);
        break;
      }
    }
    if (h < keyHours[0] || h > keyHours[keyHours.length - 1]) {
      // wrap-around: 22..24..0 handled by treating 22->0
      a = keyHours.length - 1; b = 0;
      t = (h + 24 - keyHours[a]) / (24 - keyHours[a] + keyHours[b]);
    }
    const ka = keys[a], kb = keys[b];

    const topColor = new THREE.Color(ka.top).lerp(new THREE.Color(kb.top), t);
    const horizonColor = new THREE.Color(ka.horizon).lerp(new THREE.Color(kb.horizon), t);
    const sunColor = new THREE.Color(ka.sun).lerp(new THREE.Color(kb.sun), t);
    const fogColor = new THREE.Color(ka.fog).lerp(new THREE.Color(kb.fog), t);
    const sunIntensity = ka.sunI + (kb.sunI - ka.sunI) * t;
    const ambientIntensity = ka.amb + (kb.amb - ka.amb) * t;
    const fogDensity = ka.fogD + (kb.fogD - ka.fogD) * t;

    // Apply to sky dome
    if (this.skyUniforms) {
      this.skyUniforms.top.value.copy(topColor);
      this.skyUniforms.bottom.value.copy(horizonColor);
    }
    // Scene background matches horizon (for areas above dome edge)
    this.scene.background = horizonColor.clone();

    // Aerial perspective fog
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(fogColor);
      this.scene.fog.density = fogDensity;
    }

    // Sun
    this.sunLight.intensity = sunIntensity;
    this.sunLight.color.copy(sunColor);
    this.ambientLight.intensity = ambientIntensity;

    // Hemisphere light: sky top / warm ground bounce
    this.hemiLight.color.copy(topColor);
    this.hemiLight.groundColor.copy(horizonColor).multiplyScalar(0.6);
    this.hemiLight.intensity = 0.4 + sunIntensity * 0.15;

    // Season tint (subtle)
    const seasonTints: Record<number, number> = {
      0: 0.0,     // Spring: neutral
      1: 0.05,    // Summer: slightly warmer
      2: 0.12,    // Autumn: warm
      3: -0.08,   // Winter: cool
    };
    const seasonShift = seasonTints[season] ?? 0;
    if (seasonShift !== 0) {
      const shift = new THREE.Color(seasonShift > 0 ? '#ff8830' : '#4060a0');
      this.hemiLight.color.lerp(shift, Math.abs(seasonShift));
    }

    // Sky dome follows camera so horizon stays fixed
    if (this.skyDome) {
      this.skyDome.position.copy(this.camera.position);
    }

    // Update grade pass sun glow position (screen-space, upper-right where sun is)
    if (this.gradePass) {
      const isNight = sunIntensity < 0.4;
      this.gradePass.uniforms.uSunStrength.value = isNight ? 0.0 : 0.1 + sunIntensity * 0.04;
      this.gradePass.uniforms.uWarmth.value = isNight ? 0.15 : 0.35;
    }
  }

  // --- Camera ---

  private updateCamera(): void {
    // Smooth camera interpolation
    const lerp = 0.1;
    this.cameraState.x += (this.targetCamera.x - this.cameraState.x) * lerp;
    this.cameraState.y += (this.targetCamera.y - this.cameraState.y) * lerp;
    this.cameraState.zoom += (this.targetCamera.zoom - this.cameraState.zoom) * lerp;

    // Convert 2D camera state to 3D isometric camera
    const zoom = this.cameraState.zoom;
    const distance = 1500 / zoom;

    // Isometric angle: 45 degrees horizontal, 35 degrees vertical
    const angleH = Math.PI / 4; // 45 degrees
    const angleV = Math.PI / 5; // 36 degrees

    const cx = this.cameraState.x;
    const cy = this.cameraState.y;

    // Camera position in 3D
    this.camera.position.set(
      cx - Math.sin(angleH) * Math.cos(angleV) * distance,
      Math.sin(angleV) * distance + 200,
      cy - Math.cos(angleH) * Math.cos(angleV) * distance,
    );

    // Look at the center point
    this.camera.lookAt(cx, 0, cy);

    // Update frustum based on zoom
    this.camera.fov = 45 / zoom;
    this.camera.updateProjectionMatrix();

    // Update sun shadow camera to follow the view
    // Low golden-hour sun angle for long, dramatic shadows
    this.sunLight.position.set(cx + 1100, 380, cy + 1350);
    this.sunLight.target.position.set(cx, 0, cy);
    this.sunLight.target.updateMatrixWorld();

    // Constrain camera
    this.constrainCamera();

    // Notify parent of camera changes
    this.options.onCameraChange?.({ ...this.cameraState });
  }

  private constrainCamera(): void {
    const halfW = this.canvasWidth / (2 * this.cameraState.zoom);
    const halfH = this.canvasHeight / (2 * this.cameraState.zoom);
    this.cameraState.x = this.clamp(this.cameraState.x, halfW, MAP_WIDTH - halfW);
    this.cameraState.y = this.clamp(this.cameraState.y, halfH, MAP_HEIGHT - halfH);
    this.targetCamera.x = this.clamp(this.targetCamera.x, halfW, MAP_WIDTH - halfW);
    this.targetCamera.y = this.clamp(this.targetCamera.y, halfH, MAP_HEIGHT - halfH);
  }

  // --- Events ---

  private bindEvents(): void {
    const on = (type: string, listener: EventListener, opts?: AddEventListenerOptions) => {
      this.canvas.addEventListener(type, listener, opts);
      this.handlers.push([type, listener]);
    };

    // Zoom
    on('wheel', ((event: WheelEvent) => {
      event.preventDefault();
      const zoom = this.clamp(this.targetCamera.zoom * Math.exp(-event.deltaY * .0012), .2, 3);
      this.targetCamera.zoom = zoom;
    }) as EventListener, { passive: false });

    // Pointer events for drag and click
    on('pointerdown', ((e: PointerEvent) => {
      if (e.button === 1 || e.button === 2) {
        this.dragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    }) as EventListener);

    on('pointermove', ((e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (this.dragging) {
        const dx = (e.clientX - this.lastPointer.x) / this.targetCamera.zoom;
        const dy = (e.clientY - this.lastPointer.y) / this.targetCamera.zoom;
        this.targetCamera.x += dx;
        this.targetCamera.y += dy;
        this.lastPointer = { x: e.clientX, y: e.clientY };
      } else {
        this.updateHover();
      }
    }) as EventListener);

    on('pointerup', ((e: PointerEvent) => {
      this.dragging = false;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* */ }
    }) as EventListener);

    on('click', ((e: MouseEvent) => {
      if (e.button !== 0) return;
      const r = this.canvas.getBoundingClientRect();
      const screenX = e.clientX - r.left;
      const screenY = e.clientY - r.top;

      // Check minimap click first
      if (this.isMinimapClick(screenX, screenY)) {
        this.handleMinimapClick(screenX, screenY);
        return;
      }

      // Raycast for 3D feature click
      this.mouse.x = (screenX / this.canvasWidth) * 2 - 1;
      this.mouse.y = -(screenY / this.canvasHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);

      const intersects = this.raycaster.intersectObjects(this.buildingGroup.children, true);
      if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj && !obj.userData.featureId) {
          obj = obj.parent as THREE.Object3D;
        }
        if (obj && obj.userData.featureId) {
          const feature = this.baseFeatures.find(f => f.id === obj.userData.featureId);
          this.options.onFeatureClick?.(feature ?? null);
          return;
        }
      }

      // Terrain click - convert to world coordinates
      const worldPos = this.screenToWorld(screenX, screenY);
      const feature = this.featureAt(worldPos);
      this.options.onFeatureClick?.(feature);
    }) as EventListener);

    on('contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
  }

  private updateHover(): void {
    this.mouse.x = (this.pointer.x / this.canvasWidth) * 2 - 1;
    this.mouse.y = -(this.pointer.y / this.canvasHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects(this.buildingGroup.children, true);
    let hoveredFeature: MapFeature | null = null;

    if (intersects.length > 0) {
      let obj = intersects[0].object;
      while (obj && !obj.userData.featureId) {
        obj = obj.parent as THREE.Object3D;
      }
      if (obj && obj.userData.featureId) {
        hoveredFeature = this.baseFeatures.find(f => f.id === obj.userData.featureId) ?? null;
      }
    }

    if (hoveredFeature?.id !== this.hoverFeature?.id) {
      this.hoverFeature = hoveredFeature;
      this.canvas.style.cursor = hoveredFeature ? 'pointer' : this.dragging ? 'grabbing' : 'default';
      this.options.onHover?.(hoveredFeature, this.pointer);
    }
  }

  private featureAt(world: Position): MapFeature | null {
    const hitRadius = 22 / this.cameraState.zoom;
    let nearest: MapFeature | null = null;
    let nearestDistance = Infinity;

    for (const feature of this.baseFeatures) {
      const d = Math.hypot(feature.position.x - world.x, feature.position.y - world.y);
      if (d < hitRadius && d < nearestDistance) {
        nearest = feature;
        nearestDistance = d;
      }
    }
    return nearest;
  }

  private screenToWorld(x: number, y: number): Position {
    return {
      x: (x - this.canvasWidth / 2) / this.cameraState.zoom + this.cameraState.x,
      y: (y - this.canvasHeight / 2) / this.cameraState.zoom + this.cameraState.y,
    };
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
    const vx = (this.cameraState.x - this.canvasWidth / (2 * this.cameraState.zoom)) / MAP_WIDTH * mw;
    const vy = (this.cameraState.y - this.canvasHeight / (2 * this.cameraState.zoom)) / MAP_HEIGHT * mh;
    const vw = (this.canvasWidth / this.cameraState.zoom) / MAP_WIDTH * mw;
    const vh = (this.canvasHeight / this.cameraState.zoom) / MAP_HEIGHT * mh;
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
    for (let y = 0; y < this.terrain.length; y += 4) {
      for (let x = 0; x < this.terrain[y].length; x += 4) {
        const tile = this.terrain[y][x];
        const color = BIOME_HEX[tile.biome];
        mctx.fillStyle = color;
        mctx.fillRect(x * TERRAIN_TILE_SIZE * sx, y * TERRAIN_TILE_SIZE * sy, TERRAIN_TILE_SIZE * 4 * sx, TERRAIN_TILE_SIZE * 4 * sy);
      }
    }

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
    for (const f of this.baseFeatures) {
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

  private handleMinimapClick(clickX: number, clickY: number): void {
    const mw = 200, mh = 150;
    const mx = this.canvasWidth - mw - 12;
    const my = this.canvasHeight - mh - 12;
    const mapX = ((clickX - mx) / mw) * MAP_WIDTH;
    const mapY = ((clickY - my) / mh) * MAP_HEIGHT;
    this.targetCamera.x = this.clamp(mapX, 100, MAP_WIDTH - 100);
    this.targetCamera.y = this.clamp(mapY, 100, MAP_HEIGHT - 100);
  }

  // --- Tooltip (2D overlay on canvas) ---

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

  // --- Render Loop ---

  private frame = (time: number): void => {
    const delta = Math.min(50, time - this.lastTime || 16);
    this.lastTime = time;

    this.updateCamera();
    this.updateAtmosphere(time);
    this.updateWeatherParticles(time);
    this.animateFlags(time);
    this.animateWater(time);

    // Render 3D scene (with post-processing pipeline)
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    // Render 2D overlays (minimap, tooltip) on top using a 2D context
    // We use the same canvas but switch to 2D overlay
    // Actually, for Three.js, we render 2D overlays as a separate pass
    // Using an overlay canvas approach
    this.renderOverlays();

    this.animationFrame = requestAnimationFrame(this.frame.bind(this));
  };

  private animateFlags(time: number): void {
    this.buildingGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.isFlag) {
        const positions = obj.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < positions.length; i += 3) {
          const x = positions[i];
          const wave = Math.sin(time / 300 + x * 2) * 0.5;
          positions[i + 1] += wave * 0.01;
        }
        obj.geometry.attributes.position.needsUpdate = true;
      }
    });
  }

  private animateWater(time: number): void {
    if (this.waterMesh) {
      this.waterMesh.position.y = -0.5 + Math.sin(time / 2000) * 0.3;
    }
  }

  private renderOverlays(): void {
    // For minimap and tooltip, we'll use a 2D overlay canvas
    // This is handled by the parent component or a separate overlay
    // For now, skip 2D overlays in the 3D renderer
  }

  // --- Public API ---

  setSimulationState(state: SimulationState | null): void {
    this.state = state;
    this.minimapDirty = true;

    // Update dynamic elements
    this.updateArmies();
    this.updateConvoys();
    this.updateWeather();

    // Update territories if they changed
    if (state?.territories?.length) {
      this.territoryGroup.clear();
      this.buildTerritories();
    }
  }

  setCamera(camera: Partial<Camera>, immediate = false): void {
    this.targetCamera = {
      ...this.targetCamera,
      ...camera,
      zoom: this.clamp(camera.zoom ?? this.targetCamera.zoom, 0.2, 3),
    };
    if (immediate) this.cameraState = { ...this.targetCamera };
    this.minimapDirty = true;
  }

  getCamera(): Camera {
    return { ...this.cameraState };
  }

  getWorldPosition(screen: Position): Position {
    return this.screenToWorld(screen.x, screen.y);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvasWidth = Math.max(1, Math.round(rect.width));
    this.canvasHeight = Math.max(1, Math.round(rect.height));

    this.renderer.setSize(this.canvasWidth, this.canvasHeight);
    this.renderer.setPixelRatio(Math.min(this.dpr, 2));
    this.camera.aspect = this.canvasWidth / this.canvasHeight;
    this.camera.updateProjectionMatrix();

    // Update post-processing size
    if (this.composer) {
      this.composer.setSize(this.canvasWidth, this.canvasHeight);
    }
    if (this.bloomPass) {
      this.bloomPass.setSize(this.canvasWidth, this.canvasHeight);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.handlers.forEach(([type, listener]) => this.canvas.removeEventListener(type, listener));
    this.handlers.length = 0;

    // Dispose post-processing
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.bloomPass = null;
    this.gradePass = null;

    // Dispose Three.js resources
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    });

    this.renderer.dispose();
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

export default ThreeMapRenderer;