import { useEffect, useMemo, useRef, useState } from 'react';

export type VideoDurations = Record<string, number>;

declare global {
  interface Window {
    startRecording?: () => void;
    stopRecording?: () => void;
  }
}

export function useVideoPlayer({ durations }: { durations: VideoDurations }) {
  const sceneKeys = useMemo(() => Object.keys(durations), [durations]);
  const [currentScene, setCurrentScene] = useState(0);
  const hasStoppedRecording = useRef(false);

  useEffect(() => {
    const startFrame = window.requestAnimationFrame(() => window.startRecording?.());
    const stopTimer = window.setTimeout(() => {
      if (!hasStoppedRecording.current) {
        hasStoppedRecording.current = true;
        window.stopRecording?.();
      }
    }, sceneKeys.reduce((sum, key) => sum + durations[key], 0) + 180);

    return () => {
      window.cancelAnimationFrame(startFrame);
      window.clearTimeout(stopTimer);
    };
  }, [durations, sceneKeys]);

  useEffect(() => {
    const duration = durations[sceneKeys[currentScene]];
    const timer = window.setTimeout(() => {
      setCurrentScene((scene) => (scene + 1) % sceneKeys.length);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [currentScene, durations, sceneKeys]);

  return { currentScene, sceneKeys };
}