import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AppShell, shouldShowBottomNav } from "./layout";
import { Skeleton } from "./ui";
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
import { ProfilePage } from "./pages/ProfilePage";
import { HelpPage } from "./pages/HelpPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { HistoryPage } from "./pages/HistoryPage";
import { StartPage } from "./pages/StartPage";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Skeleton variant="rectangular" height={120} />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/first-password" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const showNav = shouldShowBottomNav(location.pathname, {
    authenticated: Boolean(user),
    mustChangePassword: Boolean(user?.mustChangePassword),
  });

  if (loading) {
    return (
      <AppShell showNav={false}>
        <Skeleton variant="rectangular" height={120} />
      </AppShell>
    );
  }

  return (
    <AppShell showNav={showNav}>
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
          path="/profile"
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
