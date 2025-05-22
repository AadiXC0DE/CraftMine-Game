
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
const TERRAIN_WIDTH = 64; // In blocks
const TERRAIN_DEPTH = 64; // In blocks
const GRASS_LAYER_DEPTH = 3;
const PLAYER_HEIGHT = BLOCK_SIZE * 1.75;
const PLAYER_SPEED = 5.0;
const GRAVITY = -15.0;
const JUMP_VELOCITY = 7.0;

// Material definitions (cached at module level)
const materials = {
  grass: new THREE.MeshStandardMaterial({ color: 0x70AD47, roughness: 0.8, metalness: 0.1 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9, metalness: 0.1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xA0522D, roughness: 0.8, metalness: 0.1 }),
  leaves: new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.7, metalness: 0.1, transparent: true, opacity: 0.9 }),
};
const blockGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);


export function BlockExplorerGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(true);
  const [showHelp, setShowHelp] = useState(true);
  const [pointerLockError, setPointerLockError] = useState<string | null>(null);
  const [isPointerLockUnavailable, setIsPointerLockUnavailable] = useState(false);


  const isPausedRef = useRef(isPaused);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Refs for Three.js objects and game state
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);
  const skyRef = useRef<Sky | null>(null);
  const terrainObjectsRef = useRef<THREE.Group>(new THREE.Group());
  
  const playerVelocity = useRef(new THREE.Vector3());
  const onGround = useRef(false);
  const moveForward = useRef(false);
  const moveBackward = useRef(false);
  const moveLeft = useRef(false);
  const moveRight = useRef(false);
  const canJump = useRef(false);
  const terrainData = useRef<number[][]>([]);

  // Refs for fallback click-and-drag controls
  const isUsingFallbackControlsRef = useRef(false);
  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });


  // Fallback mouse control handlers
  const handleCanvasMouseDown = useCallback((event: MouseEvent) => {
    if (isPausedRef.current || !isUsingFallbackControlsRef.current || !rendererRef.current?.domElement) return;
    // Ensure click is on canvas
    if (event.target === rendererRef.current.domElement) {
      isDraggingRef.current = true;
      previousMousePositionRef.current = { x: event.clientX, y: event.clientY };
      // Prevent default to avoid text selection, etc.
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

    euler.y -= movementX * 0.0025; // Sensitivity for yaw
    euler.x -= movementY * 0.0025; // Sensitivity for pitch

    const PI_2 = Math.PI / 2;
    euler.x = Math.max(-PI_2, Math.min(PI_2, euler.x)); // Clamp pitch

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

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = PLAYER_HEIGHT + BLOCK_SIZE * 10;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(50, 50, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 500;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);
    skyRef.current = sky; 
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;
    const sunPosition = new THREE.Vector3();
    const inclination = 0.3; 
    const azimuth = 0.25; 
    const theta = Math.PI * (inclination - 0.5);
    const phi = 2 * Math.PI * (azimuth - 0.5);
    sunPosition.x = Math.cos(phi);
    sunPosition.y = Math.sin(phi) * Math.sin(theta);
    sunPosition.z = Math.sin(phi) * Math.cos(theta);
    skyUniforms['sunPosition'].value.copy(sunPosition);
    sunLight.position.copy(sunPosition.multiplyScalar(100));
    sunLight.target.position.set(0,0,0);

    const noise = new ImprovedNoise();
    const terrainWidthHalf = TERRAIN_WIDTH / 2;
    const terrainDepthHalf = TERRAIN_DEPTH / 2;
    
    terrainData.current = Array(TERRAIN_WIDTH).fill(null).map(() => Array(TERRAIN_DEPTH).fill(0));

    const blockInstances: { [key: string]: THREE.Matrix4[] } = {
      grass: [], dirt: [], wood: [], leaves: [],
    };

    for (let x = 0; x < TERRAIN_WIDTH; x++) {
      for (let z = 0; z < TERRAIN_DEPTH; z++) {
        const worldX = (x - terrainWidthHalf) * BLOCK_SIZE;
        const worldZ = (z - terrainDepthHalf) * BLOCK_SIZE;
        let height = Math.floor(noise.noise(x / 20, z / 20, 0) * 5 + 8);
        height += Math.floor(noise.noise(x / 10, z / 10, 0.5) * 3);
        height = Math.max(1, height);
        terrainData.current[x][z] = height * BLOCK_SIZE;
        for (let y = 0; y < height; y++) {
          const matrix = new THREE.Matrix4().setPosition(worldX, y * BLOCK_SIZE - BLOCK_SIZE / 2, worldZ);
          if (y >= height - GRASS_LAYER_DEPTH) blockInstances.grass.push(matrix);
          else blockInstances.dirt.push(matrix);
        }
      }
    }
    
    const treeCount = Math.floor(TERRAIN_WIDTH * TERRAIN_DEPTH * 0.02);
    for (let i = 0; i < treeCount; i++) {
      const treeX = Math.floor(Math.random() * TERRAIN_WIDTH);
      const treeZ = Math.floor(Math.random() * TERRAIN_DEPTH);
      const groundHeight = terrainData.current[treeX][treeZ];
      if (groundHeight > BLOCK_SIZE * 2) {
        const treeHeight = Math.floor(Math.random() * 4) + 3;
        const worldX = (treeX - terrainWidthHalf) * BLOCK_SIZE;
        const worldZ = (treeZ - terrainDepthHalf) * BLOCK_SIZE;
        for (let h = 0; h < treeHeight; h++) {
          blockInstances.wood.push(new THREE.Matrix4().setPosition(worldX, groundHeight + h * BLOCK_SIZE - BLOCK_SIZE/2, worldZ));
        }
        const canopyRadius = Math.floor(Math.random() * 1) + 1;
        const canopyHeight = Math.floor(Math.random() * 2) + 2;
        const canopyBaseY = groundHeight + treeHeight * BLOCK_SIZE - BLOCK_SIZE / 2;
        for (let ly = 0; ly < canopyHeight; ly++) {
          for (let lx = -canopyRadius; lx <= canopyRadius; lx++) {
            for (let lz = -canopyRadius; lz <= canopyRadius; lz++) {
              if (lx === 0 && lz === 0 && ly < canopyHeight -1) continue;
              if (Math.sqrt(lx*lx + lz*lz) > canopyRadius + 0.5 && ly < canopyHeight -1) continue;
              blockInstances.leaves.push(new THREE.Matrix4().setPosition(worldX + lx * BLOCK_SIZE, canopyBaseY + ly * BLOCK_SIZE, worldZ + lz * BLOCK_SIZE));
            }
          }
        }
      }
    }

    Object.entries(blockInstances).forEach(([type, matrices]) => {
      if (matrices.length > 0) {
        const instancedMesh = new THREE.InstancedMesh(blockGeometry, materials[type as keyof typeof materials], matrices.length);
        matrices.forEach((matrix, i) => instancedMesh.setMatrixAt(i, matrix));
        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;
        terrainObjectsRef.current.add(instancedMesh);
      }
    });
    scene.add(terrainObjectsRef.current);
    
    camera.position.x = (Math.random() * TERRAIN_WIDTH/4 - TERRAIN_WIDTH/8) * BLOCK_SIZE;
    camera.position.z = (Math.random() * TERRAIN_DEPTH/4 - TERRAIN_DEPTH/8) * BLOCK_SIZE;
    const initialPlayerXBlock = Math.floor(camera.position.x/BLOCK_SIZE + TERRAIN_WIDTH/2);
    const initialPlayerZBlock = Math.floor(camera.position.z/BLOCK_SIZE + TERRAIN_DEPTH/2);
    if (terrainData.current[initialPlayerXBlock] && terrainData.current[initialPlayerXBlock][initialPlayerZBlock]) {
        camera.position.y = terrainData.current[initialPlayerXBlock][initialPlayerZBlock] + PLAYER_HEIGHT;
    } else {
        camera.position.y = BLOCK_SIZE * 10 + PLAYER_HEIGHT; 
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
             if (controlsRef.current?.isLocked) {
               // PointerLockControls will unlock and trigger its 'unlock' event
             } else {
               // If not using pointer lock (isLocked is false) or it failed, directly pause
               setIsPaused(true);
             }
           } else if (isPausedRef.current && !pointerLockError && !isPointerLockUnavailable) {
              // If paused without critical errors, ESC can resume via trying to lock pointer
              // This might be redundant if "Start Exploring" button is primary way to resume
              // For now, let startGame handle resume logic
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
      setIsPaused(false); 
      setShowHelp(false); 
      setPointerLockError(null);
      setIsPointerLockUnavailable(false);
      isUsingFallbackControlsRef.current = false; // Pointer lock is active
    };
    const onControlsUnlock = () => {
      setIsPaused(true);
      // Don't show general help if a specific error or fallback is active
      if (!pointerLockError && !isPointerLockUnavailable) {
        setShowHelp(true);
      }
    };
    controls.addEventListener('lock', onControlsLock);
    controls.addEventListener('unlock', onControlsUnlock);
    
    // Add fallback control listeners if PointerLockControls are not active
    // These will be added in startGame if needed
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

      if (controlsRef.current && !isPausedRef.current && cameraRef.current) { 
        const cam = controlsRef.current.getObject();
        
        playerVelocity.current.y += GRAVITY * delta;
        cam.position.y += playerVelocity.current.y * delta;

        const playerXBlock = Math.floor(cam.position.x / BLOCK_SIZE + TERRAIN_WIDTH / 2);
        const playerZBlock = Math.floor(cam.position.z / BLOCK_SIZE + TERRAIN_DEPTH / 2);
        
        let groundY = -Infinity;
        if (playerXBlock >= 0 && playerXBlock < TERRAIN_WIDTH && playerZBlock >= 0 && playerZBlock < TERRAIN_DEPTH) {
           if(terrainData.current[playerXBlock]?.[playerZBlock] !== undefined) {
             groundY = terrainData.current[playerXBlock][playerZBlock];
           }
        }
        
        if (cam.position.y < groundY + PLAYER_HEIGHT) {
          cam.position.y = groundY + PLAYER_HEIGHT;
          playerVelocity.current.y = 0;
          onGround.current = true;
          canJump.current = true;
        } else {
          onGround.current = false;
        }

        const moveSpeed = PLAYER_SPEED * (onGround.current ? 1 : 0.7) * delta; 
        const direction = new THREE.Vector3();
        const forwardVector = new THREE.Vector3();
        
        // Get forward vector based on camera, Y component is handled by PointerLockControls or click-drag
        cam.getWorldDirection(forwardVector);
        // For WASD movement, we only care about XZ plane.
        // If using PointerLockControls, it directly manipulates camera's quaternion/rotation.
        // If using click-drag, our mousemove handler manipulates camera's quaternion/rotation.
        const cameraDirectionForMovement = new THREE.Vector3(forwardVector.x, 0, forwardVector.z).normalize();


        const rightVector = new THREE.Vector3().crossVectors(scene.up, cameraDirectionForMovement).normalize();

        if (moveForward.current) direction.add(cameraDirectionForMovement);
        if (moveBackward.current) direction.sub(cameraDirectionForMovement);
        if (moveLeft.current) direction.sub(rightVector); 
        if (moveRight.current) direction.add(rightVector); 
        
        direction.normalize(); 

        if (direction.lengthSq() > 0) { 
            const oldPosition = cam.position.clone();
            cam.position.addScaledVector(direction, moveSpeed);

            const newPlayerXBlock = Math.floor(cam.position.x / BLOCK_SIZE + TERRAIN_WIDTH / 2);
            const newPlayerZBlock = Math.floor(cam.position.z / BLOCK_SIZE + TERRAIN_DEPTH / 2);
            
            const checkCollisionAtY = (yOffset: number) => {
                const playerFeetYLevel = cam.position.y - PLAYER_HEIGHT;
                const playerHeadYLevel = cam.position.y;

                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const blockX = newPlayerXBlock + dx;
                        const blockZ = newPlayerZBlock + dz;
                        if (blockX >= 0 && blockX < TERRAIN_WIDTH && blockZ >= 0 && blockZ < TERRAIN_DEPTH) {
                            const blockHeightInUnits = terrainData.current[blockX][blockZ];
                            const blockTopY = blockHeightInUnits; 
                            const blockBottomY = blockHeightInUnits - BLOCK_SIZE; 

                            const currentBlockWorldX = (blockX - TERRAIN_WIDTH / 2) * BLOCK_SIZE;
                            const currentBlockWorldZ = (blockZ - TERRAIN_DEPTH / 2) * BLOCK_SIZE;
                            
                            const playerBB = new THREE.Box3(
                                new THREE.Vector3(cam.position.x - 0.3, playerFeetYLevel + 0.1, cam.position.z - 0.3),
                                new THREE.Vector3(cam.position.x + 0.3, playerHeadYLevel - 0.1, cam.position.z + 0.3) 
                            );
                            const blockBB = new THREE.Box3(
                                new THREE.Vector3(currentBlockWorldX - BLOCK_SIZE/2, blockBottomY, currentBlockWorldZ - BLOCK_SIZE/2),
                                new THREE.Vector3(currentBlockWorldX + BLOCK_SIZE/2, blockTopY, currentBlockWorldZ + BLOCK_SIZE/2)
                            );

                            if (playerBB.intersectsBox(blockBB)) { 
                                cam.position.x = oldPosition.x;
                                cam.position.z = oldPosition.z;
                                return true; 
                            }
                        }
                    }
                }
                return false; 
            };
            checkCollisionAtY(0.5 * BLOCK_SIZE);
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
      
      skyRef.current?.material.dispose();

      Object.values(materials).forEach(mat => mat.dispose());
      blockGeometry.dispose();

      terrainObjectsRef.current.children.forEach(child => {
        if (child instanceof THREE.InstancedMesh) {
          // Geometry and materials are shared
        }
      });
      terrainObjectsRef.current.clear(); 
      
      sceneRef.current?.clear(); 

      // Cleanup fallback listeners
      rendererRef.current?.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('mouseleave', handleDocumentMouseUp);
    };
  }, [handleCanvasMouseDown, handleDocumentMouseMove, handleDocumentMouseUp]); 

  const startGame = () => {
    setPointerLockError(null); 
    setIsPointerLockUnavailable(false);
    isUsingFallbackControlsRef.current = false;

    // Remove any existing fallback listeners before trying to lock
    rendererRef.current?.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
    document.removeEventListener('mousemove', handleDocumentMouseMove);
    document.removeEventListener('mouseup', handleDocumentMouseUp);
    document.removeEventListener('mouseleave', handleDocumentMouseUp);


    if (controlsRef.current && rendererRef.current?.domElement) {
      rendererRef.current.domElement.setAttribute('tabindex', '-1');
      rendererRef.current.domElement.focus();
      
      try {
        controlsRef.current.lock();
        // If lock() succeeds, the 'lock' event will fire, 
        // which then calls setIsPaused(false), setPointerLockError(null), etc.
      } catch (e: any) {
        console.error("Pointer lock request failed. Original error:", e);
        let friendlyMessage = "Error: Could not lock the mouse pointer for looking around.\n\n";
        
        if (e && e.message && (e.message.includes("sandboxed") || e.message.includes("allow-pointer-lock") || e.name === 'NotSupportedError' || e.message.includes("Pointer Lock API is not available"))) {
          friendlyMessage += "This often happens in restricted environments (like iframes without 'allow-pointer-lock' permission).\n\n";
          friendlyMessage += "Switched to **Click & Drag** to look around.\n";
          friendlyMessage += "Move: WASD, Jump: Space.\n\n";
          friendlyMessage += "For the full experience (hidden cursor), try opening the game in a new browser tab if possible.";
          
          setPointerLockError(e.message); // Store technical error
          setIsPointerLockUnavailable(true); // Signal fallback mode
          isUsingFallbackControlsRef.current = true;

          // Add listeners for click-drag
          rendererRef.current?.domElement.addEventListener('mousedown', handleCanvasMouseDown);
          document.addEventListener('mousemove', handleDocumentMouseMove);
          document.addEventListener('mouseup', handleDocumentMouseUp);
          document.addEventListener('mouseleave', handleDocumentMouseUp); // Stop dragging if mouse leaves window

          setIsPaused(false); // Start the game with click-drag controls
          setShowHelp(false);
        } else {
          friendlyMessage += "Common reasons and solutions:\n";
          friendlyMessage += "- **Browser/iframe restrictions:** If the game is in an iframe, it might lack permissions. Try opening the game in a new, standalone browser tab.\n";
          friendlyMessage += "- **Browser settings:** Ensure your browser settings allow pointer lock for this site.\n";
          friendlyMessage += `Details from the error: "${e.message || 'Unknown error'}"\n\n`;
          friendlyMessage += "(A 'THREE.PointerLockControls: Unable to use Pointer Lock API.' message may also appear in the browser's developer console due to this issue.)";
          setPointerLockError(friendlyMessage);
          setIsPaused(true); // Ensure pause screen with error is shown
        }
      }
    } else {
      console.warn('BlockExplorerGame: Could not start game, controls or renderer domElement not ready.');
      setPointerLockError("Game components are not ready. Please try reloading.");
      setIsPaused(true);
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
              <CardHeader>
                <CardTitle className="flex items-center text-primary">
                  <Mouse className="mr-2 h-6 w-6" /> Fallback Controls Active
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-card-foreground/90 mb-3">
                  Mouse pointer lock is unavailable. You can use an alternative control scheme:
                </p>
                <ul className="list-disc list-inside space-y-1 mb-4 text-card-foreground/80">
                  <li><strong>Look:</strong> Click and Drag Mouse on game screen</li>
                  <li><strong>Move:</strong> WASD or Arrow Keys</li>
                  <li><strong>Jump:</strong> Spacebar</li>
                  <li><strong>Pause/Unpause:</strong> ESC key (or button below)</li>
                </ul>
                <p className="text-sm text-muted-foreground mb-3">
                  For the best experience (hidden cursor, direct mouse look), try opening the game in a new browser tab.
                </p>
                 {pointerLockError && <p className="text-xs text-destructive/80 mt-2 mb-3">Details: {pointerLockError}</p>}
                <Button onClick={startGame} size="lg" className="w-full">
                  <Play className="mr-2 h-5 w-5" /> {buttonText}
                </Button>
              </CardContent>
            </Card>
          ) : pointerLockError ? (
            <Card className="w-full max-w-lg bg-card/90 shadow-xl">
              <CardHeader>
                <CardTitle className="flex items-center text-destructive">
                  <AlertCircle className="mr-2 h-6 w-6" /> Pointer Lock Issue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-destructive-foreground/90 mb-4 whitespace-pre-line">{pointerLockError}</p>
                <Button onClick={startGame} size="lg" className="w-full">
                  <Play className="mr-2 h-5 w-5" /> Try Again
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <h1 className="text-5xl font-bold text-primary mb-4">{gameTitle}</h1>
              <Button onClick={startGame} size="lg" className="mb-4">
                <Play className="mr-2 h-5 w-5" /> {buttonText}
              </Button>
              {showHelp && (
                 <Card className="w-full max-w-md bg-card/80 shadow-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center text-card-foreground">
                      <HelpCircle className="mr-2 h-6 w-6 text-accent" /> How to Play
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-card-foreground/90">
                    <ul className="list-disc list-inside space-y-1">
                      <li><strong>Move:</strong> WASD or Arrow Keys</li>
                      <li><strong>Look:</strong> Mouse (after clicking start)</li>
                      <li><strong>Jump:</strong> Spacebar</li>
                      <li><strong>Pause/Unpause:</strong> ESC key</li>
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
