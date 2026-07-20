import { useEffect, useState } from "react";
import { Alert, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState } from "../patterns";
import { api } from "../api";

export function HelpPage() {
  const [articles, setArticles] = useState<Array<Record<string, unknown>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

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
        onSubmit={(e) => {
          e.preventDefault();
          void api.feedback("question", message).then(() => {
            setMessage("");
            setSent(true);
          });
        }}
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
        <Button type="submit">Отправить</Button>
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
