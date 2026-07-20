import { useEffect, useState } from "react";
import { Button } from "../ui";
import { api } from "../api";

export function RankingsPage() {
  const [period, setPeriod] = useState<"all_time" | "week" | "month">(
    "all_time",
  );
  const [rankings, setRankings] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    void api.rankings(period).then((r) => setRankings(r.rankings));
  }, [period]);

  return (
    <div className="stack">
      <h1 className="page-title">Рейтинг</h1>
      <div className="row">
        {(
          [
            ["all_time", "Всё время"],
            ["week", "Неделя"],
            ["month", "Месяц"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={period === key ? "primary" : "secondary"}
            onClick={() => setPeriod(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {rankings.length === 0 ? (
        <div className="empty-state card">Пока нет результатов</div>
      ) : (
        rankings.map((r, i) => (
          <div className="card row" key={String(r.userId)}>
            <strong>#{i + 1}</strong>
            <span style={{ flex: 1 }}>{String(r.displayName)}</span>
            <span>{String(r.wins)} побед</span>
          </div>
        ))
      )}
    </div>
  );
}
