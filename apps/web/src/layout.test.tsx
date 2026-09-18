import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppShell, TaskNavigation } from "./layout";

function Path() {
  return <span data-testid="path">{useLocation().pathname}</span>;
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
});
