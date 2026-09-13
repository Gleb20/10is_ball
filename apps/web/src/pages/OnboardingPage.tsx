import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button } from "../ui";
import { PageLayout } from "../layout";
import { api } from "../api";
import { useAuth } from "../auth";
import { useSingleFlight } from "../useSingleFlight";

const STEPS = [
  {
    title: "Главная",
    description:
      "Здесь собраны активные события, последние результаты и быстрый вход в уведомления.",
  },
  {
    title: "Рейтинг",
    description:
      "Сравнивайте результаты за всё время, неделю или месяц и вызывайте соперника на матч.",
  },
  {
    title: "История",
    description: "Возвращайтесь к завершённым матчам и турнирам клуба.",
  },
  {
    title: "Уведомления",
    description: "Здесь появляются приглашения в команды, матчи и турниры.",
  },
  {
    title: "Профиль",
    description:
      "Управляйте командами, сессиями, справкой и повторным запуском онбординга.",
  },
  {
    title: "Начать",
    description:
      "Создайте обычный матч или турнир из центрального раздела навигации.",
  },
  {
    title: "Учебный матч",
    description:
      "Попробуйте judge flow с «Призрачным Олегом». Учебный результат не влияет на рейтинг и историю.",
  },
] as const;

export function OnboardingPage() {
  const [actionError, setActionError] = useState<string | null>(null);
  const action = useSingleFlight();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const stepIndex = Math.min(
    Math.max(Number(user?.onboardingStep ?? 0), 0),
    STEPS.length - 1,
  );
  const step = STEPS[stepIndex]!;
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [stepIndex]);

  function advance() {
    void action.run(async () => {
      setActionError(null);
      try {
        const result = await api.setOnboardingStep(
          Math.min(stepIndex + 1, STEPS.length - 1),
        );
        setUser(result.user);
      } catch (error) {
        setActionError((error as Error).message);
      }
    });
  }

  function startTutorial() {
    void action.run(async () => {
      setActionError(null);
      try {
        const progress = await api.setOnboardingStep(STEPS.length - 1);
        setUser(progress.user);
        const result = await api.tutorial();
        navigate(`/matches/${result.match.id}/judge?tutorial=1`);
      } catch (error) {
        setActionError((error as Error).message);
      }
    });
  }

  function skipOnboarding() {
    void action.run(async () => {
      setActionError(null);
      try {
        const result = await api.completeOnboarding();
        setUser(result.user);
        navigate("/");
      } catch (error) {
        setActionError((error as Error).message);
      }
    });
  }

  return (
    <PageLayout title="Онбординг">
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
          <p className="context-tip" role="note" aria-label="Завершение онбординга">
            После учебного матча вы вернётесь сюда. Онбординг завершится только после явного выбора «Завершить без учебного матча».
          </p>
        ) : null}
        <p className="muted">
          Прогресс сохраняется в профиле. Можно закрыть страницу и продолжить с
          этого шага после следующего входа.
        </p>
        <div className="stack stack--actions">
          {stepIndex === STEPS.length - 1 ? (
            <Button disabled={action.pending} onClick={startTutorial}>
              {action.pending ? "Запуск…" : "Матч с Призрачным Олегом"}
            </Button>
          ) : (
            <>
              <Button disabled={action.pending} onClick={advance}>
                {action.pending ? "Сохраняем…" : "Далее"}
              </Button>
              <Button
                variant="secondary"
                disabled={action.pending}
                onClick={advance}
              >
                Пропустить шаг
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            disabled={action.pending}
            onClick={skipOnboarding}
          >
            {stepIndex === STEPS.length - 1
              ? "Завершить без учебного матча"
              : "Закрыть онбординг"}
          </Button>
        </div>
        {actionError ? (
          <Alert
            type="error"
            variant="tonal"
            title="Не удалось выполнить"
            description={actionError}
          />
        ) : null}
      </div>
    </PageLayout>
  );
}
