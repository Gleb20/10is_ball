import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState } from "../patterns";
import { api } from "../api";
import { useAuth } from "../auth";
import { useLifecycleSingleFlight } from "./useLifecycleSingleFlight";

export function HelpPage() {
  const [articles, setArticles] = useState<Array<Record<string, unknown>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const generation = useRef(0);
  const [kind, setKind] = useState("question");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<{ title: string; description: string } | null>(null);
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  const submission = useLifecycleSingleFlight();
  const userRef = useRef(user);
  const mountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const submissionActorRef = useRef<string | null>(null);
  const interruptedSubmissionRef = useRef<string | null>(null);
  const lastActorIdRef = useRef(user?.id ?? null);
  const messageId = useId();
  const formErrorId = "feedback-form-error";

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;
    submission.resume();
    const actorId = userRef.current?.id ?? null;
    if (actorId && lastActorIdRef.current && actorId !== lastActorIdRef.current) {
      setKind("question");
      setMessage("");
      setSent(false);
      setFormError(null);
      setSubmissionUncertain(false);
      interruptedSubmissionRef.current = null;
    } else if (actorId && interruptedSubmissionRef.current === actorId) {
      interruptedSubmissionRef.current = null;
      setSent(false);
      setSubmissionUncertain(true);
      setFormError({
        title: "Не удалось подтвердить отправку",
        description: "Обращение могло сохраниться. Текст оставлен в поле; повторная отправка может создать ещё одно обращение.",
      });
    } else if (actorId && interruptedSubmissionRef.current) {
      interruptedSubmissionRef.current = null;
    }
    if (actorId) lastActorIdRef.current = actorId;
    return () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      if (submission.invalidate() && submissionActorRef.current) {
        interruptedSubmissionRef.current = submissionActorRef.current;
      }
    };
  }, [user?.id]);

  useEffect(() => {
    if (formError) document.getElementById(formErrorId)?.focus();
  }, [formError]);

  function isCurrentSubmission(actorId: string, generation: number) {
    return mountedRef.current &&
      lifecycleGenerationRef.current === generation &&
      userRef.current?.id === actorId;
  }

  function isDocumentedNoWrite(error: unknown) {
    const status = (error as { status?: number }).status;
    return status === 400 || status === 403;
  }

  async function sendFeedback(e: React.FormEvent) {
    e.preventDefault();
    const normalizedMessage = message.trim();
    if (!normalizedMessage || message.length > 4000) {
      setSent(false);
      setSubmissionUncertain(false);
      setFormError({
        title: "Проверьте сообщение",
        description: normalizedMessage ? "Сообщение длиннее 4000 символов." : "Введите сообщение.",
      });
      return;
    }
    await submission.run(async () => {
      setFormError(null);
      setSent(false);
      setSubmissionUncertain(false);
      const actorId = userRef.current?.id;
      if (!actorId) return;
      submissionActorRef.current = actorId;
      const generation = lifecycleGenerationRef.current;
      try {
        await api.feedback(kind, normalizedMessage);
        if (!isCurrentSubmission(actorId, generation)) return;
        setMessage("");
        setSent(true);
      } catch (feedbackError) {
        const status = (feedbackError as Error & { status?: number }).status;
        if (status === 401 || !isCurrentSubmission(actorId, generation)) return;
        if (isDocumentedNoWrite(feedbackError)) {
          setFormError({
            title: "Не удалось отправить",
            description: (feedbackError as Error).message,
          });
        } else {
          setSubmissionUncertain(true);
          setFormError({
            title: "Не удалось подтвердить отправку",
            description: "Обращение могло сохраниться. Текст оставлен в поле; повторная отправка может создать ещё одно обращение.",
          });
        }
      }
    });
  }

  async function load() {
    const current = ++generation.current;
    setError(null);
    try {
      const result = await api.faq();
      if (current === generation.current) setArticles(result.articles);
    } catch (failure) {
      if (current === generation.current && (failure as Error & { status?: number }).status !== 401) setError((failure as Error).message);
    }
  }
  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [user]);

  return (
    <PageLayout title="Помощь">
      {error ? <Button variant="secondary" onClick={() => void load()}>Повторить загрузку справки</Button> : null}
      <AsyncState
        loading={articles === null && !error}
        error={error}
        empty={articles !== null && articles.length === 0}
        emptyTitle="FAQ пока пуст"
        emptyDescription="Статьи появятся позже. Можно отправить вопрос ниже."
      >
        <div className="stack">
          {(articles ?? []).map((a) => (
            <div className="card" key={String(a.id)}>
              <div className="muted">{String(a.category)}</div>
              <strong>{String(a.title)}</strong>
              <p>{String(a.body)}</p>
            </div>
          ))}
        </div>
      </AsyncState>

      <form
        className="card stack"
        onSubmit={sendFeedback}
        noValidate
        aria-label="Обратная связь"
      >
        <h2 className="section-title">Обратная связь</h2>
        <label className="stack">
          Категория
          <select aria-label="Категория" value={kind} disabled={submission.pending} onChange={(event) => setKind(event.target.value)}>
            <option value="bug">Ошибка</option><option value="idea">Идея</option><option value="question">Вопрос</option><option value="other">Другое</option>
          </select>
        </label>
        <p id="feedback-materials" className="muted">Если есть материалы, добавьте ссылку в сообщение.</p>
        <label className="stack" htmlFor={messageId}>
          Сообщение
          <textarea
            id={messageId}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            required
            rows={5}
            maxLength={4000}
            disabled={submission.pending}
            aria-invalid={formError ? true : undefined}
            aria-describedby={`feedback-materials feedback-limit${formError ? ` ${formErrorId}` : ""}`}
            style={{
              width: "100%",
              boxSizing: "border-box",
              resize: "vertical",
              maxHeight: "40vh",
              overflowY: "auto",
              padding: "12px",
              border: "1px solid var(--color-border-primary, #d5d5d5)",
              borderRadius: "8px",
              background: "var(--color-bg-secondary, #fff)",
              color: "var(--color-text-primary, #111)",
              font: "inherit",
              lineHeight: 1.5,
            }}
          />
        </label>
        <p id="feedback-limit" className="muted" aria-live="polite">
          {message.length} из 4000 символов
        </p>
        <Button type="submit" disabled={submission.pending}>
          {submission.pending
            ? "Отправка…"
            : submissionUncertain
              ? "Отправить ещё раз"
              : "Отправить"}
        </Button>
        {formError ? (
          <Alert
            id={formErrorId}
            tabIndex={-1}
            role="alert"
            type="error"
            variant="tonal"
            title={formError.title}
            description={formError.description}
          />
        ) : null}
        {sent && (
          <Alert
            type="success"
            variant="tonal"
            title="Спасибо"
            description="Сообщение отправлено."
          />
        )}
      </form>
    </PageLayout>
  );
}
