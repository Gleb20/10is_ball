import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppShell, TaskNavigation } from "./layout";

function Path() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}|{JSON.stringify(location.state)}</span>;
}

describe("REQ_shell__home_first_navigation_d36", () => {
  it("returns to the provided task context and offers Home", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/matches/m1", state: { returnTo: "/history", returnLabel: "К истории" } }]}>
        <TaskNavigation />
        <Routes><Route path="*" element={<Path />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation", { name: "Возврат" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "К истории" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/history");
  });

  it("uses a safe route fallback when context is absent", () => {
    render(<MemoryRouter initialEntries={["/tournaments/t1"]}><TaskNavigation /><Routes><Route path="*" element={<Path />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "К турнирам" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/tournaments");
  });

  it("GAP-040 returns a directly opened guest card to the guest catalogue", () => {
    render(<MemoryRouter initialEntries={["/guests/g1"]}><TaskNavigation /><Routes><Route path="*" element={<Path />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "К гостям" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/guests");
  });

  it("GAP-040 preserves a picker detour through a guest card and returns cancellation to the draft", () => {
    const guestSelectionContext = {
      kind: "match",
      returnTo: "/matches/new",
      returnLabel: "К выбору гостя",
      draftToken: "opaque-token",
      slotKey: "opponent1",
    };
    render(
      <MemoryRouter initialEntries={[{
        pathname: "/guests/g1",
        state: { returnTo: "/guests", returnLabel: "К гостям", guestSelectionContext },
      }]}>
        <TaskNavigation />
        <Routes><Route path="*" element={<Path />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "К гостям" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/guests");
    fireEvent.click(screen.getByRole("button", { name: "К выбору гостя" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/matches/new");
    expect(screen.getByTestId("path")).toHaveTextContent('"guestSelectionCancel"');
    expect(screen.getByTestId("path")).toHaveTextContent('"draftToken":"opaque-token"');
  });

  it("GAP-026 returns an active admin directly opened account to the user catalog", () => {
    render(<MemoryRouter initialEntries={["/admin/users/u1"]}><TaskNavigation isAdmin /><Routes><Route path="*" element={<Path />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "К пользователям" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/admin");
  });

  it("does not expose the admin catalog fallback to an ordinary active user", () => {
    render(<MemoryRouter initialEntries={["/admin/users/u1"]}><TaskNavigation isAdmin={false} /><Routes><Route path="*" element={<Path />} /></Routes></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "К пользователям" })).toBeNull();
    expect(screen.getByRole("button", { name: "На главную" })).toBeInTheDocument();
  });

  it("removes a stale admin catalog fallback after the actor is demoted", () => {
    const entry = { pathname: "/admin/users/u1", state: { returnTo: "/admin", returnLabel: "К пользователям" } };
    const view = render(<MemoryRouter initialEntries={[entry]}><TaskNavigation isAdmin /><Routes><Route path="*" element={<Path />} /></Routes></MemoryRouter>);
    expect(screen.getByRole("button", { name: "К пользователям" })).toBeInTheDocument();
    view.rerender(<MemoryRouter initialEntries={[entry]}><TaskNavigation isAdmin={false} /><Routes><Route path="*" element={<Path />} /></Routes></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "К пользователям" })).toBeNull();
    expect(screen.getByRole("button", { name: "На главную" })).toBeInTheDocument();
  });

  it("discards list return context when the user explicitly goes Home", () => {
    window.sessionStorage.setItem("tab10.history.return", JSON.stringify({
      userId: "u1",
      detailPath: "/matches/m1",
    }));
    window.sessionStorage.setItem("tab10.admin.return", JSON.stringify({
      userId: "u1",
      detailPath: "/admin/users/u2",
    }));
    render(
      <MemoryRouter initialEntries={[{
        pathname: "/matches/m1",
        state: { returnTo: "/history", returnLabel: "К истории" },
      }]}>
        <TaskNavigation userId="u1" />
        <Routes><Route path="*" element={<Path />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "На главную" }));

    expect(screen.getByTestId("path")).toHaveTextContent("/");
    expect(window.sessionStorage.getItem("tab10.history.return")).toBeNull();
    expect(window.sessionStorage.getItem("tab10.admin.return")).not.toBeNull();
    window.sessionStorage.clear();
  });

  it("discards the matching admin return context without exposing another actor's context", () => {
    window.sessionStorage.setItem("tab10.admin.return", JSON.stringify({
      userId: "u1",
      detailPath: "/admin/users/u2",
    }));
    render(
      <MemoryRouter initialEntries={[{
        pathname: "/admin/users/u2",
        state: { returnTo: "/admin", returnLabel: "К пользователям" },
      }]}>
        <TaskNavigation userId="u1" isAdmin />
        <Routes><Route path="*" element={<Path />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "На главную" }));

    expect(window.sessionStorage.getItem("tab10.admin.return")).toBeNull();
  });

  it("rejects stale list context when a different detail target is opened directly", () => {
    window.sessionStorage.setItem("tab10.history.return", JSON.stringify({
      userId: "u1",
      detailPath: "/matches/a",
    }));
    window.sessionStorage.setItem("tab10.admin.return", JSON.stringify({
      userId: "u1",
      detailPath: "/admin/users/a",
    }));
    const view = render(
      <MemoryRouter initialEntries={["/matches/b"]}>
        <TaskNavigation userId="u1" />
        <Routes><Route path="*" element={<Path />} /></Routes>
      </MemoryRouter>,
    );
    expect(window.sessionStorage.getItem("tab10.history.return")).toBeNull();
    expect(window.sessionStorage.getItem("tab10.admin.return")).not.toBeNull();

    view.unmount();
    render(
      <MemoryRouter initialEntries={["/admin/users/b"]}>
        <TaskNavigation userId="u1" isAdmin />
        <Routes><Route path="*" element={<Path />} /></Routes>
      </MemoryRouter>,
    );
    expect(window.sessionStorage.getItem("tab10.admin.return")).toBeNull();
  });

  it("keeps the judge release result at the destination", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/matches/m1", state: { judgeExitNotice: { kind: "warning", message: "Не удалось подтвердить освобождение слота" } } }]}>
        <AppShell showTaskNav>Матч</AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByText("Проверьте слот судьи")).toBeInTheDocument();
    expect(screen.getByText("Не удалось подтвердить освобождение слота")).toBeInTheDocument();
  });

  it("shows a judge release warning after choosing Home", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/", state: { judgeExitNotice: { kind: "warning", message: "Исход освобождения неизвестен" } } }]}>
        <AppShell>Главная</AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByText("Проверьте слот судьи")).toBeInTheDocument();
    expect(screen.getByText("Исход освобождения неизвестен")).toBeInTheDocument();
  });

  it("GAP-013 gives new-match preparation the same immersive shell as judging", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/matches/new"]}>
        <AppShell showTaskNav>
          <p>Подготовка матча</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(container.querySelector(".app-shell--immersive")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Возврат" })).not.toBeInTheDocument();
    expect(container.querySelector(".skip-link")).not.toBeInTheDocument();
  });
});
