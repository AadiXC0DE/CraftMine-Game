
'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { Button } from '@/components/ui/button';
import { Play, HelpCircle, AlertCircle, Mouse } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Game Constants
const BLOCK_SIZE = 1;
const CHUNK_WIDTH = 16; // Blocks
const CHUNK_DEPTH = 16; // Blocks
const GRASS_LAYER_DEPTH = 3; // How many blocks of grass on top of dirt
const PLAYER_HEIGHT = BLOCK_SIZE * 1.75;
const PLAYER_SPEED = 5.0;
const GRAVITY = -15.0;
const JUMP_VELOCITY = 7.0;
const VIEW_DISTANCE_CHUNKS = 4; // Load chunks in a square of (2*VD+1) x (2*VD+1)
const COLLISION_TOLERANCE = 1e-3; // Small tolerance for physics calculations

// Sky Constants
const SUN_SIZE = 40 * BLOCK_SIZE;
const SKY_RADIUS = 450000; // Matches Sky object scale for sun positioning
const NUM_CLOUDS = 25;
const CLOUD_ALTITUDE_MIN = 70 * BLOCK_SIZE;
const CLOUD_ALTITUDE_MAX = 90 * BLOCK_SIZE;
const CLOUD_AREA_SPREAD = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 3;
const CLOUD_SPEED = 0.5 * BLOCK_SIZE; // Units per second
const CLOUD_SEGMENT_BASE_SIZE = 6 * BLOCK_SIZE;
const CLOUD_SEGMENT_THICKNESS = 2 * BLOCK_SIZE;
const MAX_SEGMENTS_PER_CLOUD = 10;
const MIN_SEGMENTS_PER_CLOUD = 4;

// Water and Terrain Constants
const WATER_LEVEL_Y_CENTER = 4 * BLOCK_SIZE; // Center Y of the highest water block. Water surface is this + BLOCK_SIZE/2.
// No explicit SAND_BEACH_WIDTH; sand forms based on being underwater.
const MAX_TERRAIN_HEIGHT_BLOCKS = 20; // Max height of terrain in blocks


// Function to create a procedural wood texture
function createWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;

  const baseColor = '#A0522D'; // Brown base
  const grainColorDark = '#835434'; // Darker brown for grain
  const grainColorLight = '#B97A57'; // Lighter brown for highlights

  // Fill background
  context.fillStyle = baseColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Draw wood grain lines
  context.lineWidth = 1.5; // Slightly thicker lines
  const numLines = 5; // Number of main grain lines

  for (let i = 0; i < numLines; i++) {
    const baseX = (canvas.width / (numLines + 0.5)) * (i + 0.5) + (Math.random() - 0.5) * 4; // Add more randomness to line start

    // Darker grain line
    context.strokeStyle = grainColorDark;
    context.beginPath();
    context.moveTo(baseX + (Math.random() - 0.5) * 2, 0); // Start y
    context.lineTo(baseX + (Math.random() - 0.5) * 5, canvas.height); // End y, more waviness
    context.stroke();

    // Lighter grain line (highlight)
    context.strokeStyle = grainColorLight;
    context.beginPath();
    context.moveTo(baseX + 1.5 + (Math.random() - 0.5) * 2, 0); // Offset slightly
    context.lineTo(baseX + 1.5 + (Math.random() - 0.5) * 5, canvas.height);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Function to create a procedural leaf texture
function createLeafTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d')!;

  const baseLeafColor = '#2E8B57'; // SeaGreen, a good base for jungle leaves
  const darkerLeafColor = '#228B22'; // ForestGreen, for depth
  const highlightLeafColor = '#3CB371'; // MediumSeaGreen, for highlights

  // Base color
  context.fillStyle = baseLeafColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Add splotches for texture and depth
  const numSplotches = 20; // More splotches for a denser look
  for (let i = 0; i < numSplotches; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 3 + 2; // Vary splotch size
    context.fillStyle = i % 2 === 0 ? darkerLeafColor : highlightLeafColor; // Alternate colors
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2, true);
    context.fill();
  }

  // Add smaller, brighter highlights
  const numHighlights = 5;
   for (let i = 0; i < numHighlights; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 1 + 0.5; // Small highlights
    context.fillStyle = '#90EE90'; // LightGreen, for a bit of shine
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2, true);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const woodTexture = createWoodTexture();
const leafTexture = createLeafTexture();

// Material definitions (cached at module level)
const materials = {
  grass: new THREE.MeshStandardMaterial({ color: 0x70AD47, roughness: 0.8, metalness: 0.1 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9, metalness: 0.1 }),
  wood: new THREE.MeshStandardMaterial({
    map: woodTexture,
    roughness: 0.8,
    metalness: 0.1
  }),
  leaves: new THREE.MeshStandardMaterial({
    map: leafTexture,
    roughness: 0.7,
    metalness: 0.1,
    alphaTest: 0.1, // For sharper leaf edges if texture has alpha
    side: THREE.DoubleSide, // Render both sides of leaves
    transparent: true, // Allow opacity for softer look
  }),
  cloud: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  water: new THREE.MeshStandardMaterial({
    color: 0x4682B4, // Steel Blue, can adjust
    opacity: 0.65,
    transparent: true,
    roughness: 0.1,
    metalness: 0.1,
    side: THREE.DoubleSide, // See water from below
  }),
  sand: new THREE.MeshStandardMaterial({ color: 0xF4A460, roughness: 0.9, metalness: 0.1 }), // SandyBrown
};
const blockGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
const cloudSegmentGeometry = new THREE.BoxGeometry(CLOUD_SEGMENT_BASE_SIZE, CLOUD_SEGMENT_THICKNESS, CLOUD_SEGMENT_BASE_SIZE);


interface ChunkData {
  meshes: THREE.InstancedMesh[];
  terrainHeights: number[][];
}

export function BlockExplorerGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(true);
  const [showHelp, setShowHelp] = useState(true);
  const [pointerLockError, setPointerLockError] = useState<string | null>(null);
  const [isPointerLockUnavailable, setIsPointerLockUnavailable] = useState(false);

  const isPausedRef = useRef(isPaused);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);

  const playerVelocity = useRef(new THREE.Vector3());
  const onGround = useRef(false);
  const moveForward = useRef(false);
  const moveBackward = useRef(false);
  const moveLeft = useRef(false);
  const moveRight = useRef(false);
  const canJump = useRef(false);

  const loadedChunksRef = useRef<Map<string, ChunkData>>(new Map());
  const currentChunkCoordsRef = useRef({ x: 0, z: 0 });
  const noiseRef = useRef(new ImprovedNoise());
  const initialChunksLoadedRef = useRef(false);

  const isUsingFallbackControlsRef = useRef(false);
  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });

  const sunMeshRef = useRef<THREE.Mesh | null>(null);
  const cloudsGroupRef = useRef<THREE.Group | null>(null);
  const sunPositionVecRef = useRef(new THREE.Vector3());


  const generateChunk = useCallback((chunkX: number, chunkZ: number): ChunkData | null => {
    if (!noiseRef.current) return null;
    const noise = noiseRef.current;

    const chunkTerrainHeights: number[][] = Array(CHUNK_WIDTH).fill(null).map(() => Array(CHUNK_DEPTH).fill(0));
    const blockInstances: { [key: string]: THREE.Matrix4[] } = {
      grass: [], dirt: [], wood: [], leaves: [], water: [], sand: [],
    };

    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_DEPTH; z++) {
        const globalNoiseX = chunkX * CHUNK_WIDTH + x;
        const globalNoiseZ = chunkZ * CHUNK_DEPTH + z;
        const worldXPos = (chunkX * CHUNK_WIDTH + x) * BLOCK_SIZE;
        const worldZPos = (chunkZ * CHUNK_DEPTH + z) * BLOCK_SIZE;

        // Determine base terrain height in blocks
        let baseTerrainHeightBlocks = Math.floor(noise.noise(globalNoiseX / 25, globalNoiseZ / 25, 0) * 7 + 8); // Primary terrain shape, base height increased
        baseTerrainHeightBlocks += Math.floor(noise.noise(globalNoiseX / 12, globalNoiseZ / 12, 0.5) * 3); // Secondary detail
        baseTerrainHeightBlocks = Math.min(baseTerrainHeightBlocks, MAX_TERRAIN_HEIGHT_BLOCKS);
        baseTerrainHeightBlocks = Math.max(1, baseTerrainHeightBlocks);

        // Store Y of the TOP SURFACE of the highest SOLID block for physics and tree placement
        chunkTerrainHeights[x][z] = (baseTerrainHeightBlocks - 1) * BLOCK_SIZE + (BLOCK_SIZE / 2);

        // Place solid blocks (grass, sand, dirt)
        for (let yBlockIndex = 0; yBlockIndex < baseTerrainHeightBlocks; yBlockIndex++) {
          const blockCenterY = yBlockIndex * BLOCK_SIZE;
          const matrix = new THREE.Matrix4().setPosition(worldXPos, blockCenterY, worldZPos);

          if (yBlockIndex === baseTerrainHeightBlocks - 1) { // This is the topmost solid block
            // If the center of this top block is below the center of the water level, it's underwater -> sand
            if (blockCenterY < WATER_LEVEL_Y_CENTER) {
              blockInstances.sand.push(matrix);
            } else { // Otherwise, it's grass, even if it's right next to water.
              blockInstances.grass.push(matrix);
            }
          } else { // Blocks below the top solid block
            // Check if the actual top block of this column is sand (i.e., underwater)
            const topBlockActualCenterY = (baseTerrainHeightBlocks - 1) * BLOCK_SIZE;
            const isSurfaceSubmergedSand = topBlockActualCenterY < WATER_LEVEL_Y_CENTER;

            if (isSurfaceSubmergedSand && yBlockIndex >= baseTerrainHeightBlocks - GRASS_LAYER_DEPTH) {
              // If the surface is sand (because it's truly underwater)
              // and this block is within the typical 'dirt layer depth' from the surface,
              // then this sub-surface block also becomes sand.
              blockInstances.sand.push(matrix);
            } else {
              blockInstances.dirt.push(matrix); // Standard dirt
            }
          }
        }

        // Place water blocks if solid ground is below water surface
        const solidGroundTopSurfaceY = chunkTerrainHeights[x][z];
        const waterActualSurfaceY = WATER_LEVEL_Y_CENTER + BLOCK_SIZE / 2;

        if (solidGroundTopSurfaceY < waterActualSurfaceY) {
          let currentWaterBlockCenterY = solidGroundTopSurfaceY + BLOCK_SIZE / 2; // Center of first water block sits on solid ground
          while (currentWaterBlockCenterY <= WATER_LEVEL_Y_CENTER) {
            blockInstances.water.push(new THREE.Matrix4().setPosition(worldXPos, currentWaterBlockCenterY, worldZPos));
            currentWaterBlockCenterY += BLOCK_SIZE;
          }
        }
      }
    }

    // Tree Generation
    const treeCount = Math.floor(CHUNK_WIDTH * CHUNK_DEPTH * 0.015);
    for (let i = 0; i < treeCount; i++) {
      const treeLocalX = Math.floor(Math.random() * CHUNK_WIDTH);
      const treeLocalZ = Math.floor(Math.random() * CHUNK_DEPTH);

      const groundSurfaceYForTree = chunkTerrainHeights[treeLocalX]?.[treeLocalZ]; // Y of top surface of SOLID ground

      // Check if the spot is suitable (not water, ground exists)
      // Water surface is at WATER_LEVEL_Y_CENTER + BLOCK_SIZE / 2
      if (groundSurfaceYForTree === undefined || groundSurfaceYForTree <= WATER_LEVEL_Y_CENTER + BLOCK_SIZE / 2) {
        continue; // Skip tree if in water or ground too low
      }

      const firstTrunkBlockCenterY = groundSurfaceYForTree + (BLOCK_SIZE / 2);

      if (firstTrunkBlockCenterY - (BLOCK_SIZE / 2) > -Infinity) {
        const treeHeight = Math.floor(Math.random() * 3) + 4; // Trunk height: 4 to 6 blocks
        const worldTreeRootX = (chunkX * CHUNK_WIDTH + treeLocalX) * BLOCK_SIZE;
        const worldTreeRootZ = (chunkZ * CHUNK_DEPTH + treeLocalZ) * BLOCK_SIZE;

        // Create trunk
        for (let h = 0; h < treeHeight; h++) {
          const trunkBlockCenterY = firstTrunkBlockCenterY + (h * BLOCK_SIZE);
          blockInstances.wood.push(new THREE.Matrix4().setPosition(worldTreeRootX, trunkBlockCenterY, worldTreeRootZ));
        }

        // Canopy properties
        const topTrunkY = firstTrunkBlockCenterY + ((treeHeight - 1) * BLOCK_SIZE);
        const canopyBaseY = topTrunkY + BLOCK_SIZE; // Leaves start one block above trunk top

        // Main canopy body (roughly 5x5 wide, 2 blocks tall)
        for (let lyOffset = 0; lyOffset < 2; lyOffset++) { // Two main layers of leaves
          const currentLayerY = canopyBaseY + lyOffset * BLOCK_SIZE;
          for (let lx = -2; lx <= 2; lx++) {
            for (let lz = -2; lz <= 2; lz++) {
              // Skip corners on the lower layer of the main canopy to make it rounder
              if (lyOffset === 0 && Math.abs(lx) === 2 && Math.abs(lz) === 2) {
                if (Math.random() < 0.6) continue; // 60% chance to skip deep corners
              }
              // Skip edges on the lower layer sometimes
              else if (lyOffset === 0 && (Math.abs(lx) === 2 || Math.abs(lz) === 2)) {
                if (Math.random() < 0.25) continue; // 25% chance to skip edges
              }
              // Don't place leaves directly on top of the trunk in the first layer
              if (lyOffset === 0 && lx === 0 && lz === 0) continue;

              blockInstances.leaves.push(new THREE.Matrix4().setPosition(worldTreeRootX + lx * BLOCK_SIZE, currentLayerY, worldTreeRootZ + lz * BLOCK_SIZE));
            }
          }
        }

        // Canopy top cap (roughly 3x3 wide, 1-2 blocks tall)
        const topCapY = canopyBaseY + 2 * BLOCK_SIZE; // Start top cap above main body
        for (let lx = -1; lx <= 1; lx++) {
          for (let lz = -1; lz <= 1; lz++) {
             // Skip corners of the cap sometimes
             if (Math.abs(lx) === 1 && Math.abs(lz) === 1) {
                if (Math.random() < 0.4) continue; // 40% chance to skip cap corners
             }
            blockInstances.leaves.push(new THREE.Matrix4().setPosition(worldTreeRootX + lx * BLOCK_SIZE, topCapY, worldTreeRootZ + lz * BLOCK_SIZE));
          }
        }
        // Chance for a single leaf at the very peak
        if (Math.random() < 0.75) { // 75% chance
            blockInstances.leaves.push(new THREE.Matrix4().setPosition(worldTreeRootX, topCapY + BLOCK_SIZE, worldTreeRootZ));
        }
         // More varied "outreach" leaves for a natural look
        const outreachLeafPositions = [
            { x: 0, y: 0, z: 2, p: 0.6 }, { x: 0, y: 0, z: -2, p: 0.6 }, // Front/Back middle layer
            { x: 2, y: 0, z: 0, p: 0.6 }, { x: -2, y: 0, z: 0, p: 0.6 }, // Sides middle layer
            { x: 1, y: 1, z: 2, p: 0.4 }, { x: -1, y: 1, z: 2, p: 0.4 }, // Upper front corners
            { x: 1, y: 1, z: -2, p: 0.4 }, { x: -1, y: 1, z: -2, p: 0.4 }, // Upper back corners
            { x: 2, y: 1, z: 1, p: 0.4 }, { x: 2, y: 1, z: -1, p: 0.4 }, // Upper side corners (front)
            { x: -2, y: 1, z: 1, p: 0.4 }, { x: -2, y: 1, z: -1, p: 0.4 }, // Upper side corners (back)
            { x: 0, y: 2, z: 1, p: 0.5 }, { x: 0, y: 2, z: -1, p: 0.5 }, // Top layer front/back
            { x: 1, y: 2, z: 0, p: 0.5 }, { x: -1, y: 2, z: 0, p: 0.5 }, // Top layer sides
        ];

        outreachLeafPositions.forEach(pos => {
            if (Math.random() < pos.p) {
                blockInstances.leaves.push(new THREE.Matrix4().setPosition(
                    worldTreeRootX + pos.x * BLOCK_SIZE,
                    canopyBaseY + pos.y * BLOCK_SIZE, // pos.y is offset from canopyBaseY
                    worldTreeRootZ + pos.z * BLOCK_SIZE
                ));
            }
        });
      }
    }

    const instancedMeshes: THREE.InstancedMesh[] = [];
    Object.entries(blockInstances).forEach(([type, matrices]) => {
      if (matrices.length > 0) {
        let currentMaterial: THREE.Material | THREE.Material[];
        if (type === 'grass') {
          currentMaterial = [
            materials.dirt, materials.dirt, materials.grass,
            materials.dirt, materials.dirt, materials.dirt,
          ];
        } else {
          currentMaterial = materials[type as keyof typeof materials];
        }
        const instancedMesh = new THREE.InstancedMesh(blockGeometry, currentMaterial, matrices.length);
        matrices.forEach((matrix, idx) => instancedMesh.setMatrixAt(idx, matrix));
        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;
        instancedMeshes.push(instancedMesh);
      }
    });
    return { meshes: instancedMeshes, terrainHeights: chunkTerrainHeights };
  }, []);

  const getPlayerGroundHeight = useCallback((worldX: number, worldZ: number): number => {
    const camChunkX = Math.floor(worldX / BLOCK_SIZE / CHUNK_WIDTH);
    const camChunkZ = Math.floor(worldZ / BLOCK_SIZE / CHUNK_DEPTH);
    const chunkKey = `${camChunkX},${camChunkZ}`;

    const chunkData = loadedChunksRef.current.get(chunkKey);
    if (!chunkData) return -Infinity;

    let localX = Math.floor((worldX / BLOCK_SIZE) - camChunkX * CHUNK_WIDTH);
    let localZ = Math.floor((worldZ / BLOCK_SIZE) - camChunkZ * CHUNK_DEPTH);

    // Ensure localX and localZ are always positive and within chunk bounds [0, CHUNK_WIDTH/DEPTH - 1]
    localX = (localX % CHUNK_WIDTH + CHUNK_WIDTH) % CHUNK_WIDTH;
    localZ = (localZ % CHUNK_DEPTH + CHUNK_DEPTH) % CHUNK_DEPTH;

    const height = chunkData.terrainHeights[localX]?.[localZ];
    return height === undefined ? -Infinity : height; // Y of the TOP SURFACE of the SOLID block
  }, []);

  const updateChunks = useCallback(() => {
    if (!cameraRef.current || !sceneRef.current) return;

    const camPos = cameraRef.current.position;
    const currentPlayerChunkX = Math.floor(camPos.x / BLOCK_SIZE / CHUNK_WIDTH);
    const currentPlayerChunkZ = Math.floor(camPos.z / BLOCK_SIZE / CHUNK_DEPTH);

    if (
      initialChunksLoadedRef.current &&
      currentChunkCoordsRef.current.x === currentPlayerChunkX &&
      currentChunkCoordsRef.current.z === currentPlayerChunkZ
    ) {
      return; // No need to update if player hasn't changed chunks
    }

    currentChunkCoordsRef.current = { x: currentPlayerChunkX, z: currentPlayerChunkZ };

    const newRequiredChunks = new Set<string>();
    for (let dx = -VIEW_DISTANCE_CHUNKS; dx <= VIEW_DISTANCE_CHUNKS; dx++) {
      for (let dz = -VIEW_DISTANCE_CHUNKS; dz <= VIEW_DISTANCE_CHUNKS; dz++) {
        newRequiredChunks.add(`${currentPlayerChunkX + dx},${currentPlayerChunkZ + dz}`);
      }
    }

    // Unload old chunks
    const chunksToRemoveKeys: string[] = [];
    loadedChunksRef.current.forEach((_, chunkKey) => {
      if (!newRequiredChunks.has(chunkKey)) {
        chunksToRemoveKeys.push(chunkKey);
      }
    });

    chunksToRemoveKeys.forEach(chunkKey => {
      const chunkData = loadedChunksRef.current.get(chunkKey);
      if (chunkData) {
        chunkData.meshes.forEach(mesh => {
          sceneRef.current?.remove(mesh);
          mesh.dispose(); // Dispose geometry and material if unique
        });
        loadedChunksRef.current.delete(chunkKey);
      }
    });

    // Load new chunks
    newRequiredChunks.forEach(chunkKey => {
      if (!loadedChunksRef.current.has(chunkKey)) {
        const [loadChunkX, loadChunkZ] = chunkKey.split(',').map(Number);
        const newChunkData = generateChunk(loadChunkX, loadChunkZ);
        if (newChunkData) {
          newChunkData.meshes.forEach(mesh => sceneRef.current?.add(mesh));
          loadedChunksRef.current.set(chunkKey, newChunkData);
        }
      }
    });
    initialChunksLoadedRef.current = true;
  }, [generateChunk]);

  const handleCanvasMouseDown = useCallback((event: MouseEvent) => {
    if (isPausedRef.current || !isUsingFallbackControlsRef.current || !rendererRef.current?.domElement) return;
    if (event.target === rendererRef.current.domElement) {
      isDraggingRef.current = true;
      previousMousePositionRef.current = { x: event.clientX, y: event.clientY };
      event.preventDefault(); // Prevent text selection or other default drag behaviors
    }
  }, []);

  const handleDocumentMouseMove = useCallback((event: MouseEvent) => {
    if (isPausedRef.current || !isDraggingRef.current || !isUsingFallbackControlsRef.current || !cameraRef.current) return;

    const movementX = event.clientX - previousMousePositionRef.current.x;
    const movementY = event.clientY - previousMousePositionRef.current.y;

    const camera = cameraRef.current;
    // Simple Euler angle manipulation for fallback controls
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.setFromQuaternion(camera.quaternion);

    euler.y -= movementX * 0.0025; // Adjust sensitivity as needed
    euler.x -= movementY * 0.0025;

    // Clamp vertical rotation
    const PI_2 = Math.PI / 2;
    euler.x = Math.max(-PI_2 + 0.01, Math.min(PI_2 - 0.01, euler.x)); // Avoid gimbal lock

    camera.quaternion.setFromEuler(euler);
    previousMousePositionRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handleDocumentMouseUp = useCallback(() => {
    if (!isUsingFallbackControlsRef.current) return;
    isDraggingRef.current = false;
  }, []);

  const createCloudSegment = useCallback(() => {
    const segment = new THREE.Mesh(cloudSegmentGeometry, materials.cloud);
    const scaleVariation = 0.5 + Math.random(); // Vary segment size
    segment.scale.set(scaleVariation, 0.5 + Math.random() * 0.5, scaleVariation);
    segment.castShadow = true; // Clouds can cast soft shadows if desired
    segment.receiveShadow = true;
    return segment;
  }, []);

  const createCloud = useCallback(() => {
    const cloud = new THREE.Group();
    const numSegments = MIN_SEGMENTS_PER_CLOUD + Math.floor(Math.random() * (MAX_SEGMENTS_PER_CLOUD - MIN_SEGMENTS_PER_CLOUD + 1));
    let currentX = 0;
    let currentZ = 0;
    for (let i = 0; i < numSegments; i++) {
        const segment = createCloudSegment();
        // Position segments relative to each other to form a cloud cluster
        segment.position.set(currentX, (Math.random() - 0.5) * CLOUD_SEGMENT_THICKNESS * 2, currentZ);
        cloud.add(segment);
        // Offset next segment randomly
        currentX += (Math.random() - 0.5) * CLOUD_SEGMENT_BASE_SIZE * 1.5;
        currentZ += (Math.random() - 0.5) * CLOUD_SEGMENT_BASE_SIZE * 1.5;
    }
    return cloud;
  }, [createCloudSegment]);


  useEffect(() => {
    if (!mountRef.current) return;
    const currentMount = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Light sky blue
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 2.5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Increased ambient light
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8); // Stronger sunlight
    sunLight.position.set(50, 100, 75); // Default position
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048; // Shadow map resolution
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 3; // Adjust far plane based on view distance
    // Adjust shadow camera frustum to cover visible area
    const shadowCamSize = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 1.5;
    sunLight.shadow.camera.left = -shadowCamSize;
    sunLight.shadow.camera.right = shadowCamSize;
    sunLight.shadow.camera.top = shadowCamSize;
    sunLight.shadow.camera.bottom = -shadowCamSize;
    scene.add(sunLight);
    scene.add(sunLight.target); // Target for the directional light

    // Skybox using THREE.Sky
    const sky = new Sky();
    sky.scale.setScalar(SKY_RADIUS); // Large scale for sky dome
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;

    // Position sun in sky and link to light
    sunPositionVecRef.current.setFromSphericalCoords(1, Math.PI / 2 - 0.45, Math.PI * 0.35); // Mid-morning/afternoon angle
    skyUniforms['sunPosition'].value.copy(sunPositionVecRef.current);
    sunLight.position.copy(sunPositionVecRef.current.clone().multiplyScalar(150)); // Place light source far away along this vector
    sunLight.target.position.set(0,0,0); // Light aims at origin

    // Square Sun Mesh
    const sunGeometry = new THREE.PlaneGeometry(SUN_SIZE, SUN_SIZE);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFBC1, side: THREE.DoubleSide, fog: false }); // Bright yellow, no fog
    sunMeshRef.current = new THREE.Mesh(sunGeometry, sunMaterial);
    sunMeshRef.current.position.copy(sunPositionVecRef.current.clone().multiplyScalar(SKY_RADIUS * 0.8)); // Position sun on sky dome
    sunMeshRef.current.lookAt(new THREE.Vector3(0,0,0)); // Sun faces origin
    scene.add(sunMeshRef.current);

    // Clouds
    cloudsGroupRef.current = new THREE.Group();
    for (let i = 0; i < NUM_CLOUDS; i++) {
        const cloud = createCloud();
        // Random initial positions for clouds
        cloud.position.set(
            (Math.random() - 0.5) * CLOUD_AREA_SPREAD,
            CLOUD_ALTITUDE_MIN + Math.random() * (CLOUD_ALTITUDE_MAX - CLOUD_ALTITUDE_MIN),
            (Math.random() - 0.5) * CLOUD_AREA_SPREAD
        );
        cloudsGroupRef.current.add(cloud);
    }
    scene.add(cloudsGroupRef.current);

    // Initial player position and chunk loading
    // Spawn player near origin, slightly randomized within the first chunk
    camera.position.x = (Math.random() * CHUNK_WIDTH / 4 - CHUNK_WIDTH / 8) * BLOCK_SIZE;
    camera.position.z = (Math.random() * CHUNK_DEPTH / 4 - CHUNK_DEPTH / 8) * BLOCK_SIZE;

    updateChunks(); // Load initial chunks around the player
    const initialGroundY = getPlayerGroundHeight(camera.position.x, camera.position.z);
    if (initialGroundY > -Infinity) {
        camera.position.y = initialGroundY + PLAYER_HEIGHT - (BLOCK_SIZE / 2); // Place player on ground
    } else {
        // Fallback if ground height isn't found (e.g., during initial load issues)
        camera.position.y = PLAYER_HEIGHT + 20 * BLOCK_SIZE; // Start high up
    }

    // Pointer Lock Controls
    const controls = new PointerLockControls(camera, renderer.domElement);
    controlsRef.current = controls;
    scene.add(controls.getObject()); // Add camera to scene via controls

    // Event Listeners
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPausedRef.current && event.code !== 'Escape') return; // Ignore input if paused (except Esc)
      switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward.current = true; break;
        case 'ArrowLeft': case 'KeyA': moveLeft.current = true; break;
        case 'ArrowDown': case 'KeyS': moveBackward.current = true; break;
        case 'ArrowRight': case 'KeyD': moveRight.current = true; break;
        case 'Space': if (canJump.current && onGround.current) playerVelocity.current.y = JUMP_VELOCITY; break;
        case 'Escape':
           if (!isPausedRef.current) { // If game is running
             if (controlsRef.current?.isLocked) controlsRef.current.unlock(); // Unlock pointer if locked
             else setIsPaused(true); // Otherwise, pause (e.g., if using fallback controls)
           } else if (isPausedRef.current && (pointerLockError || isPointerLockUnavailable)) {
            // If paused due to error, Esc shows help/error screen again
            setShowHelp(true);
           } else {
            // If paused normally, Esc resumes the game
            startGame();
           }
          break;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward.current = false; break;
        case 'ArrowLeft': case 'KeyA': moveLeft.current = false; break;
        case 'ArrowDown': case 'KeyS': moveBackward.current = false; break;
        case 'ArrowRight': case 'KeyD': moveRight.current = false; break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Handle pointer lock events
    const onControlsLock = () => {
      setIsPaused(false); setShowHelp(false); setPointerLockError(null);
      setIsPointerLockUnavailable(false); isUsingFallbackControlsRef.current = false;
      // Remove fallback mouse listeners if pointer lock succeeds
      if (rendererRef.current?.domElement) {
        rendererRef.current.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);
        document.removeEventListener('mouseleave', handleDocumentMouseUp); // Handle mouse leaving canvas
      }
    };
    const onControlsUnlock = () => {
      setIsPaused(true);
      // If unlock was not due to an error, show normal pause/help screen
      if (!pointerLockError && !isPointerLockUnavailable) setShowHelp(true);
    };
    controls.addEventListener('lock', onControlsLock);
    controls.addEventListener('unlock', onControlsUnlock);

    // Handle window resize
    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    const clock = new THREE.Clock();
    let animationFrameId: number;

    // Animation Loop
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      updateChunks(); // Check and update chunks based on player position

      // Animate clouds
      if (cloudsGroupRef.current && cameraRef.current) {
          // Keep the cloud field centered on the player horizontally
          cloudsGroupRef.current.position.x = cameraRef.current.position.x;
          cloudsGroupRef.current.position.z = cameraRef.current.position.z;

          cloudsGroupRef.current.children.forEach(cloud => {
              // Move cloud
              cloud.position.x += CLOUD_SPEED * delta;
              // Wrap cloud around if it goes too far
              if (cloud.position.x > CLOUD_AREA_SPREAD / 2) {
                  cloud.position.x = -CLOUD_AREA_SPREAD / 2;
                  // Optionally re-randomize Z and Y for variety when wrapping
                  cloud.position.z = (Math.random() - 0.5) * CLOUD_AREA_SPREAD;
                  cloud.position.y = CLOUD_ALTITUDE_MIN + Math.random() * (CLOUD_ALTITUDE_MAX - CLOUD_ALTITUDE_MIN);
              }
          });
      }

      // Player physics and movement (only if not paused or if using fallback controls that allow movement while "paused")
      if (cameraRef.current && sceneRef.current && (!isPausedRef.current || isUsingFallbackControlsRef.current)) {
        const cam = cameraRef.current;

        // Apply gravity
        playerVelocity.current.y += GRAVITY * delta;
        cam.position.y += playerVelocity.current.y * delta;

        // Ground collision (vertical)
        const groundSurfaceY = getPlayerGroundHeight(cam.position.x, cam.position.z);
        const playerFeetY = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2); // Bottom of player capsule

        if (playerFeetY < groundSurfaceY + COLLISION_TOLERANCE) { // Landed on or slightly below ground
          cam.position.y = groundSurfaceY + PLAYER_HEIGHT - (BLOCK_SIZE / 2); // Correct position to be on ground
          playerVelocity.current.y = 0;
          onGround.current = true;
          canJump.current = true;
        } else {
          onGround.current = false;
        }

        // Movement
        const moveSpeed = PLAYER_SPEED * (onGround.current ? 1 : 0.9) * delta; // Slower air control
        const moveDirection = new THREE.Vector3();

        // Get camera's forward and right vectors, projected onto XZ plane
        const forwardVector = new THREE.Vector3();
        cam.getWorldDirection(forwardVector);
        const cameraDirectionXZ = new THREE.Vector3(forwardVector.x, 0, forwardVector.z).normalize();
        const rightVectorXZ = new THREE.Vector3().crossVectors(cameraDirectionXZ, sceneRef.current.up).normalize();


        if (moveForward.current) moveDirection.add(cameraDirectionXZ);
        if (moveBackward.current) moveDirection.sub(cameraDirectionXZ);
        if (moveLeft.current) moveDirection.sub(rightVectorXZ); // Corrected: sub for left
        if (moveRight.current) moveDirection.add(rightVectorXZ); // Corrected: add for right


        if (moveDirection.lengthSq() > 0) { // If there's movement input
            moveDirection.normalize();
            const oldPosition = cam.position.clone();
            cam.position.addScaledVector(moveDirection, moveSpeed);

            // Horizontal Collision (simplified: check if new position is inside a "wall")
            // A "wall" is defined as a terrain column significantly higher than player's feet but below player's head
            const currentPlayerFeetAbsY = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2); // Recalculate after potential Y correction by gravity
            const playerHeadAbsY = cam.position.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE; // Top of player head
            const targetBlockWorldX = cam.position.x;
            const targetBlockWorldZ = cam.position.z;

            const collisionColumnSurfaceY = getPlayerGroundHeight(targetBlockWorldX, targetBlockWorldZ); // Top surface of terrain at new XZ
            const blockTopAbsY = collisionColumnSurfaceY; // Top of the potential obstacle block
            const blockBottomAbsY = collisionColumnSurfaceY - BLOCK_SIZE; // Bottom of the potential obstacle block (assuming 1 block high obstacle for simplicity)


            // Check if player is trying to move into a block horizontally
            // Player's feet must be below the top of the obstacle AND player's head must be above the bottom of the obstacle
            if (currentPlayerFeetAbsY < (blockTopAbsY - COLLISION_TOLERANCE) &&
                playerHeadAbsY > (blockBottomAbsY + COLLISION_TOLERANCE)) {
                        // More precise collision check (slide along walls)
                        const playerMinX = cam.position.x - 0.3 * BLOCK_SIZE; // Player's bounding box
                        const playerMaxX = cam.position.x + 0.3 * BLOCK_SIZE;
                        const playerMinZ = cam.position.z - 0.3 * BLOCK_SIZE;
                        const playerMaxZ = cam.position.z + 0.3 * BLOCK_SIZE;

                        // Consider the block at the target position
                        const obstacleBlockCenterWorldX = Math.round(targetBlockWorldX / BLOCK_SIZE) * BLOCK_SIZE;
                        const obstacleBlockCenterWorldZ = Math.round(targetBlockWorldZ / BLOCK_SIZE) * BLOCK_SIZE;
                        const blockMinX = obstacleBlockCenterWorldX - BLOCK_SIZE / 2;
                        const blockMaxX = obstacleBlockCenterWorldX + BLOCK_SIZE / 2;
                        const blockMinZ = obstacleBlockCenterWorldZ - BLOCK_SIZE / 2;
                        const blockMaxZ = obstacleBlockCenterWorldZ + BLOCK_SIZE / 2;

                        // Basic AABB collision check with the specific block column
                        if (playerMaxX > blockMinX && playerMinX < blockMaxX &&
                            playerMaxZ > blockMinZ && playerMinZ < blockMaxZ) {

                            // Attempt to slide by trying X and Z movement separately
                            let hitX = false, hitZ = false;

                            // Try moving only along Z
                            const tempPosCheck = cam.position.clone();
                            tempPosCheck.x = oldPosition.x; // Keep old X
                            tempPosCheck.z = cam.position.z;  // New Z
                            const feetAtZMove = tempPosCheck.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                            const headAtZMove = tempPosCheck.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                            const heightAtZMove = getPlayerGroundHeight(tempPosCheck.x, tempPosCheck.z);
                            const zMoveBlockTop = heightAtZMove;
                            const zMoveBlockBottom = heightAtZMove - BLOCK_SIZE;
                            // If moving only along Z doesn't cause a collision with that column's height
                            if (!(feetAtZMove < (zMoveBlockTop - COLLISION_TOLERANCE) && headAtZMove > (zMoveBlockBottom + COLLISION_TOLERANCE))) {
                                // No collision on Z-only move, so the original X move must have caused it
                            } else {
                               // Collision even with Z-only move, means X move was potentially problematic
                               const heightAtXOnly = getPlayerGroundHeight(cam.position.x, oldPosition.z); // Check original X, new Z
                               const feetAtXOnly = oldPosition.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2); // Use old Y for this hypothetical check
                               const headAtXOnly = oldPosition.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                               if(feetAtXOnly < (heightAtXOnly - COLLISION_TOLERANCE) && headAtXOnly > (heightAtXOnly - BLOCK_SIZE + COLLISION_TOLERANCE)) {
                                   hitX = true; // Original X move was problematic
                               }
                            }

                            // Try moving only along X
                            tempPosCheck.x = cam.position.x;  // New X
                            tempPosCheck.z = oldPosition.z; // Keep old Z
                            const feetAtXMove = tempPosCheck.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                            const headAtXMove = tempPosCheck.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                            const heightAtXMove = getPlayerGroundHeight(tempPosCheck.x, tempPosCheck.z);
                            const xMoveBlockTop = heightAtXMove;
                            const xMoveBlockBottom = heightAtXMove - BLOCK_SIZE;
                            if (!(feetAtXMove < (xMoveBlockTop - COLLISION_TOLERANCE) && headAtXMove > (xMoveBlockBottom + COLLISION_TOLERANCE))) {
                                // No collision on X-only move
                            } else {
                               const heightAtZOnly = getPlayerGroundHeight(oldPosition.x, cam.position.z); // Check original Z, new X
                               const feetAtZOnly = oldPosition.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                               const headAtZOnly = oldPosition.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                               if(feetAtZOnly < (heightAtZOnly - COLLISION_TOLERANCE) && headAtZOnly > (heightAtZOnly - BLOCK_SIZE + COLLISION_TOLERANCE)) {
                                hitZ = true; // Original Z move was problematic
                               }
                            }

                            if (hitX && !hitZ) { cam.position.x = oldPosition.x; } // Only X was bad, revert X
                            else if (hitZ && !hitX) { cam.position.z = oldPosition.z; } // Only Z was bad, revert Z
                            else if (hitX && hitZ) { cam.position.set(oldPosition.x, cam.position.y, oldPosition.z); } // Both bad, revert both

                            // Final check: if after sliding, we are still in a wall, revert fully.
                            // This can happen if sliding puts player into another wall corner.
                            const finalCollisionCheckHeight = getPlayerGroundHeight(cam.position.x, cam.position.z);
                            const finalPlayerFeet = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                            const finalPlayerHead = cam.position.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;

                            if (finalPlayerFeet < (finalCollisionCheckHeight - COLLISION_TOLERANCE) &&
                                finalPlayerHead > (finalCollisionCheckHeight - BLOCK_SIZE + COLLISION_TOLERANCE)) {
                                cam.position.set(oldPosition.x, cam.position.y, oldPosition.z); // Revert to pre-move Y
                            }
                        }
                }
        }
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', handleResize);
      controlsRef.current?.removeEventListener('lock', onControlsLock);
      controlsRef.current?.removeEventListener('unlock', onControlsUnlock);
      controlsRef.current?.disconnect(); // Important for PointerLockControls
      if (currentMount && rendererRef.current?.domElement) {
        currentMount.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
      sky?.material.dispose(); // Dispose Sky material
      woodTexture.dispose();
      leafTexture.dispose();
      if (sunMeshRef.current) {
        sunMeshRef.current.geometry.dispose();
        if (Array.isArray(sunMeshRef.current.material)) { sunMeshRef.current.material.forEach(m => m.dispose());}
        else { sunMeshRef.current.material.dispose(); }
      }
      if (cloudsGroupRef.current) {
        cloudsGroupRef.current.children.forEach(cloud => {
            if (cloud instanceof THREE.Group) {
                cloud.children.forEach(segment => { if (segment instanceof THREE.Mesh) { segment.geometry.dispose(); /* material is shared */ } });
            }
        });
      }
      cloudSegmentGeometry.dispose(); // Dispose shared cloud segment geometry
      // Dispose materials (ensure maps are also disposed if they are not shared and disposed elsewhere)
      Object.values(materials).forEach(mat => {
        if (Array.isArray(mat)) { mat.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });} // Handle material arrays
        else { if (mat.map && mat.map !== woodTexture && mat.map !== leafTexture) mat.map.dispose(); mat.dispose(); }
      });
      blockGeometry.dispose(); // Dispose shared block geometry
      // Dispose instanced meshes in loaded chunks
      loadedChunksRef.current.forEach(chunkData => { chunkData.meshes.forEach(mesh => { /* mesh.dispose() called during unload */ }); });
      loadedChunksRef.current.clear();
      // Clean up scene children more thoroughly
      if (sceneRef.current) { while(sceneRef.current.children.length > 0){ const obj = sceneRef.current.children[0]; sceneRef.current.remove(obj); /* further disposal if obj has geometry/material might be needed if not shared */ } }

      // Remove fallback mouse listeners if they were added
      rendererRef.current?.domElement?.removeEventListener('mousedown', handleCanvasMouseDown);
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('mouseleave', handleDocumentMouseUp);
    };
  }, [getPlayerGroundHeight, updateChunks, generateChunk, createCloud, createCloudSegment, handleCanvasMouseDown, handleDocumentMouseMove, handleDocumentMouseUp]); // Added fallback control handlers to dependencies

  const startGame = () => {
    setPointerLockError(null); setIsPointerLockUnavailable(false);
    // Ensure fallback listeners are removed if we're trying standard pointer lock
    if (rendererRef.current?.domElement && isUsingFallbackControlsRef.current) {
      rendererRef.current.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('mouseleave', handleDocumentMouseUp);
    }
    isUsingFallbackControlsRef.current = false; // Assume standard lock will work

    if (controlsRef.current && rendererRef.current?.domElement) {
      // Try to focus the canvas first, can sometimes help.
      rendererRef.current.domElement.setAttribute('tabindex', '-1'); // Make it focusable
      rendererRef.current.domElement.focus();
      try {
        controlsRef.current.lock();
        // 'lock' event will set isPaused=false, showHelp=false
      } catch (e: any) {
        console.error("Pointer lock request failed. Original error:", e);
        let friendlyMessage = "Error: Could not lock the mouse pointer.\n\n";
        // Check for specific error messages related to sandboxing or API unavailability
        if (e && e.message && (e.message.includes("sandboxed") || e.message.includes("allow-pointer-lock") || e.name === 'NotSupportedError' || e.message.includes("Pointer Lock API is not available") || e.message.includes("denied") || e.message.includes("not focused"))) {
          friendlyMessage += "This often happens in restricted environments (like iframes without 'allow-pointer-lock' permission) or if the document isn't focused.\nSwitched to **Click & Drag** to look around.\nMove: WASD, Jump: Space.\n\nFor the full experience, try opening the game in a new browser tab or ensuring the game window is active.";
          setPointerLockError(friendlyMessage);
          setIsPointerLockUnavailable(true); // Indicate standard pointer lock is not working
          isUsingFallbackControlsRef.current = true; // Enable fallback controls
          // Add event listeners for fallback controls
          rendererRef.current?.domElement.addEventListener('mousedown', handleCanvasMouseDown);
          document.addEventListener('mousemove', handleDocumentMouseMove);
          document.addEventListener('mouseup', handleDocumentMouseUp);
          document.addEventListener('mouseleave', handleDocumentMouseUp); // Also handle mouse leaving the canvas
          setIsPaused(false); setShowHelp(false); // "Start" the game with fallback
        } else {
          // Generic error
          friendlyMessage += "Common reasons: browser/iframe restrictions, document not focused, or browser settings.\n";
          friendlyMessage += `Details: "${e.message || 'Unknown error'}"\n\n(A 'THREE.PointerLockControls: Unable to use Pointer Lock API.' message may also appear in the browser's console if the API itself is unavailable.)`;
          setPointerLockError(friendlyMessage); setIsPaused(true); // Keep game paused on generic error
        }
      }
    } else {
      setPointerLockError("Game components are not ready. Please try reloading."); setIsPaused(true);
    }
  };

  const gameTitle = "Block Explorer";
  const buttonTextStart = "Start Exploring";
  const buttonTextResume = isUsingFallbackControlsRef.current ? "Resume (Click & Drag)" : "Resume Exploring";

  return (
    <div ref={mountRef} className="h-full w-full relative">
      {isPaused && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm z-10 p-4">
          {/* UI for when fallback controls are active due to pointer lock unavailability */}
          {isPointerLockUnavailable ? (
            <Card className="w-full max-w-lg bg-card/90 shadow-xl">
              <CardHeader><CardTitle className="flex items-center text-primary"><Mouse className="mr-2 h-6 w-6" /> Fallback Controls Active</CardTitle></CardHeader>
              <CardContent>
                <p className="text-card-foreground/90 mb-3 whitespace-pre-line">{pointerLockError || "Mouse pointer lock is unavailable. Using alternative controls:"}</p>
                <ul className="list-disc list-inside space-y-1 mb-4 text-card-foreground/80">
                  <li><strong>Look:</strong> Click and Drag Mouse on game screen</li>
                  <li><strong>Move:</strong> WASD or Arrow Keys</li><li><strong>Jump:</strong> Spacebar</li><li><strong>Pause/Unpause:</strong> ESC key (may show this menu again)</li>
                </ul>
                <p className="text-sm text-muted-foreground mb-3">For the best experience with pointer lock, try opening the game in a new browser tab.</p>
                <Button onClick={() => { setIsPaused(false); setShowHelp(false);}} size="lg" className="w-full"><Play className="mr-2 h-5 w-5" /> {buttonTextResume}</Button>
              </CardContent>
            </Card>
          ) : pointerLockError ? (
            // UI for when there's a pointer lock error, but fallback is not yet (or won't be) activated
            <Card className="w-full max-w-lg bg-card/90 shadow-xl">
              <CardHeader><CardTitle className="flex items-center text-destructive"><AlertCircle className="mr-2 h-6 w-6" /> Pointer Lock Issue</CardTitle></CardHeader>
              <CardContent>
                <p className="text-destructive-foreground/90 mb-4 whitespace-pre-line">{pointerLockError}</p>
                <Button onClick={startGame} size="lg" className="w-full"><Play className="mr-2 h-5 w-5" /> Try Again</Button>
                 <p className="mt-3 text-sm text-muted-foreground">If issues persist, ensure the game window is focused or try opening it in a new browser tab.</p>
              </CardContent>
            </Card>
          ) : (
            // Standard pause menu / initial start screen
            <>
              <h1 className="text-5xl font-bold text-primary mb-4">{gameTitle}</h1>
              <Button onClick={startGame} size="lg" className="mb-4"><Play className="mr-2 h-5 w-5" /> {showHelp ? buttonTextStart : buttonTextResume}</Button>
              {showHelp && (
                 <Card className="w-full max-w-md bg-card/80 shadow-xl">
                  <CardHeader><CardTitle className="flex items-center text-card-foreground"><HelpCircle className="mr-2 h-6 w-6 text-accent" /> How to Play</CardTitle></CardHeader>
                  <CardContent className="text-card-foreground/90">
                    <ul className="list-disc list-inside space-y-1">
                      <li><strong>Move:</strong> WASD or Arrow Keys</li><li><strong>Look:</strong> Mouse (after clicking start)</li>
                      <li><strong>Jump:</strong> Spacebar</li><li><strong>Pause/Unpause:</strong> ESC key</li>
                    </ul>
                    <p className="mt-3 text-sm">Click "{showHelp ? buttonTextStart : buttonTextResume}" to lock mouse pointer and begin.</p>
                  </CardContent>
                </Card>
              )}
              {!showHelp && <p className="text-muted-foreground">Game Paused. Press ESC or click resume.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default BlockExplorerGame;
    

    