import { NavLink, useLocation } from "react-router-dom";
import { Icon } from "./ui";

const TABS = [
  { to: "/", end: true, label: "Главная", icon: "Design/Layout" },
  { to: "/history", label: "История", icon: "Time/Clock" },
  { to: "/start", label: "Начать", icon: "Math & Finances/Plus" },
  { to: "/rankings", label: "Рейтинг", icon: "Games/Trophy" },
  { to: "/profile", label: "Профиль", icon: "People/User" },
] as const;

export function shouldShowBottomNav(pathname: string, opts: {
  authenticated: boolean;
  mustChangePassword: boolean;
}): boolean {
  if (!opts.authenticated || opts.mustChangePassword) return false;
  if (pathname === "/login" || pathname === "/first-password") return false;
  if (/\/matches\/[^/]+\/judge$/.test(pathname)) return false;
  return true;
}

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={"end" in tab ? tab.end : false}
          className={({ isActive }) =>
            isActive ? "bottom-nav__item active" : "bottom-nav__item"
          }
        >
          <Icon path={tab.icon} size={22} weight="regular" />
          <span>{tab.label}</span>
        </NavLink>
      ))}
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
}: {
  children: React.ReactNode;
  showNav: boolean;
}) {
  const location = useLocation();
  const immersive = /\/matches\/[^/]+\/judge$/.test(location.pathname);

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
        {children}
      </main>
      {showNav ? <BottomNav /> : null}
    </div>
  );
}
