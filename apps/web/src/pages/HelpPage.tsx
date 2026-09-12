import { useEffect, useState } from "react";
import { Alert, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState } from "../patterns";
import { api } from "../api";
import { useSingleFlight } from "../useSingleFlight";

export function HelpPage() {
  const [articles, setArticles] = useState<Array<Record<string, unknown>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
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
        await api.feedback("question", message);
        setMessage("");
        setSent(true);
      } catch (feedbackError) {
        setFormError((feedbackError as Error).message);
      }
    });
  }

  useEffect(() => {
    void api
      .faq()
      .then((r) => setArticles(r.articles))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <PageLayout title="Помощь">
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
        <TextField
          label="Сообщение"
          value={message}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setMessage(e.target.value)
          }
          required
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
