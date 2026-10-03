import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TeamAvatar, TeamAvatarPicker } from "./TeamAvatar";

describe("TeamAvatar", () => {
  it("shows the selected preset and falls back to team initials on image error", () => {
    const { container, rerender } = render(
      <TeamAvatar avatarKey="avatar_3" teamName="Ракетки Москвы" />,
    );

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", "/avatars/avatar_3.png");

    fireEvent.error(image!);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("РМ")).toBeInTheDocument();

    rerender(<TeamAvatar avatarKey="avatar_4" teamName="Ракетки Москвы" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/avatars/avatar_4.png");
  });

  it("falls back for omitted and invalid legacy values", () => {
    const { rerender } = render(
      <TeamAvatar teamName="Ракетки Москвы" avatarKey={undefined} />,
    );
    expect(screen.getByText("РМ")).toBeInTheDocument();

    rerender(
      <TeamAvatar teamName="Ракетки Москвы" avatarKey={"avatar_99" as "avatar_1"} />,
    );
    expect(screen.getByText("РМ")).toBeInTheDocument();
  });
});

describe("TeamAvatarPicker", () => {
  it("renders none plus ten presets as a native radio group", () => {
    render(<TeamAvatarPicker value={null} onChange={vi.fn()} name="team-avatar" />);

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(11);
    expect(screen.getByRole("radio", { name: "Без аватара" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Аватар 10" })).not.toBeChecked();
    expect(radios.every((radio) => radio.getAttribute("name") === "team-avatar")).toBe(true);
  });

  it("supports keyboard selection and reports the stable preset key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TeamAvatarPicker value={null} onChange={onChange} name="team-avatar" />);

    const option = screen.getByRole("radio", { name: "Аватар 4" });
    option.focus();
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith("avatar_4");
  });

  it("disables every option while its parent mutation is pending", () => {
    render(
      <TeamAvatarPicker
        value="avatar_2"
        onChange={vi.fn()}
        name="team-avatar"
        disabled
      />,
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });
});
