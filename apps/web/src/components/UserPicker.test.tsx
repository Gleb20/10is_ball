import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { UserPicker } from "./UserPicker";

const directory = vi.fn();
const authState = vi.hoisted(() => ({ userId: "me" }));

vi.mock("../api", () => ({
  api: {
    directory: (...args: unknown[]) => directory(...args),
  },
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ user: { id: authState.userId } }),
}));

beforeEach(() => { directory.mockReset(); authState.userId = "me"; });

describe("UserPicker", () => {
  beforeEach(() => {
    directory.mockReset();
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
    const input = screen.getByRole("combobox", { name: "Добавить игрока" });
    await userEvent.setup().click(input);
    await waitFor(() => expect(screen.getByRole("option", { name: "Кузьма Домовой" })).toBeInTheDocument());
    expect(screen.queryByText("Я Сам")).toBeNull();
    expect(screen.queryByText("Уже Вростере")).toBeNull();
  });
});

it("BUG-023 finds the same permitted ID with name tokens in either order", async () => {
  directory.mockResolvedValue({ users: [{ id: "u2", displayName: "Кузьма Домовой" }] });
  const user = userEvent.setup();
  render(<UserPicker label="Игрок" value="" onChange={() => undefined} excludeSelf={false} />);
  const input = screen.getByRole("combobox", { name: "Игрок" });
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, "Домовой Кузьма");
  expect(screen.getByRole("option", { name: "Кузьма Домовой" })).toBeInTheDocument();
});

it("BUG-025 distinguishes a pending directory from a ready empty result", async () => {
  let resolve!: (value: { users: Array<{ id: string; displayName: string }> }) => void;
  directory.mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<UserPicker label="Игрок" value="" onChange={() => undefined} />);
  const input = screen.getByRole("combobox", { name: "Игрок" });
  expect(input).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Загружаем игроков");
  resolve({ users: [] });
  await waitFor(() => expect(input).toBeEnabled());
  expect(screen.getByRole("status")).toHaveTextContent("Нет доступных игроков");
});

it("BUG-025 offers one explicit GET retry after a directory failure", async () => {
  directory.mockRejectedValueOnce(new Error("offline"));
  directory.mockResolvedValueOnce({ users: [{ id: "u2", displayName: "Кузьма Домовой" }] });
  const user = userEvent.setup();
  render(<UserPicker label="Игрок" value="" onChange={() => undefined} />);
  const input = screen.getByRole("combobox", { name: "Игрок" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить игроков");
  expect(input).toBeDisabled();
  expect(directory).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Повторить загрузку" }));
  await waitFor(() => expect(input).toBeEnabled());
  expect(directory).toHaveBeenCalledTimes(2);
  expect(input).toHaveFocus();
});

it("BUG-025 ignores the old actor's late directory response even when self-exclusion is off", async () => {
  let resolveOld!: (value: { users: Array<{ id: string; displayName: string }> }) => void;
  directory.mockReturnValueOnce(new Promise((done) => { resolveOld = done; }));
  directory.mockResolvedValueOnce({ users: [{ id: "new", displayName: "Новый Игрок" }] });
  const picker = () => <UserPicker label="Игрок" value="" onChange={() => undefined} excludeSelf={false} />;
  const { rerender } = render(picker());
  authState.userId = "other";
  rerender(picker());
  await waitFor(() => expect(directory).toHaveBeenCalledTimes(2));
  resolveOld({ users: [{ id: "old", displayName: "Старый Игрок" }] });
  const input = screen.getByRole("combobox", { name: "Игрок" });
  await userEvent.setup().click(input);
  expect(screen.getByRole("option", { name: "Новый Игрок" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Старый Игрок" })).not.toBeInTheDocument();
});

it("BUG-025 never restores an excluded player from an obsolete response", async () => {
  let resolveOld!: (value: { users: Array<{ id: string; displayName: string }> }) => void;
  directory.mockReturnValueOnce(new Promise((done) => { resolveOld = done; }));
  directory.mockResolvedValueOnce({ users: [{ id: "u2", displayName: "Кузьма Домовой" }] });
  const onChange = vi.fn();
  const { rerender } = render(<UserPicker label="Игрок" value="" onChange={onChange} excludeUserIds={[]} />);
  rerender(<UserPicker label="Игрок" value="" onChange={onChange} excludeUserIds={["u2"]} />);
  await waitFor(() => expect(directory).toHaveBeenCalledTimes(2));
  resolveOld({ users: [{ id: "u2", displayName: "Кузьма Домовой" }] });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Нет доступных игроков"));
  await userEvent.setup().click(screen.getByRole("combobox", { name: "Игрок" }));
  expect(screen.queryByRole("option", { name: "Кузьма Домовой" })).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it("BUG-025 does not steal focus after retry if the operator moved elsewhere", async () => {
  let resolve!: (value: { users: Array<{ id: string; displayName: string }> }) => void;
  directory.mockRejectedValueOnce(new Error("offline"));
  directory.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const user = userEvent.setup();
  render(<><UserPicker label="Игрок" value="" onChange={() => undefined} /><button>Другое поле</button></>);
  await user.click(await screen.findByRole("button", { name: "Повторить загрузку" }));
  const other = screen.getByRole("button", { name: "Другое поле" });
  other.focus();
  resolve({ users: [{ id: "u2", displayName: "Кузьма Домовой" }] });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Игрок" })).toBeEnabled());
  expect(other).toHaveFocus();
});

it("BUG-025 leaves focus on retry after another directory failure", async () => {
  directory.mockRejectedValueOnce(new Error("offline"));
  directory.mockRejectedValueOnce(new Error("still offline"));
  const user = userEvent.setup();
  render(<UserPicker label="Игрок" value="" onChange={() => undefined} />);
  await user.click(await screen.findByRole("button", { name: "Повторить загрузку" }));
  const retry = await screen.findByRole("button", { name: "Повторить загрузку" });
  await waitFor(() => expect(retry).toHaveFocus());
  expect(directory).toHaveBeenCalledTimes(2);
});

it("GAP-011 announces directory failure", async () => {
  directory.mockRejectedValueOnce(new Error("offline"));
  directory.mockResolvedValue({ users: [] });
  render(<UserPicker label="Игрок" value="" onChange={() => undefined} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить игроков");
  expect(directory).toHaveBeenCalledTimes(1);
});
