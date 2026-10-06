import { CreativeModel } from '@shared/types';
import { useEffect, useMemo, useState } from 'react';

type Timing = { expected: number; min: number; max: number };

// Timing configuration. The native Creative backend can include first-run model loading, so the
// fallback estimate remains deliberately conservative until the native runtime
// exposes real stage/progress reporting.
export const TIMING_CONFIG: Record<
  'image' | 'mesh',
  Record<CreativeModel, Timing>
> = {
  image: {
    'local/native': { expected: 180000, min: 45000, max: 600000 },
    fast: { expected: 35000, min: 15000, max: 45000 },
    quality: { expected: 120000, min: 60000, max: 150000 },
    ultra: { expected: 150000, min: 90000, max: 200000 },
  },
  mesh: {
    'local/native': { expected: 300000, min: 60000, max: 900000 },
    fast: { expected: 75000, min: 60000, max: 90000 },
    quality: { expected: 45000, min: 30000, max: 60000 },
    ultra: { expected: 270000, min: 240000, max: 300000 },
  },
};

type Stage = 1 | 2 | 3;

// Custom hook for loading progress
export function useLoadingProgress(
  modelType: 'image' | 'mesh',
  startTime?: number,
  model?: CreativeModel,
) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<Stage>(1);

  const actualStartTime = useMemo(() => startTime || Date.now(), [startTime]);

  const modelName = model || 'local/native';

  const timing = TIMING_CONFIG[modelType][modelName];

  useEffect(() => {
    const updateProgress = () => {
      const { progress, stage } = getProgress(
        actualStartTime,
        timing.expected,
        Date.now(),
      );

      setStage(stage);
      setProgress(progress);
    };

    updateProgress();
    const interval = setInterval(updateProgress, 150);
    return () => clearInterval(interval);
  }, [actualStartTime, timing]);

  return {
    progress,
    stage,
    timing,
    remainingTime: actualStartTime + timing.max - Date.now(),
  };
}

export function getProgress(
  actualStartTime: number,
  expectedTime: number,
  currentTime: number,
) {
  const elapsedTime = currentTime - actualStartTime;

  let currentStage: Stage = 1;

  if (elapsedTime < expectedTime * 0.15) {
    currentStage = 1;
  } else if (elapsedTime < expectedTime * 0.575) {
    currentStage = 2;
  } else {
    currentStage = 3;
  }

  let progress: number;

  if (elapsedTime <= expectedTime) {
    progress = (elapsedTime / expectedTime) * 100;
  } else {
    const overtime = elapsedTime - expectedTime;
    const overtimeRatio = overtime / expectedTime;
    progress = 85 + (10 * Math.log(1 + overtimeRatio)) / Math.log(6);
  }

  return {
    progress: Math.min(95, progress),
    stage: currentStage,
  };
}
