'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import type * as THREE from 'three'; // Import type for Three.js
import { PerspectiveCamera, Scene, WebGLRenderer, AmbientLight, DirectionalLight, Clock, Vector3, BoxGeometry, MeshStandardMaterial, InstancedMesh, Matrix4, CanvasTexture, RepeatWrapping, Color, Euler, PlaneGeometry, MeshBasicMaterial, DoubleSide, Group, BufferGeometry, BufferAttribute, Mesh, NearestFilter, PCFSoftShadowMap } from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { Button } from '@/components/ui/button';
import { Play, HelpCircle, AlertCircle, Mouse } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import MinecraftHeart from '../MinecraftHeart';

// Game Constants
const BLOCK_SIZE = 1;
const CHUNK_WIDTH = 16; // Blocks
const CHUNK_DEPTH = 16; // Blocks
const GRASS_LAYER_DEPTH = 3; // How many blocks of grass/sand on top of dirt/sand
const PLAYER_HEIGHT = BLOCK_SIZE * 1.75;
const PLAYER_SPEED = 5.0;
const GRAVITY = -15.0;
const JUMP_VELOCITY = 7.0;
const MAX_VERTICAL_COLLISION_STEP = BLOCK_SIZE * 0.5; // Max height step player can climb automatically
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
const PLANT_PLANE_DIM = BLOCK_SIZE * 0.7; // Width and height for cross-plane plants (flowers, tall grass)
const TALL_GRASS_HEIGHT_MULTIPLIER = 1.5; // Tall grass is slightly taller than a block
const TALL_GRASS_SPAWN_PROBABILITY = 0.03; // Increased chance to spawn tall grass on a grass block
const TALL_GRASS_MATERIAL_COLOR = '#558B2F'; // Darker green for tall grass
const FLOWER_SPAWN_PROBABILITY = 0.035; // Increased chance to spawn a flower on a grass block


// --- Texture Generation ---

function createMinecraftGrassTopTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;

  // Base grass colors - more vibrant Minecraft-like greens
  const grassColors = [
    '#7CB518', '#8BC34A', '#689F38', '#7CB342',
    '#6B9A2D', '#7BA428', '#5D8016', '#6BA52A'
  ];

  // Fill with pixelated grass pattern
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const colorIndex = Math.floor(Math.random() * grassColors.length);
      context.fillStyle = grassColors[colorIndex];
      context.fillRect(x, y, 1, 1);
    }
  }

  // Add some brighter highlights
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(Math.random() * 16);
    const y = Math.floor(Math.random() * 16);
    context.fillStyle = '#9CCC65'; // Brighter green highlight
    context.fillRect(x, y, 1, 1);
  }

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createMinecraftDirtTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;

  // Base dirt colors - various shades of brown
  const dirtColors = [
    '#8B4513', '#A0522D', '#8B4026', '#7A3F14',
    '#9B4F1A', '#8A4312', '#7B3E0F', '#964B18'
  ];

  // Fill with pixelated dirt pattern
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const colorIndex = Math.floor(Math.random() * dirtColors.length);
      context.fillStyle = dirtColors[colorIndex];
      context.fillRect(x, y, 1, 1);
    }
  }

  // Add some darker spots for texture
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(Math.random() * 16);
    const y = Math.floor(Math.random() * 16);
    context.fillStyle = '#5D2F08';
    context.fillRect(x, y, 1, 1);
  }

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createMinecraftSandTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;

  // Base sand colors - various shades of tan/yellow
  const sandColors = [
    '#F4A460', '#F5DEB3', '#DEB887', '#D2B48C',
    '#E6D8B8', '#EDD5A3', '#F0E68C', '#DAA520'
  ];

  // Fill with pixelated sand pattern
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const colorIndex = Math.floor(Math.random() * sandColors.length);
      context.fillStyle = sandColors[colorIndex];
      context.fillRect(x, y, 1, 1);
    }
  }

  // Add some lighter highlights
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(Math.random() * 16);
    const y = Math.floor(Math.random() * 16);
    context.fillStyle = '#FFF8DC';
    context.fillRect(x, y, 1, 1);
  }

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createMinecraftWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;

  // Base wood color - much darker oak wood brown
  const baseColor = '#654321';
  context.fillStyle = baseColor;
  context.fillRect(0, 0, 16, 16);

  // Wood grain colors - darker browns to distinguish from dirt
  const grainColors = ['#5D2F08', '#4A2507', '#3D1E06', '#2F1705'];
  
  // Create horizontal wood grain pattern (like Minecraft logs)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // Create horizontal lines with some variation
      if (y % 2 === 0 || y % 3 === 0) {
        const colorIndex = (x + y) % grainColors.length;
        context.fillStyle = grainColors[colorIndex];
        context.fillRect(x, y, 1, 1);
      }
      
      // Add some random darker spots for knots
      if (Math.random() < 0.02) {
        context.fillStyle = '#1A0F04';
        context.fillRect(x, y, 1, 1);
      }
    }
  }

  // Add tree ring pattern (circles from center)
  const centerX = 8;
  const centerY = 8;
  context.fillStyle = '#3D1E06';
  
  // Draw concentric rings
  for (let radius = 2; radius <= 6; radius += 2) {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
      const x = Math.floor(centerX + Math.cos(angle) * radius);
      const y = Math.floor(centerY + Math.sin(angle) * radius);
      if (x >= 0 && x < 16 && y >= 0 && y < 16) {
        context.fillRect(x, y, 1, 1);
      }
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createMinecraftLeafTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;

  // Base leaf colors - various shades of green
  const leafColors = [
    '#228B22', '#32CD32', '#2E8B57', '#3CB371',
    '#20B2AA', '#2F4F4F', '#006400', '#008000'
  ];

  // Fill with pixelated leaf pattern
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const colorIndex = Math.floor(Math.random() * leafColors.length);
      context.fillStyle = leafColors[colorIndex];
      context.fillRect(x, y, 1, 1);
    }
  }

  // Add some transparent spots to make it look less dense
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(Math.random() * 16);
    const y = Math.floor(Math.random() * 16);
    context.clearRect(x, y, 1, 1);
  }

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createMinecraftWaterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;

  // Base water colors - Minecraft blue shades
  const waterColors = [
    '#3F76E4', '#4285F4', '#2196F3', '#1976D2',
    '#5294F0', '#4A90E2', '#3B82F6', '#2563EB'
  ];

  // Fill with pixelated water pattern
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const colorIndex = Math.floor(Math.random() * waterColors.length);
      context.fillStyle = waterColors[colorIndex];
      context.fillRect(x, y, 1, 1);
    }
  }

  // Add flowing water highlights (diagonal patterns)
  for (let i = 0; i < 8; i++) {
    const startX = Math.floor(Math.random() * 16);
    const startY = Math.floor(Math.random() * 16);
    context.fillStyle = '#87CEEB'; // Light blue highlight
    
    // Create diagonal flow lines
    for (let j = 0; j < 4; j++) {
      const x = (startX + j) % 16;
      const y = (startY + j) % 16;
      context.fillRect(x, y, 1, 1);
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createWoodTexture(): THREE.CanvasTexture {
  // Use the new Minecraft-style wood texture
  return createMinecraftWoodTexture();
}

function createLeafTexture(): THREE.CanvasTexture {
  // Use the new Minecraft-style leaf texture
  return createMinecraftLeafTexture();
}

// Generic flower texture creator
function createFlowerTexture(
  stemColor: string,
  petalColor: string,
  petalShapeFn: (ctx: CanvasRenderingContext2D, w: number, h: number, petalColor: string) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const texSize = 64; // Higher resolution for better detail
  canvas.width = texSize / 2; // Make it narrower, height is more important
  canvas.height = texSize;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, texSize, texSize); // Transparent background

  // Stem (drawn first, petals will overlap)
  ctx.fillStyle = stemColor;
  const stemWidth = texSize * 0.08; // Slightly narrower stem
  const stemHeight = texSize * 0.6; // Stem occupies bottom 60%
  // Stem from 40% Y down to bottom of canvas
  ctx.fillRect(canvas.width / 2 - stemWidth / 2, texSize * 0.4, stemWidth, stemHeight);

  // Petals (drawn in the top 0% to 40% Y of the canvas)
  petalShapeFn(ctx, canvas.width, texSize, petalColor); // Use canvas.width, not texSize
  
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

// Tall Grass Texture (simpler for generic grass)
function createTallGrassTexture(): THREE.CanvasTexture {
   const canvas = document.createElement('canvas');
   const texSize = 128; // Higher resolution
   canvas.width = texSize / 2; // Narrower, tall aspect
   canvas.height = texSize;
   const ctx = canvas.getContext('2d')!;

   ctx.clearRect(0, 0, canvas.width, canvas.height); // Transparent background

  const bladeColorBase = '#558B2F'; // Darker Green
  const bladeColorLight = '#7CB342'; // Light Green

   // Draw multiple distinct grass blades/clumps
  const numBlades = 8; // More blades for denser look
  const maxBladeWidth = canvas.width * 0.15;

  for (let i = 0; i < numBlades; i++) {
    const baseX = (canvas.width / (numBlades + 1)) * (i + 1) + (Math.random() - 0.5) * canvas.width * 0.1; // Spread out with some randomness
    const startY = canvas.height * (0.05 + Math.random() * 0.1); // Start lower
    const tipY = canvas.height * (0.9 + Math.random() * 0.1); // Reach higher
    const bladeWidth = maxBladeWidth * (0.5 + Math.random() * 0.5); // Vary width

    ctx.fillStyle = Math.random() < 0.5 ? bladeColorBase : bladeColorLight;
    ctx.beginPath();
    ctx.moveTo(baseX + (Math.random() - 0.5) * 3, canvas.height); // Base at bottom
    ctx.quadraticCurveTo(baseX + (Math.random() - 0.5) * 10, startY + (tipY - startY) * 0.5, baseX + (Math.random() - 0.5) * 2, startY); // Curve upwards
    ctx.lineTo(baseX + (Math.random() - 0.5) * 2, startY); 
    ctx.fill();
  }

   const texture = new CanvasTexture(canvas); texture.needsUpdate = true;
   return texture;
}

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
const cloudSegmentGeometry = new BoxGeometry(CLOUD_SEGMENT_BASE_SIZE, CLOUD_SEGMENT_THICKNESS, CLOUD_SEGMENT_BASE_SIZE); // Kept separate

const FLOWER_CROSS_GEOMETRY = (() => {
    const geometry = new BufferGeometry();
    const w_geom = PLANT_PLANE_DIM / 2;
    const h_geom = PLANT_PLANE_DIM / 2; // Use PLANT_PLANE_DIM for flowers

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


const TALL_GRASS_CROSS_GEOMETRY = (() => {
    const geometry = new BufferGeometry();
    const w_geom = PLANT_PLANE_DIM / 2;
    const h_geom = PLANT_PLANE_DIM * TALL_GRASS_HEIGHT_MULTIPLIER / 2; // Taller height

    const vertices_corrected = new Float32Array([
        // Plane 1 (on XY, billboard towards Z)
        -w_geom, -h_geom, 0,   w_geom, -h_geom, 0,   w_geom,  h_geom, 0,
        -w_geom, -h_geom, 0,   w_geom,  h_geom, 0,  -w_geom,  h_geom, 0,
        // Plane 2 (on ZY, billboard towards X)
        0, -h_geom, -w_geom,   0, -h_geom,  w_geom,   0,  h_geom,  w_geom,
        0, -h_geom, -w_geom,   0,  h_geom,  w_geom,   0,  h_geom, -w_geom,
    ]);
    geometry.setAttribute('position', new BufferAttribute(vertices_corrected, 3));

     const uvs = new Float32Array([0, 0,  1, 0,  1, 1, 0, 0,  1, 1,  0, 1, 0, 0,  1, 0,  1, 1, 0, 0,  1, 1,  0, 1]);
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));

    geometry.computeVertexNormals();
    return geometry;
})();

// --- Materials (cached at module level) ---
const grassTopTexture = createMinecraftGrassTopTexture();
const dirtTexture = createMinecraftDirtTexture();
const sandTexture = createMinecraftSandTexture();
const woodTexture = createMinecraftWoodTexture();
const leafTexture = createMinecraftLeafTexture();
const waterTexture = createMinecraftWaterTexture();

const materials = {
  grassTop: new MeshStandardMaterial({ map: grassTopTexture, roughness: 0.8, metalness: 0.1 }),
  dirt: new MeshStandardMaterial({ map: dirtTexture, roughness: 0.9, metalness: 0.1 }),
  wood: new MeshStandardMaterial({ map: woodTexture, roughness: 0.8, metalness: 0.1 }),
  leaves: new MeshStandardMaterial({ 
    map: leafTexture, 
    roughness: 0.7, 
    metalness: 0.1, 
    alphaTest: 0.5, 
    side: DoubleSide, 
    transparent: true 
  }),
  cloud: new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, transparent: true, opacity: 0.9 }),
  water: new MeshStandardMaterial({ 
    map: waterTexture,
    opacity: 0.7, 
    transparent: true, 
    roughness: 0.1, 
    metalness: 0.1, 
    side: DoubleSide 
  }),
  sand: new MeshStandardMaterial({ map: sandTexture, roughness: 0.9, metalness: 0.1 }),
  tallGrass: new MeshBasicMaterial({ map: createTallGrassTexture(), alphaTest: 0.2, transparent: true, side: DoubleSide }),
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
  const [fps, setFps] = useState(0);

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

  const isRunningRef = useRef(false);

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

  // FPS tracking
  const fpsCounterRef = useRef(0);
  const lastFpsUpdateRef = useRef(0);

  const generateChunk = useCallback((chunkX: number, chunkZ: number): ChunkData | null => {
    if (!noiseRef.current) return null;
    const noise = noiseRef.current;

    const chunkTerrainHeights: number[][] = Array(CHUNK_WIDTH).fill(null).map(() => Array(CHUNK_DEPTH).fill(0));
    const blockInstances: { [key: string]: THREE.Matrix4[] } = {
      grass: [], dirt: [], wood: [], leaves: [], water: [], sand: [],
 tallGrass: [], ...flowerDefinitions.reduce((acc, def) => {
        acc[`plant_${def.name}`] = []; // Using 'plant_' prefix for flowers
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
             // Decide what plant to spawn, if any
            const plantType = Math.random();
            const plantTopSurfaceY = chunkTerrainHeights[x][z]; // This is the center Y of the highest block

            // Calculate abundance multiplier based on terrain height (more grass on hills)
            const terrainHeightBlocks = Math.floor(plantTopSurfaceY / BLOCK_SIZE) + 1;
            let abundanceMultiplier = 1.0;
            
            // More vegetation on higher terrain (hills and mountains)
            if (terrainHeightBlocks > 8) {
              abundanceMultiplier = 1.8; // 80% more vegetation on hills
            } else if (terrainHeightBlocks > 5) {
              abundanceMultiplier = 1.4; // 40% more vegetation on elevated areas
            }
            
            // Create grass patches - areas with higher grass density
            const patchNoise = noise.noise(globalNoiseX / 8, globalNoiseZ / 8, 1.5);
            if (patchNoise > 0.3) {
              abundanceMultiplier *= 2.2; // Much denser grass in patches
            }

            const adjustedTallGrassProb = TALL_GRASS_SPAWN_PROBABILITY * abundanceMultiplier;
            const adjustedFlowerProb = FLOWER_SPAWN_PROBABILITY * abundanceMultiplier;

            if (plantType < adjustedTallGrassProb) {
                 // Spawn Tall Grass
                const tallGrassCenterY = plantTopSurfaceY - (BLOCK_SIZE / 2) + (PLANT_PLANE_DIM * TALL_GRASS_HEIGHT_MULTIPLIER / 2);
                const tallGrassMatrix = new Matrix4().setPosition(
                     worldXPos + (Math.random() - 0.5) * BLOCK_SIZE * 0.6, // Slight random offset
                    tallGrassCenterY,
                    worldZPos + (Math.random() - 0.5) * BLOCK_SIZE * 0.6  // Slight random offset
                );
                tallGrassMatrix.multiply(new Matrix4().makeRotationY(Math.random() * Math.PI * 2)); // Random rotation
                blockInstances['tallGrass'].push(tallGrassMatrix);

            } else if (plantType < adjustedTallGrassProb + adjustedFlowerProb) {
                 // Spawn a random Flower
                const randomFlowerDef = flowerDefinitions[Math.floor(Math.random() * flowerDefinitions.length)];
                const flowerCenterY = plantTopSurfaceY - (BLOCK_SIZE / 2) + (PLANT_PLANE_DIM / 2); // Flower plane is smaller

                const flowerMatrix = new Matrix4().setPosition(
                    worldXPos + (Math.random() - 0.5) * BLOCK_SIZE * 0.6, // Slight random offset
                    flowerCenterY,
                    worldZPos + (Math.random() - 0.5) * BLOCK_SIZE * 0.6  // Slight random offset
                );
                flowerMatrix.multiply(new Matrix4().makeRotationY(Math.random() * Math.PI * 2)); // Random rotation
                blockInstances[`plant_${randomFlowerDef.name}`].push(flowerMatrix);
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

        if (type.startsWith('plant_')) {
            const plantName = type.substring('plant_'.length);
            if (plantName === 'tallGrass') {
 currentMaterial = materials.tallGrass;
 currentGeometry = TALL_GRASS_CROSS_GEOMETRY;
            } else { 
            const flowerName = plantName; 
            const flowerDef = flowerDefinitions.find(fd => fd.name === flowerName); if (!flowerDef || !flowerDef.material) return; currentMaterial = flowerDef.material; currentGeometry = FLOWER_CROSS_GEOMETRY;
            }
            castShadow = false; receiveShadow = false; 
        } else if (type === 'grass') {
          currentMaterial = [
            materials.dirt, materials.dirt, 
            materials.grassTop, materials.dirt, 
            materials.dirt, materials.dirt  
          ];
        } else if (type === 'leaves') {
          currentMaterial = materials[type as keyof typeof materials];
          castShadow = false; // Disable shadow casting for leaves to fix glitchy shadows
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
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap; 
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
    skyUniforms['turbidity'].value = 1; // Much clearer sky like Minecraft
    skyUniforms['rayleigh'].value = 0.5; // Reduced atmospheric scattering
    skyUniforms['mieCoefficient'].value = 0.005; 
    skyUniforms['mieDirectionalG'].value = 0.8;
    
    // Position sun more directly overhead like Minecraft
    sunPositionVecRef.current.setFromSphericalCoords(1, Math.PI / 2 - 0.2, Math.PI * 0.25); 
    skyUniforms['sunPosition'].value.copy(sunPositionVecRef.current);
    sunLight.position.copy(sunPositionVecRef.current.clone().multiplyScalar(200)); // Higher sun position
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
        case 'ShiftLeft': case 'ShiftRight': isRunningRef.current = true; break;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward.current = false; break;
        case 'ArrowLeft': case 'KeyA': moveLeft.current = false; break;
        case 'ArrowDown': case 'KeyS': moveBackward.current = false; break;
        case 'ArrowRight': case 'KeyD': moveRight.current = false; break;
        case 'ShiftLeft': case 'ShiftRight': isRunningRef.current = false; break;
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

      // FPS tracking
      fpsCounterRef.current++;
      const currentTime = performance.now();
      if (currentTime - lastFpsUpdateRef.current >= 1000) {
        setFps(fpsCounterRef.current);
        fpsCounterRef.current = 0;
        lastFpsUpdateRef.current = currentTime;
      }

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

        // Determine base speed based on ground contact
        let baseSpeed = PLAYER_SPEED * (onGround.current ? 1 : 0.9);

        // Increase speed if running (Shift + Forward)
        if (isRunningRef.current && moveForward.current) {
            baseSpeed *= 1.75; // Sprinting speed multiplier (adjust as needed)
        }

        const moveSpeed = baseSpeed * delta;
        
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

            // Check if player is trying to step up a small amount
            if (onGround.current && playerFeetAbsY + COLLISION_TOLERANCE < blockTopAbsY && blockTopAbsY - (playerFeetAbsY + COLLISION_TOLERANCE) <= MAX_VERTICAL_COLLISION_STEP) {
                 // Allow stepping up by adjusting player Y position
                 cam.position.y = blockTopAbsY + PLAYER_HEIGHT - (BLOCK_SIZE / 2) + COLLISION_TOLERANCE;
                 playerVelocity.current.y = 0; // Reset vertical velocity after stepping up
                 onGround.current = true; // Still on ground
                 canJump.current = true;
                 // No need for further XZ collision checks for this specific step-up scenario
            } else {
            // Standard horizontal collision check if not stepping up
            const blockBottomAbsY = collisionColumnSurfaceY - BLOCK_SIZE; 

             // Basic collision box around the player
             const playerMinX = cam.position.x - 0.4 * BLOCK_SIZE; // Adjusted for slight player size
             const playerMaxX = cam.position.x + 0.4 * BLOCK_SIZE; // Adjusted for slight player size
             const playerMinZ = cam.position.z - 0.3 * BLOCK_SIZE; 
             const playerMaxZ = cam.position.z + 0.3 * BLOCK_SIZE;

             // Iterate through loaded chunks to check for collision with wood blocks
             let collidedWithWood = false;
             loadedChunksRef.current.forEach((chunkData, chunkKey) => {
                 const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
                 const chunkWorldMinX = chunkX * CHUNK_WIDTH * BLOCK_SIZE - BLOCK_SIZE/2;
                 const chunkWorldMaxX = (chunkX + 1) * CHUNK_WIDTH * BLOCK_SIZE + BLOCK_SIZE/2;
                 const chunkWorldMinZ = chunkZ * CHUNK_DEPTH * BLOCK_SIZE - BLOCK_SIZE/2;
                 const chunkWorldMaxZ = (chunkZ + 1) * CHUNK_DEPTH * BLOCK_SIZE + BLOCK_SIZE/2;
                
                 // Quick check if player bounding box overlaps with chunk bounds
                 if (playerMaxX > chunkWorldMinX && playerMinX < chunkWorldMaxX && playerMaxZ > chunkWorldMinZ && playerMinZ < chunkWorldMaxZ) {
                     chunkData.meshes.forEach(mesh => {
                         if (mesh.material instanceof MeshStandardMaterial && mesh.material.map === woodTexture) { 
                             // This is a wood instanced mesh
                             const matrixWorld = new Matrix4();
                             for (let i = 0; i < mesh.count; i++) {
                                 mesh.getMatrixAt(i, matrixWorld);
                                 const position = new Vector3().setFromMatrixPosition(matrixWorld);

                                 // Calculate bounding box for this specific wood instance
                                 const blockMinX = position.x - BLOCK_SIZE / 2;
                                 const blockMaxX = position.x + BLOCK_SIZE / 2;
                                 const blockMinY = position.y - BLOCK_SIZE / 2;
                                 const blockMaxY = position.y + BLOCK_SIZE / 2;
                                 const blockMinZ = position.z - BLOCK_SIZE / 2;
                                 const blockMaxZ = position.z + BLOCK_SIZE / 2;

                                 // Check for intersection with player bounding box
                                 if (playerMaxX > blockMinX + COLLISION_TOLERANCE && playerMinX < blockMaxX - COLLISION_TOLERANCE && playerHeadAbsY > blockMinY + COLLISION_TOLERANCE && playerFeetAbsY < blockMaxY - COLLISION_TOLERANCE && playerMaxZ > blockMinZ + COLLISION_TOLERANCE && playerMinZ < blockMaxZ - COLLISION_TOLERANCE) {
                                     collidedWithWood = true;
                         // This is still not accurate block type lookup. 
                         // A proper voxel structure or collision grid is needed for accurate collision per block type.
                         // However, to fulfill the requirement of colliding with 'tree wood',
                         // we can implement the collision logic and mention this limitation.
                         // For the *purpose of demonstrating collision with a specific block type*,
                         // let's *assume* that any solid block the player is attempting to enter
                         // that is above the terrain surface and within typical tree height
                         // is a "wood-like" block for this collision check.
                                     
                                     // Determine collision direction and revert position
                                     let hitX = false, hitZ = false;
                                     const posCheckX = oldPosition.clone(); posCheckX.x = cam.position.x;
                                     if (playerMaxX > blockMinX + COLLISION_TOLERANCE && playerMinX < blockMaxX - COLLISION_TOLERANCE && playerMaxZ > blockMinZ + COLLISION_TOLERANCE && playerMinZ < blockMaxZ - COLLISION_TOLERANCE && posCheckX.distanceToSquared(oldPosition) > 0) hitX = true;
                                     const posCheckZ = oldPosition.clone(); posCheckZ.z = cam.position.z;
                                     if (playerMaxX > blockMinX + COLLISION_TOLERANCE && playerMinX < blockMaxX - COLLISION_TOLERANCE && playerMaxZ > blockMinZ + COLLISION_TOLERANCE && playerMinZ < blockMaxZ - COLLISION_TOLERANCE && posCheckZ.distanceToSquared(oldPosition) > 0) hitZ = true;
                                     if (hitX) cam.position.x = oldPosition.x;
                                     if (hitZ) cam.position.z = oldPosition.z;
                                     return; // Found collision with wood, no need to check other instances in this mesh
                                 }
                             }
                         }
                     });
                 }
             });
            } // End else for stepping up
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
      
      // Dispose of all textures
      grassTopTexture.dispose();
      dirtTexture.dispose();
      sandTexture.dispose();
      woodTexture.dispose();
      leafTexture.dispose();
      waterTexture.dispose();
      
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
        else { if (mat.map) mat.map.dispose(); mat.dispose(); }
      });
      blockGeometry.dispose(); 
      FLOWER_CROSS_GEOMETRY.dispose();
      TALL_GRASS_CROSS_GEOMETRY.dispose();
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
      {/* FPS Counter */}
      {!isPaused && (
        <div className="absolute top-4 right-4 z-20 bg-black/50 text-white px-2 py-1 rounded text-sm font-mono">
          {fps} FPS
        </div>
      )}

      {/* Minecraft HUD */}
      {!isPaused && (
        <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
          {/* Container for Health and Food bars, positioned above and centered with Hotbar */}
          <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 flex items-end space-x-4">
            <div className="flex space-x-1">
              {[...Array(10)].map((_, i) => (
                <MinecraftHeart key={i} size={16} />
              ))}
            </div>
            {/* Food Bar */}
            <div className="flex space-x-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className="w-4 h-4 bg-orange-400 relative"
                  style={{
                    clipPath: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)',
                    filter: 'drop-shadow(1px 1px 0px #000)',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Hotbar */}
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2">
            <div className="flex bg-gray-800/80 p-1 rounded border-2 border-gray-600">
              {[...Array(9)].map((_, i) => (
                <div
                  key={i}
                  className={`w-10 h-10 border-2 ${
                    i === 0 ? 'border-white bg-gray-700/50' : 'border-gray-500 bg-gray-800/50'
                  } mx-0.5 relative`}
                >
                  {/* Slot number */}
                  <span className="absolute -top-4 left-1/2 transform -translate-x-1/2 text-white text-xs font-bold">
                    {i + 1}
                  </span>
                  
                  {/* Mock items for first few slots */}
                  {i === 0 && (
                    <div className="w-8 h-8 m-0.5 bg-amber-700" style={{
                      background: 'linear-gradient(45deg, #8B4513 25%, #A0522D 25%, #A0522D 50%, #8B4513 50%, #8B4513 75%, #A0522D 75%)',
                      backgroundSize: '4px 4px',
                      imageRendering: 'pixelated'
                    }} />
                  )}
                  {i === 1 && (
                    <div className="w-8 h-8 m-0.5 bg-stone-500" style={{
                      background: 'linear-gradient(45deg, #6B7280 25%, #9CA3AF 25%, #9CA3AF 50%, #6B7280 50%, #6B7280 75%, #9CA3AF 75%)',
                      backgroundSize: '4px 4px',
                      imageRendering: 'pixelated'
                    }} />
                  )}
                  {i === 2 && (
                    <div className="w-8 h-8 m-0.5 bg-green-600" style={{
                      background: 'linear-gradient(45deg, #16A34A 25%, #22C55E 25%, #22C55E 50%, #16A34A 50%, #16A34A 75%, #22C55E 75%)',
                      backgroundSize: '4px 4px',
                      imageRendering: 'pixelated'
                    }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
    
