import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button } from "../ui";
import { PageLayout } from "../layout";
import { api, type User } from "../api";
import { useAuth } from "../auth";
import { useLifecycleSingleFlight } from "./useLifecycleSingleFlight";

const STEPS = [
  {
    title: "Главная",
    description:
      "Здесь собраны активные события, последние результаты и быстрый вход в уведомления.",
  },
  {
    title: "Рейтинг",
    description:
      "Сравнивайте результаты за всё время, неделю или месяц.",
  },
  {
    title: "История",
    description: "Возвращайтесь к завершённым матчам и турнирам клуба.",
  },
  {
    title: "Уведомления",
    description: "Здесь появляются приглашения в команды и сообщения о передаче судейства.",
  },
  {
    title: "Профиль",
    description:
      "Управляйте командами, сессиями, справкой и повторным запуском обучения.",
  },
  {
    title: "Начать",
    description:
      "На Главной доступны отдельные действия «Начать матч» и «Провести турнир».",
  },
  {
    title: "Учебный матч",
    description:
      "Попробуйте вести счёт в учебном матче с «Призрачным Олегом». Учебный результат не влияет на рейтинг и историю.",
  },
] as const;

export function OnboardingPage() {
  const [actionError, setActionError] = useState<{ title: string; description: string } | null>(null);
  const [tutorialOutcomeUnknown, setTutorialOutcomeUnknown] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<"advance" | "tutorial" | "complete" | null>(null);
  const action = useLifecycleSingleFlight();
  const { user, setUser } = useAuth();
  const userRef = useRef(user);
  const mountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const pendingIntentRef = useRef<"advance" | "tutorial" | "complete" | null>(null);
  const tutorialPhaseRef = useRef<"progress" | "create" | null>(null);
  const interruptedActionRef = useRef<{
    actorId: string;
    intent: "advance" | "tutorial" | "complete";
    tutorialPhase: "progress" | "create" | null;
    expectedStep: number | null;
  } | null>(null);
  const navigate = useNavigate();
  const stepIndex = Math.min(
    Math.max(Number(user?.onboardingStep ?? 0), 0),
    STEPS.length - 1,
  );
  const step = STEPS[stepIndex]!;
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const actionErrorId = "learning-action-error";

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;
    action.resume();
    setPendingIntent(null);
    pendingIntentRef.current = null;
    setActionError(null);
    const actorId = userRef.current?.id;
    const interrupted = interruptedActionRef.current;
    if (actorId && interrupted?.actorId === actorId) {
      interruptedActionRef.current = null;
      if (interrupted.intent === "tutorial" && interrupted.tutorialPhase === "create") {
        setTutorialOutcomeUnknown(true);
        setActionError({
          title: "Не удалось подтвердить запуск",
          description: "Учебный матч мог быть создан, но ответ не получен. Можно завершить обучение или явно начать ещё один учебный матч.",
        });
      } else {
        void recoverInterruptedProgress(interrupted, lifecycleGenerationRef.current);
      }
    } else if (actorId && interrupted) {
      interruptedActionRef.current = null;
      setTutorialOutcomeUnknown(false);
    }
    return () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      if (action.invalidate() && userRef.current?.id && pendingIntentRef.current) {
        interruptedActionRef.current = {
          actorId: userRef.current.id,
          intent: pendingIntentRef.current,
          tutorialPhase: tutorialPhaseRef.current,
          expectedStep: pendingIntentRef.current === "advance"
            ? Math.min(Number(userRef.current.onboardingStep ?? 0) + 1, STEPS.length - 1)
            : pendingIntentRef.current === "tutorial"
              ? STEPS.length - 1
              : null,
        };
      }
    };
  }, [user?.id]);

  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [stepIndex]);

  useEffect(() => {
    if (actionError) document.getElementById(actionErrorId)?.focus();
  }, [actionError]);

  function isCurrentAction(actorId: string, generation: number) {
    return mountedRef.current &&
      lifecycleGenerationRef.current === generation &&
      userRef.current?.id === actorId;
  }

  function applyUserForActor(actorId: string, generation: number, nextUser: User) {
    if (!isCurrentAction(actorId, generation) || nextUser.id !== actorId) return false;
    userRef.current = nextUser;
    setUser(nextUser);
    return true;
  }

  async function recoverProgress(actorId: string, generation: number) {
    try {
      const result = await api.me();
      return applyUserForActor(actorId, generation, result.user) ? result.user : null;
    } catch {
      return null;
    }
  }

  async function recoverInterruptedProgress(
    interrupted: NonNullable<typeof interruptedActionRef.current>,
    generation: number,
  ) {
    const { actorId, intent, expectedStep } = interrupted;
    const recovered = await recoverProgress(actorId, generation);
    if (!isCurrentAction(actorId, generation)) return;
    if (intent === "complete" && recovered?.onboardingCompletedAt) {
      navigate("/");
      return;
    }
    if (intent === "advance" && recovered && Number(recovered.onboardingStep) === expectedStep) return;
    if (intent === "tutorial" && recovered && Number(recovered.onboardingStep) === STEPS.length - 1) {
      setActionError({
        title: "Прогресс сохранён",
        description: "Учебный матч не запускался автоматически. Нажмите кнопку ещё раз, когда будете готовы начать.",
      });
      return;
    }
    setActionError({
      title: "Не удалось подтвердить результат",
      description: intent === "complete"
        ? "Завершение могло сохраниться. Обновите страницу, чтобы проверить подтверждённое состояние."
        : intent === "advance"
          ? "Шаг мог сохраниться. Обновите страницу: обучение продолжится с подтверждённого шага."
          : "Не удалось подтвердить сохранение прогресса. Учебный матч не запущен автоматически.",
    });
  }

  function beginIntent(intent: "advance" | "tutorial" | "complete") {
    pendingIntentRef.current = intent;
    setPendingIntent(intent);
  }

  function endIntent(actorId: string, generation: number) {
    if (!isCurrentAction(actorId, generation)) return;
    pendingIntentRef.current = null;
    tutorialPhaseRef.current = null;
    setPendingIntent(null);
  }

  function isAuthError(error: unknown) {
    return (error as { status?: number }).status === 401;
  }

  function isDocumentedNoWrite(error: unknown) {
    const status = (error as { status?: number }).status;
    return status === 400 || status === 403;
  }

  function issueFor(error: unknown, fallback: string) {
    return {
      title: isDocumentedNoWrite(error) ? "Не удалось выполнить" : "Не удалось подтвердить результат",
      description: isDocumentedNoWrite(error) ? (error as Error).message : fallback,
    };
  }

  function advance() {
    void action.run(async () => {
      beginIntent("advance");
      setActionError(null);
      const actorId = userRef.current?.id;
      if (!actorId) {
        pendingIntentRef.current = null;
        setPendingIntent(null);
        return;
      }
      const generation = lifecycleGenerationRef.current;
      const nextStep = Math.min(stepIndex + 1, STEPS.length - 1);
      try {
        const result = await api.setOnboardingStep(nextStep);
        applyUserForActor(actorId, generation, result.user);
      } catch (error) {
        if (!isCurrentAction(actorId, generation) || isAuthError(error)) return;
        const recovered = await recoverProgress(actorId, generation);
        if (!isCurrentAction(actorId, generation)) return;
        if (recovered && Number(recovered.onboardingStep) === nextStep) return;
        setActionError(issueFor(
          error,
          "Шаг мог сохраниться. После восстановления соединения обновите страницу: обучение продолжится с подтверждённого шага.",
        ));
      } finally {
        endIntent(actorId, generation);
      }
    });
  }

  function startTutorial() {
    void action.run(async () => {
      beginIntent("tutorial");
      tutorialPhaseRef.current = "progress";
      setActionError(null);
      setTutorialOutcomeUnknown(false);
      const actorId = userRef.current?.id;
      if (!actorId) {
        pendingIntentRef.current = null;
        tutorialPhaseRef.current = null;
        setPendingIntent(null);
        return;
      }
      const generation = lifecycleGenerationRef.current;
      try {
        const progress = await api.setOnboardingStep(STEPS.length - 1);
        if (!applyUserForActor(actorId, generation, progress.user)) return;
      } catch (error) {
        if (!isCurrentAction(actorId, generation) || isAuthError(error)) return;
        const recovered = await recoverProgress(actorId, generation);
        if (!isCurrentAction(actorId, generation)) return;
        if (recovered && Number(recovered.onboardingStep) === STEPS.length - 1) {
          setActionError({
            title: "Прогресс сохранён",
            description: "Учебный матч не запускался автоматически. Нажмите кнопку ещё раз, когда будете готовы начать.",
          });
        } else {
          setActionError(issueFor(
            error,
            "Не удалось подтвердить сохранение прогресса. Учебный матч не запущен автоматически.",
          ));
        }
        endIntent(actorId, generation);
        return;
      }
      tutorialPhaseRef.current = "create";
      try {
        const result = await api.tutorial();
        if (!isCurrentAction(actorId, generation)) return;
        navigate(`/matches/${result.match.id}/judge?tutorial=1`);
      } catch (error) {
        if (!isCurrentAction(actorId, generation) || isAuthError(error)) return;
        const isUnknown = !isDocumentedNoWrite(error);
        setTutorialOutcomeUnknown(isUnknown);
        setActionError(isUnknown ? {
          title: "Не удалось подтвердить запуск",
          description: "Учебный матч мог быть создан, но ответ не получен. Можно завершить обучение или явно начать ещё один учебный матч.",
        } : {
          title: "Не удалось запустить учебный матч",
          description: (error as Error).message,
        });
      } finally {
        endIntent(actorId, generation);
      }
    });
  }

  function skipOnboarding() {
    void action.run(async () => {
      beginIntent("complete");
      setActionError(null);
      const actorId = userRef.current?.id;
      if (!actorId) {
        pendingIntentRef.current = null;
        setPendingIntent(null);
        return;
      }
      const generation = lifecycleGenerationRef.current;
      try {
        const result = await api.completeOnboarding();
        if (applyUserForActor(actorId, generation, result.user)) navigate("/");
      } catch (error) {
        if (!isCurrentAction(actorId, generation) || isAuthError(error)) return;
        const recovered = await recoverProgress(actorId, generation);
        if (!isCurrentAction(actorId, generation)) return;
        if (recovered?.onboardingCompletedAt) {
          navigate("/");
          return;
        }
        setActionError(issueFor(
          error,
          "Завершение могло сохраниться. После восстановления соединения обновите страницу, чтобы проверить подтверждённое состояние.",
        ));
      } finally {
        endIntent(actorId, generation);
      }
    });
  }

  return (
    <PageLayout title="Обучение">
      <div className="card stack">
        <p className="muted" role="status" aria-live="polite">
          Шаг {stepIndex + 1} из {STEPS.length}
        </p>
        <h2 ref={stepHeadingRef} tabIndex={-1}>{step.title}</h2>
        <p>{step.description}</p>
        {stepIndex === 3 ? (
          <aside className="onboarding-context-target" role="note" aria-label="Где найти уведомления">
            <strong>Вход в уведомления</strong>
            <span>После обучения он доступен на Главной и в Профиле.</span>
          </aside>
        ) : null}
        {stepIndex === STEPS.length - 1 ? (
          <p className="context-tip" role="note" aria-label="Завершение обучения">
            После учебного матча вы вернётесь сюда. Обучение завершится только после явного выбора «Завершить обучение».
          </p>
        ) : null}
        <p className="muted">
          Прогресс сохраняется в профиле. Можно закрыть страницу и продолжить с
          этого шага после следующего входа.
        </p>
        <div className="stack stack--actions">
          {stepIndex === STEPS.length - 1 ? (
            <Button disabled={action.pending} onClick={startTutorial}>
              {pendingIntent === "tutorial"
                ? "Запускаем учебный матч…"
                : tutorialOutcomeUnknown
                  ? "Начать ещё один учебный матч"
                  : "Матч с Призрачным Олегом"}
            </Button>
          ) : (
            <Button disabled={action.pending} onClick={advance}>
              {pendingIntent === "advance" ? "Сохраняем…" : "Далее"}
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={action.pending}
            onClick={skipOnboarding}
          >
            {pendingIntent === "complete"
              ? "Завершаем…"
              : stepIndex === STEPS.length - 1
                ? "Завершить обучение"
                : "Закрыть обучение"}
          </Button>
        </div>
        {actionError ? (
          <Alert
            id={actionErrorId}
            tabIndex={-1}
            role="alert"
            type="error"
            variant="tonal"
            title={actionError.title}
            description={actionError.description}
          />
        ) : null}
      </div>
    </PageLayout>
  );
}
