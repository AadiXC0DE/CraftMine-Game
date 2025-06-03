import * as THREE from 'three';
import { BlockType, BLOCK_PROPERTIES, getBlockBreakTime } from './blockTypes';
import { identifyBlockTypeWithFallback } from './blockIdentification';

// Block breaking constants
export const BREAK_REACH_DISTANCE = 5; // Maximum distance player can break blocks
export const BREAK_CRACK_STAGES = 10; // Number of crack stages (0-9 like Minecraft)

export interface BlockPosition {
  x: number;
  y: number;
  z: number;
  chunkX: number;
  chunkZ: number;
  localX: number;
  localZ: number;
}

export interface BreakingBlock {
  position: BlockPosition;
  blockType: BlockType;
  progress: number; // 0 to 1
  startTime: number;
  breakTime: number; // Total time needed to break
  mesh?: THREE.Mesh; // Reference to the block mesh instance
  instanceIndex?: number; // Index in the instanced mesh
}

export interface RaycastResult {
  hit: boolean;
  position?: BlockPosition;
  blockType?: BlockType;
  mesh?: THREE.InstancedMesh;
  instanceIndex?: number;
  distance?: number;
  normal?: THREE.Vector3;
  point?: THREE.Vector3;
}

export interface DroppedItem {
  id: string;
  blockType: BlockType;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
  bobOffset: number;
  age: number; // Time since dropped
  collected: boolean;
}

export class BlockBreakingSystem {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private raycaster: THREE.Raycaster;
  private currentBreaking: BreakingBlock | null = null;
  private crackOverlayMesh: THREE.Mesh | null = null;
  private droppedItems: Map<string, DroppedItem> = new Map();
  private onBlockRemoved?: (chunkKey: string, oldMesh: THREE.InstancedMesh, newMesh: THREE.InstancedMesh | null) => void;
  private getGroundHeight?: (x: number, z: number) => number;
  private onItemCollected?: (blockType: BlockType) => void;

  constructor(
    scene: THREE.Scene, 
    camera: THREE.Camera, 
    onBlockRemoved?: (chunkKey: string, oldMesh: THREE.InstancedMesh, newMesh: THREE.InstancedMesh | null) => void,
    getGroundHeight?: (x: number, z: number) => number,
    onItemCollected?: (blockType: BlockType) => void
  ) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = BREAK_REACH_DISTANCE;
    this.onBlockRemoved = onBlockRemoved;
    this.getGroundHeight = getGroundHeight;
    this.onItemCollected = onItemCollected;
  }

  // Cast ray from camera to find targeted block
  public raycastBlock(loadedChunks: Map<string, any>, BLOCK_SIZE: number, CHUNK_WIDTH: number, CHUNK_DEPTH: number): RaycastResult {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    
    const intersections: Array<{
      object: THREE.InstancedMesh;
      distance: number;
      instanceId: number;
      point: THREE.Vector3;
      normal: THREE.Vector3;
      worldPos: THREE.Vector3;
    }> = [];

    // Check all loaded chunks for block intersections
    loadedChunks.forEach((chunkData, chunkKey) => {
      const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
      
      chunkData.meshes.forEach((mesh: THREE.InstancedMesh) => {
        const tempMatrix = new THREE.Matrix4();
        const tempBox = new THREE.Box3();
        const tempVector = new THREE.Vector3();
        
        // Check each instance in the mesh
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, tempMatrix);
          tempVector.setFromMatrixPosition(tempMatrix);
          
          // Create bounding box for this block instance
          tempBox.setFromCenterAndSize(
            tempVector,
            new THREE.Vector3(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE)
          );
          
          // Check if ray intersects this block
          const rayIntersection = this.raycaster.ray.intersectBox(tempBox, new THREE.Vector3());
          if (rayIntersection) {
            const distance = rayIntersection.distanceTo(this.raycaster.ray.origin);
            if (distance <= BREAK_REACH_DISTANCE) {
              // Calculate normal based on which face was hit
              const blockCenter = tempVector;
              const hitPoint = rayIntersection;
              const diff = hitPoint.clone().sub(blockCenter);
              
              // Find the axis with the largest absolute difference to determine face normal
              const normal = new THREE.Vector3();
              if (Math.abs(diff.x) > Math.abs(diff.y) && Math.abs(diff.x) > Math.abs(diff.z)) {
                normal.set(Math.sign(diff.x), 0, 0);
              } else if (Math.abs(diff.y) > Math.abs(diff.z)) {
                normal.set(0, Math.sign(diff.y), 0);
              } else {
                normal.set(0, 0, Math.sign(diff.z));
              }
              
              intersections.push({
                object: mesh,
                distance: distance,
                instanceId: i,
                point: rayIntersection,
                normal: normal,
                worldPos: tempVector.clone() // Store the actual world position
              });
            }
          }
        }
      });
    });

    // Find the closest intersection
    if (intersections.length === 0) {
      return { hit: false };
    }

    intersections.sort((a, b) => a.distance - b.distance);
    const closest = intersections[0];
    
    // Determine block type from mesh material
    const blockType = this.getBlockTypeFromMesh(closest.object);
    if (!blockType) {
      return { hit: false };
    }

    // Use the actual world position from the matrix
    const worldPos = closest.worldPos;
    
    const chunkX = Math.floor((worldPos.x / BLOCK_SIZE) / CHUNK_WIDTH);
    const chunkZ = Math.floor((worldPos.z / BLOCK_SIZE) / CHUNK_DEPTH);
    const localX = Math.floor((worldPos.x / BLOCK_SIZE) - chunkX * CHUNK_WIDTH);
    const localZ = Math.floor((worldPos.z / BLOCK_SIZE) - chunkZ * CHUNK_DEPTH);

    const position: BlockPosition = {
      x: worldPos.x, // Use actual world position, not rounded
      y: worldPos.y,
      z: worldPos.z,
      chunkX,
      chunkZ,
      localX,
      localZ
    };

    return {
      hit: true,
      position,
      blockType,
      mesh: closest.object,
      instanceIndex: closest.instanceId,
      distance: closest.distance,
      normal: closest.normal,
      point: closest.point
    };
  }

  private getBlockTypeFromMesh(mesh: THREE.InstancedMesh): BlockType | null {
    // Use the proper identification system
    return identifyBlockTypeWithFallback(mesh);
  }

  // Start breaking a block
  public startBreaking(raycastResult: RaycastResult, tool: string = 'hand'): boolean {
    if (!raycastResult.hit || !raycastResult.position || !raycastResult.blockType) {
      return false;
    }

    const properties = BLOCK_PROPERTIES[raycastResult.blockType];
    if (!properties.breakable) {
      return false;
    }

    const breakTime = getBlockBreakTime(raycastResult.blockType, tool);

    this.currentBreaking = {
      position: raycastResult.position,
      blockType: raycastResult.blockType,
      progress: 0,
      startTime: performance.now(),
      breakTime: breakTime * 1000, // Convert to milliseconds
      mesh: raycastResult.mesh as any,
      instanceIndex: raycastResult.instanceIndex
    };

    return true;
  }

  // Update breaking progress and dropped items
  public updateBreaking(deltaTime: number): BreakingBlock | null {
    if (!this.currentBreaking) {
      // Still need to update dropped items even when not breaking
      this.updateDroppedItems(deltaTime);
      return null;
    }

    const elapsed = performance.now() - this.currentBreaking.startTime;
    this.currentBreaking.progress = Math.min(elapsed / this.currentBreaking.breakTime, 1);

    // Update crack overlay
    this.updateCrackOverlay();

    // Update dropped items
    this.updateDroppedItems(deltaTime);

    // Check if breaking is complete
    if (this.currentBreaking.progress >= 1) {
      const completed = this.currentBreaking;
      this.completeBreaking();
      return completed;
    }

    return null;
  }

  // Stop breaking (when player releases mouse or looks away)
  public stopBreaking(): void {
    this.currentBreaking = null;
    this.removeCrackOverlay();
  }

  // Complete the breaking process
  private completeBreaking(): void {
    if (!this.currentBreaking) return;

    // Create dropped item instead of particles
    this.createDroppedItem(this.currentBreaking);

    // Remove the block
    this.removeBlockFromChunk(this.currentBreaking);

    // Clean up
    this.removeCrackOverlay();
    this.currentBreaking = null;
  }

  // Create crack overlay on the block being broken
  private updateCrackOverlay(): void {
    if (!this.currentBreaking) return;

    const crackStage = Math.floor(this.currentBreaking.progress * BREAK_CRACK_STAGES);
    
    // Remove existing overlay
    this.removeCrackOverlay();

    if (crackStage > 0) {
      // Create crack texture
      const crackTexture = this.createCrackTexture(crackStage);
      
      // Create overlay geometry slightly larger than the block
      const overlayGeometry = new THREE.BoxGeometry(1.001, 1.001, 1.001);
      const overlayMaterial = new THREE.MeshBasicMaterial({
        map: crackTexture,
        transparent: true,
        alphaTest: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true
      });

      this.crackOverlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);
      
      // Position the overlay at the breaking block
      this.crackOverlayMesh.position.copy(new THREE.Vector3(
        this.currentBreaking.position.x,
        this.currentBreaking.position.y,
        this.currentBreaking.position.z
      ));
      
      this.scene.add(this.crackOverlayMesh);
    }
  }

  private removeCrackOverlay(): void {
    if (this.crackOverlayMesh) {
      this.scene.remove(this.crackOverlayMesh);
      const material = this.crackOverlayMesh.material as THREE.MeshBasicMaterial;
      if (material.map) {
        material.map.dispose();
      }
      material.dispose();
      this.crackOverlayMesh.geometry.dispose();
      this.crackOverlayMesh = null;
    }
  }

  // Create Minecraft-style crack texture
  private createCrackTexture(stage: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d')!;

    // Start with transparent background
    ctx.clearRect(0, 0, 16, 16);

    // Draw black cracks with varying opacity based on stage
    const opacity = Math.min(0.8, (stage / BREAK_CRACK_STAGES) * 0.6 + 0.2);
    ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
    ctx.lineWidth = 1;
    ctx.lineCap = 'square';
    
    // Create Minecraft-style crack patterns based on stage
    const patterns = this.getMinecraftCrackPattern(stage);
    
    patterns.forEach(pattern => {
      ctx.beginPath();
      ctx.moveTo(pattern.startX, pattern.startY);
      pattern.points.forEach(point => {
        ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }

  // Generate authentic Minecraft crack patterns
  private getMinecraftCrackPattern(stage: number): Array<{startX: number, startY: number, points: Array<{x: number, y: number}>}> {
    const patterns = [];
    
    // Minecraft-style crack patterns that progressively get more severe
    switch(stage) {
      case 1:
        patterns.push({
          startX: 3, startY: 2,
          points: [{x: 7, y: 5}, {x: 9, y: 8}]
        });
        break;
      case 2:
        patterns.push({
          startX: 3, startY: 2,
          points: [{x: 7, y: 5}, {x: 9, y: 8}, {x: 11, y: 6}]
        });
        patterns.push({
          startX: 13, startY: 1,
          points: [{x: 10, y: 4}]
        });
        break;
      case 3:
        patterns.push({
          startX: 3, startY: 2,
          points: [{x: 7, y: 5}, {x: 9, y: 8}, {x: 11, y: 6}, {x: 13, y: 9}]
        });
        patterns.push({
          startX: 13, startY: 1,
          points: [{x: 10, y: 4}, {x: 8, y: 7}]
        });
        patterns.push({
          startX: 2, startY: 13,
          points: [{x: 5, y: 11}]
        });
        break;
      case 4:
        patterns.push({
          startX: 3, startY: 2,
          points: [{x: 7, y: 5}, {x: 9, y: 8}, {x: 11, y: 6}, {x: 13, y: 9}, {x: 10, y: 13}]
        });
        patterns.push({
          startX: 13, startY: 1,
          points: [{x: 10, y: 4}, {x: 8, y: 7}, {x: 5, y: 10}]
        });
        patterns.push({
          startX: 2, startY: 13,
          points: [{x: 5, y: 11}, {x: 8, y: 9}]
        });
        break;
      case 5:
        patterns.push({
          startX: 3, startY: 2,
          points: [{x: 7, y: 5}, {x: 9, y: 8}, {x: 11, y: 6}, {x: 13, y: 9}, {x: 10, y: 13}]
        });
        patterns.push({
          startX: 13, startY: 1,
          points: [{x: 10, y: 4}, {x: 8, y: 7}, {x: 5, y: 10}, {x: 3, y: 12}]
        });
        patterns.push({
          startX: 2, startY: 13,
          points: [{x: 5, y: 11}, {x: 8, y: 9}, {x: 12, y: 7}]
        });
        patterns.push({
          startX: 14, startY: 14,
          points: [{x: 11, y: 12}]
        });
        break;
      default:
        // For stages 6-9, add more cracks
        patterns.push({
          startX: 3, startY: 2,
          points: [{x: 7, y: 5}, {x: 9, y: 8}, {x: 11, y: 6}, {x: 13, y: 9}, {x: 10, y: 13}]
        });
        patterns.push({
          startX: 13, startY: 1,
          points: [{x: 10, y: 4}, {x: 8, y: 7}, {x: 5, y: 10}, {x: 3, y: 12}]
        });
        patterns.push({
          startX: 2, startY: 13,
          points: [{x: 5, y: 11}, {x: 8, y: 9}, {x: 12, y: 7}]
        });
        patterns.push({
          startX: 14, startY: 14,
          points: [{x: 11, y: 12}, {x: 8, y: 10}, {x: 6, y: 8}]
        });
        patterns.push({
          startX: 1, startY: 8,
          points: [{x: 4, y: 6}, {x: 7, y: 4}]
        });
        patterns.push({
          startX: 15, startY: 7,
          points: [{x: 12, y: 9}, {x: 9, y: 11}]
        });
    }
    
    return patterns;
  }

  // Create a dropped item that looks like a mini block
  private createDroppedItem(breakingBlock: BreakingBlock): void {
    const properties = BLOCK_PROPERTIES[breakingBlock.blockType];
    if (!properties.drops) return;

    // Create mini block geometry (smaller than normal blocks)
    const itemGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    
    // Get the material from the original block type
    let itemMaterial: THREE.Material;
    
    // Create material based on block type
    switch (breakingBlock.blockType) {
      case 'grass':
        itemMaterial = new THREE.MeshStandardMaterial({ color: 0x7CB518 });
        break;
      case 'dirt':
        itemMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        break;
      case 'wood':
        itemMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
        break;
      case 'leaves':
        itemMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        break;
      case 'sand':
        itemMaterial = new THREE.MeshStandardMaterial({ color: 0xF4A460 });
        break;
      case 'stone':
        itemMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
        break;
      default:
        itemMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    }

    const itemMesh = new THREE.Mesh(itemGeometry, itemMaterial);
    
    // Position slightly above the broken block
    itemMesh.position.set(
      breakingBlock.position.x + (Math.random() - 0.5) * 0.3,
      breakingBlock.position.y + 0.5,
      breakingBlock.position.z + (Math.random() - 0.5) * 0.3
    );

    // Add to scene
    this.scene.add(itemMesh);

    // Create dropped item data
    const itemId = `item_${Date.now()}_${Math.random()}`;
    const droppedItem: DroppedItem = {
      id: itemId,
      blockType: breakingBlock.blockType,
      position: itemMesh.position.clone(),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 2 + 1,
        (Math.random() - 0.5) * 2
      ),
      mesh: itemMesh,
      bobOffset: Math.random() * Math.PI * 2, // Random start phase for bobbing
      age: 0,
      collected: false
    };

    this.droppedItems.set(itemId, droppedItem);
  }

  // Update all dropped items (physics, pickup, despawn)
  private updateDroppedItems(deltaTime: number): void {
    const playerPosition = this.camera.position;
    const itemsToRemove: string[] = [];

    this.droppedItems.forEach((item, itemId) => {
      if (item.collected) return;

      // Update age
      item.age += deltaTime;

      // Apply gravity and velocity
      item.velocity.y -= 9.8 * deltaTime; // Gravity
      item.position.add(item.velocity.clone().multiplyScalar(deltaTime));

      // Ground collision using actual terrain height
      let groundHeight = 0; // Fallback to sea level
      if (this.getGroundHeight) {
        groundHeight = this.getGroundHeight(item.position.x, item.position.z);
      }
      
      const itemBottomY = item.position.y - 0.125; // Half the item height
      const targetGroundY = groundHeight + 0.625; // Hover slightly above ground (0.5 blocks up)
      
      if (itemBottomY < targetGroundY) {
        item.position.y = targetGroundY + 0.125; // Set to hover height + half item height
        item.velocity.y = Math.max(0, item.velocity.y * -0.3); // Bounce with damping
        item.velocity.x *= 0.8; // Friction
        item.velocity.z *= 0.8;
      }

      // Bobbing animation
      const bobSpeed = 3;
      const bobHeight = 0.05;
      item.bobOffset += bobSpeed * deltaTime;
      const bobY = Math.sin(item.bobOffset) * bobHeight;

      // Rotation animation
      item.mesh.rotation.y += deltaTime * 2; // Spin around Y axis

      // Check distance to player for pickup
      const distanceToPlayer = item.position.distanceTo(playerPosition);
      
      if (distanceToPlayer < 1.5) { // Pickup range
        // Move item toward player
        const directionToPlayer = playerPosition.clone().sub(item.position).normalize();
        const attractionSpeed = 5;
        item.velocity.add(directionToPlayer.multiplyScalar(attractionSpeed * deltaTime));
        
        // Collect if very close
        if (distanceToPlayer < 0.5) {
          item.collected = true;
          this.scene.remove(item.mesh);
          item.mesh.geometry.dispose();
          (item.mesh.material as THREE.Material).dispose();
          itemsToRemove.push(itemId);
          console.log(`Collected ${item.blockType} block!`);
          if (this.onItemCollected) {
            this.onItemCollected(item.blockType);
          }
        }
      }

      // Despawn after 5 minutes (like Minecraft)
      if (item.age > 300) {
        this.scene.remove(item.mesh);
        item.mesh.geometry.dispose();
        (item.mesh.material as THREE.Material).dispose();
        itemsToRemove.push(itemId);
      }

      // Update mesh position
      item.mesh.position.copy(item.position);
      item.mesh.position.y += bobY; // Add bobbing
    });

    // Remove collected/despawned items
    itemsToRemove.forEach(itemId => {
      this.droppedItems.delete(itemId);
    });
  }

  // Remove block from chunk (now properly implemented)
  private removeBlockFromChunk(breakingBlock: BreakingBlock): void {
    if (!breakingBlock.mesh || typeof breakingBlock.instanceIndex !== 'number') {
      console.warn('Cannot remove block: missing mesh or instance index');
      return;
    }

    const mesh = breakingBlock.mesh as THREE.InstancedMesh;
    const instanceIndex = breakingBlock.instanceIndex;
    
    // Generate chunk key from block position
    const chunkKey = `${breakingBlock.position.chunkX},${breakingBlock.position.chunkZ}`;

    console.log(`Removing block at instance ${instanceIndex} from mesh with ${mesh.count} instances`);

    // Create new matrices array without the broken block
    const matrices: THREE.Matrix4[] = [];
    const tempMatrix = new THREE.Matrix4();

    for (let i = 0; i < mesh.count; i++) {
      if (i !== instanceIndex) {
        mesh.getMatrixAt(i, tempMatrix);
        matrices.push(tempMatrix.clone());
      }
    }

    // Update the mesh with new instance count
    if (matrices.length > 0) {
      // Dispose old instance data
      mesh.dispose();
      
      // Create new instanced mesh with reduced count
      const newMesh = new THREE.InstancedMesh(
        mesh.geometry,
        mesh.material,
        matrices.length
      );

      // Set all matrices
      matrices.forEach((matrix, index) => {
        newMesh.setMatrixAt(index, matrix);
      });

      // Copy properties
      newMesh.castShadow = mesh.castShadow;
      newMesh.receiveShadow = mesh.receiveShadow;
      newMesh.instanceMatrix.needsUpdate = true;

      // Replace in scene
      this.scene.remove(mesh);
      this.scene.add(newMesh);

      // Update the reference in the chunk data (this needs to be handled by the chunk system)
      console.log(`Block successfully removed. New mesh has ${newMesh.count} instances`);

      if (this.onBlockRemoved) {
        this.onBlockRemoved(chunkKey, mesh, newMesh);
      }
    } else {
      // Remove mesh entirely if no instances left
      this.scene.remove(mesh);
      mesh.dispose();
      console.log('Mesh removed entirely (no instances left)');

      if (this.onBlockRemoved) {
        this.onBlockRemoved(chunkKey, mesh, null);
      }
    }
  }

  public getCurrentBreaking(): BreakingBlock | null {
    return this.currentBreaking;
  }

  public dispose(): void {
    this.stopBreaking();
    
    // Clean up all dropped items
    this.droppedItems.forEach((item) => {
      this.scene.remove(item.mesh);
      item.mesh.geometry.dispose();
      (item.mesh.material as THREE.Material).dispose();
    });
    this.droppedItems.clear();
  }
} 