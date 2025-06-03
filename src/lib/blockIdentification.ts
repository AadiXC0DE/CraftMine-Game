import * as THREE from 'three';
import { BlockType } from './blockTypes';

// This file provides utilities to identify block types from Three.js materials
// In a proper implementation, you would store block type data with each chunk/mesh

// Map material properties to block types
// This is a temporary solution - ideally block type would be stored in chunk data
const MATERIAL_TO_BLOCK_TYPE = new Map<string, BlockType>();

// Initialize material mappings
export function initializeBlockIdentification(materials: Record<string, THREE.Material | THREE.Material[]>) {
  // Clear existing mappings
  MATERIAL_TO_BLOCK_TYPE.clear();
  
  // Map each material to its block type
  Object.entries(materials).forEach(([blockType, material]) => {
    if (Array.isArray(material)) {
      // For multi-material blocks (like grass), use the first material as identifier
      const firstMaterial = material[0];
      if (firstMaterial instanceof THREE.MeshStandardMaterial) {
        const key = getMaterialKey(firstMaterial);
        MATERIAL_TO_BLOCK_TYPE.set(key, blockType as BlockType);
      }
    } else if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) {
      const key = getMaterialKey(material);
      MATERIAL_TO_BLOCK_TYPE.set(key, blockType as BlockType);
    }
  });
}

// Generate a unique key for a material based on its properties
function getMaterialKey(material: THREE.Material): string {
  if (material instanceof THREE.MeshStandardMaterial) {
    // Use texture UUID and material properties as key
    const textureId = material.map?.uuid || 'no-texture';
    return `standard_${textureId}_${material.roughness}_${material.metalness}`;
  } else if (material instanceof THREE.MeshBasicMaterial) {
    const textureId = material.map?.uuid || 'no-texture';
    const color = material.color.getHexString();
    return `basic_${textureId}_${color}`;
  }
  return 'unknown';
}

// Identify block type from mesh material
export function identifyBlockType(mesh: THREE.InstancedMesh): BlockType | null {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  
  if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) {
    const key = getMaterialKey(material);
    return MATERIAL_TO_BLOCK_TYPE.get(key) || null;
  }
  
  return null;
}

// Enhanced block type identification with fallback logic
export function identifyBlockTypeWithFallback(mesh: THREE.InstancedMesh): BlockType {
  // Try primary identification
  const identified = identifyBlockType(mesh);
  if (identified) {
    return identified;
  }
  
  // Fallback logic based on material properties
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  
  if (material instanceof THREE.MeshStandardMaterial) {
    // Use material properties to guess block type
    if (material.roughness === 0.8 && material.metalness === 0.1) {
      // Could be grass or wood - check if it has texture
      if (material.map) {
        // For now, default to wood for these properties
        return 'wood';
      }
    }
    
    if (material.roughness === 0.9 && material.metalness === 0.1) {
      return 'dirt';
    }
    
    if (material.roughness === 0.7 && material.metalness === 0.1 && material.transparent) {
      return 'leaves';
    }
    
    if (material.opacity < 1 && material.transparent) {
      return 'water';
    }
  }
  
  // Default fallback
  return 'dirt';
} 