
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
const COLLISION_TOLERANCE = 1e-5; // Small tolerance for floating point comparisons

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

        chunkTerrainHeights[x][z] = (terrainLevel -1) * BLOCK_SIZE + BLOCK_SIZE / 2 + (BLOCK_SIZE / 2); // Top surface Y

        const worldXPos = (chunkX * CHUNK_WIDTH + x) * BLOCK_SIZE;
        const worldZPos = (chunkZ * CHUNK_DEPTH + z) * BLOCK_SIZE;

        for (let yIdx = 0; yIdx < terrainLevel; yIdx++) {
          const blockCenterY = yIdx * BLOCK_SIZE; // Center of the block at this level
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
    const treeCount = Math.floor(CHUNK_WIDTH * CHUNK_DEPTH * 0.01); 
    for (let i = 0; i < treeCount; i++) {
      const treeLocalX = Math.floor(Math.random() * CHUNK_WIDTH);
      const treeLocalZ = Math.floor(Math.random() * CHUNK_DEPTH);
      
      const groundSurfaceY = chunkTerrainHeights[treeLocalX][treeLocalZ]; // This is already top surface
      const baseTerrainLevel = Math.round((groundSurfaceY - BLOCK_SIZE / 2) / BLOCK_SIZE) +1;


      if (groundSurfaceY > BLOCK_SIZE) { 
        const treeHeight = Math.floor(Math.random() * 4) + 3;
        
        const worldTreeRootX = (chunkX * CHUNK_WIDTH + treeLocalX) * BLOCK_SIZE;
        const worldTreeRootZ = (chunkZ * CHUNK_DEPTH + treeLocalZ) * BLOCK_SIZE;

        for (let h = 0; h < treeHeight; h++) {
          const trunkBlockCenterY = (baseTerrainLevel + h) * BLOCK_SIZE;
          blockInstances.wood.push(new THREE.Matrix4().setPosition(worldTreeRootX, trunkBlockCenterY, worldTreeRootZ));
        }

        const canopyRadius = Math.floor(Math.random() * 1) + 1;
        const canopyBlockCountY = Math.floor(Math.random() * 2) + 2; 
        
        const canopyBaseCenterY = (baseTerrainLevel + treeHeight) * BLOCK_SIZE;

        for (let lyOffset = 0; lyOffset < canopyBlockCountY; lyOffset++) { 
          for (let lx = -canopyRadius; lx <= canopyRadius; lx++) {
            for (let lz = -canopyRadius; lz <= canopyRadius; lz++) {
              if (lx === 0 && lz === 0 && lyOffset < canopyBlockCountY -1 ) continue; 
              if (Math.sqrt(lx*lx + lz*lz) > canopyRadius + 0.5 && lyOffset < canopyBlockCountY -1) continue;
              // Skip leaf if it's at the exact top center of the trunk for the lowest canopy layer
              if (lx === 0 && lz === 0 && lyOffset === 0) continue;

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

    const localX = Math.floor((worldX / BLOCK_SIZE) - camChunkX * CHUNK_WIDTH + CHUNK_WIDTH) % CHUNK_WIDTH;
    const localZ = Math.floor((worldZ / BLOCK_SIZE) - camChunkZ * CHUNK_DEPTH + CHUNK_DEPTH) % CHUNK_DEPTH;
    
    const height = chunkData.terrainHeights[localX]?.[localZ];
    return height === undefined ? -Infinity : height; // height is top surface Y
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
    scene.background = new THREE.Color(0xF0F4EC); 
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
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); 
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8); 
    sunLight.position.set(50, 100, 75); 
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 2;
    const shadowCamSize = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE / 1.5; // Adjusted shadow camera size
    sunLight.shadow.camera.left = -shadowCamSize;
    sunLight.shadow.camera.right = shadowCamSize;
    sunLight.shadow.camera.top = shadowCamSize;
    sunLight.shadow.camera.bottom = -shadowCamSize;
    scene.add(sunLight);
    scene.add(sunLight.target); 

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
    sunLight.position.copy(sunPosition.clone().multiplyScalar(150)); 
    sunLight.target.position.set(0,0,0);

    camera.position.x = (Math.random() * CHUNK_WIDTH / 4 - CHUNK_WIDTH / 8) * BLOCK_SIZE;
    camera.position.z = (Math.random() * CHUNK_DEPTH / 4 - CHUNK_DEPTH / 8) * BLOCK_SIZE;
    camera.position.y = PLAYER_HEIGHT + 20 * BLOCK_SIZE; 

    updateChunks(); 
    const initialGroundY = getPlayerGroundHeight(camera.position.x, camera.position.z);
    if (initialGroundY > -Infinity) {
        camera.position.y = initialGroundY - BLOCK_SIZE / 2 + PLAYER_HEIGHT; // Adjust to stand on surface
    }

    const controls = new PointerLockControls(camera, renderer.domElement);
    controlsRef.current = controls;

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
            // If paused due to error, ESC shouldn't try to resume pointer lock
            setShowHelp(true); // Show help/error again
           } else {
            // If simply paused by user, try to lock again
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

      updateChunks(); 

      if (controlsRef.current && !isPausedRef.current && cameraRef.current && sceneRef.current) { 
        const cam = cameraRef.current; 
        
        playerVelocity.current.y += GRAVITY * delta;
        const oldYPosition = cam.position.y;
        cam.position.y += playerVelocity.current.y * delta;

        // Ground Y is the top surface of the block. Player's feet should be at groundY + PLAYER_HEIGHT - (BLOCK_SIZE/2)
        // Or rather, player's camera center is at player_feet_y + PLAYER_HEIGHT.
        // Player feet = cam.position.y - PLAYER_HEIGHT + BLOCK_SIZE / 2;
        // We want player feet to be ON the surface: cam.position.y - PLAYER_HEIGHT + BLOCK_SIZE / 2 = groundSurfaceY
        // So, cam.position.y = groundSurfaceY + PLAYER_HEIGHT - BLOCK_SIZE / 2
        const groundSurfaceY = getPlayerGroundHeight(cam.position.x, cam.position.z);
        const targetCamYOnGround = groundSurfaceY + PLAYER_HEIGHT - (BLOCK_SIZE / 2);
        
        if (cam.position.y < targetCamYOnGround) {
          cam.position.y = targetCamYOnGround;
          playerVelocity.current.y = 0;
          onGround.current = true;
          canJump.current = true;
        } else {
          onGround.current = false;
        }
        
        const moveSpeed = PLAYER_SPEED * (onGround.current ? 1 : 0.8) * delta; 
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

            const playerFeetAbsY = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2); // Absolute Y of player's feet bottom
            const playerHeadAbsY = cam.position.y + (BLOCK_SIZE / 2); // Absolute Y of player's head top (approx)

            const playerBlockCenterX = Math.round(cam.position.x / BLOCK_SIZE); // Center X of block player is in/moving to
            const playerBlockCenterZ = Math.round(cam.position.z / BLOCK_SIZE); // Center Z of block player is in/moving to

            let collisionDetected = false;
            for (let dx = -1; dx <= 1; dx++) {
                if (collisionDetected) break;
                for (let dz = -1; dz <= 1; dz++) {
                     // We only care about horizontal collisions with blocks player might move INTO.
                    // The block directly under the player is handled by vertical collision.
                    // For pure horizontal, we'd check blocks in the direction of movement.
                    // Simplified: check all 8 surrounding blocks.

                    const checkBlockWorldX = (playerBlockCenterX + dx) * BLOCK_SIZE;
                    const checkBlockWorldZ = (playerBlockCenterZ + dz) * BLOCK_SIZE;
                    
                    const targetColumnTopSurfaceY = getPlayerGroundHeight(checkBlockWorldX, checkBlockWorldZ);
                    
                    if (targetColumnTopSurfaceY <= -Infinity + BLOCK_SIZE) continue; // No block or void

                    const blockBottomAbsY = targetColumnTopSurfaceY - BLOCK_SIZE; // Bottom of the highest block in column
                    const blockTopAbsY = targetColumnTopSurfaceY; // Top of the highest block in column

                    // Condition for a block to be a potential horizontal obstacle:
                    // Its vertical span must overlap with the player's vertical span.
                    // Use COLLISION_TOLERANCE to prevent getting stuck on edges.
                    if (playerFeetAbsY < (blockTopAbsY - COLLISION_TOLERANCE) && 
                        playerHeadAbsY > (blockBottomAbsY + COLLISION_TOLERANCE)) {
                        
                        // Player's XZ bounding box
                        const playerMinX = cam.position.x - 0.3 * BLOCK_SIZE;
                        const playerMaxX = cam.position.x + 0.3 * BLOCK_SIZE;
                        const playerMinZ = cam.position.z - 0.3 * BLOCK_SIZE;
                        const playerMaxZ = cam.position.z + 0.3 * BLOCK_SIZE;

                        // Block's XZ bounding box
                        const blockMinX = checkBlockWorldX - BLOCK_SIZE / 2;
                        const blockMaxX = checkBlockWorldX + BLOCK_SIZE / 2;
                        const blockMinZ = checkBlockWorldZ - BLOCK_SIZE / 2;
                        const blockMaxZ = checkBlockWorldZ + BLOCK_SIZE / 2;

                        if (playerMaxX > blockMinX && playerMinX < blockMaxX &&
                            playerMaxZ > blockMinZ && playerMinZ < blockMaxZ) {
                            collisionDetected = true;
                            break;
                        }
                    }
                }
            }
            if (collisionDetected) {
                cam.position.x = oldPosition.x;
                cam.position.z = oldPosition.z;
                // No Y revert here, Y is handled by vertical collision separately
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

      Object.values(materials).forEach(mat => mat.dispose());
      blockGeometry.dispose();

      loadedChunksRef.current.forEach(chunkData => {
        chunkData.meshes.forEach(mesh => {
            sceneRef.current?.remove(mesh); 
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
    setPointerLockError(null); setIsPointerLockUnavailable(false); 
    
    // Clear fallback listeners if any were attached
    if (rendererRef.current?.domElement && isUsingFallbackControlsRef.current) {
      rendererRef.current.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('mouseleave', handleDocumentMouseUp);
    }
    isUsingFallbackControlsRef.current = false; // Reset fallback state


    if (controlsRef.current && rendererRef.current?.domElement) {
      rendererRef.current.domElement.setAttribute('tabindex', '-1'); // Ensure focusable
      rendererRef.current.domElement.focus(); // Attempt to focus
      try {
        // Request pointer lock. This must be done in a user-initiated event handler.
        controlsRef.current.lock(); 
        // 'lock' event on controls will set isPaused = false
      } catch (e: any) {
        console.error("Pointer lock request failed. Original error:", e);
        let friendlyMessage = "Error: Could not lock the mouse pointer.\n\n";
        if (e && e.message && (e.message.includes("sandboxed") || e.message.includes("allow-pointer-lock") || e.name === 'NotSupportedError' || e.message.includes("Pointer Lock API is not available") || e.message.includes("denied"))) {
          friendlyMessage += "This often happens in restricted environments (like iframes without 'allow-pointer-lock' permission) or if the document isn't focused.\nSwitched to **Click & Drag** to look around.\nMove: WASD, Jump: Space.\n\nFor the full experience, try opening the game in a new browser tab or ensuring the game window is active.";
          setPointerLockError(e.message); 
          setIsPointerLockUnavailable(true); 
          isUsingFallbackControlsRef.current = true; // Enable fallback
          // Attach fallback listeners
          rendererRef.current?.domElement.addEventListener('mousedown', handleCanvasMouseDown);
          document.addEventListener('mousemove', handleDocumentMouseMove);
          document.addEventListener('mouseup', handleDocumentMouseUp);
          document.addEventListener('mouseleave', handleDocumentMouseUp);
          setIsPaused(false); setShowHelp(false); // Start game with fallback
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
                <p className="text-card-foreground/90 mb-3">Mouse pointer lock is unavailable. Using alternative controls:</p>
                <ul className="list-disc list-inside space-y-1 mb-4 text-card-foreground/80">
                  <li><strong>Look:</strong> Click and Drag Mouse on game screen</li>
                  <li><strong>Move:</strong> WASD or Arrow Keys</li><li><strong>Jump:</strong> Spacebar</li><li><strong>Pause/Unpause:</strong> ESC key (may show this menu again)</li>
                </ul>
                <p className="text-sm text-muted-foreground mb-3">For the best experience with pointer lock, try opening the game in a new browser tab.</p>
                 {pointerLockError && <p className="text-xs text-destructive/80 mt-2 mb-3">Original error: {pointerLockError}</p>}
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
