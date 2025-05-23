
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
const COLLISION_TOLERANCE = 1e-3;

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


// Function to create a procedural wood texture
function createWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32; 
  canvas.height = 64; 
  const context = canvas.getContext('2d')!;

  const baseColor = '#A0522D'; 
  const grainColorDark = '#835434'; 
  const grainColorLight = '#B97A57'; 

  context.fillStyle = baseColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.lineWidth = 1.5;
  const numLines = 5; 

  for (let i = 0; i < numLines; i++) {
    const baseX = (canvas.width / (numLines + 0.5)) * (i + 0.5) + (Math.random() - 0.5) * 4;
    
    context.strokeStyle = grainColorDark;
    context.beginPath();
    context.moveTo(baseX + (Math.random() - 0.5) * 2, 0); 
    context.lineTo(baseX + (Math.random() - 0.5) * 5, canvas.height); 
    context.stroke();

    context.strokeStyle = grainColorLight;
    context.beginPath();
    context.moveTo(baseX + 1.5 + (Math.random() - 0.5) * 2, 0); 
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

  const baseLeafColor = '#2E8B57'; 
  const darkerLeafColor = '#228B22'; 
  const highlightLeafColor = '#3CB371';

  context.fillStyle = baseLeafColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const numSplotches = 20;
  for (let i = 0; i < numSplotches; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 3 + 2; 
    context.fillStyle = i % 2 === 0 ? darkerLeafColor : highlightLeafColor;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2, true);
    context.fill();
  }
  
  const numHighlights = 5;
   for (let i = 0; i < numHighlights; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 1 + 0.5;
    context.fillStyle = '#90EE90'; 
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
    transparent: true, 
    alphaTest: 0.1, 
    side: THREE.DoubleSide, 
  }),
  cloud: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
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
      grass: [], dirt: [], wood: [], leaves: [],
    };

    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_DEPTH; z++) {
        const globalNoiseX = chunkX * CHUNK_WIDTH + x;
        const globalNoiseZ = chunkZ * CHUNK_DEPTH + z;

        let terrainLevel = Math.floor(noise.noise(globalNoiseX / 20, globalNoiseZ / 20, 0) * 5 + 8);
        terrainLevel += Math.floor(noise.noise(globalNoiseX / 10, globalNoiseZ / 10, 0.5) * 3);
        terrainLevel = Math.max(1, terrainLevel); 

        chunkTerrainHeights[x][z] = (terrainLevel -1) * BLOCK_SIZE + (BLOCK_SIZE / 2); 

        const worldXPos = (chunkX * CHUNK_WIDTH + x) * BLOCK_SIZE;
        const worldZPos = (chunkZ * CHUNK_DEPTH + z) * BLOCK_SIZE;

        for (let yIdx = 0; yIdx < terrainLevel; yIdx++) { 
          const blockCenterY = yIdx * BLOCK_SIZE; 
          const matrix = new THREE.Matrix4().setPosition(worldXPos, blockCenterY, worldZPos);
          if (yIdx >= terrainLevel - GRASS_LAYER_DEPTH) {
            blockInstances.grass.push(matrix);
          } else {
            blockInstances.dirt.push(matrix);
          }
        }
      }
    }
    
    const treeCount = Math.floor(CHUNK_WIDTH * CHUNK_DEPTH * 0.015); 
    for (let i = 0; i < treeCount; i++) {
      const treeLocalX = Math.floor(Math.random() * CHUNK_WIDTH);
      const treeLocalZ = Math.floor(Math.random() * CHUNK_DEPTH);
      
      const groundSurfaceY = chunkTerrainHeights[treeLocalX]?.[treeLocalZ]; 
      if (groundSurfaceY === undefined || groundSurfaceY <= -Infinity + BLOCK_SIZE / 2) continue;

      const firstTrunkBlockCenterY = groundSurfaceY + (BLOCK_SIZE / 2);

      if (firstTrunkBlockCenterY - (BLOCK_SIZE / 2) > -Infinity) { 
        const treeHeight = Math.floor(Math.random() * 3) + 4; 
        
        const worldTreeRootX = (chunkX * CHUNK_WIDTH + treeLocalX) * BLOCK_SIZE;
        const worldTreeRootZ = (chunkZ * CHUNK_DEPTH + treeLocalZ) * BLOCK_SIZE;

        for (let h = 0; h < treeHeight; h++) {
          const trunkBlockCenterY = firstTrunkBlockCenterY + (h * BLOCK_SIZE);
          blockInstances.wood.push(new THREE.Matrix4().setPosition(worldTreeRootX, trunkBlockCenterY, worldTreeRootZ));
        }

        const topTrunkY = firstTrunkBlockCenterY + ((treeHeight -1) * BLOCK_SIZE);
        const canopyBaseY = topTrunkY + BLOCK_SIZE;

        for (let lyOffset = 0; lyOffset < 2; lyOffset++) {
          const currentLayerY = canopyBaseY + lyOffset * BLOCK_SIZE;
          for (let lx = -2; lx <= 2; lx++) {
            for (let lz = -2; lz <= 2; lz++) {
              if (lyOffset === 0 && lx === 0 && lz === 0) continue; 
              
              if (Math.abs(lx) === 2 && Math.abs(lz) === 2) { 
                if (Math.random() < 0.6) continue; 
              } else if (Math.abs(lx) === 2 || Math.abs(lz) === 2) { 
                if (Math.random() < 0.25) continue; 
              }
              
              blockInstances.leaves.push(new THREE.Matrix4().setPosition(worldTreeRootX + lx * BLOCK_SIZE, currentLayerY, worldTreeRootZ + lz * BLOCK_SIZE));
            }
          }
        }

        const topCapY = canopyBaseY + 2 * BLOCK_SIZE;
        for (let lx = -1; lx <= 1; lx++) {
          for (let lz = -1; lz <= 1; lz++) {
             if (Math.abs(lx) === 1 && Math.abs(lz) === 1) { 
                if (Math.random() < 0.4) continue; 
             }
            blockInstances.leaves.push(new THREE.Matrix4().setPosition(worldTreeRootX + lx * BLOCK_SIZE, topCapY, worldTreeRootZ + lz * BLOCK_SIZE));
          }
        }
        
        if (Math.random() < 0.75) {
            blockInstances.leaves.push(new THREE.Matrix4().setPosition(worldTreeRootX, topCapY + BLOCK_SIZE, worldTreeRootZ));
        }

        const outreachLeafPositions = [
            { x: 2, y: 0, z: 0, p: 0.7 }, { x: -2, y: 0, z: 0, p: 0.7 },
            { x: 0, y: 0, z: 2, p: 0.7 }, { x: 0, y: 0, z: -2, p: 0.7 },
            { x: 1, y: 0, z: 2, p: 0.5 }, { x: 1, y: 0, z: -2, p: 0.5 },
            { x: -1, y: 0, z: 2, p: 0.5 }, { x: -1, y: 0, z: -2, p: 0.5 },
            { x: 2, y: 0, z: 1, p: 0.5 }, { x: 2, y: 0, z: -1, p: 0.5 },
            { x: -2, y: 0, z: 1, p: 0.5 }, { x: -2, y: 0, z: -1, p: 0.5 },
            { x: 2, y: 1, z: 0, p: 0.6 }, { x: -2, y: 1, z: 0, p: 0.6 },
            { x: 0, y: 1, z: 2, p: 0.6 }, { x: 0, y: 1, z: -2, p: 0.6 },
            { x: 1, y: 1, z: 1, p: 0.3 }, { x: 1, y: 1, z: -1, p: 0.3 }, 
            { x: -1, y: 1, z: 1, p: 0.3 }, { x: -1, y: 1, z: -1, p: 0.3 },
        ];

        for (const pos of outreachLeafPositions) {
            if (Math.random() < pos.p) {
                blockInstances.leaves.push(new THREE.Matrix4().setPosition(
                    worldTreeRootX + pos.x * BLOCK_SIZE,
                    canopyBaseY + pos.y * BLOCK_SIZE,
                    worldTreeRootZ + pos.z * BLOCK_SIZE
                ));
            }
        }
      }
    }

    const instancedMeshes: THREE.InstancedMesh[] = [];
    Object.entries(blockInstances).forEach(([type, matrices]) => {
      if (matrices.length > 0) {
        let currentMaterial: THREE.Material | THREE.Material[];
        if (type === 'grass') {
          currentMaterial = [
            materials.dirt, materials.dirt, 
            materials.grass, 
            materials.dirt, 
            materials.dirt, materials.dirt, 
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
    localX = (localX % CHUNK_WIDTH + CHUNK_WIDTH) % CHUNK_WIDTH; 
    localZ = (localZ % CHUNK_DEPTH + CHUNK_DEPTH) % CHUNK_DEPTH; 
    
    const height = chunkData.terrainHeights[localX]?.[localZ];
    return height === undefined ? -Infinity : height; 
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
      return; 
    }
    
    currentChunkCoordsRef.current = { x: currentPlayerChunkX, z: currentPlayerChunkZ };

    const newRequiredChunks = new Set<string>();
    for (let dx = -VIEW_DISTANCE_CHUNKS; dx <= VIEW_DISTANCE_CHUNKS; dx++) {
      for (let dz = -VIEW_DISTANCE_CHUNKS; dz <= VIEW_DISTANCE_CHUNKS; dz++) {
        newRequiredChunks.add(`${currentPlayerChunkX + dx},${currentPlayerChunkZ + dz}`);
      }
    }

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
          mesh.dispose(); 
        });
        loadedChunksRef.current.delete(chunkKey);
      }
    });
    
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
      event.preventDefault();
    }
  }, []);

  const handleDocumentMouseMove = useCallback((event: MouseEvent) => {
    if (isPausedRef.current || !isDraggingRef.current || !isUsingFallbackControlsRef.current || !cameraRef.current) return;
    
    const movementX = event.clientX - previousMousePositionRef.current.x;
    const movementY = event.clientY - previousMousePositionRef.current.y;
    
    const camera = cameraRef.current;
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.setFromQuaternion(camera.quaternion);

    euler.y -= movementX * 0.0025; 
    euler.x -= movementY * 0.0025; 

    const PI_2 = Math.PI / 2;
    euler.x = Math.max(-PI_2 + 0.01, Math.min(PI_2 - 0.01, euler.x)); 
    
    camera.quaternion.setFromEuler(euler);
    previousMousePositionRef.current = { x: event.clientX, y: event.clientY };
  }, []);
  
  const handleDocumentMouseUp = useCallback(() => {
    if (!isUsingFallbackControlsRef.current) return;
    isDraggingRef.current = false;
  }, []);

  // Cloud generation logic
  const createCloudSegment = useCallback(() => {
    const segment = new THREE.Mesh(cloudSegmentGeometry, materials.cloud);
    // Randomize segment size slightly
    const scaleVariation = 0.5 + Math.random(); // 0.5x to 1.5x
    segment.scale.set(
        scaleVariation,
        0.5 + Math.random() * 0.5, // flatter
        scaleVariation
    );
    segment.castShadow = true; // Clouds can cast subtle shadows
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
        segment.position.set(
            currentX,
            (Math.random() - 0.5) * CLOUD_SEGMENT_THICKNESS * 2, // Slight vertical variation
            currentZ
        );
        cloud.add(segment);

        // Move to next segment position (simple overlap for clumping)
        currentX += (Math.random() - 0.5) * CLOUD_SEGMENT_BASE_SIZE * 1.5;
        currentZ += (Math.random() - 0.5) * CLOUD_SEGMENT_BASE_SIZE * 1.5;
    }
    return cloud;
  }, [createCloudSegment]);


  useEffect(() => {
    if (!mountRef.current) return;
    const currentMount = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Brighter sky blue
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 2.5); // Increased far plane
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); 
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8); 
    sunLight.position.set(50, 100, 75); 
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 3; 
    const shadowCamSize = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 1.5; 
    sunLight.shadow.camera.left = -shadowCamSize;
    sunLight.shadow.camera.right = shadowCamSize;
    sunLight.shadow.camera.top = shadowCamSize;
    sunLight.shadow.camera.bottom = -shadowCamSize;
    scene.add(sunLight);
    scene.add(sunLight.target); 

    // Sky object (gradient)
    const sky = new Sky();
    sky.scale.setScalar(SKY_RADIUS);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;
    
    // Consistent sun position for Sky and our sun mesh
    sunPositionVecRef.current.setFromSphericalCoords(1, Math.PI / 2 - 0.45, Math.PI * 0.35); // Adjusted angle for more typical sun path
    skyUniforms['sunPosition'].value.copy(sunPositionVecRef.current);
    sunLight.position.copy(sunPositionVecRef.current.clone().multiplyScalar(150)); 
    sunLight.target.position.set(0,0,0);


    // Square Sun Mesh
    const sunGeometry = new THREE.PlaneGeometry(SUN_SIZE, SUN_SIZE);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFBC1, side: THREE.DoubleSide, fog: false }); // Slightly yellowish sun, no fog
    sunMeshRef.current = new THREE.Mesh(sunGeometry, sunMaterial);
    sunMeshRef.current.position.copy(sunPositionVecRef.current.clone().multiplyScalar(SKY_RADIUS * 0.8)); // Place it very far
    sunMeshRef.current.lookAt(new THREE.Vector3(0,0,0)); // Make it face the world origin
    scene.add(sunMeshRef.current);


    // Clouds
    cloudsGroupRef.current = new THREE.Group();
    for (let i = 0; i < NUM_CLOUDS; i++) {
        const cloud = createCloud();
        cloud.position.set(
            (Math.random() - 0.5) * CLOUD_AREA_SPREAD,
            CLOUD_ALTITUDE_MIN + Math.random() * (CLOUD_ALTITUDE_MAX - CLOUD_ALTITUDE_MIN),
            (Math.random() - 0.5) * CLOUD_AREA_SPREAD
        );
        cloudsGroupRef.current.add(cloud);
    }
    scene.add(cloudsGroupRef.current);


    camera.position.x = (Math.random() * CHUNK_WIDTH / 4 - CHUNK_WIDTH / 8) * BLOCK_SIZE;
    camera.position.z = (Math.random() * CHUNK_DEPTH / 4 - CHUNK_DEPTH / 8) * BLOCK_SIZE;
    
    updateChunks(); 
    const initialGroundY = getPlayerGroundHeight(camera.position.x, camera.position.z);
    if (initialGroundY > -Infinity) {
        camera.position.y = initialGroundY + PLAYER_HEIGHT - (BLOCK_SIZE / 2);
    } else {
        camera.position.y = PLAYER_HEIGHT + 20 * BLOCK_SIZE; 
    }

    const controls = new PointerLockControls(camera, renderer.domElement);
    controlsRef.current = controls;
    scene.add(controls.getObject()); 

    const onKeyDown = (event: KeyboardEvent) => {
      if (isPausedRef.current && event.code !== 'Escape') return;
      switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward.current = true; break;
        case 'ArrowLeft': case 'KeyA': moveLeft.current = true; break;
        case 'ArrowDown': case 'KeyS': moveBackward.current = true; break;
        case 'ArrowRight': case 'KeyD': moveRight.current = true; break;
        case 'Space': if (canJump.current && onGround.current) playerVelocity.current.y = JUMP_VELOCITY; break;
        case 'Escape':
           if (!isPausedRef.current) {
             if (controlsRef.current?.isLocked) controlsRef.current.unlock();
             else setIsPaused(true); 
           } else if (isPausedRef.current && (pointerLockError || isPointerLockUnavailable)) {
            setShowHelp(true); 
           } else {
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

    const onControlsLock = () => { 
      setIsPaused(false); setShowHelp(false); setPointerLockError(null);
      setIsPointerLockUnavailable(false); isUsingFallbackControlsRef.current = false;
      if (rendererRef.current?.domElement) { 
        rendererRef.current.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);
        document.removeEventListener('mouseleave', handleDocumentMouseUp);
      }
    };
    const onControlsUnlock = () => {
      setIsPaused(true);
      if (!pointerLockError && !isPointerLockUnavailable) setShowHelp(true);
    };
    controls.addEventListener('lock', onControlsLock);
    controls.addEventListener('unlock', onControlsUnlock);
    
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

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      updateChunks(); 

      // Cloud animation
      if (cloudsGroupRef.current) {
          cloudsGroupRef.current.children.forEach(cloud => {
              cloud.position.x += CLOUD_SPEED * delta;
              if (cloud.position.x > CLOUD_AREA_SPREAD / 2) {
                  cloud.position.x = -CLOUD_AREA_SPREAD / 2;
                  // Optionally re-randomize Z position and altitude for variety on wrap
                  cloud.position.z = (Math.random() - 0.5) * CLOUD_AREA_SPREAD;
                  cloud.position.y = CLOUD_ALTITUDE_MIN + Math.random() * (CLOUD_ALTITUDE_MAX - CLOUD_ALTITUDE_MIN);
              }
          });
      }

      if (cameraRef.current && sceneRef.current && (!isPausedRef.current || isUsingFallbackControlsRef.current)) { 
        const cam = cameraRef.current; 
        
        playerVelocity.current.y += GRAVITY * delta;
        cam.position.y += playerVelocity.current.y * delta;

        const groundSurfaceY = getPlayerGroundHeight(cam.position.x, cam.position.z);
        const playerFeetY = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
        
        if (playerFeetY < groundSurfaceY + COLLISION_TOLERANCE) {
          cam.position.y = groundSurfaceY + PLAYER_HEIGHT - (BLOCK_SIZE / 2);
          playerVelocity.current.y = 0;
          onGround.current = true;
          canJump.current = true;
        } else {
          onGround.current = false;
        }
        
        const moveSpeed = PLAYER_SPEED * (onGround.current ? 1 : 0.9) * delta; 
        const moveDirection = new THREE.Vector3();
        
        const forwardVector = new THREE.Vector3();
        cam.getWorldDirection(forwardVector);
        const cameraDirectionXZ = new THREE.Vector3(forwardVector.x, 0, forwardVector.z).normalize();
        const rightVectorXZ = new THREE.Vector3().crossVectors(cameraDirectionXZ, sceneRef.current.up).normalize();

        if (moveForward.current) moveDirection.add(cameraDirectionXZ);
        if (moveBackward.current) moveDirection.sub(cameraDirectionXZ);
        if (moveLeft.current) moveDirection.sub(rightVectorXZ); 
        if (moveRight.current) moveDirection.add(rightVectorXZ);
        
        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize();
            const oldPosition = cam.position.clone();
            cam.position.addScaledVector(moveDirection, moveSpeed);

            const currentPlayerFeetAbsY = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
            const playerHeadAbsY = cam.position.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE; 

            const targetBlockWorldX = cam.position.x; 
            const targetBlockWorldZ = cam.position.z; 
            
            const collisionColumnSurfaceY = getPlayerGroundHeight(targetBlockWorldX, targetBlockWorldZ);
            const blockTopAbsY = collisionColumnSurfaceY; 
            const blockBottomAbsY = collisionColumnSurfaceY - BLOCK_SIZE; 

            if (currentPlayerFeetAbsY < (blockTopAbsY - COLLISION_TOLERANCE) && 
                playerHeadAbsY > (blockBottomAbsY + COLLISION_TOLERANCE)) { 
                     
                        const playerMinX = cam.position.x - 0.3 * BLOCK_SIZE; 
                        const playerMaxX = cam.position.x + 0.3 * BLOCK_SIZE;
                        const playerMinZ = cam.position.z - 0.3 * BLOCK_SIZE; 
                        const playerMaxZ = cam.position.z + 0.3 * BLOCK_SIZE;

                        const obstacleBlockCenterWorldX = Math.round(targetBlockWorldX / BLOCK_SIZE) * BLOCK_SIZE;
                        const obstacleBlockCenterWorldZ = Math.round(targetBlockWorldZ / BLOCK_SIZE) * BLOCK_SIZE;

                        const blockMinX = obstacleBlockCenterWorldX - BLOCK_SIZE / 2;
                        const blockMaxX = obstacleBlockCenterWorldX + BLOCK_SIZE / 2;
                        const blockMinZ = obstacleBlockCenterWorldZ - BLOCK_SIZE / 2;
                        const blockMaxZ = obstacleBlockCenterWorldZ + BLOCK_SIZE / 2;

                        if (playerMaxX > blockMinX && playerMinX < blockMaxX &&
                            playerMaxZ > blockMinZ && playerMinZ < blockMaxZ) {
                            
                            let hitX = false, hitZ = false;
                            const tempPosCheck = cam.position.clone();

                            tempPosCheck.x = oldPosition.x; 
                            tempPosCheck.z = cam.position.z; 
                            const feetAtZMove = tempPosCheck.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                            const headAtZMove = tempPosCheck.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                            const heightAtZMove = getPlayerGroundHeight(tempPosCheck.x, tempPosCheck.z);
                            const zMoveBlockTop = heightAtZMove;
                            const zMoveBlockBottom = heightAtZMove - BLOCK_SIZE;
                            if (feetAtZMove < (zMoveBlockTop - COLLISION_TOLERANCE) && headAtZMove > (zMoveBlockBottom + COLLISION_TOLERANCE)) {
                               const heightAtXOnly = getPlayerGroundHeight(cam.position.x, oldPosition.z);
                               const feetAtXOnly = oldPosition.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2); 
                               const headAtXOnly = oldPosition.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                               if(feetAtXOnly < (heightAtXOnly - COLLISION_TOLERANCE) && headAtXOnly > (heightAtXOnly - BLOCK_SIZE + COLLISION_TOLERANCE)) {
                                   hitX = true; 
                               }
                            }
                            
                            tempPosCheck.x = cam.position.x; 
                            tempPosCheck.z = oldPosition.z; 
                            const feetAtXMove = tempPosCheck.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                            const headAtXMove = tempPosCheck.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                            const heightAtXMove = getPlayerGroundHeight(tempPosCheck.x, tempPosCheck.z);
                            const xMoveBlockTop = heightAtXMove;
                            const xMoveBlockBottom = heightAtXMove - BLOCK_SIZE;
                             if (feetAtXMove < (xMoveBlockTop - COLLISION_TOLERANCE) && headAtXMove > (xMoveBlockBottom + COLLISION_TOLERANCE)) {
                               const heightAtZOnly = getPlayerGroundHeight(oldPosition.x, cam.position.z);
                               const feetAtZOnly = oldPosition.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2); 
                               const headAtZOnly = oldPosition.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                               if(feetAtZOnly < (heightAtZOnly - COLLISION_TOLERANCE) && headAtZOnly > (heightAtZOnly - BLOCK_SIZE + COLLISION_TOLERANCE)) {
                                hitZ = true; 
                               }
                            }

                            if (hitX && !hitZ) { 
                                cam.position.x = oldPosition.x;
                            } else if (hitZ && !hitX) { 
                                cam.position.z = oldPosition.z;
                            } else if (hitX && hitZ) { 
                                cam.position.set(oldPosition.x, cam.position.y, oldPosition.z);
                            }
                            
                            const finalCollisionCheckHeight = getPlayerGroundHeight(cam.position.x, cam.position.z);
                            const finalPlayerFeet = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                            const finalPlayerHead = cam.position.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                            if (finalPlayerFeet < (finalCollisionCheckHeight - COLLISION_TOLERANCE) &&
                                finalPlayerHead > (finalCollisionCheckHeight - BLOCK_SIZE + COLLISION_TOLERANCE)) {
                                cam.position.set(oldPosition.x, cam.position.y, oldPosition.z);
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

    return () => {
      cancelAnimationFrame(animationFrameId);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', handleResize);
      
      controlsRef.current?.removeEventListener('lock', onControlsLock);
      controlsRef.current?.removeEventListener('unlock', onControlsUnlock);
      controlsRef.current?.disconnect(); 

      if (currentMount && rendererRef.current?.domElement) {
        currentMount.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
      
      sky?.material.dispose(); 
      woodTexture.dispose();
      leafTexture.dispose();

      if (sunMeshRef.current) {
        sunMeshRef.current.geometry.dispose();
        if (Array.isArray(sunMeshRef.current.material)) {
            sunMeshRef.current.material.forEach(m => m.dispose());
        } else {
            sunMeshRef.current.material.dispose();
        }
      }
      
      if (cloudsGroupRef.current) {
        cloudsGroupRef.current.children.forEach(cloud => {
            if (cloud instanceof THREE.Group) {
                cloud.children.forEach(segment => {
                    if (segment instanceof THREE.Mesh) {
                        segment.geometry.dispose();
                        // material is shared (materials.cloud), disposed below
                    }
                });
            }
        });
      }
      cloudSegmentGeometry.dispose();


      Object.values(materials).forEach(mat => {
        if (Array.isArray(mat)) { 
          mat.forEach(m => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        } else {
          if (mat.map && mat.map !== woodTexture && mat.map !== leafTexture) mat.map.dispose(); 
          mat.dispose();
        }
      });
      blockGeometry.dispose();

      loadedChunksRef.current.forEach(chunkData => {
        chunkData.meshes.forEach(mesh => {
           // InstancedMesh geometry & materials are shared, disposed above/below
        });
      });
      loadedChunksRef.current.clear();
      
      if (sceneRef.current) {
        while(sceneRef.current.children.length > 0){ 
            const obj = sceneRef.current.children[0];
            sceneRef.current.remove(obj); 
        }
      }

      rendererRef.current?.domElement?.removeEventListener('mousedown', handleCanvasMouseDown);
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('mouseleave', handleDocumentMouseUp);
    };
  }, [getPlayerGroundHeight, updateChunks, handleCanvasMouseDown, handleDocumentMouseMove, handleDocumentMouseUp, createCloud, createCloudSegment]);

  const startGame = () => {
    setPointerLockError(null); setIsPointerLockUnavailable(false); 
    
    if (rendererRef.current?.domElement && isUsingFallbackControlsRef.current) {
      rendererRef.current.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('mouseleave', handleDocumentMouseUp);
    }
    isUsingFallbackControlsRef.current = false; 

    if (controlsRef.current && rendererRef.current?.domElement) {
      rendererRef.current.domElement.setAttribute('tabindex', '-1'); 
      rendererRef.current.domElement.focus(); 
      try {
        controlsRef.current.lock(); 
      } catch (e: any) {
        console.error("Pointer lock request failed. Original error:", e);
        let friendlyMessage = "Error: Could not lock the mouse pointer.\n\n";
        if (e && e.message && (e.message.includes("sandboxed") || e.message.includes("allow-pointer-lock") || e.name === 'NotSupportedError' || e.message.includes("Pointer Lock API is not available") || e.message.includes("denied") || e.message.includes("not focused"))) {
          friendlyMessage += "This often happens in restricted environments (like iframes without 'allow-pointer-lock' permission) or if the document isn't focused.\nSwitched to **Click & Drag** to look around.\nMove: WASD, Jump: Space.\n\nFor the full experience, try opening the game in a new browser tab or ensuring the game window is active.";
          setPointerLockError(friendlyMessage); 
          setIsPointerLockUnavailable(true); 
          isUsingFallbackControlsRef.current = true; 
          
          rendererRef.current?.domElement.addEventListener('mousedown', handleCanvasMouseDown);
          document.addEventListener('mousemove', handleDocumentMouseMove);
          document.addEventListener('mouseup', handleDocumentMouseUp);
          document.addEventListener('mouseleave', handleDocumentMouseUp); 
          setIsPaused(false); setShowHelp(false); 
        } else {
          friendlyMessage += "Common reasons: browser/iframe restrictions, document not focused, or browser settings.\n";
          friendlyMessage += `Details: "${e.message || 'Unknown error'}"\n\n(A 'THREE.PointerLockControls: Unable to use Pointer Lock API.' message may also appear in the browser's console if the API itself is unavailable.)`;
          setPointerLockError(friendlyMessage); setIsPaused(true);
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
            <Card className="w-full max-w-lg bg-card/90 shadow-xl">
              <CardHeader><CardTitle className="flex items-center text-destructive"><AlertCircle className="mr-2 h-6 w-6" /> Pointer Lock Issue</CardTitle></CardHeader>
              <CardContent>
                <p className="text-destructive-foreground/90 mb-4 whitespace-pre-line">{pointerLockError}</p>
                <Button onClick={startGame} size="lg" className="w-full"><Play className="mr-2 h-5 w-5" /> Try Again</Button>
                 <p className="mt-3 text-sm text-muted-foreground">If issues persist, ensure the game window is focused or try opening it in a new browser tab.</p>
              </CardContent>
            </Card>
          ) : ( 
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
    

    

