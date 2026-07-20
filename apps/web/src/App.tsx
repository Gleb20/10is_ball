import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { FirstPasswordPage } from "./pages/FirstPasswordPage";
import { HomePage } from "./pages/HomePage";
import { AdminPage } from "./pages/AdminPage";
import { MatchesPage } from "./pages/MatchesPage";
import { MatchDetailPage } from "./pages/MatchDetailPage";
import { JudgePage } from "./pages/JudgePage";
import { RankingsPage } from "./pages/RankingsPage";
import { TournamentsPage } from "./pages/TournamentsPage";
import { TournamentDetailPage } from "./pages/TournamentDetailPage";
import { TeamsPage } from "./pages/TeamsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { HelpPage } from "./pages/HelpPage";
import { OnboardingPage } from "./pages/OnboardingPage";

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="app-shell">
      <main className="app-main">{children}</main>
      {user && !user.mustChangePassword && (
        <nav className="bottom-nav" aria-label="Основная навигация">
          <NavLink to="/" end>
            Главная
          </NavLink>
          <NavLink to="/matches">Матчи</NavLink>
          <NavLink to="/tournaments">Турниры</NavLink>
          <NavLink to="/rankings">Рейтинг</NavLink>
          <NavLink to="/profile">Профиль</NavLink>
        </nav>
      )}
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted">Загрузка…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/first-password" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <Shell>
        <p className="muted">Загрузка…</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route
          path="/login"
          element={user && !user.mustChangePassword ? <Navigate to="/" /> : <LoginPage />}
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
          path="/admin"
          element={
            <Protected>
              <AdminPage />
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
    </Shell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
