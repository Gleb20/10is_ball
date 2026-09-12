import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, type User } from "./api";
import { AUTH_UNAUTHORIZED_EVENT } from "./authEvents";

type AuthState = {
  user: User | null;
  loading: boolean;
  startupPhase: "checking" | "waking" | "failed" | "ready";
  startupError: string | null;
  reauthRequired: boolean;
  refresh: () => Promise<void>;
  retryStartup: () => void;
  setUser: (u: User | null) => void;
};

const COLD_START_HINT_MS = 1_500;
const COLD_START_TIMEOUT_MS = 60_000;

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [startupPhase, setStartupPhase] =
    useState<AuthState["startupPhase"]>("checking");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const userRef = useRef<User | null>(null);
  const startupAttemptRef = useRef(0);
  const startupControllerRef = useRef<AbortController | null>(null);

  const setUser = useCallback((nextUser: User | null) => {
    userRef.current = nextUser;
    setUserState(nextUser);
    setReauthRequired(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.me();
      setUser(res.user);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  const bootstrap = useCallback(async () => {
    const attempt = startupAttemptRef.current + 1;
    startupAttemptRef.current = attempt;
    startupControllerRef.current?.abort();
    setLoading(true);
    setStartupPhase("checking");
    setStartupError(null);
    let timedOut = false;
    const controller = new AbortController();
    startupControllerRef.current = controller;
    const wakingTimer = window.setTimeout(
      () => {
        if (startupAttemptRef.current === attempt) {
          setStartupPhase("waking");
        }
      },
      COLD_START_HINT_MS,
    );
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, COLD_START_TIMEOUT_MS);

    try {
      const res = await api.me({ signal: controller.signal });
      if (startupAttemptRef.current !== attempt) return;
      setUser(res.user);
      setStartupPhase("ready");
    } catch (error) {
      if (startupAttemptRef.current !== attempt) return;
      if ((error as { status?: number }).status === 401) {
        setStartupPhase("ready");
      } else {
        userRef.current = null;
        setUserState(null);
        setStartupError(
          timedOut
            ? "Сервис не ответил за минуту"
            : "Не удалось подключиться к сервису",
        );
        setStartupPhase("failed");
      }
    } finally {
      window.clearTimeout(wakingTimer);
      window.clearTimeout(timeout);
      if (startupAttemptRef.current === attempt) {
        startupControllerRef.current = null;
        setLoading(false);
      }
    }
  }, [setUser]);

  useEffect(() => {
    const handleUnauthorized = () => {
      const hadAuthenticatedUser = userRef.current !== null;
      userRef.current = null;
      setUserState(null);
      if (hadAuthenticatedUser) setReauthRequired(true);
      setLoading(false);
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    void bootstrap();
    return () => {
      startupAttemptRef.current += 1;
      startupControllerRef.current?.abort();
      startupControllerRef.current = null;
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    };
  }, [bootstrap]);

  const retryStartup = useCallback(() => {
    void bootstrap();
  }, [bootstrap]);

  const value = useMemo(
    () => ({
      user,
      loading,
      startupPhase,
      startupError,
      reauthRequired,
      refresh,
      retryStartup,
      setUser,
    }),
    [
      user,
      loading,
      startupPhase,
      startupError,
      reauthRequired,
      refresh,
      retryStartup,
      setUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
