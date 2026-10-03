import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { prepareBracketGraph } from "@tab10/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TournamentBracket } from "./TournamentBracket";

const graph = prepareBracketGraph({
  seedOrder: ["p1", "p2", "p3", "p4"],
  format: "single_elimination",
  constructionAlgorithm: "compact",
  thirdPlaceEnabled: true,
});
const names = {
  p1: "Александра-Екатерина Сверхдлиннофамильная",
  p2: "Борис",
  p3: "Вера",
  p4: "Григорий",
};

describe("Stage 8 bracket renderer", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    Object.defineProperty(HTMLElement.prototype, "scrollBy", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("uses one navigation group, supports a readable 75% overview, and keeps third place simple", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <TournamentBracket graph={graph} names={names} matches={[]} />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("group", { name: "Навигация по турнирной сетке" })).toHaveLength(1);
    const third = container.querySelector(".tournament-bracket__band--third");
    expect(third).not.toBeNull();
    expect(third?.querySelector(".tournament-bracket__navigation")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Уменьшить сетку" }));
    expect(screen.getByRole("status", { name: "Масштаб сетки" })).toHaveTextContent("75%");
    expect(screen.getByRole("button", { name: "Уменьшить сетку" })).toBeDisabled();
  });

  it("keeps the same cards in fullscreen and restores focus after Escape", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <TournamentBracket graph={graph} names={names} matches={[]} />
      </MemoryRouter>,
    );
    const cardCount = container.querySelectorAll(".tournament-bracket__card").length;
    const fullscreen = screen.getByRole("button", { name: "На весь экран" });

    await user.click(fullscreen);
    expect(container.querySelector(".tournament-bracket__viewport--fullscreen")).not.toBeNull();
    expect(container.querySelectorAll(".tournament-bracket__card")).toHaveLength(cardCount);

    await user.keyboard("{Escape}");
    expect(container.querySelector(".tournament-bracket__viewport--fullscreen")).toBeNull();
    expect(fullscreen).toHaveFocus();
  });

  it("reserves fate and score space consistently and exposes keyboard panning", () => {
    const { container } = render(
      <MemoryRouter>
        <TournamentBracket graph={graph} names={names} matches={[]} />
      </MemoryRouter>,
    );
    const rows = container.querySelectorAll(".tournament-bracket__player");
    expect(container.querySelectorAll(".tournament-bracket__fate")).toHaveLength(rows.length);
    expect(container.querySelectorAll(".tournament-bracket__fate--empty")).toHaveLength(rows.length);

    const region = screen.getByRole("region", { name: "Турнирная сетка" });
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(HTMLElement.prototype.scrollBy).toHaveBeenCalled();
  });

  it("applies the working-match viewport once and leaves polling refreshes in place", () => {
    const graphWithMatch = {
      ...graph,
      matches: graph.matches.map((match, index) => index === 0
        ? { ...match, actualMatchId: "m1" }
        : match),
    };
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    scrollTo.mockClear();
    const view = () => (
      <MemoryRouter>
        <TournamentBracket
          graph={graphWithMatch}
          names={names}
          matches={[{ id: "m1", status: "waiting" }]}
        />
      </MemoryRouter>
    );
    const { rerender } = render(view());
    expect(scrollTo).toHaveBeenCalledTimes(1);

    rerender(view());
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
