import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Button, EmptyState } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow, StatusChip } from "../patterns";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import { api } from "../api";
import { useAuth } from "../auth";

type RankingEntry = {
  userId: string;
  displayName: string;
  wins: number;
  avatarKey?: string | null;
};

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .home()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const lastMatches =
    (data?.lastMatches as Array<Record<string, unknown>>) ?? [];
  const topRankings = (data?.topRankings as RankingEntry[]) ?? [];
  const myStats = data?.myStats as
    | {
        rank: number;
        wins: number;
        losses: number;
        displayName: string;
        avatarKey?: string | null;
      }
    | null
    | undefined;
  const unread =
    (data?.unreadNotifications as Array<Record<string, unknown>>) ?? [];
  const hero = data?.hero as
    | {
        type: string;
        displayName?: string;
        wins?: number;
        avatarKey?: string | null;
      }
    | undefined;

  return (
    <PageLayout title={`Привет, ${user?.firstName ?? "игрок"}`}>
      <AsyncState loading={!data && !error} error={error} skeletonCount={3}>
        <div className="stack page-layout">
          {hero?.type === "empty" ? (
            <EmptyState
              title="Пока нет игр"
              description="Создайте первый матч — счёт и рейтинг появятся здесь."
              action={
                <Button onClick={() => navigate("/start")}>Создать матч</Button>
              }
            />
          ) : (
            <section className="hero-card" aria-label="Обзор">
              {myStats ? (
                <div className="hero-card__me">
                  <Avatar
                    size="md"
                    variant="tonal"
                    src={avatarSrc(myStats.avatarKey ?? user?.avatarKey)}
                    initials={initialsFromName(myStats.displayName)}
                    alt={myStats.displayName}
                  />
                  <div>
                    <p className="muted">Ваша статистика</p>
                    <strong>
                      #{myStats.rank} · {myStats.wins}П / {myStats.losses}Пр
                    </strong>
                  </div>
                </div>
              ) : null}
              <div className="hero-card__leader">
                <p className="muted">Лидер рейтинга</p>
                <div className="row">
                  <Avatar
                    size="sm"
                    variant="contained"
                    color="primary"
                    src={avatarSrc(hero?.avatarKey)}
                    initials={initialsFromName(hero?.displayName ?? "")}
                    alt={hero?.displayName}
                  />
                  <strong>
                    {hero?.displayName} — {hero?.wins} побед
                  </strong>
                </div>
              </div>
              {topRankings.length > 0 ? (
                <div className="podium podium--compact" aria-label="Топ-3">
                  {topRankings.slice(0, 3).map((r, i) => (
                    <div
                      key={r.userId}
                      className={`podium__slot podium__slot--${i + 1}`}
                    >
                      <span className="podium__place">#{i + 1}</span>
                      <Avatar
                        size="sm"
                        variant="tonal"
                        src={avatarSrc(r.avatarKey)}
                        initials={initialsFromName(r.displayName)}
                        alt={r.displayName}
                      />
                      <span className="podium__name">{r.displayName}</span>
                      <span className="muted">{r.wins} побед</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          )}

          {unread.length > 0 ? (
            <button
              type="button"
              className="card list-row list-row--button"
              onClick={() => navigate("/notifications")}
            >
              <div className="list-row__body">
                <strong>Уведомления</strong>
                <span className="muted">
                  Непрочитанных: {unread.length}
                </span>
              </div>
              <span className="list-row__chevron" aria-hidden>
                ›
              </span>
            </button>
          ) : null}

          <div className="stack stack--actions">
            <Button onClick={() => navigate("/start")}>Начать</Button>
            <Button variant="secondary" onClick={() => navigate("/history")}>
              Вся история
            </Button>
          </div>

          <h2 className="section-title">Последние матчи</h2>
          {lastMatches.length === 0 ? (
            <p className="muted">История пуста</p>
          ) : (
            <div className="stack">
              {lastMatches.map((m) => (
                <ListRow
                  key={String(m.id)}
                  to={`/matches/${m.id}`}
                  title={String(m.title)}
                  subtitle={`${String(m.scoreA)}:${String(m.scoreB)}`}
                  trailing={<StatusChip status={String(m.status)} />}
                />
              ))}
            </div>
          )}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
