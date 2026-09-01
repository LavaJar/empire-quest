import { RenderBlockManifest } from './RenderBlock';

/**
 * First executable RenderBlock asset contract.
 *
 * These paths are intentionally deterministic. Once authored PNG/WebP assets
 * are placed under public/renderblocks/prototype/, the registry/renderer can
 * use them without changing simulation code.
 */
export const PROTOTYPE_RENDERBLOCK_MANIFEST: RenderBlockManifest = {
  schemaVersion: 1,
  featureBindings: {
    'sunwell-farm': 'farm.sunwell.v1',
  },
  blocks: [
    {
      id: 'farm.sunwell.v1',
      family: 'verdant-farm',
      type: 'farm',
      version: 1,
      spatial: {
        width: 72,
        height: 52,
        pivot: { x: 0.5, y: 0.78 },
        collisionProxy: { kind: 'rect', width: 58, height: 34 },
        navProxy: { kind: 'rect', width: 58, height: 34 },
      },
      simulation: {
        productionId: 'food',
        passability: 'restricted',
        tags: ['agriculture', 'food', 'prototype'],
      },
      states: [
        {
          key: 'healthy',
          passes: {
            beauty: { src: '/renderblocks/prototype/farm/sunwell_healthy.webp' },
            alpha: { src: '/renderblocks/prototype/farm/sunwell_healthy_alpha.webp' },
          },
        },
        {
          key: 'dry',
          passes: {
            beauty: { src: '/renderblocks/prototype/farm/sunwell_dry.webp' },
            alpha: { src: '/renderblocks/prototype/farm/sunwell_dry_alpha.webp' },
          },
        },
        {
          key: 'harvested',
          passes: {
            beauty: { src: '/renderblocks/prototype/farm/sunwell_harvested.webp' },
            alpha: { src: '/renderblocks/prototype/farm/sunwell_harvested_alpha.webp' },
          },
        },
        {
          key: 'snow',
          passes: {
            beauty: { src: '/renderblocks/prototype/farm/sunwell_snow.webp' },
            alpha: { src: '/renderblocks/prototype/farm/sunwell_snow_alpha.webp' },
          },
        },
        {
          key: 'flooded',
          passes: {
            beauty: { src: '/renderblocks/prototype/farm/sunwell_flooded.webp' },
            alpha: { src: '/renderblocks/prototype/farm/sunwell_flooded_alpha.webp' },
          },
        },
      ],
      metadata: {
        authoringCamera: 'three-quarter orthographic, fixed prototype camera',
        lightDirection: 'northwest / upper-left',
        notes: 'First farm migration target. Simulation chooses visual condition; procedural farm remains fallback.',
      },
    },
    {
      id: 'castle.northwell.west-wall.v1',
      family: 'northwell-stone',
      type: 'wall',
      version: 1,
      spatial: {
        width: 96,
        height: 76,
        pivot: { x: 0.5, y: 0.86 },
        anchors: [
          { id: 'left-joint', position: { x: -48, y: 0, z: 0 }, kind: 'attachment' },
          { id: 'right-joint', position: { x: 48, y: 0, z: 0 }, kind: 'attachment' },
          { id: 'ground', position: { x: 0, y: 0, z: 0 }, kind: 'ground' },
          { id: 'impact-center', position: { x: 0, y: 20, z: 0 }, kind: 'projectile-target' },
        ],
        collisionProxy: {
          kind: 'polygon',
          points: [
            { x: 0.04, y: 0.18 },
            { x: 0.96, y: 0.18 },
            { x: 0.96, y: 0.9 },
            { x: 0.04, y: 0.9 },
          ],
        },
        navProxy: { kind: 'rect', width: 88, height: 20 },
      },
      structural: {
        nodeId: 'northwell:west_wall_04',
        damageSlots: [
          { id: 'west-wall-impact', regionId: 'west-wall-main', acceptedDamage: ['impact', 'siege', 'fire'] },
          { id: 'west-wall-battlement', regionId: 'west-wall-battlement', acceptedDamage: ['impact', 'siege', 'collapse'] },
        ],
        semanticRegions: [
          {
            id: 'west-wall-main',
            targetId: 'northwell:west_wall_04',
            material: 'limestone',
            polygon: [
              { x: 0.05, y: 0.28 },
              { x: 0.95, y: 0.28 },
              { x: 0.95, y: 0.9 },
              { x: 0.05, y: 0.9 },
            ],
          },
          {
            id: 'west-wall-battlement',
            targetId: 'northwell:west_wall_04:battlement',
            material: 'limestone',
            polygon: [
              { x: 0.04, y: 0.12 },
              { x: 0.96, y: 0.12 },
              { x: 0.96, y: 0.34 },
              { x: 0.04, y: 0.34 },
            ],
          },
        ],
        collapseRules: [
          {
            id: 'west-wall-critical',
            whenIntegrityBelow: 0.4,
            producesState: 'critical',
          },
          {
            id: 'west-wall-breach',
            whenIntegrityBelow: 0.2,
            producesState: 'breached',
            changesPassability: true,
          },
        ],
      },
      simulation: {
        passability: 'blocked',
        cover: 1,
        tags: ['castle', 'fortification', 'northwell', 'prototype'],
      },
      states: [
        {
          key: 'intact',
          passes: {
            beauty: { src: '/renderblocks/prototype/northwell/west_wall_intact.webp' },
            alpha: { src: '/renderblocks/prototype/northwell/west_wall_intact_alpha.webp' },
            semanticId: { src: '/renderblocks/prototype/northwell/west_wall_semantic.webp' },
            damageMask: { src: '/renderblocks/prototype/northwell/west_wall_damage_mask.webp' },
          },
        },
        {
          key: 'scarred',
          passes: {
            beauty: { src: '/renderblocks/prototype/northwell/west_wall_scarred.webp' },
            alpha: { src: '/renderblocks/prototype/northwell/west_wall_scarred_alpha.webp' },
          },
        },
        {
          key: 'damaged',
          passes: {
            beauty: { src: '/renderblocks/prototype/northwell/west_wall_damaged.webp' },
            alpha: { src: '/renderblocks/prototype/northwell/west_wall_damaged_alpha.webp' },
          },
        },
        {
          key: 'critical',
          passes: {
            beauty: { src: '/renderblocks/prototype/northwell/west_wall_critical.webp' },
            alpha: { src: '/renderblocks/prototype/northwell/west_wall_critical_alpha.webp' },
          },
        },
        {
          key: 'breached',
          passes: {
            beauty: { src: '/renderblocks/prototype/northwell/west_wall_breached.webp' },
            alpha: { src: '/renderblocks/prototype/northwell/west_wall_breached_alpha.webp' },
          },
        },
      ],
      metadata: {
        authoringCamera: 'three-quarter orthographic, fixed Northwell benchmark camera',
        lightDirection: 'northwest / upper-left',
        notes: 'Northwell Gate Breach R&D block. Structural node remains simulation authority.',
      },
    },
  ],
};
