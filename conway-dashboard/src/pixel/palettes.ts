// Color maps per survival tier
// Index 0 = empty (transparent), 1 = primary, 2 = secondary, 3 = accent (eyes)

export type Palette = Record<number, string>;

export const palettes: Record<string, Palette> = {
  normal: {
    0: 'transparent',
    1: '#22c55e',
    2: '#4ade80',
    3: '#bbf7d0',
  },
  low_compute: {
    0: 'transparent',
    1: '#eab308',
    2: '#ca8a04',
    3: '#fef08a',
  },
  critical: {
    0: 'transparent',
    1: '#ef4444',
    2: '#f97316',
    3: '#fecaca',
  },
  sleeping: {
    0: 'transparent',
    1: '#6366f1',
    2: '#a78bfa',
    3: '#818cf8',
  },
  dead: {
    0: 'transparent',
    1: '#4b5563',
    2: '#6b7280',
    3: '#9ca3af',
  },
};

export const tierLabels: Record<string, string> = {
  normal: 'NORMAL',
  low_compute: 'LOW COMPUTE',
  critical: 'CRITICAL',
  sleeping: 'SLEEPING',
  dead: 'DEAD',
};

export const tierColors: Record<string, { bg: string; text: string; border: string }> = {
  normal: { bg: '#052e16', text: '#86efac', border: '#166534' },
  low_compute: { bg: '#422006', text: '#fde047', border: '#854d0e' },
  critical: { bg: '#450a0a', text: '#fca5a5', border: '#991b1b' },
  sleeping: { bg: '#1e1b4b', text: '#a5b4fc', border: '#4338ca' },
  dead: { bg: '#1f2937', text: '#9ca3af', border: '#4b5563' },
};
