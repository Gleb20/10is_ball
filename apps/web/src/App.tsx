import { Activity, useRef } from "react";
import { InvitationNotice } from "./InvitationNotice";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AppShell, shouldShowBottomNav } from "./layout";
import type { BottomNavGuideTarget } from "./layout";
import { Alert, Button, Skeleton } from "./ui";
import { LoginPage } from "./pages/LoginPage";
import { FirstPasswordPage } from "./pages/FirstPasswordPage";
import { HomePage } from "./pages/HomePage";
import { AdminPage } from "./pages/AdminPage";
import { MatchesPage } from "./pages/MatchesPage";
import { MatchCreatePage } from "./pages/MatchCreatePage";
import { MatchDetailPage } from "./pages/MatchDetailPage";
import { JudgePage } from "./pages/JudgePage";
import { RankingsPage } from "./pages/RankingsPage";
import { TournamentsPage } from "./pages/TournamentsPage";
import { TournamentDetailPage } from "./pages/TournamentDetailPage";
import { TeamsPage } from "./pages/TeamsPage";
import { TeamDetailPage } from "./pages/TeamDetailPage";
import { ProfilePage } from "./pages/ProfilePage";
import { HelpPage } from "./pages/HelpPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { HistoryPage } from "./pages/HistoryPage";
import { StartPage } from "./pages/StartPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, reauthRequired } = useAuth();
  const location = useLocation();
  const protectedActorRef = useRef(user?.id ?? "anonymous");
  if (user?.id) protectedActorRef.current = user.id;
  if (loading) return <Skeleton variant="rectangular" height={120} />;
  if (!user && !reauthRequired) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ returnTo }} />;
  }
  if (user?.mustChangePassword) return <Navigate to="/first-password" replace />;
  const tutorialJudgeRoute =
    /^\/matches\/[^/]+\/judge$/.test(location.pathname) &&
    new URLSearchParams(location.search).get("tutorial") === "1";
  if (
    user?.onboardingCompletedAt === null &&
    location.pathname !== "/onboarding" &&
    !tutorialJudgeRoute
  ) {
    return <Navigate to="/onboarding" replace />;
  }
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return (
    <>
      <Activity
        key={protectedActorRef.current}
        mode={reauthRequired ? "hidden" : "visible"}
      >
        {children}
      </Activity>
      {reauthRequired ? (
        <LoginPage returnTo={returnTo} sessionExpired />
      ) : null}
    </>
  );
}

function AppRoutes() {
  const {
    user,
    loading,
    startupPhase,
    startupError,
    retryStartup,
    reauthRequired,
  } = useAuth();
  const location = useLocation();
  const onboardingActive = user?.onboardingCompletedAt === null;
  const onboardingNavTargets: ReadonlyArray<BottomNavGuideTarget | null> = [
    "/",
    "/rankings",
    "/history",
    null,
    "/profile",
    "/start",
    null,
  ];
  const onboardingGuideTarget = onboardingActive && location.pathname === "/onboarding"
    ? onboardingNavTargets[user?.onboardingStep ?? 0] ?? null
    : undefined;
  const showNav = (!onboardingActive || location.pathname === "/onboarding") && shouldShowBottomNav(location.pathname, {
    authenticated: Boolean(user),
    mustChangePassword: Boolean(user?.mustChangePassword),
  });

  if (loading) {
    return (
      <AppShell showNav={false}>
        <div className="card stack" role="status" aria-live="polite">
          <strong>
            {startupPhase === "waking"
              ? "Сервис просыпается…"
              : "Подключаемся к сервису…"}
          </strong>
          {startupPhase === "waking" ? (
            <p className="muted">
              Бесплатный сервер запускается после паузы. Это может занять до
              минуты.
            </p>
          ) : null}
          <Skeleton variant="rectangular" height={72} />
        </div>
      </AppShell>
    );
  }

  if (startupPhase === "failed") {
    return (
      <AppShell showNav={false}>
        <div className="card stack">
          <Alert
            type="error"
            variant="tonal"
            title={startupError ?? "Не удалось подключиться к сервису"}
            description="Проверьте соединение и попробуйте ещё раз."
          />
          <Button onClick={retryStartup}>Повторить</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell showNav={showNav} onboardingGuideTarget={onboardingGuideTarget}>
      {user ? <InvitationNotice userId={user.id} enabled={!user.mustChangePassword && !onboardingActive && !reauthRequired} /> : null}
      <Routes>
        <Route
          path="/login"
          element={
            user && !user.mustChangePassword ? (
              <Navigate to="/" />
            ) : (
              <LoginPage />
            )
          }
        />
        <Route path="/first-password" element={<FirstPasswordPage />} />
        <Route
          path="/"
          element={
            <Protected>
              <HomePage />
            </Protected>
          }
        />
        <Route
          path="/history"
          element={
            <Protected>
              <HistoryPage />
            </Protected>
          }
        />
        <Route
          path="/start"
          element={
            <Protected>
              <StartPage />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected>
              <AdminPage />
            </Protected>
          }
        />
        <Route
          path="/matches/new"
          element={
            <Protected>
              <MatchCreatePage />
            </Protected>
          }
        />
        <Route
          path="/matches"
          element={
            <Protected>
              <MatchesPage />
            </Protected>
          }
        />
        <Route
          path="/matches/:id"
          element={
            <Protected>
              <MatchDetailPage />
            </Protected>
          }
        />
        <Route
          path="/matches/:id/judge"
          element={
            <Protected>
              <JudgePage />
            </Protected>
          }
        />
        <Route
          path="/rankings"
          element={
            <Protected>
              <RankingsPage />
            </Protected>
          }
        />
        <Route
          path="/tournaments"
          element={
            <Protected>
              <TournamentsPage />
            </Protected>
          }
        />
        <Route
          path="/tournaments/:id"
          element={
            <Protected>
              <TournamentDetailPage />
            </Protected>
          }
        />
        <Route
          path="/teams"
          element={
            <Protected>
              <TeamsPage />
            </Protected>
          }
        />
        <Route
          path="/teams/:id"
          element={
            <Protected>
              <TeamDetailPage />
            </Protected>
          }
        />
        <Route
          path="/profile"
          element={
            <Protected>
              <ProfilePage />
            </Protected>
          }
        />
        <Route
          path="/players/:userId"
          element={
            <Protected>
              <ProfilePage />
            </Protected>
          }
        />
        <Route
          path="/help"
          element={
            <Protected>
              <HelpPage />
            </Protected>
          }
        />
        <Route
          path="/onboarding"
          element={
            <Protected>
              <OnboardingPage />
            </Protected>
          }
        />
        <Route
          path="/notifications"
          element={
            <Protected>
              <NotificationsPage />
            </Protected>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
