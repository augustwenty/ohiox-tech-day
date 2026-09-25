import { useEffect, useRef } from "react";

export function useDemoFrame(callback, paused = false) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (paused) return undefined;
    let frameId = 0;
    let previous;
    const tick = (now) => {
      const seconds = previous === undefined ? 0 : Math.min(0.05, (now - previous) / 1000);
      previous = now;
      callbackRef.current(seconds, now);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [paused]);
}
