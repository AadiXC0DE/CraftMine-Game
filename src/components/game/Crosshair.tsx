import React from 'react';

interface CrosshairProps {
  isTargeting?: boolean;
  breakProgress?: number;
}

const Crosshair: React.FC<CrosshairProps> = ({ isTargeting = false, breakProgress = 0 }) => {
  return (
    <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30">
      {/* Main crosshair */}
      <div className="relative w-6 h-6">
        {/* Horizontal line */}
        <div 
          className={`absolute top-1/2 left-0 w-full h-0.5 transform -translate-y-1/2 transition-colors ${
            isTargeting ? 'bg-red-400' : 'bg-white'
          }`}
          style={{
            background: isTargeting 
              ? `linear-gradient(to right, #ef4444 ${breakProgress * 100}%, #f87171 ${breakProgress * 100}%)`
              : '#ffffff'
          }}
        />
        
        {/* Vertical line */}
        <div 
          className={`absolute left-1/2 top-0 w-0.5 h-full transform -translate-x-1/2 transition-colors ${
            isTargeting ? 'bg-red-400' : 'bg-white'
          }`}
          style={{
            background: isTargeting 
              ? `linear-gradient(to bottom, #ef4444 ${breakProgress * 100}%, #f87171 ${breakProgress * 100}%)`
              : '#ffffff'
          }}
        />
        
        {/* Center dot */}
        <div className={`absolute top-1/2 left-1/2 w-1 h-1 transform -translate-x-1/2 -translate-y-1/2 rounded-full ${
          isTargeting ? 'bg-red-500' : 'bg-white'
        }`} />
        
        {/* Targeting indicator */}
        {isTargeting && (
          <div className="absolute top-1/2 left-1/2 w-8 h-8 transform -translate-x-1/2 -translate-y-1/2">
            <div className="w-full h-full border-2 border-red-400 rounded animate-pulse" />
          </div>
        )}
      </div>
      
      {/* Break progress indicator */}
      {isTargeting && breakProgress > 0 && (
        <div className="absolute top-8 left-1/2 transform -translate-x-1/2">
          <div className="w-16 h-1 bg-gray-600 rounded">
            <div 
              className="h-full bg-red-500 rounded transition-all duration-100"
              style={{ width: `${breakProgress * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Crosshair; 