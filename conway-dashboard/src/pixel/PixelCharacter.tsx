import { useState, useEffect } from 'react';
import { sprites } from './sprites';
import { palettes } from './palettes';

interface PixelCharacterProps {
  tier: string;
  agentState?: string;
  pixelSize?: number;
}

export function PixelCharacter({ tier, agentState, pixelSize = 8 }: PixelCharacterProps) {
  const [frame, setFrame] = useState(0);
  const isSleeping = agentState === 'sleeping';
  const spriteKey = isSleeping ? 'sleeping' : tier;

  useEffect(() => {
    if (tier === 'dead' && !isSleeping) return;
    const interval = isSleeping ? 2000 : tier === 'critical' ? 300 : 800;
    const id = setInterval(() => setFrame(f => (f === 0 ? 1 : 0)), interval);
    return () => clearInterval(id);
  }, [tier, isSleeping]);

  const spriteFrames = sprites[spriteKey] ?? sprites.dead;
  const palette = palettes[spriteKey] ?? palettes.dead;
  const grid = spriteFrames[frame];
  const cols = grid[0].length;

  const animationClass = isSleeping
    ? 'animate-[bounce-slow_4s_ease-in-out_infinite]'
    : tier === 'normal' ? 'animate-[bounce-gentle_1.5s_ease-in-out_infinite]'
    : tier === 'low_compute' ? 'animate-[bounce-slow_3s_ease-in-out_infinite]'
    : tier === 'critical' ? 'animate-[shake_200ms_linear_infinite]'
    : '';

  return (
    <div className={animationClass}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${pixelSize}px)`,
          gap: 0,
        }}
      >
        {grid.flatMap((row, y) =>
          row.map((cell, x) => (
            <div
              key={`${y}-${x}`}
              style={{
                width: pixelSize,
                height: pixelSize,
                backgroundColor: palette[cell] ?? 'transparent',
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
