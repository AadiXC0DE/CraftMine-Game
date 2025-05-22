'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { Button } from '@/components/ui/button';
import { Play, HelpCircle } from 'lucide-react';

// Game Constants
const BLOCK_SIZE = 1;
const TERRAIN_WIDTH = 64; // In blocks
const TERRAIN_DEPTH = 64; // In blocks
const GRASS_LAYER_DEPTH = 3;
const PLAYER_HEIGHT = BLOCK_SIZE * 1.75;
const PLAYER_SPEED = 5.0;
const GRAVITY = -15.0;
const JUMP_VELOCITY = 7.0;

// Material definitions
const materials = {
  grass: new THREE.MeshStandardMaterial({ color: 0x70AD47, roughness: 0.8, metalness: 0.1 }), // Primary green
  dirt: new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9, metalness: 0.1 }),   // SaddleBrown
  wood: new THREE.MeshStandardMaterial({ color: 0xA0522D, roughness: 0.8, metalness: 0.1 }),   // Sienna
  leaves: new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.7, metalness: 0.1, transparent: true, opacity: 0.9 }), // ForestGreen
};
const blockGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);


export function BlockExplorerGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(true);
  const [showHelp, setShowHelp] = useState(true);

  // Refs for Three.js objects and game state
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);
  const terrainObjectsRef = useRef<THREE.Group>(new THREE.Group());
  const playerVelocity = useRef(new THREE.Vector3());
  const onGround = useRef(false);
  const moveForward = useRef(false);
  const moveBackward = useRef(false);
  const moveLeft = useRef(false);
  const moveRight = useRef(false);
  const canJump = useRef(false);
  const terrainData = useRef<number[][]>([]);

  useEffect(() => {
    if (!mountRef.current) return;

    const currentMount = mountRef.current;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF0F4EC); // Light desaturated green
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = PLAYER_HEIGHT + BLOCK_SIZE * 10; // Start above terrain
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(50, 50, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.camera.left = -100;
    sunLight.shadow.camera.right = 100;
    sunLight.shadow.camera.top = 100;
    sunLight.shadow.camera.bottom = -100;
    scene.add(sunLight);
    scene.add(sunLight.target); // Important for shadow direction

    // Sky
    const sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;
    const sunPosition = new THREE.Vector3();
    const inclination = 0.3; // Sun elevation
    const azimuth = 0.25; // Sun direction (0 = south, 0.25 = west, 0.5 = north, 0.75 = east)
    const theta = Math.PI * (inclination - 0.5);
    const phi = 2 * Math.PI * (azimuth - 0.5);
    sunPosition.x = Math.cos(phi);
    sunPosition.y = Math.sin(phi) * Math.sin(theta);
    sunPosition.z = Math.sin(phi) * Math.cos(theta);
    skyUniforms['sunPosition'].value.copy(sunPosition);
    sunLight.position.copy(sunPosition.multiplyScalar(100)); // Position directional light based on sky
    sunLight.target.position.set(0,0,0);


    // Terrain Generation
    const noise = new ImprovedNoise();
    const terrainWidthHalf = TERRAIN_WIDTH / 2;
    const terrainDepthHalf = TERRAIN_DEPTH / 2;
    
    terrainData.current = Array(TERRAIN_WIDTH).fill(null).map(() => Array(TERRAIN_DEPTH).fill(0));

    const blockInstances: { [key: string]: THREE.Matrix4[] } = {
      grass: [],
      dirt: [],
      wood: [],
      leaves: [],
    };

    for (let x = 0; x < TERRAIN_WIDTH; x++) {
      for (let z = 0; z < TERRAIN_DEPTH; z++) {
        const worldX = (x - terrainWidthHalf) * BLOCK_SIZE;
        const worldZ = (z - terrainDepthHalf) * BLOCK_SIZE;
        
        let height = Math.floor(noise.noise(x / 20, z / 20, 0) * 5 + 8); // Base height
        height += Math.floor(noise.noise(x / 10, z / 10, 0.5) * 3); // Medium features
        height = Math.max(1, height); // Ensure minimum height of 1
        terrainData.current[x][z] = height * BLOCK_SIZE;

        for (let y = 0; y < height; y++) {
          const matrix = new THREE.Matrix4().setPosition(worldX, y * BLOCK_SIZE - BLOCK_SIZE / 2, worldZ); // Center block
          if (y >= height - GRASS_LAYER_DEPTH) {
            blockInstances.grass.push(matrix);
          } else {
            blockInstances.dirt.push(matrix);
          }
        }
      }
    }
    
    // Tree Generation
    const treeCount = Math.floor(TERRAIN_WIDTH * TERRAIN_DEPTH * 0.02); // 2% density
    for (let i = 0; i < treeCount; i++) {
      const treeX = Math.floor(Math.random() * TERRAIN_WIDTH);
      const treeZ = Math.floor(Math.random() * TERRAIN_DEPTH);
      const groundHeight = terrainData.current[treeX][treeZ];
      
      if (groundHeight > BLOCK_SIZE * 2) { // Only place trees on reasonably high ground
        const treeHeight = Math.floor(Math.random() * 4) + 3; // 3-6 blocks tall trunk
        const worldX = (treeX - terrainWidthHalf) * BLOCK_SIZE;
        const worldZ = (treeZ - terrainDepthHalf) * BLOCK_SIZE;

        // Trunk
        for (let h = 0; h < treeHeight; h++) {
          const matrix = new THREE.Matrix4().setPosition(worldX, groundHeight + h * BLOCK_SIZE - BLOCK_SIZE/2, worldZ);
          blockInstances.wood.push(matrix);
        }

        // Leaves (simple canopy)
        const canopyRadius = Math.floor(Math.random() * 1) + 1; // 1-2 block radius
        const canopyHeight = Math.floor(Math.random() * 2) + 2; // 2-3 blocks tall canopy
        const canopyBaseY = groundHeight + treeHeight * BLOCK_SIZE - BLOCK_SIZE / 2;

        for (let ly = 0; ly < canopyHeight; ly++) {
          for (let lx = -canopyRadius; lx <= canopyRadius; lx++) {
            for (let lz = -canopyRadius; lz <= canopyRadius; lz++) {
              if (lx === 0 && lz === 0 && ly < canopyHeight -1) continue; // Hollow center under top layer
              if (Math.sqrt(lx*lx + lz*lz) > canopyRadius + 0.5 && ly < canopyHeight -1) continue; // Rounded shape
              const matrix = new THREE.Matrix4().setPosition(
                worldX + lx * BLOCK_SIZE, 
                canopyBaseY + ly * BLOCK_SIZE, 
                worldZ + lz * BLOCK_SIZE
              );
              blockInstances.leaves.push(matrix);
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
    camera.position.y = (terrainData.current[Math.floor(camera.position.x/BLOCK_SIZE + TERRAIN_WIDTH/2)][Math.floor(camera.position.z/BLOCK_SIZE + TERRAIN_DEPTH/2)] || BLOCK_SIZE * 10) + PLAYER_HEIGHT;


    // Controls
    const controls = new PointerLockControls(camera, renderer.domElement);
    controlsRef.current = controls;
    scene.add(controls.getObject());

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW': moveForward.current = true; break;
        case 'ArrowLeft':
        case 'KeyA': moveLeft.current = true; break;
        case 'ArrowDown':
        case 'KeyS': moveBackward.current = true; break;
        case 'ArrowRight':
        case 'KeyD': moveRight.current = true; break;
        case 'Space': if (canJump.current) playerVelocity.current.y = JUMP_VELOCITY; break;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW': moveForward.current = false; break;
        case 'ArrowLeft':
        case 'KeyA': moveLeft.current = false; break;
        case 'ArrowDown':
        case 'KeyS': moveBackward.current = false; break;
        case 'ArrowRight':
        case 'KeyD': moveRight.current = false; break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    controls.addEventListener('lock', () => { setIsPaused(false); setShowHelp(false); });
    controls.addEventListener('unlock', () => setIsPaused(true));

    // Resize handler
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (controlsRef.current && !isPaused) {
        const cam = controlsRef.current.getObject();
        
        // Apply gravity
        playerVelocity.current.y += GRAVITY * delta;
        cam.position.y += playerVelocity.current.y * delta;

        // Terrain collision
        const playerXBlock = Math.floor(cam.position.x / BLOCK_SIZE + TERRAIN_WIDTH / 2);
        const playerZBlock = Math.floor(cam.position.z / BLOCK_SIZE + TERRAIN_DEPTH / 2);
        
        let groundY = -Infinity;
        if (playerXBlock >= 0 && playerXBlock < TERRAIN_WIDTH && playerZBlock >= 0 && playerZBlock < TERRAIN_DEPTH) {
          groundY = terrainData.current[playerXBlock][playerZBlock];
        }
        
        if (cam.position.y < groundY + PLAYER_HEIGHT) {
          cam.position.y = groundY + PLAYER_HEIGHT;
          playerVelocity.current.y = 0;
          onGround.current = true;
          canJump.current = true;
        } else {
          onGround.current = false;
        }

        // Movement
        const moveSpeed = PLAYER_SPEED * delta;
        const direction = new THREE.Vector3();
        if (moveForward.current) direction.z = -1;
        if (moveBackward.current) direction.z = 1;
        if (moveLeft.current) direction.x = -1;
        if (moveRight.current) direction.x = 1;
        direction.normalize(); // Ensure consistent speed in all directions

        if (moveForward.current || moveBackward.current) {
          controlsRef.current.moveForward(direction.z * moveSpeed);
        }
        if (moveLeft.current || moveRight.current) {
          controlsRef.current.moveRight(direction.x * moveSpeed);
        }
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', handleResize);
      if (currentMount && renderer.domElement) {
        currentMount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      
      // Dispose materials and geometries
      Object.values(materials).forEach(mat => mat.dispose());
      blockGeometry.dispose();
      terrainObjectsRef.current.children.forEach(child => {
        if (child instanceof THREE.InstancedMesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    };
  }, [isPaused]); // Rerun effect if isPaused changes (relevant for controls lock/unlock)

  const startGame = () => {
    controlsRef.current?.lock();
  };

  return (
    <div ref={mountRef} className="h-full w-full relative">
      {isPaused && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm z-10">
          <h1 className="text-5xl font-bold text-primary mb-4">Block Explorer</h1>
          <Button onClick={startGame} size="lg" className="mb-4">
            <Play className="mr-2 h-5 w-5" /> Start Exploring
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
                  <li><strong>Move:</strong> WASD keys</li>
                  <li><strong>Look:</strong> Mouse</li>
                  <li><strong>Jump:</strong> Spacebar</li>
                  <li><strong>Pause/Unpause:</strong> ESC key</li>
                </ul>
                <p className="mt-3 text-sm">Click "Start Exploring" to lock mouse pointer and begin.</p>
              </CardContent>
            </Card>
          )}
           {!showHelp && <p className="text-muted-foreground">Game Paused. Press ESC to resume control if needed, or click "Start Exploring".</p>}
        </div>
      )}
    </div>
  );
}

// Minimal Card components for the help text, to avoid circular dependencies or large imports
const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`rounded-lg border bg-card text-card-foreground shadow-sm ${className}`} {...props} />
);
const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`flex flex-col space-y-1.5 p-6 ${className}`} {...props} />
);
const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, ...props }) => (
  <h3 className={`text-2xl font-semibold leading-none tracking-tight ${className}`} {...props} />
);
const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`p-6 pt-0 ${className}`} {...props} />
);

export default BlockExplorerGame;
