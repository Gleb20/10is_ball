import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Button } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, FilterBar, ListRow } from "../patterns";
import { initialsFromName, splitPodium } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import { api } from "../api";

type RankingRow = {
  userId: string;
  displayName: string;
  wins: number;
  avatarKey?: string | null;
};

export function RankingsPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<"all_time" | "week" | "month">(
    "all_time",
  );
  const [rankings, setRankings] = useState<RankingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setRankings(null);
    void api
      .rankings(period)
      .then((r) => setRankings(r.rankings as RankingRow[]))
      .catch((e) => setError(e.message));
  }, [period]);

  const { podium, rest } = splitPodium(rankings ?? []);

  return (
    <PageLayout title="Рейтинг">
      <FilterBar
        label="Период рейтинга"
        value={period}
        onChange={(v) => setPeriod(v as "all_time" | "week" | "month")}
        options={[
          { value: "all_time", label: "Всё время" },
          { value: "week", label: "Неделя" },
          { value: "month", label: "Месяц" },
        ]}
      />
      <AsyncState
        loading={rankings === null && !error}
        error={error}
        empty={rankings !== null && rankings.length === 0}
        emptyTitle="Пока нет результатов"
        emptyDescription="Сыграйте матч — рейтинг появится здесь."
        emptyAction={
          <Button onClick={() => navigate("/start")}>Начать</Button>
        }
      >
        <div className="stack">
          {podium.length > 0 ? (
            <div className="podium" aria-label="Пьедестал">
              {[1, 0, 2]
                .filter((i) => podium[i])
                .map((i) => {
                  const r = podium[i]!;
                  return (
                    <div
                      key={r.userId}
                      className={`podium__slot podium__slot--${i + 1}`}
                    >
                      <span className="podium__place">#{i + 1}</span>
                      <Avatar
                        size="md"
                        variant={i === 0 ? "contained" : "tonal"}
                        color={i === 0 ? "primary" : "secondary"}
                        src={avatarSrc(r.avatarKey)}
                        initials={initialsFromName(r.displayName)}
                        alt={r.displayName}
                      />
                      <strong className="podium__name">{r.displayName}</strong>
                      <span className="muted">{r.wins} побед</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          navigate(
                            `/matches/new?opponentId=${encodeURIComponent(r.userId)}&opponentName=${encodeURIComponent(r.displayName)}`,
                          )
                        }
                      >
                        Вызов
                      </Button>
                    </div>
                  );
                })}
            </div>
          ) : null}

          {rest.length > 0 ? (
            <div className="stack">
              {rest.map((r, i) => (
                <ListRow
                  key={r.userId}
                  leading={
                    <strong className="rank-badge">#{i + 4}</strong>
                  }
                  title={r.displayName}
                  trailing={
                    <span className="muted">{r.wins} побед</span>
                  }
                />
              ))}
            </div>
          ) : null}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
