import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TournamentsPage } from "./TournamentsPage";
import { formatPlannedDate } from "../tournamentDate";
const createTournament = vi.fn();
const listTournaments = vi.fn();
vi.mock("../api", () => ({ api: { createTournament: (...args: unknown[]) => createTournament(...args), listTournaments: (...args: unknown[]) => listTournaments(...args) } }));
describe("GAP-019 planned date", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("keeps the submitted optional calendar date frozen during request and retains it after a rejection", async () => {
    let reject!: (reason: unknown) => void;
    createTournament.mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
    render(<MemoryRouter><TournamentsPage createOnly /></MemoryRouter>);
    const field = screen.getByLabelText("Плановая дата (необязательно)");
    fireEvent.change(field, { target: { value: "2028-02-29" } });
    fireEvent.submit(screen.getByRole("form", { name: "Создание турнира" }));
    await waitFor(() => expect(createTournament).toHaveBeenCalledWith(expect.objectContaining({ plannedDate: "2028-02-29" })));
    expect(field).toBeDisabled();
    reject(Object.assign(new Error("Создание отклонено"), { status: 400 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Создание отклонено");
    expect(field).toBeEnabled();
    expect(field).toHaveValue("2028-02-29");
  });
  it("shows a calendar date in the catalog without changing it to the viewer's previous day", async () => {
    listTournaments.mockResolvedValue({ tournaments: [{ id: "t1", title: "Будущий турнир", status: "collecting", format: "single_elimination", plannedDate: "2028-02-29" }] });
    render(<MemoryRouter><TournamentsPage /></MemoryRouter>);
    expect(await screen.findByText(/29 февраля 2028/)).toBeInTheDocument();
    expect(formatPlannedDate(null)).toBeNull();
    expect(formatPlannedDate("2027-02-29")).toBeNull();
  });
});
