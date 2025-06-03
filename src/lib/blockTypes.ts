// Block types and their properties for the mining system
export type BlockType = 'grass' | 'dirt' | 'wood' | 'leaves' | 'water' | 'sand' | 'stone';

export interface BlockProperties {
  type: BlockType;
  hardness: number; // Time in seconds to break with hand
  tool?: 'pickaxe' | 'axe' | 'shovel' | 'hand';
  preferredTool?: 'pickaxe' | 'axe' | 'shovel' | 'hand';
  breakable: boolean;
  drops: string[]; // What items the block drops when broken
  breakSound?: string;
  breakParticles?: {
    color: string;
    count: number;
  };
}

// Define properties for each block type (similar to Minecraft)
export const BLOCK_PROPERTIES: Record<BlockType, BlockProperties> = {
  grass: {
    type: 'grass',
    hardness: 0.6,
    preferredTool: 'shovel',
    breakable: true,
    drops: ['dirt'],
    breakSound: 'grass',
    breakParticles: {
      color: '#7CB518',
      count: 8
    }
  },
  dirt: {
    type: 'dirt',
    hardness: 0.5,
    preferredTool: 'shovel',
    breakable: true,
    drops: ['dirt'],
    breakSound: 'dirt',
    breakParticles: {
      color: '#8B4513',
      count: 8
    }
  },
  wood: {
    type: 'wood',
    hardness: 2.0,
    preferredTool: 'axe',
    breakable: true,
    drops: ['wood'],
    breakSound: 'wood',
    breakParticles: {
      color: '#654321',
      count: 10
    }
  },
  leaves: {
    type: 'leaves',
    hardness: 0.2,
    preferredTool: 'hand',
    breakable: true,
    drops: [], // Leaves don't drop items normally
    breakSound: 'leaves',
    breakParticles: {
      color: '#228B22',
      count: 6
    }
  },
  sand: {
    type: 'sand',
    hardness: 0.5,
    preferredTool: 'shovel',
    breakable: true,
    drops: ['sand'],
    breakSound: 'sand',
    breakParticles: {
      color: '#F4A460',
      count: 8
    }
  },
  water: {
    type: 'water',
    hardness: 0,
    breakable: false,
    drops: [],
    breakParticles: {
      color: '#3F76E4',
      count: 0
    }
  },
  stone: {
    type: 'stone',
    hardness: 1.5,
    preferredTool: 'pickaxe',
    breakable: true,
    drops: ['stone'],
    breakSound: 'stone',
    breakParticles: {
      color: '#808080',
      count: 10
    }
  }
};

// Tool effectiveness multipliers
export const TOOL_EFFECTIVENESS: Record<string, Record<string, number>> = {
  hand: {
    grass: 1,
    dirt: 1,
    wood: 1,
    leaves: 1,
    sand: 1,
    stone: 1
  },
  shovel: {
    grass: 5,
    dirt: 5,
    sand: 5,
    wood: 0.75,
    leaves: 1,
    stone: 0.5
  },
  axe: {
    wood: 5,
    leaves: 1.5,
    grass: 0.75,
    dirt: 0.75,
    sand: 0.75,
    stone: 0.5
  },
  pickaxe: {
    stone: 5,
    dirt: 2,
    sand: 2,
    wood: 0.75,
    leaves: 1,
    grass: 0.75
  }
};

export function getBlockBreakTime(blockType: BlockType, tool: string = 'hand'): number {
  const properties = BLOCK_PROPERTIES[blockType];
  if (!properties.breakable) return Infinity;
  
  const effectiveness = TOOL_EFFECTIVENESS[tool]?.[blockType] || 1;
  return properties.hardness / effectiveness;
}

export function getBlockDrops(blockType: BlockType): string[] {
  return BLOCK_PROPERTIES[blockType].drops;
} 