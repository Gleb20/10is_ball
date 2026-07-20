import { useEffect, useState } from "react";
import { Button, TextField } from "../ui";
import { api } from "../api";

export function HelpPage() {
  const [articles, setArticles] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void api.faq().then((r) => setArticles(r.articles));
  }, []);

  return (
    <div className="stack">
      <h1 className="page-title">Помощь</h1>
      {articles.map((a) => (
        <div className="card" key={String(a.id)}>
          <div className="muted">{String(a.category)}</div>
          <strong>{String(a.title)}</strong>
          <p>{String(a.body)}</p>
        </div>
      ))}
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
        <h2>Обратная связь</h2>
        <TextField
          label="Сообщение"
          value={message}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setMessage(e.target.value)
          }
          required
        />
        <Button type="submit">Отправить</Button>
        {sent && <p role="status">Спасибо! Сообщение отправлено.</p>}
      </form>
    </div>
  );
}
