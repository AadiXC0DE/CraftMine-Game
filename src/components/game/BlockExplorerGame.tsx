
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

// Material definitions (cached at module level)
const materials = {
  grass: new THREE.MeshStandardMaterial({ color: 0x70AD47, roughness: 0.8, metalness: 0.1 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9, metalness: 0.1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xA0522D, roughness: 0.8, metalness: 0.1 }),
  leaves: new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.7, metalness: 0.1, transparent: true, opacity: 0.9 }),
};
const blockGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);

interface ChunkData {
  meshes: THREE.InstancedMesh[];
  terrainHeights: number[][]; // Stores Y of top surface of highest ground block for each (x,z) in chunk
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


  // Fallback mouse control state
  const isUsingFallbackControlsRef = useRef(false);
  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });

  const generateChunk = useCallback((chunkX: number, chunkZ: number): ChunkData | null => {
    if (!noiseRef.current) return null;
    const noise = noiseRef.current;

    const chunkTerrainHeights: number[][] = Array(CHUNK_WIDTH).fill(null).map(() => Array(CHUNK_DEPTH).fill(0));
    const blockInstances: { [key: string]: THREE.Matrix4[] } = {
      grass: [], dirt: [], wood: [], leaves: [],
    };

    // Generate terrain blocks
    for (let x = 0; x < CHUNK_WIDTH; x++) { // Local x within chunk
      for (let z = 0; z < CHUNK_DEPTH; z++) { // Local z within chunk
        const globalNoiseX = chunkX * CHUNK_WIDTH + x;
        const globalNoiseZ = chunkZ * CHUNK_DEPTH + z;

        let terrainLevel = Math.floor(noise.noise(globalNoiseX / 20, globalNoiseZ / 20, 0) * 5 + 8);
        terrainLevel += Math.floor(noise.noise(globalNoiseX / 10, globalNoiseZ / 10, 0.5) * 3);
        terrainLevel = Math.max(1, terrainLevel); // Min 1 block high

        // Y-coordinate of the top surface of the highest block in this column
        // Block centers are at y_loop_index * BLOCK_SIZE - BLOCK_SIZE/2.
        // For terrainLevel blocks (indices 0 to terrainLevel-1), top surface is (terrainLevel-1)*BLOCK_SIZE.
        chunkTerrainHeights[x][z] = (terrainLevel - 1) * BLOCK_SIZE;

        const worldXPos = (chunkX * CHUNK_WIDTH + x) * BLOCK_SIZE;
        const worldZPos = (chunkZ * CHUNK_DEPTH + z) * BLOCK_SIZE;

        for (let yIdx = 0; yIdx < terrainLevel; yIdx++) {
          // Center of the block at this level in the column
          const blockCenterY = yIdx * BLOCK_SIZE - (BLOCK_SIZE / 2);
          const matrix = new THREE.Matrix4().setPosition(worldXPos, blockCenterY, worldZPos);
          if (yIdx >= terrainLevel - GRASS_LAYER_DEPTH) {
            blockInstances.grass.push(matrix);
          } else {
            blockInstances.dirt.push(matrix);
          }
        }
      }
    }
    
    // Generate trees
    const treeCount = Math.floor(CHUNK_WIDTH * CHUNK_DEPTH * 0.01); // Reduced density per chunk
    for (let i = 0; i < treeCount; i++) {
      const treeLocalX = Math.floor(Math.random() * CHUNK_WIDTH);
      const treeLocalZ = Math.floor(Math.random() * CHUNK_DEPTH);
      
      const groundSurfaceY = chunkTerrainHeights[treeLocalX][treeLocalZ];
      const baseTerrainLevel = Math.round(groundSurfaceY / BLOCK_SIZE) + 1; // Number of blocks up to surface

      if (groundSurfaceY > BLOCK_SIZE) { // Ensure trees are on sufficiently high ground
        const treeHeight = Math.floor(Math.random() * 4) + 3;
        
        const worldTreeRootX = (chunkX * CHUNK_WIDTH + treeLocalX) * BLOCK_SIZE;
        const worldTreeRootZ = (chunkZ * CHUNK_DEPTH + treeLocalZ) * BLOCK_SIZE;

        // Trunk
        for (let h = 0; h < treeHeight; h++) {
          // Trunk blocks start at level `baseTerrainLevel`
          const trunkBlockCenterY = (baseTerrainLevel + h) * BLOCK_SIZE - (BLOCK_SIZE / 2);
          blockInstances.wood.push(new THREE.Matrix4().setPosition(worldTreeRootX, trunkBlockCenterY, worldTreeRootZ));
        }

        // Canopy
        const canopyRadius = Math.floor(Math.random() * 1) + 1;
        const canopyBlockCountY = Math.floor(Math.random() * 2) + 2; // How many blocks high the canopy is
        
        // Center Y of the block where the canopy is built around (just above the trunk)
        const canopyBaseCenterY = (baseTerrainLevel + treeHeight) * BLOCK_SIZE - (BLOCK_SIZE / 2);

        for (let lyOffset = 0; lyOffset < canopyBlockCountY; lyOffset++) { // lyOffset from 0 up to canopyBlockCountY-1
          for (let lx = -canopyRadius; lx <= canopyRadius; lx++) {
            for (let lz = -canopyRadius; lz <= canopyRadius; lz++) {
              if (lx === 0 && lz === 0 && lyOffset < canopyBlockCountY -1 ) continue; // Hollow out bottom center a bit
              if (Math.sqrt(lx*lx + lz*lz) > canopyRadius + 0.5 && lyOffset < canopyBlockCountY -1) continue;
              
              const leafBlockCenterY = canopyBaseCenterY + lyOffset * BLOCK_SIZE;
              blockInstances.leaves.push(new THREE.Matrix4().setPosition(worldTreeRootX + lx * BLOCK_SIZE, leafBlockCenterY, worldTreeRootZ + lz * BLOCK_SIZE));
            }
          }
        }
      }
    }

    const instancedMeshes: THREE.InstancedMesh[] = [];
    Object.entries(blockInstances).forEach(([type, matrices]) => {
      if (matrices.length > 0) {
        const instancedMesh = new THREE.InstancedMesh(blockGeometry, materials[type as keyof typeof materials], matrices.length);
        matrices.forEach((matrix, i) => instancedMesh.setMatrixAt(i, matrix));
        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;
        instancedMeshes.push(instancedMesh);
      }
    });
    // console.log(`Generated chunk ${chunkX},${chunkZ} with ${instancedMeshes.reduce((sum, m) => sum + m.count, 0)} blocks`);
    return { meshes: instancedMeshes, terrainHeights: chunkTerrainHeights };
  }, []);


  const getPlayerGroundHeight = useCallback((worldX: number, worldZ: number): number => {
    const camChunkX = Math.floor(worldX / BLOCK_SIZE / CHUNK_WIDTH);
    const camChunkZ = Math.floor(worldZ / BLOCK_SIZE / CHUNK_DEPTH);
    const chunkKey = `${camChunkX},${camChunkZ}`;

    const chunkData = loadedChunksRef.current.get(chunkKey);
    if (!chunkData) return -Infinity; // Chunk not loaded

    const localX = Math.floor(worldX / BLOCK_SIZE) - camChunkX * CHUNK_WIDTH;
    const localZ = Math.floor(worldZ / BLOCK_SIZE) - camChunkZ * CHUNK_DEPTH;

    if (localX < 0 || localX >= CHUNK_WIDTH || localZ < 0 || localZ >= CHUNK_DEPTH) {
      // console.warn(`getPlayerGroundHeight: Local coords out of bounds: ${localX}, ${localZ} for world ${worldX}, ${worldZ}`);
      return -Infinity; // Should not happen if camChunkX/Z are correct
    }
    
    const height = chunkData.terrainHeights[localX]?.[localZ];
    return height === undefined ? -Infinity : height;
  }, []);

  const updateChunks = useCallback(() => {
    if (!cameraRef.current || !sceneRef.current) return;

    const camPos = cameraRef.current.position;
    // Player's current chunk (integer coordinates)
    const currentPlayerChunkX = Math.floor(camPos.x / BLOCK_SIZE / CHUNK_WIDTH);
    const currentPlayerChunkZ = Math.floor(camPos.z / BLOCK_SIZE / CHUNK_DEPTH);

    if (
      initialChunksLoadedRef.current &&
      currentChunkCoordsRef.current.x === currentPlayerChunkX &&
      currentChunkCoordsRef.current.z === currentPlayerChunkZ
    ) {
      return; // Player hasn't moved to a new chunk, and initial load done
    }
    
    // console.log(`Player moved to chunk: ${currentPlayerChunkX}, ${currentPlayerChunkZ}`);
    currentChunkCoordsRef.current = { x: currentPlayerChunkX, z: currentPlayerChunkZ };

    const newRequiredChunks = new Set<string>();
    for (let dx = -VIEW_DISTANCE_CHUNKS; dx <= VIEW_DISTANCE_CHUNKS; dx++) {
      for (let dz = -VIEW_DISTANCE_CHUNKS; dz <= VIEW_DISTANCE_CHUNKS; dz++) {
        newRequiredChunks.add(`${currentPlayerChunkX + dx},${currentPlayerChunkZ + dz}`);
      }
    }

    // Unload chunks no longer in view
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
          // mesh.dispose(); // Not strictly necessary for InstancedMesh if geometry/material are shared and managed elsewhere
        });
        loadedChunksRef.current.delete(chunkKey);
        // console.log(`Unloaded chunk: ${chunkKey}`);
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
          // console.log(`Loaded chunk: ${loadChunkX},${loadChunkZ}`);
        }
      }
    });
    initialChunksLoadedRef.current = true;
  }, [generateChunk]);


  // Fallback mouse control handlers
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
    euler.x = Math.max(-PI_2, Math.min(PI_2, euler.x));
    camera.quaternion.setFromEuler(euler);
    previousMousePositionRef.current = { x: event.clientX, y: event.clientY };
  }, []);
  
  const handleDocumentMouseUp = useCallback(() => {
    if (!isUsingFallbackControlsRef.current) return;
    isDraggingRef.current = false;
  }, []);


  useEffect(() => {
    if (!mountRef.current) return;
    const currentMount = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF0F4EC); // Light green-ish sky
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 1.5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Brighter ambient
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8); // Brighter sun
    sunLight.position.set(50, 100, 75); // Higher sun
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 2;
    sunLight.shadow.camera.left = -VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE /2;
    sunLight.shadow.camera.right = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE /2;
    sunLight.shadow.camera.top = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE /2;
    sunLight.shadow.camera.bottom = -VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE /2;
    scene.add(sunLight);
    scene.add(sunLight.target); // Important for directional light targeting

    const sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - 0.3, Math.PI * 0.25);
    skyUniforms['sunPosition'].value.copy(sunPosition);
    sunLight.position.copy(sunPosition.clone().multiplyScalar(150)); // Sun position consistent with sky
    sunLight.target.position.set(0,0,0);


    // Initial player position (near world origin 0,0)
    camera.position.x = (Math.random() * CHUNK_WIDTH / 4 - CHUNK_WIDTH / 8) * BLOCK_SIZE;
    camera.position.z = (Math.random() * CHUNK_DEPTH / 4 - CHUNK_DEPTH / 8) * BLOCK_SIZE;
    // Initial Y will be set after first chunk load via gravity or direct setting in animate
    camera.position.y = PLAYER_HEIGHT + 20 * BLOCK_SIZE; // Start high, will fall

    // Initial chunk loading
    updateChunks(); 
    const initialGroundY = getPlayerGroundHeight(camera.position.x, camera.position.z);
    if (initialGroundY > -Infinity) {
        camera.position.y = initialGroundY + PLAYER_HEIGHT;
    }


    const controls = new PointerLockControls(camera, renderer.domElement);
    controlsRef.current = controls;
    // scene.add(controls.getObject()); // PointerLockControls adds its object to camera directly, no need to add to scene

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
    };
    const onControlsUnlock = () => {
      setIsPaused(true);
      if (!pointerLockError && !isPointerLockUnavailable) setShowHelp(true);
    };
    controls.addEventListener('lock', onControlsLock);
    controls.addEventListener('unlock', onControlsUnlock);
    
    const currentRendererDom = rendererRef.current?.domElement;
    if (currentRendererDom && isUsingFallbackControlsRef.current) {
        currentRendererDom.addEventListener('mousedown', handleCanvasMouseDown);
        document.addEventListener('mousemove', handleDocumentMouseMove);
        document.addEventListener('mouseup', handleDocumentMouseUp);
        document.addEventListener('mouseleave', handleDocumentMouseUp);
    }

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

      updateChunks(); // Update chunks based on player position

      if (controlsRef.current && !isPausedRef.current && cameraRef.current && sceneRef.current) { 
        const cam = cameraRef.current; // PointerLockControls directly manipulates camera
        
        playerVelocity.current.y += GRAVITY * delta;
        const oldYPosition = cam.position.y;
        cam.position.y += playerVelocity.current.y * delta;

        const groundY = getPlayerGroundHeight(cam.position.x, cam.position.z);
        
        if (cam.position.y < groundY + PLAYER_HEIGHT) {
          cam.position.y = groundY + PLAYER_HEIGHT;
          playerVelocity.current.y = 0;
          onGround.current = true;
          canJump.current = true;
        } else {
          onGround.current = false;
        }
        
        const moveSpeed = PLAYER_SPEED * (onGround.current ? 1 : 0.8) * delta; 
        const moveDirection = new THREE.Vector3();
        const forwardVector = new THREE.Vector3();
        cam.getWorldDirection(forwardVector); // Gets the direction camera is looking
        
        const cameraDirectionXZ = new THREE.Vector3(forwardVector.x, 0, forwardVector.z).normalize();
        const rightVectorXZ = new THREE.Vector3().crossVectors(sceneRef.current.up, cameraDirectionXZ).normalize();

        if (moveForward.current) moveDirection.add(cameraDirectionXZ);
        if (moveBackward.current) moveDirection.sub(cameraDirectionXZ);
        if (moveLeft.current) moveDirection.sub(rightVectorXZ); 
        if (moveRight.current) moveDirection.add(rightVectorXZ); 
        
        moveDirection.normalize(); 

        if (moveDirection.lengthSq() > 0) { 
            const oldPosition = cam.position.clone();
            cam.position.addScaledVector(moveDirection, moveSpeed);

            // Basic horizontal collision detection
            const playerFeetYLevel = cam.position.y - PLAYER_HEIGHT;
            const playerHeadYLevel = cam.position.y;

            // Check 3x3 grid of blocks around player for collision
            const playerBlockX = Math.floor(cam.position.x / BLOCK_SIZE);
            const playerBlockZ = Math.floor(cam.position.z / BLOCK_SIZE);

            let collisionDetected = false;
            for (let dx = -1; dx <= 1; dx++) {
                if (collisionDetected) break;
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue; // Don't check self for horizontal

                    const checkWorldX = (playerBlockX + dx) * BLOCK_SIZE;
                    const checkWorldZ = (playerBlockZ + dz) * BLOCK_SIZE;
                    
                    const targetColumnGroundSurfaceY = getPlayerGroundHeight(checkWorldX, checkWorldZ);
                    
                    // Consider column solid from very low up to its surface
                    const columnMinY = -100 * BLOCK_SIZE; // Effectively solid from below
                    const columnMaxY = targetColumnGroundSurfaceY;

                    const playerAABB = new THREE.Box3(
                        new THREE.Vector3(cam.position.x - 0.3*BLOCK_SIZE, playerFeetYLevel + 0.1, cam.position.z - 0.3*BLOCK_SIZE),
                        new THREE.Vector3(cam.position.x + 0.3*BLOCK_SIZE, playerHeadYLevel - 0.1, cam.position.z + 0.3*BLOCK_SIZE)
                    );
                    const columnAABB = new THREE.Box3(
                        new THREE.Vector3(checkWorldX - BLOCK_SIZE/2, columnMinY, checkWorldZ - BLOCK_SIZE/2),
                        new THREE.Vector3(checkWorldX + BLOCK_SIZE/2, columnMaxY, checkWorldZ + BLOCK_SIZE/2)
                    );

                    if (playerAABB.intersectsBox(columnAABB)) {
                        collisionDetected = true;
                        break;
                    }
                }
            }
            if (collisionDetected) {
                // Revert only XZ movement, keep Y movement (gravity/jump)
                cam.position.x = oldPosition.x;
                cam.position.z = oldPosition.z;

                // If vertical movement also caused collision (e.g. hitting ceiling), revert Y too
                const groundCheckAfterRevertXZ = getPlayerGroundHeight(cam.position.x, cam.position.z);
                if (oldYPosition < groundCheckAfterRevertXZ + PLAYER_HEIGHT && playerVelocity.current.y < 0) { // was falling
                   // already handled by vertical collision
                } else if (cam.position.y > oldYPosition && playerVelocity.current.y > 0) { // was jumping into something
                    const headCheckY = getPlayerGroundHeight(cam.position.x, oldPosition.z); // check at new X, old Z
                     if (cam.position.y - PLAYER_HEIGHT > headCheckY - BLOCK_SIZE) { //簡易的な天井衝突
                        // cam.position.y = oldYPosition;
                        // playerVelocity.current.y = 0;
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
      
      sky?.material.dispose(); // Sky was not ref'd, local var. Okay for this cleanup.

      Object.values(materials).forEach(mat => mat.dispose());
      blockGeometry.dispose();

      loadedChunksRef.current.forEach(chunkData => {
        chunkData.meshes.forEach(mesh => {
            sceneRef.current?.remove(mesh); // Ensure all meshes are removed
            // mesh.dispose(); // InstancedMesh internal geo/mat are shared
        });
      });
      loadedChunksRef.current.clear();
      
      sceneRef.current?.clear(); 

      rendererRef.current?.domElement?.removeEventListener('mousedown', handleCanvasMouseDown);
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('mouseleave', handleDocumentMouseUp);
    };
  }, [generateChunk, getPlayerGroundHeight, updateChunks, handleCanvasMouseDown, handleDocumentMouseMove, handleDocumentMouseUp]); 

  const startGame = () => {
    setPointerLockError(null); setIsPointerLockUnavailable(false); isUsingFallbackControlsRef.current = false;
    rendererRef.current?.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
    document.removeEventListener('mousemove', handleDocumentMouseMove);
    document.removeEventListener('mouseup', handleDocumentMouseUp);
    document.removeEventListener('mouseleave', handleDocumentMouseUp);

    if (controlsRef.current && rendererRef.current?.domElement) {
      rendererRef.current.domElement.setAttribute('tabindex', '-1');
      rendererRef.current.domElement.focus();
      try {
        controlsRef.current.lock();
      } catch (e: any) {
        console.error("Pointer lock request failed. Original error:", e);
        let friendlyMessage = "Error: Could not lock the mouse pointer.\n\n";
        if (e && e.message && (e.message.includes("sandboxed") || e.message.includes("allow-pointer-lock") || e.name === 'NotSupportedError' || e.message.includes("Pointer Lock API is not available"))) {
          friendlyMessage += "This often happens in restricted environments (like iframes without 'allow-pointer-lock' permission).\nSwitched to **Click & Drag** to look around.\nMove: WASD, Jump: Space.\n\nFor the full experience, try opening the game in a new browser tab.";
          setPointerLockError(e.message); 
          setIsPointerLockUnavailable(true); 
          isUsingFallbackControlsRef.current = true;
          rendererRef.current?.domElement.addEventListener('mousedown', handleCanvasMouseDown);
          document.addEventListener('mousemove', handleDocumentMouseMove);
          document.addEventListener('mouseup', handleDocumentMouseUp);
          document.addEventListener('mouseleave', handleDocumentMouseUp);
          setIsPaused(false); setShowHelp(false);
        } else {
          friendlyMessage += "Common reasons: browser/iframe restrictions, or browser settings.\n";
          friendlyMessage += `Details: "${e.message || 'Unknown error'}"\n\n(A 'THREE.PointerLockControls: Unable to use Pointer Lock API.' message may also appear in the browser's console.)`;
          setPointerLockError(friendlyMessage); setIsPaused(true);
        }
      }
    } else {
      setPointerLockError("Game components are not ready. Please try reloading."); setIsPaused(true);
    }
  };

  const gameTitle = "Block Explorer";
  const buttonText = isPaused && (!pointerLockError && !isPointerLockUnavailable) ? "Start Exploring" : "Resume Exploring";

  return (
    <div ref={mountRef} className="h-full w-full relative">
      {isPaused && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm z-10 p-4">
          {isPointerLockUnavailable ? (
            <Card className="w-full max-w-lg bg-card/90 shadow-xl">
              <CardHeader><CardTitle className="flex items-center text-primary"><Mouse className="mr-2 h-6 w-6" /> Fallback Controls Active</CardTitle></CardHeader>
              <CardContent>
                <p className="text-card-foreground/90 mb-3">Mouse pointer lock is unavailable. Using alternative controls:</p>
                <ul className="list-disc list-inside space-y-1 mb-4 text-card-foreground/80">
                  <li><strong>Look:</strong> Click and Drag Mouse on game screen</li>
                  <li><strong>Move:</strong> WASD or Arrow Keys</li><li><strong>Jump:</strong> Spacebar</li><li><strong>Pause/Unpause:</strong> ESC key</li>
                </ul>
                <p className="text-sm text-muted-foreground mb-3">For the best experience, try opening in a new browser tab.</p>
                 {pointerLockError && <p className="text-xs text-destructive/80 mt-2 mb-3">Details: {pointerLockError}</p>}
                <Button onClick={startGame} size="lg" className="w-full"><Play className="mr-2 h-5 w-5" /> {buttonText}</Button>
              </CardContent>
            </Card>
          ) : pointerLockError ? (
            <Card className="w-full max-w-lg bg-card/90 shadow-xl">
              <CardHeader><CardTitle className="flex items-center text-destructive"><AlertCircle className="mr-2 h-6 w-6" /> Pointer Lock Issue</CardTitle></CardHeader>
              <CardContent>
                <p className="text-destructive-foreground/90 mb-4 whitespace-pre-line">{pointerLockError}</p>
                <Button onClick={startGame} size="lg" className="w-full"><Play className="mr-2 h-5 w-5" /> Try Again</Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <h1 className="text-5xl font-bold text-primary mb-4">{gameTitle}</h1>
              <Button onClick={startGame} size="lg" className="mb-4"><Play className="mr-2 h-5 w-5" /> {buttonText}</Button>
              {showHelp && (
                 <Card className="w-full max-w-md bg-card/80 shadow-xl">
                  <CardHeader><CardTitle className="flex items-center text-card-foreground"><HelpCircle className="mr-2 h-6 w-6 text-accent" /> How to Play</CardTitle></CardHeader>
                  <CardContent className="text-card-foreground/90">
                    <ul className="list-disc list-inside space-y-1">
                      <li><strong>Move:</strong> WASD or Arrow Keys</li><li><strong>Look:</strong> Mouse (after clicking start)</li>
                      <li><strong>Jump:</strong> Spacebar</li><li><strong>Pause/Unpause:</strong> ESC key</li>
                    </ul>
                    <p className="mt-3 text-sm">Click "{buttonText}" to lock mouse pointer and begin.</p>
                  </CardContent>
                </Card>
              )}
              {!showHelp && <p className="text-muted-foreground">Game Paused. Press ESC or click "{buttonText}" to resume.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default BlockExplorerGame;

    