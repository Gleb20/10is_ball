import { useCallback, useRef, useState } from "react";

export function useSingleFlight() {
  const active = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T>(task: () => Promise<T>) => {
    if (active.current) return undefined;
    active.current = true;
    setPending(true);
    try {
      return await task();
    } finally {
      active.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run };
}
