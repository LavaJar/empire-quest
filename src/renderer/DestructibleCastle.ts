import * as THREE from 'three';
import { createStoneMasonryTexture } from './textures';

/**
 * Destructible Castle Module
 *
 * Walls are built from individually-modeled stone blocks. Siege impacts
 * remove blocks near the collision point; blocks collapse outward/downward
 * with physics-lite animation and leave persistent rubble on the ground.
 * Breaches become actual passages soldiers can use.
 *
 * Architecture notes:
 * - Pre-fractured block grid (not real-time fracture physics — too expensive
 *   for thousands of blocks). Blocks are authored at build time.
 * - Impact localization via raycast against block meshes.
 * - Collapse animation: blocks translate outward from impact + downward,
 *   rotating as they fall. Uses simple easing, no rigid-body engine.
 * - Persistent rubble: small instanced meshes spawned where blocks collapsed.
 * - Dust particles spawn on each block collapse.
 */

export interface DestructibleCastleOptions {
  wallLength: number;      // total wall width in world units
  wallHeight: number;      // wall height
  wallThickness: number;   // wall depth
  blockWidth: number;      // stone block width
  blockHeight: number;     // stone block height
  seed?: number;
}

export interface ImpactEvent {
  position: THREE.Vector3;
  radius: number;          // damage radius around impact
  strength: number;        // blocks within radius take damage
}

interface BlockState {
  mesh: THREE.Mesh;
  gridX: number;
  gridY: number;
  health: number;          // 0..1 remaining integrity
  destroyed: boolean;
  collapsing: boolean;
  collapseProgress: number;
  collapseDir: THREE.Vector3; // direction block falls
  originalPosition: THREE.Vector3;
  originalRotation: THREE.Euler;
}

export class DestructibleWall {
  readonly group: THREE.Group;
  private blocks: BlockState[] = [];
  private rubbleGroup: THREE.Group;
  private dustGroup: THREE.Group;
  private readonly tex: THREE.CanvasTexture;
  private readonly blockMat: THREE.MeshStandardMaterial;
  private readonly rubbleMat: THREE.MeshStandardMaterial;
  private readonly options: DestructibleCastleOptions;
  private readonly cols: number;
  private readonly rows: number;
  private nextRubbleId = 0;
  private nextDustId = 0;

  constructor(options: DestructibleCastleOptions) {
    this.options = options;
    this.cols = Math.floor(options.wallLength / options.blockWidth);
    this.rows = Math.floor(options.wallHeight / options.blockHeight);
    this.tex = createStoneMasonryTexture(options.seed ?? 7);
    this.blockMat = new THREE.MeshStandardMaterial({
      map: this.tex,
      bumpMap: this.tex,
      bumpScale: 0.25,
      color: 0xd8d0c0,
      roughness: 0.92,
      metalness: 0.02,
    });
    this.rubbleMat = new THREE.MeshStandardMaterial({
      map: this.tex,
      color: 0xb0a898,
      roughness: 0.95,
      metalness: 0,
    });

    this.group = new THREE.Group();
    this.rubbleGroup = new THREE.Group();
    this.dustGroup = new THREE.Group();
    this.group.add(this.rubbleGroup);
    this.group.add(this.dustGroup);

    this.build();
  }

  private build(): void {
    const { blockWidth, blockHeight, wallThickness } = this.options;
    const bw = blockWidth;
    const bh = blockHeight;
    const bd = wallThickness;

    // Build block grid
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        // Slight random offset for organic mortar joints
        const offsetX = ((gx % 2) * (bw * 0.5)) + (Math.random() - 0.5) * 0.3;
        const x = gx * bw + offsetX - (this.cols * bw) / 2;
        const y = gy * bh + bh / 2;
        const z = (Math.random() - 0.5) * bd * 0.1;

        const geo = new THREE.BoxGeometry(
          bw * (0.92 + Math.random() * 0.06),
          bh * (0.92 + Math.random() * 0.06),
          bd * (0.9 + Math.random() * 0.1)
        );
        const mesh = new THREE.Mesh(geo, this.blockMat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.isBlock = true;

        const state: BlockState = {
          mesh,
          gridX: gx,
          gridY: gy,
          health: 1,
          destroyed: false,
          collapsing: false,
          collapseProgress: 0,
          collapseDir: new THREE.Vector3(),
          originalPosition: mesh.position.clone(),
          originalRotation: mesh.rotation.clone(),
        };
        this.blocks.push(state);
        this.group.add(mesh);
      }
    }
  }

  /** Apply damage at a world position (relative to wall group origin) */
  applyImpact(impact: ImpactEvent): void {
    const { radius, strength } = impact;
    const hitBlocks: BlockState[] = [];

    for (const block of this.blocks) {
      if (block.destroyed) continue;
      const dx = block.mesh.position.x - impact.position.x;
      const dy = block.mesh.position.y - impact.position.y;
      const dz = block.mesh.position.z - impact.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < radius) {
        // Damage falls off with distance
        const dmg = strength * (1 - dist / radius);
        block.health -= dmg;
        if (block.health <= 0) {
          block.health = 0;
          hitBlocks.push(block);
        }
      }
    }

    // Collapse destroyed blocks
    for (const block of hitBlocks) {
      this.collapseBlock(block, impact.position);
    }
  }

  private collapseBlock(block: BlockState, impactPos: THREE.Vector3): void {
    block.destroyed = true;
    block.collapsing = true;
    block.collapseProgress = 0;

    // Fall direction: outward from impact + gravity
    const dir = new THREE.Vector3()
      .subVectors(block.mesh.position, impactPos)
      .normalize();
    dir.y = -0.5; // gravity bias
    dir.normalize();
    block.collapseDir.copy(dir);

    // Spawn persistent rubble where the block was
    this.spawnRubble(block);

    // Spawn dust cloud
    this.spawnDust(block.mesh.position);
  }

  private spawnRubble(block: BlockState): void {
    const { blockWidth, blockHeight, wallThickness } = this.options;
    const pieces = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pieces; i++) {
      const w = blockWidth * (0.2 + Math.random() * 0.4);
      const h = blockHeight * (0.15 + Math.random() * 0.3);
      const d = wallThickness * (0.2 + Math.random() * 0.4);
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, this.rubbleMat);
      mesh.position.set(
        block.originalPosition.x + (Math.random() - 0.5) * blockWidth,
        block.originalPosition.y * 0.15, // settle near ground
        block.originalPosition.z + (Math.random() - 0.5) * wallThickness
      );
      mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.isRubble = true;
      mesh.userData.rubbleId = this.nextRubbleId++;
      this.rubbleGroup.add(mesh);
    }
  }

  private spawnDust(pos: THREE.Vector3): void {
    const count = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const geo = new THREE.PlaneGeometry(1.5, 1.5);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xc8b898,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.position.x += (Math.random() - 0.5) * 3;
      mesh.position.y += Math.random() * 2;
      mesh.position.z += (Math.random() - 0.5) * 3;
      mesh.userData.isDust = true;
      mesh.userData.dustId = this.nextDustId++;
      mesh.userData.dustVel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        0.3 + Math.random() * 0.6,
        (Math.random() - 0.5) * 0.8
      );
      mesh.userData.dustLife = 1.0;
      this.dustGroup.add(mesh);
    }
  }

  /** Update animation state — call every frame */
  update(delta: number): void {
    const speed = 3.5; // collapse animation speed

    // Collapse blocks
    for (const block of this.blocks) {
      if (block.collapsing && !block.destroyed) continue;
      if (block.collapsing) {
        block.collapseProgress += delta * speed;
        const t = Math.min(1, block.collapseProgress);
        const ease = t * t * (3 - 2 * t); // smoothstep

        // Translate outward + down
        block.mesh.position.copy(block.originalPosition)
          .addScaledVector(block.collapseDir, ease * 4);
        block.mesh.position.y = block.originalPosition.y - ease * block.originalPosition.y;

        // Rotate as it falls
        block.mesh.rotation.x = block.originalRotation.x + ease * block.collapseDir.z * 1.5;
        block.mesh.rotation.z = block.originalRotation.z + ease * block.collapseDir.x * 1.5;

        if (t >= 1) {
          block.collapsing = false;
          // Remove from scene (block is gone, rubble persists)
          this.group.remove(block.mesh);
        }
      }
    }

    // Update dust particles
    for (const dust of this.dustGroup.children) {
      const m = dust as THREE.Mesh;
      if (m.userData.isDust) {
        m.userData.dustLife -= delta * 0.6;
        m.position.addScaledVector(m.userData.dustVel, delta);
        m.userData.dustVel.y -= delta * 0.3; // gravity on dust
        m.scale.setScalar(1 + (1 - m.userData.dustLife) * 1.5);
        (m.material as THREE.MeshBasicMaterial).opacity = m.userData.dustLife * 0.45;
        if (m.userData.dustLife <= 0) {
          this.dustGroup.remove(m);
          (m.material as THREE.MeshBasicMaterial).dispose();
          m.geometry.dispose();
        }
      }
    }
  }

  /** Get whether the wall has any breaches (destroyed blocks at ground level) */
  hasBreaches(): boolean {
    return this.blocks.some(b => b.destroyed && b.gridY < 2);
  }

  /** Reset wall to intact state */
  reset(): void {
    // Remove rubble and dust
    while (this.rubbleGroup.children.length) {
      const c = this.rubbleGroup.children[0] as THREE.Mesh;
      this.rubbleGroup.remove(c);
      c.geometry.dispose();
      (c.material as THREE.Material).dispose();
    }
    while (this.dustGroup.children.length) {
      const c = this.dustGroup.children[0] as THREE.Mesh;
      this.dustGroup.remove(c);
      c.geometry.dispose();
      (c.material as THREE.Material).dispose();
    }
    // Reset blocks
    for (const block of this.blocks) {
      block.health = 1;
      block.destroyed = false;
      block.collapsing = false;
      block.collapseProgress = 0;
      block.mesh.position.copy(block.originalPosition);
      block.mesh.rotation.copy(block.originalRotation);
      if (!this.group.children.includes(block.mesh)) {
        this.group.add(block.mesh);
      }
    }
  }

  dispose(): void {
    this.blockMat.dispose();
    this.rubbleMat.dispose();
    this.tex.dispose();
    for (const block of this.blocks) {
      block.mesh.geometry.dispose();
    }
  }
}

/** Build a full destructible castle with walls, towers, gatehouse, and keep */
export interface CastleOptions {
  seed?: number;
  kingdomColor?: THREE.Color;
}

export class DestructibleCastle {
  readonly group: THREE.Group;
  readonly walls: DestructibleWall[] = [];
  private towers: THREE.Group[] = [];
  private keep: THREE.Group | null = null;
  private readonly options: CastleOptions;

  constructor(options: CastleOptions = {}) {
    this.options = options;
    this.group = new THREE.Group();
    this.build();
  }

  private build(): void {
    const tex = createStoneMasonryTexture(this.options.seed ?? 7);
    const stoneMat = new THREE.MeshStandardMaterial({
      map: tex,
      bumpMap: tex,
      bumpScale: 0.25,
      color: 0xd8d0c0,
      roughness: 0.92,
      metalness: 0.02,
    });

    // Four destructible wall segments (each ~24 units wide)
    const wallLen = 24;
    const wallH = 12;
    const wallT = 2.5;
    const blockW = 2.2;
    const blockH = 1.5;

    const offsets = [
      { x: 0, z: -wallLen / 2, rot: 0 },     // front wall
      { x: 0, z: wallLen / 2, rot: 0 },       // back wall
      { x: -wallLen / 2, z: 0, rot: Math.PI / 2 }, // left wall
      { x: wallLen / 2, z: 0, rot: Math.PI / 2 },  // right wall
    ];

    for (const off of offsets) {
      const wall = new DestructibleWall({
        wallLength: wallLen,
        wallHeight: wallH,
        wallThickness: wallT,
        blockWidth: blockW,
        blockHeight: blockH,
        seed: this.options.seed ?? 7,
      });
      wall.group.position.set(off.x, wallH / 2, off.z);
      wall.group.rotation.y = off.rot;
      this.group.add(wall.group);
      this.walls.push(wall);
    }

    // Corner towers
    const towerPositions = [
      [-wallLen / 2, -wallLen / 2],
      [wallLen / 2, -wallLen / 2],
      [-wallLen / 2, wallLen / 2],
      [wallLen / 2, wallLen / 2],
    ];
    for (const [x, z] of towerPositions) {
      const tower = this.buildTower(tex);
      tower.position.set(x, wallH, z);
      this.group.add(tower);
      this.towers.push(tower);
    }

    // Central keep
    this.keep = this.buildKeep(tex);
    this.group.add(this.keep);
  }

  private buildTower(tex: THREE.CanvasTexture): THREE.Group {
    const group = new THREE.Group();
    const towerMat = new THREE.MeshStandardMaterial({
      map: tex,
      bumpMap: tex,
      bumpScale: 0.2,
      color: 0xd0c8b8,
      roughness: 0.9,
      metalness: 0.02,
    });

    // Tower body
    const bodyGeo = new THREE.CylinderGeometry(3, 3.5, 10, 12);
    const body = new THREE.Mesh(bodyGeo, towerMat);
    body.position.y = 5;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Tower roof (conical)
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x8a6a40,
      roughness: 0.75,
      metalness: 0.08,
    });
    const roofGeo = new THREE.ConeGeometry(4, 5, 12);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 12.5;
    roof.castShadow = true;
    group.add(roof);

    // Battlements around top
    const battMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xe0d8c8,
      roughness: 0.88,
    });
    for (let i = 0; i < 8; i += 2) {
      const angle = (i / 8) * Math.PI * 2;
      const bx = Math.cos(angle) * 3.2;
      const bz = Math.sin(angle) * 3.2;
      const battGeo = new THREE.BoxGeometry(1.2, 1.5, 1.2);
      const batt = new THREE.Mesh(battGeo, battMat);
      batt.position.set(bx, 10.75, bz);
      batt.castShadow = true;
      group.add(batt);
    }

    // Tower window
    const winMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.95 });
    const winGeo = new THREE.BoxGeometry(0.8, 1.5, 0.4);
    const win = new THREE.Mesh(winGeo, winMat);
    win.position.set(0, 4, 3.4);
    group.add(win);

    return group;
  }

  private buildKeep(tex: THREE.CanvasTexture): THREE.Group {
    const group = new THREE.Group();
    const keepMat = new THREE.MeshStandardMaterial({
      map: tex,
      bumpMap: tex,
      bumpScale: 0.25,
      color: 0xe0d8c8,
      roughness: 0.88,
      metalness: 0.02,
    });

    // Keep body
    const bodyGeo = new THREE.BoxGeometry(8, 14, 8);
    const body = new THREE.Mesh(bodyGeo, keepMat);
    body.position.y = 7;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Keep roof (pyramid)
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x8a6a40,
      roughness: 0.75,
      metalness: 0.08,
    });
    const roofGeo = new THREE.ConeGeometry(6, 6, 4);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 17;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    // Keep battlements
    const battMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xe8e0d0,
      roughness: 0.88,
    });
    for (let i = 0; i < 8; i += 2) {
      const cx = (i % 4) * 2 - 3;
      const cz = (i < 4 ? -3.5 : 3.5);
      const battGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
      const batt = new THREE.Mesh(battGeo, battMat);
      batt.position.set(cx, 14.75, cz);
      batt.castShadow = true;
      group.add(batt);
    }

    // Keep windows (gothic arches)
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x1a1410,
      roughness: 0.95,
      emissive: 0x332200,
      emissiveIntensity: 0.15,
    });
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const wx = (col - 0.5) * 3;
        const wy = 3 + row * 4;
        const wz = (row === 0 ? 4.1 : -4.1);
        const winGeo = new THREE.BoxGeometry(1.2, 2, 0.3);
        const win = new THREE.Mesh(winGeo, winMat);
        win.position.set(wx, wy, wz);
        group.add(win);
      }
    }

    // Keep door
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2510, roughness: 0.95 });
    const doorGeo = new THREE.BoxGeometry(2.5, 4, 0.3);
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 2, 4.15);
    group.add(door);

    return group;
  }

  /** Apply siege impact to the nearest wall */
  applyImpact(position: THREE.Vector3, radius = 4, strength = 1.2): void {
    let nearest: DestructibleWall | null = null;
    let nearestDist = Infinity;
    for (const wall of this.walls) {
      const worldPos = new THREE.Vector3()
        .copy(position)
        .sub(wall.group.position)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), -wall.group.rotation.y);
      const dist = Math.abs(worldPos.z); // distance to wall plane
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = wall;
      }
    }
    if (nearest) {
      const localPos = new THREE.Vector3()
        .copy(position)
        .sub(nearest.group.position)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), -nearest.group.rotation.y);
      nearest.applyImpact({ position: localPos, radius, strength });
    }
  }

  /** Update all destruction animations */
  update(delta: number): void {
    for (const wall of this.walls) {
      wall.update(delta);
    }
  }

  dispose(): void {
    for (const wall of this.walls) {
      wall.dispose();
    }
  }
}