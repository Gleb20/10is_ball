import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Button } from "./ui";

export type JudgeExitNotice = {
  kind: "success" | "warning";
  message: string;
};

function fallbackFor(pathname: string): { to: string; label: string } {
  if (pathname.startsWith("/teams/")) return { to: "/teams", label: "К командам" };
  if (pathname.startsWith("/tournaments/")) return { to: "/tournaments", label: "К турнирам" };
  if (pathname.startsWith("/matches/")) return { to: "/matches", label: "К матчам" };
  return { to: "/", label: "На главную" };
}

function savedSource(pathname: string, userId?: string) {
  if (!userId || typeof window === "undefined") return null;
  try {
    const history = JSON.parse(window.sessionStorage.getItem("tab10.history.return") ?? "null") as { userId?: string; detailPath?: string } | null;
    if (history?.userId === userId && history.detailPath === pathname) return { to: "/history", label: "К истории" };
    const bracket = JSON.parse(window.sessionStorage.getItem("tab10.bracket.return") ?? "null") as { userId?: string; tournamentId?: string; matchId?: string } | null;
    if (bracket?.userId === userId && bracket.matchId && pathname === `/matches/${bracket.matchId}` && bracket.tournamentId) {
      return { to: `/tournaments/${bracket.tournamentId}`, label: "К сетке" };
    }
  } catch { return null; }
  return null;
}

export function TaskNavigation({ userId }: { userId?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { returnTo?: unknown; returnLabel?: unknown } | null;
  const source = typeof state?.returnTo === "string" && state.returnTo.startsWith("/") && !state.returnTo.startsWith("//")
    ? { to: state.returnTo, label: typeof state.returnLabel === "string" ? state.returnLabel : "Назад" }
    : savedSource(location.pathname, userId) ?? fallbackFor(location.pathname);
  if (["/", "/login", "/first-password", "/onboarding", "/start"].includes(location.pathname) ||
      /\/matches\/[^/]+\/judge$/.test(location.pathname)) return null;
  return (
    <nav className="task-navigation" aria-label="Возврат">
      <Button size="sm" variant="secondary" onClick={() => navigate(source.to)}>{source.label}</Button>
      {source.to !== "/" ? <Button size="sm" variant="secondary" onClick={() => navigate("/")}>На главную</Button> : null}
    </nav>
  );
}

export function PageHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      {action ? <div className="page-header__action">{action}</div> : null}
    </header>
  );
}

export function PageLayout({
  children,
  title,
  action,
}: {
  children: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="stack page-layout">
      {title ? <PageHeader title={title} action={action} /> : null}
      {children}
    </div>
  );
}

export function AppShell({
  children,
  showTaskNav = false,
  userId,
}: {
  children: React.ReactNode;
  showTaskNav?: boolean;
  userId?: string;
}) {
  const location = useLocation();
  const immersive = /\/matches\/[^/]+\/judge$/.test(location.pathname);
  const judgeExitNotice = (
    location.state as { judgeExitNotice?: JudgeExitNotice } | null
  )?.judgeExitNotice;

  return (
    <div
      className={
        immersive ? "app-shell app-shell--immersive" : "app-shell"
      }
    >
      {!immersive ? (
        <a className="skip-link" href="#main-content">
          К содержимому
        </a>
      ) : null}
      <main
        id="main-content"
        tabIndex={-1}
        className="app-main"
      >
        {showTaskNav && !immersive ? <TaskNavigation userId={userId} /> : null}
        {judgeExitNotice && !immersive ? (
          <Alert
            type={judgeExitNotice.kind === "success" ? "success" : "warning"}
            variant="tonal"
            title={
              judgeExitNotice.kind === "success"
                ? "Судейство завершено"
                : "Проверьте слот судьи"
            }
            description={judgeExitNotice.message}
          />
        ) : null}
        {children}
      </main>
    </div>
  );
}
