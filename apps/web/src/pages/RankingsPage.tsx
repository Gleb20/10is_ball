import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Avatar, Button } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, FilterBar } from "../patterns";
import { initialsFromName, splitPodium } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import {
  api,
  type RankingResponse,
  type RankingRow,
  type RankingScope,
} from "../api";
import { useAuth } from "../auth";

function activeMemberLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun =
    mod10 === 1 && mod100 !== 11
      ? "активный участник"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "активных участника"
        : "активных участников";
  return `${count} ${noun}`;
}

function challengeUrl(row: RankingRow): string {
  return `/matches/new?opponentId=${encodeURIComponent(row.userId)}&opponentName=${encodeURIComponent(row.displayName)}`;
}

function profileUrl(row: RankingRow, actorUserId?: string): string {
  return row.userId === actorUserId
    ? "/profile"
    : `/players/${encodeURIComponent(row.userId)}`;
}

export function RankingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<RankingScope>("all_time");
  const [teamId, setTeamId] = useState("");
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let current = true;
    setLoading(true);
    setError(null);
    void api
      .rankings(period, teamId || undefined)
      .then((response) => {
        if (current) setData(response);
      })
      .catch((reason: Error) => {
        if (current) setError(reason.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [period, teamId, user?.id]);

  const rankings = data?.rankings ?? [];
  const { podium, rest } = splitPodium(rankings);
  const initialError = !data ? error : null;

  return (
    <PageLayout title="Рейтинг">
      <FilterBar
        label="Период рейтинга"
        value={period}
        onChange={(value) => setPeriod(value as RankingScope)}
        options={[
          { value: "all_time", label: "Всё время" },
          { value: "calendar_week", label: "Неделя" },
          { value: "calendar_month", label: "Месяц" },
        ]}
      />
      <p className="muted ranking-time-note context-tip" role="note" aria-label="Подсказка о периодах рейтинга">
        «Всё время» охватывает всю историю. Неделя и месяц считаются по московскому времени.
      </p>

      {data && data.availableTeams.length > 0 ? (
        <FilterBar
          label="Состав рейтинга"
          value={teamId || "all"}
          onChange={(value) => setTeamId(value === "all" ? "" : value)}
          options={[
            { value: "all", label: "Общий" },
            ...data.availableTeams.map((team) => ({
              value: team.id,
              label: team.name,
            })),
          ]}
        />
      ) : null}

      {data && data.availableTeams.length === 0 ? (
        <div className="card stack ranking-team-empty">
          <strong>Командный рейтинг станет доступен после вступления в команду.</strong>
          <Link className="text-link" to="/teams">
            Создать команду
          </Link>
        </div>
      ) : null}

      {data?.team ? (
        <div className="card ranking-team-summary" aria-label="Итог команды">
          <div>
            <span className="muted">Команда</span>
            <strong>{data.team.name}</strong>
          </div>
          <div>
            <strong>{data.team.winsAllTime} побед за всё время</strong>
            <span className="muted">
              {activeMemberLabel(data.team.activeMemberCount)}
            </span>
          </div>
        </div>
      ) : null}

      {data && error ? (
        <Alert
          type="error"
          variant="tonal"
          title="Не удалось обновить рейтинг"
          description={error}
        />
      ) : null}

      <AsyncState
        loading={loading && !data}
        error={initialError}
        empty={Boolean(data) && rankings.length === 0}
        emptyTitle={teamId ? "У команды пока нет результатов" : "Пока нет результатов"}
        emptyDescription="Сыграйте матч — рейтинг появится здесь."
        emptyAction={<Button onClick={() => navigate("/start")}>Сыграть матч</Button>}
      >
        <div className="stack" aria-busy={loading && Boolean(data)}>
          {podium.length > 0 ? (
            <div className="podium" aria-label="Пьедестал">
              {[1, 0, 2]
                .filter((index) => podium[index])
                .map((index) => {
                  const row = podium[index]!;
                  return (
                    <div
                      key={row.userId}
                      className={`podium__slot podium__slot--${index + 1}`}
                    >
                      <span className="podium__place">#{index + 1}</span>
                      <Link
                        className="podium__player-link"
                        to={profileUrl(row, user?.id)}
                        aria-label={`Открыть карточку ${row.displayName}`}
                      >
                        <Avatar
                          size="md"
                          variant={index === 0 ? "contained" : "tonal"}
                          color={index === 0 ? "primary" : "secondary"}
                          src={avatarSrc(row.avatarKey)}
                          initials={initialsFromName(row.displayName)}
                          alt={row.displayName}
                        />
                        <strong className="podium__name">{row.displayName}</strong>
                      </Link>
                      <span className="muted">{row.wins} побед</span>
                      {user && row.userId !== user.id ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => navigate(challengeUrl(row))}
                        >
                          Вызов
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          ) : null}

          {rest.length > 0 ? (
            <div className="stack" aria-label="Остальные игроки">
              {rest.map((row, index) => (
                <div className="ranking-row" key={row.userId}>
                  <Link
                    className="ranking-row__player"
                    to={profileUrl(row, user?.id)}
                    aria-label={`Открыть карточку ${row.displayName}`}
                  >
                    <strong className="rank-badge">#{index + 4}</strong>
                    <Avatar
                      size="sm"
                      variant="tonal"
                      color="secondary"
                      src={avatarSrc(row.avatarKey)}
                      initials={initialsFromName(row.displayName)}
                      alt=""
                      aria-hidden="true"
                    />
                    <span className="ranking-row__body">
                      <strong>{row.displayName}</strong>
                      <span className="muted">
                        {row.wins} побед · {row.matchesPlayed} матчей
                      </span>
                    </span>
                  </Link>
                  {user && row.userId !== user.id ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(challengeUrl(row))}
                    >
                      Вызов
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
