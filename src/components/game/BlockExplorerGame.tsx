
'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import type * as THREE from 'three'; // Import type for Three.js
import { PerspectiveCamera, Scene, WebGLRenderer, AmbientLight, DirectionalLight, Clock, Vector3, BoxGeometry, MeshStandardMaterial, InstancedMesh, Matrix4, CanvasTexture, RepeatWrapping, Color, Euler, PlaneGeometry, MeshBasicMaterial, DoubleSide, Group, BufferGeometry, BufferAttribute, Mesh } from 'three';
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
const GRASS_LAYER_DEPTH = 3; // How many blocks of grass/sand on top of dirt/sand
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
const MAX_TERRAIN_HEIGHT_BLOCKS = 35; // Max height of terrain in blocks, increased for mountains

// Flower Constants
const FLOWER_PLANE_DIM = BLOCK_SIZE * 0.7; // Width and height of flower planes
const FLOWER_SPAWN_PROBABILITY = 0.025; // Chance to spawn a flower on a grass block (Reduced by 75% from 0.1)


// --- Texture Generation ---

function createWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 64; // Rectangular for better tiling on trunks
  const context = canvas.getContext('2d')!;

  // Base wood color
  const baseColor = '#A0522D'; // Brown
  context.fillStyle = baseColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Wood grain lines
  const grainColorDark = '#8B4513'; // Darker brown
  const grainColorLight = '#B97A57'; // Lighter brown
  context.lineWidth = 1.5;
  const numLines = 5; // Fewer, more distinct lines

  for (let i = 0; i < numLines; i++) {
    const baseX = (canvas.width / (numLines + 0.5)) * (i + 0.5) + (Math.random() - 0.5) * 4; // Add some waviness to base X

    // Darker grain line
    context.strokeStyle = grainColorDark;
    context.beginPath();
    context.moveTo(baseX + (Math.random() - 0.5) * 2, 0); // Random start offset
    context.lineTo(baseX + (Math.random() - 0.5) * 5, canvas.height); // Random end offset for variation
    context.stroke();

    // Lighter highlight line
    context.strokeStyle = grainColorLight;
    context.beginPath();
    context.moveTo(baseX + 1.5 + (Math.random() - 0.5) * 2, 0); // Offset from dark line
    context.lineTo(baseX + 1.5 + (Math.random() - 0.5) * 5, canvas.height);
    context.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createLeafTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d')!;

  const baseLeafColor = '#2E8B57'; // SeaGreen
  const darkerLeafColor = '#228B22'; // ForestGreen
  const highlightLeafColor = '#3CB371'; // MediumSeaGreen

  // Fill base color
  context.fillStyle = baseLeafColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Add splotches for texture
  const numSplotches = 20;
  for (let i = 0; i < numSplotches; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 3 + 2; // Vary splotch size
    context.fillStyle = i % 2 === 0 ? darkerLeafColor : highlightLeafColor; // Alternate colors
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2, true);
    context.fill();
  }
  // Add smaller highlights for more detail
   const numHighlights = 5;
   for (let i = 0; i < numHighlights; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 1 + 0.5;
    context.fillStyle = '#90EE90'; // LightGreen for sharp highlights
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2, true);
    context.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

// Generic flower texture creator
function createFlowerTexture(
  stemColor: string,
  petalColor: string,
  petalShapeFn: (ctx: CanvasRenderingContext2D, w: number, h: number, petalColor: string) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const texSize = 32;
  canvas.width = texSize;
  canvas.height = texSize;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, texSize, texSize); // Transparent background

  // Stem (drawn first, petals will overlap)
  ctx.fillStyle = stemColor;
  const stemWidth = texSize * 0.1;
  const stemHeight = texSize * 0.6; // Stem occupies bottom 60%
  // Stem from 40% Y down to bottom of canvas
  ctx.fillRect(texSize / 2 - stemWidth / 2, texSize * 0.4, stemWidth, stemHeight);

  // Petals (drawn in the top 0% to 40% Y of the canvas)
  petalShapeFn(ctx, texSize, texSize, petalColor);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// --- Improved Petal Shape Functions ---
const drawTulipPetals = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string) => {
  ctx.fillStyle = color;
  const centerX = w / 2;
  const topY = h * 0.05;    // Top of petals very high
  const midY = h * 0.25;   // Mid-point for curves
  const bottomY = h * 0.4; // Base of petals, just above stem start
  const petalWidthTop = w * 0.25;
  const petalWidthBottom = w * 0.15;

  // Center Petal
  ctx.beginPath();
  ctx.moveTo(centerX, topY);
  ctx.quadraticCurveTo(centerX - petalWidthTop * 0.8, midY, centerX - petalWidthBottom, bottomY);
  ctx.lineTo(centerX + petalWidthBottom, bottomY);
  ctx.quadraticCurveTo(centerX + petalWidthTop * 0.8, midY, centerX, topY);
  ctx.fill();

  // Side Petal Left
  ctx.beginPath();
  ctx.moveTo(centerX - petalWidthBottom * 0.5, topY + h*0.03);
  ctx.quadraticCurveTo(centerX - petalWidthTop * 1.5, midY, centerX - petalWidthBottom * 1.2, bottomY - h*0.02);
  ctx.quadraticCurveTo(centerX - petalWidthBottom * 0.5, midY + h*0.05, centerX - petalWidthBottom * 0.5, topY + h*0.03);
  ctx.fill();

  // Side Petal Right
  ctx.beginPath();
  ctx.moveTo(centerX + petalWidthBottom * 0.5, topY + h*0.03);
  ctx.quadraticCurveTo(centerX + petalWidthTop * 1.5, midY, centerX + petalWidthBottom * 1.2, bottomY - h*0.02);
  ctx.quadraticCurveTo(centerX + petalWidthBottom * 0.5, midY + h*0.05, centerX + petalWidthBottom * 0.5, topY + h*0.03);
  ctx.fill();
};

const drawDandelionPetals = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string) => {
  ctx.fillStyle = color;
  const centerX = w / 2;
  const centerY = h * 0.2; // Center of the dandelion head
  const numOuterPetals = 16;
  const outerRadius = w * 0.38;
  const innerRadius = w * 0.05; // Small center point

  for (let i = 0; i < numOuterPetals; i++) {
    const angle = (i / numOuterPetals) * Math.PI * 2;
    // Thin, slightly irregular petals
    const petalLength = outerRadius * (0.8 + Math.random() * 0.2);
    const tipX = centerX + Math.cos(angle) * petalLength;
    const tipY = centerY + Math.sin(angle) * petalLength;
    const baseOffX = Math.cos(angle + Math.PI/32) * innerRadius;
    const baseOffY = Math.sin(angle + Math.PI/32) * innerRadius;
    
    ctx.beginPath();
    ctx.moveTo(centerX + baseOffX, centerY + baseOffY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(centerX - baseOffX, centerY - baseOffY); // Connect to other side of center for thin line
    ctx.closePath();
    ctx.fill();
  }
  // Add a very small darker center if needed
  // ctx.fillStyle = '#DAA520'; // Darker yellow
  // ctx.beginPath();
  // ctx.arc(centerX, centerY, innerRadius * 0.8, 0, Math.PI * 2);
  // ctx.fill();
};

const drawCornflowerPetals = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string) => {
  ctx.fillStyle = color;
  const centerX = w / 2;
  const centerY = h * 0.22; // Center of flower
  const numPetals = 6;
  const outerRadius = w * 0.35;
  const innerRadius = w * 0.1;
  const tipIndent = 0.8; // How much the petal tip indents

  for (let i = 0; i < numPetals; i++) {
    const angle = (i / numPetals) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX + Math.cos(angle) * innerRadius, centerY + Math.sin(angle) * innerRadius);
    // Create a characteristic "toothy" or "frilled" cornflower petal
    ctx.lineTo(centerX + Math.cos(angle - 0.15) * outerRadius, centerY + Math.sin(angle - 0.15) * outerRadius);
    ctx.lineTo(centerX + Math.cos(angle) * outerRadius * tipIndent, centerY + Math.sin(angle) * outerRadius * tipIndent); // Indent
    ctx.lineTo(centerX + Math.cos(angle + 0.15) * outerRadius, centerY + Math.sin(angle + 0.15) * outerRadius);
    ctx.closePath();
    ctx.fill();
  }
   // Darker small center
  ctx.fillStyle = '#303F9F'; // Darker blue
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius * 0.7, 0, Math.PI * 2);
  ctx.fill();
};

const drawDaisyPetals = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string) => {
  const centerX = w / 2;
  const centerY = h * 0.2; // Center of daisy
  const numPetals = 12;
  const petalLength = w * 0.33;
  const petalBaseWidth = w * 0.08;
  const petalTipWidth = w * 0.12;

  // Petals
  ctx.fillStyle = color; // White
  for (let i = 0; i < numPetals; i++) {
    const angle = (i / numPetals) * Math.PI * 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(petalBaseWidth / 2, 0); // Base right
    ctx.lineTo(petalLength, -petalTipWidth / 2); // Tip top
    ctx.lineTo(petalLength, petalTipWidth / 2);  // Tip bottom
    ctx.lineTo(-petalBaseWidth / 2, 0); // Base left
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Yellow Center
  ctx.fillStyle = '#FFD700'; // Gold
  ctx.beginPath();
  ctx.arc(centerX, centerY, w * 0.14, 0, Math.PI * 2); // Slightly larger center
  ctx.fill();
};

const drawAlliumPetals = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string) => {
  ctx.fillStyle = color;
  const centerX = w / 2;
  const centerY = h * 0.18; // Center of the allium globe, slightly higher
  const globeRadius = w * 0.28;
  const numFlorets = 25; // More florets for denser look

  // Base color for the globe
  ctx.beginPath();
  ctx.arc(centerX, centerY, globeRadius, 0, Math.PI * 2);
  ctx.fill();

  // Add texture to suggest florets (dots of slightly varied shades)
  const baseColorHex = color; // Assuming color is hex e.g. #FFC0CB
  const r = parseInt(baseColorHex.slice(1, 3), 16);
  const g = parseInt(baseColorHex.slice(3, 5), 16);
  const b = parseInt(baseColorHex.slice(5, 7), 16);

  for (let i = 0; i < numFlorets; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * globeRadius * 0.9; // Keep dots within the main sphere
    const floretX = centerX + Math.cos(angle) * dist;
    const floretY = centerY + Math.sin(angle) * dist;
    const floretRadius = w * 0.03 + Math.random() * w * 0.01; // Vary floret size

    // Create slightly lighter/darker shades of the base petal color
    const variation = (Math.random() - 0.5) * 40; // +/- 20
    const rVar = Math.max(0, Math.min(255, r + variation)).toString(16).padStart(2, '0');
    const gVar = Math.max(0, Math.min(255, g + variation)).toString(16).padStart(2, '0');
    const bVar = Math.max(0, Math.min(255, b + variation)).toString(16).padStart(2, '0');
    ctx.fillStyle = `#${rVar}${gVar}${bVar}`;

    ctx.beginPath();
    ctx.arc(floretX, floretY, floretRadius, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawPoppyPetals = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string) => {
  ctx.fillStyle = color;
  const centerX = w / 2;
  const centerY = h * 0.25; // Center of the flower
  const numPetals = 4;
  const mainRadius = w * 0.3; // Controls overall size
  const crinkleFactor = 0.15; // How much "crinkle"

  for (let i = 0; i < numPetals; i++) {
    const angle = (i / numPetals) * Math.PI * 2 + Math.PI / numPetals; // Offset for overlap
    
    ctx.beginPath();
    ctx.moveTo(centerX, centerY); // Start from center

    // Control points for a wide, slightly irregular petal
    const cp1x = centerX + Math.cos(angle - 0.4) * mainRadius * (1 + (Math.random()-0.5)*crinkleFactor);
    const cp1y = centerY + Math.sin(angle - 0.4) * mainRadius * (1 + (Math.random()-0.5)*crinkleFactor);
    const cp2x = centerX + Math.cos(angle + 0.4) * mainRadius * (1 + (Math.random()-0.5)*crinkleFactor);
    const cp2y = centerY + Math.sin(angle + 0.4) * mainRadius * (1 + (Math.random()-0.5)*crinkleFactor);
    const tipX = centerX + Math.cos(angle) * mainRadius * 1.1 * (1 + (Math.random()-0.5)*crinkleFactor*0.5); // Slightly pointier tip
    const tipY = centerY + Math.sin(angle) * mainRadius * 1.1 * (1 + (Math.random()-0.5)*crinkleFactor*0.5);
    
    ctx.quadraticCurveTo(cp1x, cp1y, tipX, tipY);
    ctx.quadraticCurveTo(cp2x, cp2y, centerX, centerY);
    ctx.fill();
  }

  // Dark center
  ctx.fillStyle = '#2A2A2A'; // Very dark grey, almost black
  ctx.beginPath();
  ctx.arc(centerX, centerY, w * 0.09, 0, Math.PI * 2);
  ctx.fill();
};


// --- Flower Definitions ---
interface FlowerDefinition {
  name: string;
  stemColor: string;
  petalColor: string;
  petalShapeFn: (ctx: CanvasRenderingContext2D, w: number, h: number, petalColor: string) => void;
  material?: THREE.MeshBasicMaterial;
}

const flowerDefinitions: FlowerDefinition[] = [
  { name: 'redTulip', stemColor: '#2E7D32', petalColor: '#E53935', petalShapeFn: drawTulipPetals },       // Darker Green Stem, Strong Red
  { name: 'yellowDandelion', stemColor: '#388E3C', petalColor: '#FFEB3B', petalShapeFn: drawDandelionPetals }, // Medium Green Stem, Bright Yellow
  { name: 'blueCornflower', stemColor: '#2E7D32', petalColor: '#1E88E5', petalShapeFn: drawCornflowerPetals }, // Darker Green Stem, Vibrant Blue
  { name: 'whiteDaisy', stemColor: '#4CAF50', petalColor: '#FFFFFF', petalShapeFn: drawDaisyPetals },      // Lighter Green Stem, Pure White
  { name: 'pinkAllium', stemColor: '#388E3C', petalColor: '#EC407A', petalShapeFn: drawAlliumPetals },       // Medium Green Stem, Deep Pink
  { name: 'orangePoppy', stemColor: '#4CAF50', petalColor: '#FB8C00', petalShapeFn: drawPoppyPetals },     // Lighter Green Stem, Bright Orange
];

// --- Geometries (created once) ---
const blockGeometry = new BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
const cloudSegmentGeometry = new BoxGeometry(CLOUD_SEGMENT_BASE_SIZE, CLOUD_SEGMENT_THICKNESS, CLOUD_SEGMENT_BASE_SIZE);

const FLOWER_CROSS_GEOMETRY = (() => {
    const geometry = new BufferGeometry();
    const w_geom = FLOWER_PLANE_DIM / 2;
    const h_geom = FLOWER_PLANE_DIM / 2;

    const vertices_corrected = new Float32Array([
        // Plane 1 (on XY, billboard towards Z)
        -w_geom, -h_geom, 0,   w_geom, -h_geom, 0,   w_geom,  h_geom, 0,
        -w_geom, -h_geom, 0,   w_geom,  h_geom, 0,  -w_geom,  h_geom, 0,
        // Plane 2 (on ZY, billboard towards X)
        0, -h_geom, -w_geom,   0, -h_geom,  w_geom,   0,  h_geom,  w_geom,
        0, -h_geom, -w_geom,   0,  h_geom,  w_geom,   0,  h_geom, -w_geom,
    ]);
    geometry.setAttribute('position', new BufferAttribute(vertices_corrected, 3));
    
     const uvs = new Float32Array([
        0, 0,  1, 0,  1, 1,
        0, 0,  1, 1,  0, 1,
        0, 0,  1, 0,  1, 1,
        0, 0,  1, 1,  0, 1,
    ]);
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));

    geometry.computeVertexNormals(); 
    return geometry;
})();


// --- Materials (cached at module level) ---
const woodTexture = createWoodTexture();
const leafTexture = createLeafTexture();

const materials = {
  grass: new MeshStandardMaterial({ color: 0x70AD47, roughness: 0.8, metalness: 0.1 }),
  dirt: new MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9, metalness: 0.1 }),
  wood: new MeshStandardMaterial({ map: woodTexture, roughness: 0.8, metalness: 0.1 }),
  leaves: new MeshStandardMaterial({ map: leafTexture, roughness: 0.7, metalness: 0.1, alphaTest: 0.1, side: DoubleSide, transparent: true }),
  cloud: new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, transparent: true, opacity: 0.9 }),
  water: new MeshStandardMaterial({ color: 0x4682B4, opacity: 0.65, transparent: true, roughness: 0.1, metalness: 0.1, side: DoubleSide }),
  sand: new MeshStandardMaterial({ color: 0xF4A460, roughness: 0.9, metalness: 0.1 }),
};

// Initialize flower materials
flowerDefinitions.forEach(def => {
  const texture = createFlowerTexture(def.stemColor, def.petalColor, def.petalShapeFn);
  def.material = new MeshBasicMaterial({
    map: texture,
    alphaTest: 0.2, 
    transparent: true,
    side: DoubleSide, 
  });
});


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

  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);

  const playerVelocity = useRef(new Vector3());
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
  const cloudsGroupRef = useRef<Group | null>(null);
  const sunPositionVecRef = useRef(new Vector3());


  const generateChunk = useCallback((chunkX: number, chunkZ: number): ChunkData | null => {
    if (!noiseRef.current) return null;
    const noise = noiseRef.current;

    const chunkTerrainHeights: number[][] = Array(CHUNK_WIDTH).fill(null).map(() => Array(CHUNK_DEPTH).fill(0));
    const blockInstances: { [key: string]: THREE.Matrix4[] } = {
      grass: [], dirt: [], wood: [], leaves: [], water: [], sand: [],
      ...flowerDefinitions.reduce((acc, def) => {
        acc[`flower_${def.name}`] = [];
        return acc;
      }, {} as Record<string, THREE.Matrix4[]>)
    };


    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let z = 0; z < CHUNK_DEPTH; z++) {
        const globalNoiseX = chunkX * CHUNK_WIDTH + x;
        const globalNoiseZ = chunkZ * CHUNK_DEPTH + z;
        const worldXPos = (chunkX * CHUNK_WIDTH + x) * BLOCK_SIZE;
        const worldZPos = (chunkZ * CHUNK_DEPTH + z) * BLOCK_SIZE;

        let primaryHills = noise.noise(globalNoiseX / 35, globalNoiseZ / 35, 0) * 7 + 7; 
        let secondaryDetail = noise.noise(globalNoiseX / 12, globalNoiseZ / 12, 0.5) * 3;
        const mountainNoiseVal = noise.noise(globalNoiseX / 100, globalNoiseZ / 100, 1.0);
        let mountainBoost = 0;
        if (mountainNoiseVal > 0.2) mountainBoost = (mountainNoiseVal - 0.2) * 25;
        
        let baseTerrainHeightBlocks = Math.floor(primaryHills + secondaryDetail + mountainBoost);
        baseTerrainHeightBlocks = Math.min(baseTerrainHeightBlocks, MAX_TERRAIN_HEIGHT_BLOCKS);
        baseTerrainHeightBlocks = Math.max(1, baseTerrainHeightBlocks); 

        chunkTerrainHeights[x][z] = (baseTerrainHeightBlocks -1) * BLOCK_SIZE + BLOCK_SIZE / 2;
        const highestSolidBlockCenterY = (baseTerrainHeightBlocks - 1) * BLOCK_SIZE; 
        
        let surfaceBlockType: 'grass' | 'sand' = 'grass';
        if (highestSolidBlockCenterY < WATER_LEVEL_Y_CENTER) { 
          surfaceBlockType = 'sand';
        } else if (highestSolidBlockCenterY === WATER_LEVEL_Y_CENTER) { 
          if (Math.random() < 0.15) surfaceBlockType = 'sand'; 
        }
       
        for (let yBlockIndex = 0; yBlockIndex < baseTerrainHeightBlocks; yBlockIndex++) {
          const currentBlock_CenterY = yBlockIndex * BLOCK_SIZE;
          const matrix = new Matrix4().setPosition(worldXPos, currentBlock_CenterY, worldZPos);
          if (yBlockIndex === baseTerrainHeightBlocks - 1) { 
            blockInstances[surfaceBlockType].push(matrix);
          } else { 
            if (surfaceBlockType === 'sand' && yBlockIndex >= baseTerrainHeightBlocks - GRASS_LAYER_DEPTH) {
              blockInstances.sand.push(matrix); 
            } else {
              blockInstances.dirt.push(matrix); 
            }
          }
        }

        if (surfaceBlockType === 'grass') { 
            if (Math.random() < FLOWER_SPAWN_PROBABILITY) {
                const randomFlowerDef = flowerDefinitions[Math.floor(Math.random() * flowerDefinitions.length)];
                const flowerTopSurfaceY = chunkTerrainHeights[x][z]; 
                const flowerCenterY = flowerTopSurfaceY - (BLOCK_SIZE / 2) + (FLOWER_PLANE_DIM / 2);

                const flowerMatrix = new Matrix4().setPosition(
                    worldXPos + (Math.random() - 0.5) * BLOCK_SIZE * 0.6, 
                    flowerCenterY,
                    worldZPos + (Math.random() - 0.5) * BLOCK_SIZE * 0.6
                );
                flowerMatrix.multiply(new Matrix4().makeRotationY(Math.random() * Math.PI * 2));
                blockInstances[`flower_${randomFlowerDef.name}`].push(flowerMatrix);
            }
        }

        for (let yWaterCenter = highestSolidBlockCenterY + BLOCK_SIZE; yWaterCenter <= WATER_LEVEL_Y_CENTER; yWaterCenter += BLOCK_SIZE) {
          blockInstances.water.push(new Matrix4().setPosition(worldXPos, yWaterCenter, worldZPos));
        }
      }
    }

    const treeCount = Math.floor(CHUNK_WIDTH * CHUNK_DEPTH * 0.015); 
    for (let i = 0; i < treeCount; i++) {
      const treeLocalX = Math.floor(Math.random() * CHUNK_WIDTH);
      const treeLocalZ = Math.floor(Math.random() * CHUNK_DEPTH);

      const groundSurfaceYForTree = chunkTerrainHeights[treeLocalX]?.[treeLocalZ];
      if (groundSurfaceYForTree === undefined || groundSurfaceYForTree <= WATER_LEVEL_Y_CENTER + BLOCK_SIZE / 2) continue;

      const firstTrunkBlockCenterY = groundSurfaceYForTree + (BLOCK_SIZE / 2); 

      if (firstTrunkBlockCenterY - (BLOCK_SIZE / 2) > -Infinity) { 
        const treeHeight = Math.floor(Math.random() * 3) + 4; 
        const worldTreeRootX = (chunkX * CHUNK_WIDTH + treeLocalX) * BLOCK_SIZE;
        const worldTreeRootZ = (chunkZ * CHUNK_DEPTH + treeLocalZ) * BLOCK_SIZE;

        for (let h = 0; h < treeHeight; h++) {
          blockInstances.wood.push(new Matrix4().setPosition(worldTreeRootX, firstTrunkBlockCenterY + (h * BLOCK_SIZE), worldTreeRootZ));
        }

        const topTrunkY = firstTrunkBlockCenterY + ((treeHeight - 1) * BLOCK_SIZE);
        const canopyBaseY = topTrunkY + BLOCK_SIZE; 

        for (let lyOffset = 0; lyOffset < 2; lyOffset++) { 
          const currentLayerY = canopyBaseY + lyOffset * BLOCK_SIZE;
          for (let lx = -2; lx <= 2; lx++) {
            for (let lz = -2; lz <= 2; lz++) {
              if (lyOffset === 0 && Math.abs(lx) === 2 && Math.abs(lz) === 2) { if (Math.random() < 0.6) continue; } 
              else if (lyOffset === 0 && (Math.abs(lx) === 2 || Math.abs(lz) === 2)) { if (Math.random() < 0.25) continue; } 
              if (lyOffset === 0 && lx === 0 && lz === 0) continue;
              blockInstances.leaves.push(new Matrix4().setPosition(worldTreeRootX + lx * BLOCK_SIZE, currentLayerY, worldTreeRootZ + lz * BLOCK_SIZE));
            }
          }
        }

        const topCapY = canopyBaseY + 2 * BLOCK_SIZE; 
        for (let lx = -1; lx <= 1; lx++) {
          for (let lz = -1; lz <= 1; lz++) {
             if (Math.abs(lx) === 1 && Math.abs(lz) === 1) { if (Math.random() < 0.4) continue; }
            blockInstances.leaves.push(new Matrix4().setPosition(worldTreeRootX + lx * BLOCK_SIZE, topCapY, worldTreeRootZ + lz * BLOCK_SIZE));
          }
        }
        if (Math.random() < 0.75) { 
            blockInstances.leaves.push(new Matrix4().setPosition(worldTreeRootX, topCapY + BLOCK_SIZE, worldTreeRootZ));
        }
        
        const outreachLeafPositions = [
            { x: 0, y: 0, z: 2, p: 0.6 }, { x: 0, y: 0, z: -2, p: 0.6 }, 
            { x: 2, y: 0, z: 0, p: 0.6 }, { x: -2, y: 0, z: 0, p: 0.6 }, 
            { x: 1, y: 1, z: 2, p: 0.4 }, { x: -1, y: 1, z: 2, p: 0.4 },
            { x: 1, y: 1, z: -2, p: 0.4 }, { x: -1, y: 1, z: -2, p: 0.4 },
            { x: 2, y: 1, z: 1, p: 0.4 }, { x: 2, y: 1, z: -1, p: 0.4 },
            { x: -2, y: 1, z: 1, p: 0.4 }, { x: -2, y: 1, z: -1, p: 0.4 },
            { x: 0, y: 2, z: 1, p: 0.5 }, { x: 0, y: 2, z: -1, p: 0.5 },
            { x: 1, y: 2, z: 0, p: 0.5 }, { x: -1, y: 2, z: 0, p: 0.5 },
        ];
        outreachLeafPositions.forEach(pos => {
            if (Math.random() < pos.p) { 
                blockInstances.leaves.push(new Matrix4().setPosition(
                    worldTreeRootX + pos.x * BLOCK_SIZE,
                    canopyBaseY + pos.y * BLOCK_SIZE, 
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
        let currentGeometry: THREE.BufferGeometry = blockGeometry; 
        let castShadow = true;
        let receiveShadow = true;

        if (type.startsWith('flower_')) {
            const flowerName = type.substring('flower_'.length);
            const flowerDef = flowerDefinitions.find(fd => fd.name === flowerName);
            if (!flowerDef || !flowerDef.material) return; 
            currentMaterial = flowerDef.material;
            currentGeometry = FLOWER_CROSS_GEOMETRY;
            castShadow = false; 
            receiveShadow = false;
        } else if (type === 'grass') {
          currentMaterial = [
            materials.dirt, materials.dirt, 
            materials.grass, materials.dirt, 
            materials.dirt, materials.dirt  
          ];
        } else {
          currentMaterial = materials[type as keyof typeof materials];
        }

        if (!currentMaterial) {
            console.warn(`Material for type ${type} not found.`);
            return;
        }

        const instancedMesh = new InstancedMesh(currentGeometry, currentMaterial, matrices.length);
        matrices.forEach((matrix, idx) => instancedMesh.setMatrixAt(idx, matrix));
        instancedMesh.castShadow = castShadow;
        instancedMesh.receiveShadow = receiveShadow;
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

    if (initialChunksLoadedRef.current && currentChunkCoordsRef.current.x === currentPlayerChunkX && currentChunkCoordsRef.current.z === currentPlayerChunkZ) return; 
    currentChunkCoordsRef.current = { x: currentPlayerChunkX, z: currentPlayerChunkZ };

    const newRequiredChunks = new Set<string>();
    for (let dx = -VIEW_DISTANCE_CHUNKS; dx <= VIEW_DISTANCE_CHUNKS; dx++) {
      for (let dz = -VIEW_DISTANCE_CHUNKS; dz <= VIEW_DISTANCE_CHUNKS; dz++) {
        newRequiredChunks.add(`${currentPlayerChunkX + dx},${currentPlayerChunkZ + dz}`);
      }
    }
    const chunksToRemoveKeys: string[] = [];
    loadedChunksRef.current.forEach((_, chunkKey) => { if (!newRequiredChunks.has(chunkKey)) chunksToRemoveKeys.push(chunkKey); });
    chunksToRemoveKeys.forEach(chunkKey => {
      const chunkData = loadedChunksRef.current.get(chunkKey);
      if (chunkData && sceneRef.current) {
        chunkData.meshes.forEach(mesh => { sceneRef.current?.remove(mesh); mesh.geometry.dispose(); });
        loadedChunksRef.current.delete(chunkKey);
      }
    });
    newRequiredChunks.forEach(chunkKey => {
      if (!loadedChunksRef.current.has(chunkKey) && sceneRef.current) {
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
    const euler = new Euler(0, 0, 0, 'YXZ');
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

  const createCloudSegment = useCallback(() => {
    const segment = new Mesh(cloudSegmentGeometry, materials.cloud);
    const scaleVariation = 0.5 + Math.random(); 
    segment.scale.set(scaleVariation, 0.5 + Math.random() * 0.5, scaleVariation);
    segment.castShadow = true; segment.receiveShadow = true;
    return segment;
  }, []);

  const createCloud = useCallback(() => {
    const cloud = new Group();
    const numSegments = MIN_SEGMENTS_PER_CLOUD + Math.floor(Math.random() * (MAX_SEGMENTS_PER_CLOUD - MIN_SEGMENTS_PER_CLOUD + 1));
    let currentX = 0; let currentZ = 0;
    for (let i = 0; i < numSegments; i++) {
        const segment = createCloudSegment();
        segment.position.set(currentX, (Math.random() - 0.5) * CLOUD_SEGMENT_THICKNESS * 2, currentZ);
        cloud.add(segment);
        currentX += (Math.random() - 0.5) * CLOUD_SEGMENT_BASE_SIZE * 1.5;
        currentZ += (Math.random() - 0.5) * CLOUD_SEGMENT_BASE_SIZE * 1.5;
    }
    return cloud;
  }, [createCloudSegment]);


  useEffect(() => {
    if (!mountRef.current) return;

    const currentMount = mountRef.current;

    const scene = new Scene();
    scene.background = new Color(0x87CEEB); 
    sceneRef.current = scene;

    const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 2.5);
    cameraRef.current = camera;

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = PerspectiveCamera.PCFSoftShadowMap; 
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new AmbientLight(0xffffff, 0.7); 
    scene.add(ambientLight);

    const sunLight = new DirectionalLight(0xffffff, 1.8); 
    sunLight.position.set(50, 100, 75); 
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048; sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5; sunLight.shadow.camera.far = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 3; 
    const shadowCamSize = VIEW_DISTANCE_CHUNKS * CHUNK_WIDTH * BLOCK_SIZE * 1.5;
    sunLight.shadow.camera.left = -shadowCamSize; sunLight.shadow.camera.right = shadowCamSize;
    sunLight.shadow.camera.top = shadowCamSize; sunLight.shadow.camera.bottom = -shadowCamSize;
    scene.add(sunLight); scene.add(sunLight.target); 

    const sky = new Sky();
    sky.scale.setScalar(SKY_RADIUS); 
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 10; skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005; skyUniforms['mieDirectionalG'].value = 0.8;
    
    sunPositionVecRef.current.setFromSphericalCoords(1, Math.PI / 2 - 0.45, Math.PI * 0.35); 
    skyUniforms['sunPosition'].value.copy(sunPositionVecRef.current);
    sunLight.position.copy(sunPositionVecRef.current.clone().multiplyScalar(150)); 
    sunLight.target.position.set(0,0,0); 

    const sunGeometry = new PlaneGeometry(SUN_SIZE, SUN_SIZE);
    const sunMaterial = new MeshBasicMaterial({ color: 0xFFFBC1, side: DoubleSide, fog: false }); 
    sunMeshRef.current = new Mesh(sunGeometry, sunMaterial);
    sunMeshRef.current.position.copy(sunPositionVecRef.current.clone().multiplyScalar(SKY_RADIUS * 0.8)); 
    sunMeshRef.current.lookAt(new Vector3(0,0,0)); 
    scene.add(sunMeshRef.current);

    cloudsGroupRef.current = new Group();
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
    camera.position.y = (initialGroundY > -Infinity ? initialGroundY + PLAYER_HEIGHT - (BLOCK_SIZE / 2) : PLAYER_HEIGHT + 20 * BLOCK_SIZE);


    const controls = new PointerLockControls(camera, renderer.domElement);
    controlsRef.current = controls; scene.add(controls.getObject()); 

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
             if (controlsRef.current?.isLocked) controlsRef.current.unlock(); else setIsPaused(true); 
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
    document.addEventListener('keydown', onKeyDown); document.addEventListener('keyup', onKeyUp);

    const onControlsLock = () => { setIsPaused(false); setShowHelp(false); setPointerLockError(null); setIsPointerLockUnavailable(false); isUsingFallbackControlsRef.current = false; if (rendererRef.current?.domElement) { rendererRef.current.domElement.removeEventListener('mousedown', handleCanvasMouseDown); document.removeEventListener('mousemove', handleDocumentMouseMove); document.removeEventListener('mouseup', handleDocumentMouseUp); document.removeEventListener('mouseleave', handleDocumentMouseUp); } };
    const onControlsUnlock = () => { setIsPaused(true); if (!pointerLockError && !isPointerLockUnavailable) setShowHelp(true); };
    controls.addEventListener('lock', onControlsLock); controls.addEventListener('unlock', onControlsUnlock);

    const handleResize = () => { if (cameraRef.current && rendererRef.current) { cameraRef.current.aspect = window.innerWidth / window.innerHeight; cameraRef.current.updateProjectionMatrix(); rendererRef.current.setSize(window.innerWidth, window.innerHeight); } };
    window.addEventListener('resize', handleResize);

    const clock = new Clock(); let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      updateChunks(); 

      if (cloudsGroupRef.current && cameraRef.current) {
          cloudsGroupRef.current.position.x = cameraRef.current.position.x; 
          cloudsGroupRef.current.position.z = cameraRef.current.position.z; 
          cloudsGroupRef.current.children.forEach(cloud => {
              cloud.position.x += CLOUD_SPEED * delta; 
              if (cloud.position.x > CLOUD_AREA_SPREAD / 2) {
                  cloud.position.x = -CLOUD_AREA_SPREAD / 2;
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
        const playerFeetBottomY = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2); 

        if (playerFeetBottomY < groundSurfaceY + COLLISION_TOLERANCE) { 
          cam.position.y = groundSurfaceY + PLAYER_HEIGHT - (BLOCK_SIZE / 2); 
          playerVelocity.current.y = 0;
          onGround.current = true;
          canJump.current = true;
        } else {
          onGround.current = false;
        }

        const moveSpeed = PLAYER_SPEED * (onGround.current ? 1 : 0.9) * delta; 
        const moveDirection = new Vector3();
        const forwardVector = new Vector3();
        cam.getWorldDirection(forwardVector);
        const cameraDirectionXZ = new Vector3(forwardVector.x, 0, forwardVector.z).normalize();
        const rightVectorXZ = new Vector3().crossVectors(cameraDirectionXZ, sceneRef.current.up).normalize();


        if (moveForward.current) moveDirection.add(cameraDirectionXZ);
        if (moveBackward.current) moveDirection.sub(cameraDirectionXZ);
        if (moveLeft.current) moveDirection.sub(rightVectorXZ); 
        if (moveRight.current) moveDirection.add(rightVectorXZ); 

        if (moveDirection.lengthSq() > 0) { 
            moveDirection.normalize();
            const oldPosition = cam.position.clone();
            cam.position.addScaledVector(moveDirection, moveSpeed);

            const playerFeetAbsY = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2); 
            const playerHeadAbsY = cam.position.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE; 

            const targetBlockWorldX = cam.position.x;
            const targetBlockWorldZ = cam.position.z;
            const collisionColumnSurfaceY = getPlayerGroundHeight(targetBlockWorldX, targetBlockWorldZ); 
            
            const blockTopAbsY = collisionColumnSurfaceY;
            const blockBottomAbsY = collisionColumnSurfaceY - BLOCK_SIZE; 

            if (playerFeetAbsY < (blockTopAbsY - COLLISION_TOLERANCE) && playerHeadAbsY > (blockBottomAbsY + COLLISION_TOLERANCE) ) {
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

                if (playerMaxX > blockMinX && playerMinX < blockMaxX && playerMaxZ > blockMinZ && playerMinZ < blockMaxZ) {
                    let hitX = false, hitZ = false;

                    const tempPosCheckZ = oldPosition.clone();
                    tempPosCheckZ.z = cam.position.z;  
                    const feetAtZMove = tempPosCheckZ.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                    const headAtZMove = tempPosCheckZ.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                    const heightAtZMove = getPlayerGroundHeight(tempPosCheckZ.x, tempPosCheckZ.z);
                    if (feetAtZMove < (heightAtZMove - COLLISION_TOLERANCE) && headAtZMove > (heightAtZMove - BLOCK_SIZE + COLLISION_TOLERANCE)) {
                        hitZ = true;
                    }

                    const tempPosCheckX = oldPosition.clone();
                    tempPosCheckX.x = cam.position.x; 
                    const feetAtXMove = tempPosCheckX.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                    const headAtXMove = tempPosCheckX.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                    const heightAtXMove = getPlayerGroundHeight(tempPosCheckX.x, tempPosCheckX.z);
                     if (feetAtXMove < (heightAtXMove - COLLISION_TOLERANCE) && headAtXMove > (heightAtXMove - BLOCK_SIZE + COLLISION_TOLERANCE)) {
                        hitX = true;
                    }
                    
                    if (hitX && !hitZ) cam.position.x = oldPosition.x; 
                    else if (hitZ && !hitX) cam.position.z = oldPosition.z; 
                    else if (hitX && hitZ) cam.position.set(oldPosition.x, cam.position.y, oldPosition.z); 

                    const finalCollisionCheckHeight = getPlayerGroundHeight(cam.position.x, cam.position.z);
                    const finalPlayerFeet = cam.position.y - PLAYER_HEIGHT + (BLOCK_SIZE / 2);
                    const finalPlayerHead = cam.position.y + (BLOCK_SIZE / 2) - COLLISION_TOLERANCE;
                    if (finalPlayerFeet < (finalCollisionCheckHeight - COLLISION_TOLERANCE) && finalPlayerHead > (finalCollisionCheckHeight - BLOCK_SIZE + COLLISION_TOLERANCE)) {
                        cam.position.set(oldPosition.x, cam.position.y, oldPosition.z); 
                    }
                }
            }
        }
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', handleResize);
      controlsRef.current?.removeEventListener('lock', onControlsLock); controlsRef.current?.removeEventListener('unlock', onControlsUnlock);
      controlsRef.current?.disconnect(); 
      if (currentMount && rendererRef.current?.domElement) currentMount.removeChild(rendererRef.current.domElement);
      rendererRef.current?.dispose();
      sky?.material.dispose(); 
      
      woodTexture.dispose();
      leafTexture.dispose();
      
      if (sunMeshRef.current) {
        sunMeshRef.current.geometry.dispose();
        if (Array.isArray(sunMeshRef.current.material)) { sunMeshRef.current.material.forEach(m => m.dispose());} else { (sunMeshRef.current.material as THREE.Material).dispose(); }
      }
      if (cloudsGroupRef.current) {
        cloudsGroupRef.current.children.forEach(cloud => {
            if (cloud instanceof Group) {
                cloud.children.forEach(segment => {
                    if (segment instanceof Mesh) { (segment.geometry as THREE.BufferGeometry).dispose(); } 
                });
            }
        });
      }
      cloudSegmentGeometry.dispose(); 

      Object.values(materials).forEach(mat => {
        if (Array.isArray(mat)) { mat.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });} 
        else { if (mat.map && mat.map !== woodTexture && mat.map !== leafTexture) mat.map.dispose(); mat.dispose(); }
      });
      blockGeometry.dispose(); 
      FLOWER_CROSS_GEOMETRY.dispose();
      flowerDefinitions.forEach(def => {
          def.material?.map?.dispose(); 
          def.material?.dispose();      
      });

      loadedChunksRef.current.forEach(chunkData => {  });
      loadedChunksRef.current.clear();
      if (sceneRef.current) { while(sceneRef.current.children.length > 0){ const obj = sceneRef.current.children[0]; sceneRef.current.remove(obj);  } }

      rendererRef.current?.domElement?.removeEventListener('mousedown', handleCanvasMouseDown);
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('mouseleave', handleDocumentMouseUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getPlayerGroundHeight, updateChunks, generateChunk, createCloud, createCloudSegment, handleCanvasMouseDown, handleDocumentMouseMove, handleDocumentMouseUp]); 


  const startGame = () => {
    setPointerLockError(null); setIsPointerLockUnavailable(false);
    if (rendererRef.current?.domElement && isUsingFallbackControlsRef.current) { rendererRef.current.domElement.removeEventListener('mousedown', handleCanvasMouseDown); document.removeEventListener('mousemove', handleDocumentMouseMove); document.removeEventListener('mouseup', handleDocumentMouseUp); document.removeEventListener('mouseleave', handleDocumentMouseUp); }
    isUsingFallbackControlsRef.current = false; 

    if (controlsRef.current && rendererRef.current?.domElement) {
      rendererRef.current.domElement.setAttribute('tabindex', '-1'); 
      rendererRef.current.domElement.focus();
      try {
        controlsRef.current.lock();
      } catch (e: any) {
        console.error("BlockExplorerGame: Pointer lock request failed. Original error:", e);
        let friendlyMessage = "Error: Could not lock the mouse pointer.\n\n";
        if (e && e.message && (e.message.includes("sandboxed") || e.message.includes("allow-pointer-lock") || e.name === 'NotSupportedError' || e.message.includes("Pointer Lock API is not available") || e.message.includes("denied") || e.message.includes("not focused"))) {
          friendlyMessage += "This often happens in restricted environments (like iframes without 'allow-pointer-lock' permission) or if the document isn't focused.\n\nSwitched to **Click & Drag** to look around.\nMove: WASD, Jump: Space.\n\nFor the full experience, try opening the game in a new browser tab or ensuring the game window is active.";
          setPointerLockError(friendlyMessage);
          setIsPointerLockUnavailable(true);
          isUsingFallbackControlsRef.current = true; 
          rendererRef.current?.domElement.addEventListener('mousedown', handleCanvasMouseDown);
          document.addEventListener('mousemove', handleDocumentMouseMove);
          document.addEventListener('mouseup', handleDocumentMouseUp);
          document.addEventListener('mouseleave', handleDocumentMouseUp); 
          setIsPaused(false); 
          setShowHelp(false); 
        } else {
          friendlyMessage += "Common reasons: browser/iframe restrictions, document not focused, or browser settings.\n";
          friendlyMessage += `Details: "${e.message || 'Unknown error'}"\n\n(A 'THREE.PointerLockControls: Unable to use Pointer Lock API.' message may also appear in the browser's console if the API itself is unavailable.)`;
          setPointerLockError(friendlyMessage);
          setIsPaused(true); 
        }
      }
    } else {
      setPointerLockError("Game components are not ready. Please try reloading.");
      setIsPaused(true);
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
    
