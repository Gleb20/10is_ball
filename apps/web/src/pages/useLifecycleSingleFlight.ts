import { useCallback, useRef, useState } from "react";

export function useLifecycleSingleFlight() {
  const activeTokenRef = useRef<symbol | null>(null);
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T>(task: () => Promise<T>) => {
    if (activeTokenRef.current) return undefined;
    const token = Symbol("lifecycle-single-flight");
    activeTokenRef.current = token;
    setPending(true);
    try {
      return await task();
    } finally {
      if (activeTokenRef.current === token) {
        activeTokenRef.current = null;
        setPending(false);
      }
    }
  }, []);

  const invalidate = useCallback(() => {
    const interrupted = activeTokenRef.current !== null;
    activeTokenRef.current = null;
    return interrupted;
  }, []);

  const resume = useCallback(() => {
    setPending(false);
  }, []);

  return { pending, run, invalidate, resume };
}
