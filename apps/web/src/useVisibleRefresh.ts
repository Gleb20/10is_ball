import { useCallback, useEffect, useRef, useState } from "react";

export const LIVE_REFRESH_INTERVAL_MS = 30_000;

export function useVisibleRefresh(
  refresh: () => Promise<void>,
  {
    pollingEnabled = true,
    refreshKey,
    intervalMs = LIVE_REFRESH_INTERVAL_MS,
  }: {
    pollingEnabled?: boolean;
    refreshKey?: unknown;
    intervalMs?: number;
  } = {},
) {
  const refreshRef = useRef(refresh);
  const refreshKeyRef = useRef(refreshKey);
  const inFlightRef = useRef<{
    key: unknown;
    promise: Promise<void>;
    token: object;
  } | null>(null);
  const mountedRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  refreshRef.current = refresh;
  refreshKeyRef.current = refreshKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshNow = useCallback(() => {
    const key = refreshKeyRef.current;
    if (inFlightRef.current && Object.is(inFlightRef.current.key, key)) {
      return inFlightRef.current.promise;
    }

    if (mountedRef.current) setRefreshing(true);
    const token = {};
    const request = (async () => {
      try {
        await refreshRef.current();
        if (mountedRef.current && Object.is(refreshKeyRef.current, key)) {
          setError(null);
        }
      } catch (cause) {
        if (mountedRef.current && Object.is(refreshKeyRef.current, key)) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось обновить данные",
          );
        }
      } finally {
        if (inFlightRef.current?.token === token) {
          inFlightRef.current = null;
          if (mountedRef.current && Object.is(refreshKeyRef.current, key)) {
            setRefreshing(false);
          }
        }
      }
    })();

    inFlightRef.current = { key, promise: request, token };
    return request;
  }, []);

  useEffect(() => {
    void refreshNow();
  }, [refreshKey, refreshNow]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    let timer: number | null = null;
    let wasVisible = document.visibilityState === "visible";

    const stopTimer = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const startTimer = () => {
      if (!pollingEnabled || !wasVisible || timer !== null) return;
      timer = window.setInterval(() => {
        void refreshNow();
      }, intervalMs);
    };
    const onVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      if (visible === wasVisible) return;
      wasVisible = visible;
      if (!visible) {
        stopTimer();
        return;
      }
      if (pollingEnabled) {
        void refreshNow();
        startTimer();
      }
    };

    startTimer();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, pollingEnabled, refreshNow]);

  return { error, refreshing, refreshNow };
}
