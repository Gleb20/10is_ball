import { useEffect, useRef, useState } from "react";
import { Alert, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState } from "../patterns";
import { api } from "../api";
import { useAuth } from "../auth";
import { useSingleFlight } from "../useSingleFlight";

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
  const [formError, setFormError] = useState<string | null>(null);
  const submission = useSingleFlight();

  async function sendFeedback(e: React.FormEvent) {
    e.preventDefault();
    await submission.run(async () => {
      setFormError(null);
      setSent(false);
      try {
        await api.feedback(kind, message.trim());
        setMessage("");
        setSent(true);
      } catch (feedbackError) {
        if ((feedbackError as Error & { status?: number }).status !== 401) setFormError((feedbackError as Error).message);
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
        <TextField
          label="Сообщение"
          value={message}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setMessage(e.target.value)
          }
          required
          maxLength={4000}
          disabled={submission.pending}
          aria-describedby="feedback-materials"
        />
        <Button type="submit" disabled={submission.pending}>
          {submission.pending ? "Отправка…" : "Отправить"}
        </Button>
        {formError ? (
          <Alert
            type="error"
            variant="tonal"
            title="Не удалось отправить"
            description={formError}
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
