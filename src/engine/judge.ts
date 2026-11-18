export type Judgement = 'perfect' | 'great' | 'good' | 'miss';

/** timing windows in seconds (|delta| must be inside) */
export const PERFECT_MS = 0.04;
export const GREAT_MS = 0.09;
export const GOOD_MS = 0.14;

export const JUDGE_WEIGHT: Record<Judgement, number> = {
  perfect: 1,
  great: 0.7,
  good: 0.4,
  miss: 0,
};

export const JUDGE_SCORE: Record<Judgement, number> = {
  perfect: 100,
  great: 60,
  good: 30,
  miss: 0,
};

export function judgeDelta(deltaSec: number): Judgement {
  const d = Math.abs(deltaSec);
  if (d <= PERFECT_MS) return 'perfect';
  if (d <= GREAT_MS) return 'great';
  if (d <= GOOD_MS) return 'good';
  return 'miss';
}

export function starsForAccuracy(acc: number): number {
  if (acc >= 0.9) return 3;
  if (acc >= 0.75) return 2;
  if (acc >= 0.6) return 1;
  return 0;
}
