import React from 'react';

export function MinecraftHeart({ size = 16, color = '#e00' }) {
  return (
    <div
      style={{
        width: `${size}px`,
        aspectRatio: '1',
        background: `
          radial-gradient(circle at 60% 65%, ${color} 64%, transparent 65%) top left / 50% 50% no-repeat,
          radial-gradient(circle at 40% 65%, ${color} 64%, transparent 65%) top right / 50% 50% no-repeat,
          conic-gradient(from -45deg at 50% 85.5%, ${color} 90deg, transparent 0) bottom / 100% 50% no-repeat
        `,
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

export default MinecraftHeart;