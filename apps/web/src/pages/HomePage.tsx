import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Avatar, Button, EmptyState } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  FilterBar,
  ListRow,
  RefreshButton,
  StatusChip,
} from "../patterns";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import {
  api,
  type HomeMatchEvent,
  type HomeResponse,
  type HomeTournamentEvent,
} from "../api";
import { useAuth } from "../auth";
import { useVisibleRefresh } from "../useVisibleRefresh";

function formatDuration(seconds?: number | null) {
  if (seconds == null) return null;
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function roleLabel(role?: string) {
  if (role === "participant") return "Вы играли";
  if (role === "judge") return "Вы судили";
  if (role === "organizer") return "Вы организатор";
  return "Событие клуба";
}

function eventSubtitle(event: HomeMatchEvent | HomeTournamentEvent) {
  const duration = formatDuration(event.durationSeconds);
  if (event.type === "match") {
    const sides =
      event.sideA && event.sideB ? `${event.sideA} — ${event.sideB}` : null;
    return [
      sides,
      `${event.scoreA}:${event.scoreB}`,
      event.winnerName ? `Победитель: ${event.winnerName}` : null,
      duration,
      event.format,
      event.judgeName ? `Судья: ${event.judgeName}` : null,
      roleLabel(event.userRole),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    event.topThree?.length ? `Топ: ${event.topThree.join(", ")}` : null,
    duration,
    roleLabel(event.userRole),
  ]
    .filter(Boolean)
    .join(" · ");
}

function EventRow({ event }: { event: HomeMatchEvent | HomeTournamentEvent }) {
  return (
    <ListRow
      to={
        event.type === "match"
          ? `/matches/${event.id}`
          : `/tournaments/${event.id}`
      }
      title={event.title}
      subtitle={eventSubtitle(event)}
      trailing={
        <StatusChip
          status={event.status}
          domain={event.type === "tournament" ? "tournament" : "match"}
        />
      }
    />
  );
}

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<"all_time" | "month">("all_time");
  const [data, setData] = useState<HomeResponse | null>(null);
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const response = await api.home(period);
    if (sequence === requestSequence.current) setData(response);
  }, [period]);
  const { error, refreshing, refreshNow } = useVisibleRefresh(load, {
    refreshKey: period,
  });

  const myStats = data?.myStats;
  const activeEvents = data?.activeEvents
    ? [data.activeEvents.match, data.activeEvents.tournament].filter(
        (
          event,
        ): event is HomeMatchEvent | HomeTournamentEvent => Boolean(event),
      )
    : [];
  const topRankings = data?.topRankings ?? [];
  const recentEvents = data?.recentEvents ?? [];
  const unreadCount =
    data?.unreadCount ?? data?.unreadNotifications?.length ?? 0;

  return (
    <PageLayout
      title={`Привет, ${user?.firstName ?? "игрок"}`}
      action={<RefreshButton refreshing={refreshing} onRefresh={refreshNow} />}
    >
      <AsyncState
        loading={!data && !error}
        error={!data ? error : null}
        skeletonCount={4}
      >
        {data ? (
          <div className="stack page-layout">
            {error ? (
              <Alert
                type="warning"
                variant="tonal"
                title="Не удалось обновить"
                description={error}
              />
            ) : null}

            <section className="hero-card" aria-labelledby="home-stats-title">
              <div className="hero-card__me">
                <Avatar
                  size="md"
                  variant="tonal"
                  src={avatarSrc(myStats?.avatarKey ?? user?.avatarKey)}
                  initials={initialsFromName(
                    myStats?.displayName ?? user?.firstName ?? "",
                  )}
                  alt={myStats?.displayName ?? user?.firstName}
                />
                <div>
                  <p className="muted" id="home-stats-title">
                    Ваша статистика
                  </p>
                  <strong>
                    {myStats?.rank
                      ? `#${myStats.rank} в рейтинге`
                      : "Первые результаты впереди"}
                  </strong>
                </div>
              </div>
              <dl className="home-stats">
                <div>
                  <dt>Сыграно</dt>
                  <dd>{myStats?.matchesPlayed ?? 0}</dd>
                </div>
                <div>
                  <dt>Победы</dt>
                  <dd>{myStats?.wins ?? 0}</dd>
                </div>
                <div>
                  <dt>Поражения</dt>
                  <dd>{myStats?.losses ?? 0}</dd>
                </div>
                <div>
                  <dt>Win rate</dt>
                  <dd>{Math.round((myStats?.winRate ?? 0) * 100)}%</dd>
                </div>
                <div>
                  <dt>Очков за матч</dt>
                  <dd>{myStats?.averagePoints ?? 0}</dd>
                </div>
              </dl>
              {myStats?.rival ? (
                <div className="home-rival">
                  <div>
                    <span className="muted">Принципиальный соперник</span>
                    <strong>{myStats.rival.displayName}</strong>
                    <span className="muted">
                      {myStats.rival.matchCount} очных матча
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      navigate(
                        `/matches/new?opponentId=${encodeURIComponent(myStats.rival!.userId)}&opponentName=${encodeURIComponent(myStats.rival!.displayName)}&source=revenge`,
                      )
                    }
                  >
                    Реванш
                  </Button>
                </div>
              ) : (
                <p className="muted">
                  Соперник появится после трёх очных матчей
                </p>
              )}
            </section>

            <Button onClick={() => navigate("/start")}>Начать</Button>

            <section className="stack" aria-labelledby="active-events-title">
              <h2 className="section-title" id="active-events-title">
                Активные события
              </h2>
              {activeEvents.length > 0 ? (
                activeEvents.map((event) => (
                  <EventRow
                    key={`${event.type}-${event.id}`}
                    event={event}
                  />
                ))
              ) : (
                <EmptyState
                  title="Активных событий нет"
                  description="Создайте матч или присоединитесь к турниру."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => navigate("/start")}
                    >
                      Начать игру
                    </Button>
                  }
                />
              )}
            </section>

            <div className="home-shortcuts">
              <button
                type="button"
                className="card list-row list-row--button"
                onClick={() => navigate("/notifications")}
              >
                <div className="list-row__body">
                  <strong>Уведомления</strong>
                  <span className="muted">
                    Непрочитанных: {unreadCount}
                  </span>
                </div>
                <span className="list-row__chevron" aria-hidden>
                  ›
                </span>
              </button>
              <Button
                variant="secondary"
                onClick={() => navigate("/profile")}
                aria-label="Открыть профиль"
              >
                Профиль
              </Button>
            </div>

            <section className="stack" aria-labelledby="home-ranking-title">
              <div className="home-section-heading">
                <h2 className="section-title" id="home-ranking-title">
                  Топ-3
                </h2>
                <FilterBar
                  label="Период рейтинга"
                  value={period}
                  onChange={(value) =>
                    setPeriod(value as "all_time" | "month")
                  }
                  options={[
                    { value: "all_time", label: "Всё время" },
                    { value: "month", label: "За месяц" },
                  ]}
                />
              </div>
              {topRankings.length > 0 ? (
                <div
                  className="podium podium--compact"
                  aria-label="Топ-3 рейтинга"
                >
                  {topRankings.map((entry, index) => (
                    <div
                      key={entry.userId}
                      className={`podium__slot podium__slot--${index + 1}`}
                    >
                      <span className="podium__place">#{index + 1}</span>
                      <Avatar
                        size="sm"
                        variant="tonal"
                        src={avatarSrc(entry.avatarKey)}
                        initials={initialsFromName(entry.displayName)}
                        alt={entry.displayName}
                      />
                      <span className="podium__name">{entry.displayName}</span>
                      <span className="muted">{entry.wins} побед</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Рейтинг пока пуст"
                  description="Завершите матч, чтобы попасть в таблицу."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => navigate("/start")}
                    >
                      Сыграть матч
                    </Button>
                  }
                />
              )}
            </section>

            <section className="stack" aria-labelledby="recent-events-title">
              <h2 className="section-title" id="recent-events-title">
                Последние события
              </h2>
              {recentEvents.length > 0 ? (
                recentEvents.map((event) => (
                  <EventRow
                    key={`${event.type}-${event.id}`}
                    event={event}
                  />
                ))
              ) : (
                <EmptyState
                  title="История пока пуста"
                  description="Здесь появятся пять последних матчей и турниров."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => navigate("/start")}
                    >
                      Начать первое событие
                    </Button>
                  }
                />
              )}
              <Button
                variant="secondary"
                onClick={() => navigate("/history")}
              >
                Вся история
              </Button>
            </section>
          </div>
        ) : null}
      </AsyncState>
    </PageLayout>
  );
}
