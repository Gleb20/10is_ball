import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  AsyncState,
  FilterBar,
  ListRow,
  StatusChip,
} from "./patterns";
import { formatLabel, statusLabel, statusTone } from "./statusLabels";

describe("REQ_ui__status_labels", () => {
  it("maps match and tournament statuses to Russian", () => {
    expect(statusLabel("in_progress")).toBe("Идёт");
    expect(statusLabel("waiting")).toBe("Ожидание");
    expect(statusLabel("collecting", "tournament")).toBe("Сбор");
    expect(statusLabel("blocked", "user")).toBe("Заблокирован");
    expect(formatLabel("single_elimination")).toBe("Single elim.");
  });

  it("assigns tone for StatusChip colors", () => {
    expect(statusTone("finished")).toBe("success");
    expect(statusTone("cancelled")).toBe("error");
    expect(statusTone("in_progress")).toBe("warning");
  });
});

describe("REQ_ui__list_row", () => {
  it("renders link row with title and chevron", () => {
    render(
      <MemoryRouter>
        <ListRow to="/matches/1" title="Дружеский" subtitle="Идёт · 3:1" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /дружеский/i })).toHaveAttribute(
      "href",
      "/matches/1",
    );
    expect(screen.getByText("Идёт · 3:1")).toBeInTheDocument();
  });
});

describe("REQ_ui__status_chip", () => {
  it("shows localized label", () => {
    render(<StatusChip status="pending_confirmation" />);
    expect(screen.getByText("Подтверждение")).toBeInTheDocument();
  });
});

describe("REQ_ui__async_state", () => {
  it("shows skeleton while loading", () => {
    const { container } = render(
      <AsyncState loading empty={false}>
        <p>content</p>
      </AsyncState>,
    );
    expect(screen.queryByText("content")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[class*='skeleton'], span").length).toBeGreaterThan(
      0,
    );
  });

  it("shows alert on error", () => {
    render(
      <AsyncState loading={false} error="Сеть недоступна">
        <p>content</p>
      </AsyncState>,
    );
    expect(screen.getByText("Сеть недоступна")).toBeInTheDocument();
  });

  it("shows empty state", () => {
    render(
      <AsyncState
        loading={false}
        empty
        emptyTitle="Нет матчей"
        emptyDescription="Создайте первый"
      >
        <p>content</p>
      </AsyncState>,
    );
    expect(screen.getByText("Нет матчей")).toBeInTheDocument();
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });
});

describe("REQ_ui__filter_bar", () => {
  it("renders button group options", () => {
    render(
      <FilterBar
        label="Период"
        value="week"
        onChange={() => undefined}
        options={[
          { value: "all_time", label: "Всё время" },
          { value: "week", label: "Неделя" },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: /период/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /неделя/i })).toBeInTheDocument();
  });
});
