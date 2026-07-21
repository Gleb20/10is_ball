import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { UserPicker } from "./UserPicker";

const directory = vi.fn();

vi.mock("../api", () => ({
  api: {
    directory: (...args: unknown[]) => directory(...args),
  },
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ user: { id: "me" } }),
}));

vi.mock("../ui", () => ({
  Autocomplete: (props: {
    label: string;
    options: Array<{ value: string; label: string }>;
  }) => (
    <div>
      <span>{props.label}</span>
      <ul>
        {props.options.map((o) => (
          <li key={o.value}>{o.label}</li>
        ))}
      </ul>
    </div>
  ),
}));

describe("UserPicker", () => {
  beforeEach(() => {
    directory.mockResolvedValue({
      users: [
        { id: "me", displayName: "Я Сам" },
        { id: "u2", displayName: "Кузьма Домовой" },
        { id: "u3", displayName: "Уже Вростере" },
      ],
    });
  });

  it("filters by exclude list and self", async () => {
    render(
      <UserPicker
        label="Добавить игрока"
        value=""
        onChange={() => undefined}
        excludeUserIds={["u3"]}
        excludeSelf
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Кузьма Домовой")).toBeTruthy();
    });
    expect(screen.queryByText("Я Сам")).toBeNull();
    expect(screen.queryByText("Уже Вростере")).toBeNull();
  });
});
