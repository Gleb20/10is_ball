import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Alert, Avatar, Button, EmptyState, Skeleton } from "../ui";
import { PageLayout } from "../layout";
import { FilterBar, StatusChip } from "../patterns";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import {
  api,
  type HomeCurrentTask,
  type HomeMatchEvent,
  type HomeResponse,
  type HomeTournamentEvent,
} from "../api";
import { useAuth } from "../auth";
import { useVisibleRefresh } from "../useVisibleRefresh";

type HomeEvent = HomeMatchEvent | HomeTournamentEvent;

function formatDuration(seconds?: number | null) {
  if (seconds == null) return null;
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function moreTasksLabel(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14
    ? "текущих дел"
    : last === 1 ? "текущее дело" : last >= 2 && last <= 4 ? "текущих дела" : "текущих дел";
  return `Ещё ${count} ${noun}`;
}

function EventCard({ event, current = false }: { event: HomeEvent; current?: boolean }) {
  const match = event.type === "match" ? event : null;
  const hasSides = Boolean(match?.sideA && match.sideB);
  const ordinaryFinish = match?.status === "finished";
  const winnerSide = ordinaryFinish && (match?.winnerSide === "A" || match?.winnerSide === "B") ? match.winnerSide : null;
  const route = event.type === "match" ? `/matches/${event.id}` : `/tournaments/${event.id}`;
  const duration = formatDuration(event.durationSeconds);
  const roles = "currentRoles" in event ? (event as HomeCurrentTask).currentRoles : [];
  return (
    <Link className="home-event card" to={route} state={{ returnTo: "/", returnLabel: "На главную" }}>
      <div className="home-event__main">
        <strong className="home-event__names">{hasSides ? <>
          <span className="home-event__side">{match!.sideA}{winnerSide === "A" ? <span className="home-event__winner-mark" role="img" aria-label="Победитель: сторона A">{"\u00a0"}🏆</span> : null}</span>
          <span aria-hidden="true"> — </span>
          <span className="home-event__side">{match!.sideB}{winnerSide === "B" ? <span className="home-event__winner-mark" role="img" aria-label="Победитель: сторона B">{"\u00a0"}🏆</span> : null}</span>
        </> : event.title}</strong>
        {match ? <strong className="home-event__score">{match.scoreA}:{match.scoreB}</strong> : null}
      </div>
      <div className="home-event__meta">
        {duration ? <span>{duration}</span> : null}
        {event.type === "tournament" && event.topThree?.length ? <span>Топ-3: {event.topThree.join(", ")}</span> : null}
        {current && match?.judgeName ? <span>Судья: {match.judgeName}</span> : null}
        {current && roles.includes("organizer") ? <span>Вы организатор</span> : null}
        {current && event.type === "tournament" && event.hasCurrentMatch ? <span>Ваш матч сейчас</span> : null}
      </div>
      {!ordinaryFinish ? <StatusChip status={event.status} domain={event.type === "match" ? "match" : "tournament"} /> : null}
    </Link>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const location = useLocation();
  const actionsRef = useRef<HTMLHeadingElement>(null);
  const [period, setPeriod] = useState<"all_time" | "month">("all_time");
  const [recentRole, setRecentRole] = useState<"all" | "player">("all");
  const [data, setData] = useState<HomeResponse | null>(null);
  const [showMoreTasks, setShowMoreTasks] = useState(false);
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const response = await api.home(period, recentRole);
    if (sequence === requestSequence.current) setData(response);
  }, [period, recentRole]);
  const { error, refreshing, refreshNow } = useVisibleRefresh(load, {
    refreshKey: `${period}:${recentRole}`,
  });

  useEffect(() => {
    if (location.hash === "#home-actions") actionsRef.current?.focus();
  }, [location.hash]);

  const myStats = data?.myStats;
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || myStats?.displayName || "Игрок";
  const currentTasks: HomeEvent[] = data?.currentTasks ?? [data?.activeEvents?.match, data?.activeEvents?.tournament]
    .filter((event): event is HomeEvent => Boolean(event) && event?.userRole !== "viewer");
  const recentEvents = data?.recentEvents ?? [];
  const topRankings = data?.topRankings ?? [];
  const unreadCount = data?.notificationView === "available" ? data.unreadCount : null;
  const historyChanging = data != null && (data.recentRole ?? "all") !== recentRole;
  const rankingChanging = data != null && data.rankingPeriod !== period;

  return (
    <PageLayout>
      <header className="home-identity card">
        <Link className="home-identity__profile" to="/profile" aria-label={`Профиль: ${displayName}; сеансы и обучение`}>
          <Avatar size="md" variant="tonal" src={avatarSrc(myStats?.avatarKey ?? user?.avatarKey)} initials={initialsFromName(displayName)} alt={displayName} />
          <span className="home-identity__name">{displayName}</span>
        </Link>
        <Link className="home-identity__notifications text-link" to="/notifications">
          Уведомления{unreadCount != null && unreadCount > 0 ? ` (${unreadCount})` : ""}
        </Link>
        {data ? <p className="home-identity__rank">{myStats?.rank ? `#${myStats.rank} в рейтинге` : "Первые результаты впереди"}</p> : null}
        {data ? <dl className="home-identity__stats">
          <div><dt>Матчи</dt><dd>{myStats?.matchesPlayed ?? 0}</dd></div>
          <div><dt>Победы</dt><dd>{myStats?.wins ?? 0}</dd></div>
          <div><dt>Поражения</dt><dd>{myStats?.losses ?? 0}</dd></div>
        </dl> : null}
      </header>

      <section id="home-actions" className="home-actions" aria-labelledby="home-actions-heading">
        <h1 id="home-actions-heading" ref={actionsRef} tabIndex={-1} className="visually-hidden">Главная: начните событие</h1>
        <Link className="home-action home-action--primary" to="/matches/new">Начать матч</Link>
        <Link className="home-action home-action--secondary" to="/tournaments/new">Провести турнир</Link>
      </section>

      {!data && error ? (
        <div className="card stack">
          <Alert type="error" variant="tonal" title="Не удалось загрузить главную" description={error} />
          <Button onClick={() => void refreshNow()}>Повторить</Button>
        </div>
      ) : !data ? (
        <div className="stack" role="status" aria-label="Загружаем главную">
          <Skeleton variant="rectangular" height={96} />
          <Skeleton variant="rectangular" height={96} />
          <Skeleton variant="rectangular" height={96} />
        </div>
      ) : (
        <div className="stack home-content">
          {error ? <Alert type="warning" variant="tonal" title="Не удалось обновить главную" description={error} /> : null}
          {error ? <Button size="sm" variant="secondary" onClick={() => void refreshNow()}>Повторить</Button> : null}
          {refreshing && !error ? <p className="muted home-refresh-status" role="status">Обновляем данные…</p> : null}

          {currentTasks.length ? <section className="stack" aria-labelledby="home-current-heading">
            <h2 id="home-current-heading" className="section-title">Текущие дела</h2>
            {currentTasks.slice(0, 2).map((event) => <EventCard key={`${event.type}-${event.id}`} event={event} current />)}
            {currentTasks.length > 2 ? <div id="home-more-tasks" className="stack" hidden={!showMoreTasks}>
              {currentTasks.slice(2).map((event) => <EventCard key={`${event.type}-${event.id}`} event={event} current />)}
            </div> : null}
            {currentTasks.length > 2 ? <Button variant="secondary" aria-expanded={showMoreTasks} aria-controls="home-more-tasks" onClick={() => setShowMoreTasks((value) => !value)}>
              {showMoreTasks ? "Скрыть остальные" : moreTasksLabel(currentTasks.length - 2)}
            </Button> : null}
          </section> : null}

          <section className="stack" aria-labelledby="home-history-heading">
            <div className="home-section-heading"><h2 id="home-history-heading" className="section-title">История игр</h2><Link className="text-link" to="/history">Смотреть все</Link></div>
            <FilterBar label="События истории" value={recentRole} onChange={(value) => setRecentRole(value as "all" | "player")}
              options={[{ value: "all", label: "Все" }, { value: "player", label: "Только мои" }]} />
            {historyChanging ? <Skeleton variant="rectangular" height={86} /> : recentEvents.length ? recentEvents.map((event) => <EventCard key={`${event.type}-${event.id}`} event={event} />) :
              <EmptyState title="История пока пуста" description={recentRole === "player" ? "Здесь появятся матчи и турниры, в которых вы играли." : "Здесь появятся завершённые матчи и турниры."} action={<Link className="text-link" to="/matches/new">Начать матч</Link>} />}
          </section>

          <section className="stack" aria-labelledby="home-ranking-heading">
            <div className="home-section-heading"><h2 id="home-ranking-heading" className="section-title">Топ-3</h2><Link className="text-link" to="/rankings">Смотреть все</Link></div>
            <FilterBar label="Период рейтинга" value={period} onChange={(value) => setPeriod(value as "all_time" | "month")}
              options={[{ value: "all_time", label: "Всё время" }, { value: "month", label: "За месяц" }]} />
            {rankingChanging ? <Skeleton variant="rectangular" height={86} /> : topRankings.length ?
              <ol className="home-ranking-list">{topRankings.map((entry) => <li key={entry.userId}>
                <div className="home-ranking-row"><Link to={entry.userId === user?.id ? "/profile" : `/players/${entry.userId}`}>{entry.displayName}</Link><span>{entry.wins} побед</span></div>
              </li>)}</ol> : <EmptyState title="Рейтинг пока пуст" description="После завершённых матчей здесь появятся игроки." />}
          </section>

        </div>
      )}
      <nav className="home-secondary" aria-label="Другие разделы">
        {!data ? <><Link to="/history">История</Link><Link to="/rankings">Рейтинг</Link></> : null}
        <Link to="/matches">Матчи</Link><Link to="/tournaments">Турниры</Link><Link to="/teams">Команды</Link><Link to="/help">Помощь</Link>
        {user?.role === "admin" ? <Link to="/admin">Админка</Link> : null}
      </nav>
    </PageLayout>
  );
}
