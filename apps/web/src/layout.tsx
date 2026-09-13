import { NavLink, useLocation } from "react-router-dom";
import { Alert, Icon } from "./ui";

export type JudgeExitNotice = {
  kind: "success" | "warning";
  message: string;
};

const TABS = [
  { to: "/", end: true, label: "Главная", icon: "Design/Layout" },
  { to: "/history", label: "История", icon: "Time/Clock" },
  { to: "/start", label: "Начать", icon: "Math & Finances/Plus" },
  { to: "/rankings", label: "Рейтинг", icon: "Games/Trophy" },
  { to: "/profile", label: "Профиль", icon: "People/User" },
] as const;
export type BottomNavGuideTarget = (typeof TABS)[number]["to"];

export function shouldShowBottomNav(pathname: string, opts: {
  authenticated: boolean;
  mustChangePassword: boolean;
}): boolean {
  if (!opts.authenticated || opts.mustChangePassword) return false;
  if (pathname === "/login" || pathname === "/first-password") return false;
  if (/\/matches\/[^/]+\/judge$/.test(pathname)) return false;
  return true;
}

export function BottomNav({
  guideTarget,
}: {
  guideTarget?: BottomNavGuideTarget | null;
}) {
  const guideActive = guideTarget !== undefined;
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {TABS.map((tab) => {
        const isGuideTarget = guideTarget === tab.to;
        const content = <><Icon path={tab.icon} size={22} weight="regular" /><span>{tab.label}</span></>;
        return guideActive ? (
          <span
            key={tab.to}
            className={isGuideTarget ? "bottom-nav__item bottom-nav__item--guide" : "bottom-nav__item"}
            data-onboarding-target={isGuideTarget ? "true" : undefined}
            aria-current={isGuideTarget ? "step" : undefined}
          >
            {content}
          </span>
        ) : (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={"end" in tab ? tab.end : false}
            className={({ isActive }) =>
              isActive ? "bottom-nav__item active" : "bottom-nav__item"
            }
          >
            {content}
          </NavLink>
        );
      })}
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
  showNav,
  onboardingGuideTarget,
}: {
  children: React.ReactNode;
  showNav: boolean;
  onboardingGuideTarget?: BottomNavGuideTarget | null;
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
        className={
          showNav ? "app-main" : "app-main app-main--no-nav"
        }
      >
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
      {showNav ? <BottomNav guideTarget={onboardingGuideTarget} /> : null}
    </div>
  );
}
