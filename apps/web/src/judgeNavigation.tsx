import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";

export type JudgeExitNotice = {
  kind: "success" | "warning";
  message: string;
};

export type JudgeNavigationDecision = {
  action: "POP" | "PUSH" | "REPLACE";
  currentPath: string;
  nextPath: string;
};

export type JudgeBlockedPop = {
  sourceLocationKey: string;
  targetLocationKey: string;
  proceed: (notice?: JudgeExitNotice) => void;
  reset: () => void;
};

export type JudgeNavigationController = {
  shouldBlock: (decision: JudgeNavigationDecision) => boolean;
  onBlocked: (blocked: JudgeBlockedPop) => void;
};

type RegisteredController = {
  token: symbol;
  controller: JudgeNavigationController;
};

type PendingNotice = {
  id: symbol;
  sourceLocationKey: string;
  notice: JudgeExitNotice;
};

type BridgeContextValue = {
  register: (controller: JudgeNavigationController) => () => void;
  pendingNotice: PendingNotice | null;
  consumeNotice: (id: symbol) => void;
};

const JudgeNavigationContext = createContext<BridgeContextValue | null>(null);

function locationPath(location: {
  pathname: string;
  search: string;
  hash: string;
}) {
  return `${location.pathname}${location.search}${location.hash}`;
}

export function JudgeNavigationBridge({ children }: { children: ReactNode }) {
  const controllerRef = useRef<RegisteredController | null>(null);
  const candidateRef = useRef<{
    sourceLocationKey: string;
    targetLocationKey: string;
  } | null>(null);
  const deliveredBlockRef = useRef<{
    token: symbol;
    sourceLocationKey: string;
    targetLocationKey: string;
  } | null>(null);
  const [pendingNotice, setPendingNotice] = useState<PendingNotice | null>(null);

  const blocker = useBlocker((args) => {
    const registered = controllerRef.current;
    if (!registered) return false;
    const shouldBlock = registered.controller.shouldBlock({
      action: args.historyAction,
      currentPath: locationPath(args.currentLocation),
      nextPath: locationPath(args.nextLocation),
    });
    if (shouldBlock) {
      candidateRef.current = {
        sourceLocationKey: args.currentLocation.key,
        targetLocationKey: args.nextLocation.key,
      };
    }
    return shouldBlock;
  });

  useEffect(() => {
    if (blocker.state !== "blocked") {
      if (blocker.state === "unblocked") deliveredBlockRef.current = null;
      return;
    }
    const registered = controllerRef.current;
    const candidate = candidateRef.current;
    if (!registered || !candidate) {
      blocker.reset();
      return;
    }
    const delivered = deliveredBlockRef.current;
    if (
      delivered?.token === registered.token &&
      delivered.sourceLocationKey === candidate.sourceLocationKey &&
      delivered.targetLocationKey === candidate.targetLocationKey
    ) return;
    deliveredBlockRef.current = {
      token: registered.token,
      sourceLocationKey: candidate.sourceLocationKey,
      targetLocationKey: candidate.targetLocationKey,
    };
    const controllerToken = registered.token;
    registered.controller.onBlocked({
      sourceLocationKey: candidate.sourceLocationKey,
      targetLocationKey: candidate.targetLocationKey,
      proceed: (notice) => {
        if (controllerRef.current?.token !== controllerToken) {
          blocker.reset();
          return;
        }
        if (notice) {
          setPendingNotice({
            id: Symbol("judge-exit-notice"),
            sourceLocationKey: candidate.sourceLocationKey,
            notice,
          });
        }
        blocker.proceed();
      },
      reset: () => blocker.reset(),
    });
  }, [blocker]);

  const register = useCallback((controller: JudgeNavigationController) => {
    const token = Symbol("judge-navigation-controller");
    controllerRef.current = { token, controller };
    return () => {
      if (controllerRef.current?.token === token) controllerRef.current = null;
    };
  }, []);

  const consumeNotice = useCallback((id: symbol) => {
    setPendingNotice((current) => current?.id === id ? null : current);
  }, []);
  const contextValue = useMemo(
    () => ({ register, pendingNotice, consumeNotice }),
    [consumeNotice, pendingNotice, register],
  );

  return (
    <JudgeNavigationContext.Provider value={contextValue}>
      {children}
    </JudgeNavigationContext.Provider>
  );
}

export function useJudgeNavigationController(
  controller: JudgeNavigationController,
) {
  const bridge = useContext(JudgeNavigationContext);
  const register = bridge?.register;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  if (!bridge && import.meta.env.MODE !== "test") {
    throw new Error(
      "JudgeNavigationBridge is required around Judge routes",
    );
  }

  useLayoutEffect(() => {
    if (!register) return;
    return register({
      shouldBlock: (decision) =>
        controllerRef.current.shouldBlock(decision),
      onBlocked: (blocked) => controllerRef.current.onBlocked(blocked),
    });
  }, [register]);
}

export function useNativeJudgeExitNotice(locationKey: string) {
  const bridge = useContext(JudgeNavigationContext);
  const [displayed, setDisplayed] = useState<{
    locationKey: string;
    notice: JudgeExitNotice;
  } | null>(null);

  useEffect(() => {
    const pending = bridge?.pendingNotice;
    if (pending && pending.sourceLocationKey !== locationKey) {
      setDisplayed({ locationKey, notice: pending.notice });
      bridge.consumeNotice(pending.id);
      return;
    }
    setDisplayed((current) =>
      current?.locationKey === locationKey ? current : null,
    );
  }, [bridge, locationKey]);

  return displayed?.locationKey === locationKey ? displayed.notice : null;
}
