import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { BracketAlgorithmDialog } from "./BracketAlgorithmDialog";
import {
  BRACKET_ALGORITHM_DIALOG,
  BRACKET_ALGORITHM_OPTIONS,
} from "../bracketAlgorithmCopy";

afterEach(() => cleanup());

function renderDialog(
  props: Partial<ComponentProps<typeof BracketAlgorithmDialog>> = {},
) {
  const onSelect = props.onSelect ?? vi.fn();
  const onConfirm = props.onConfirm ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const view = render(
    <BracketAlgorithmDialog
      open
      format="single_elimination"
      selected="compact"
      onSelect={onSelect}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  const body = screen.getByTestId("bracket-algorithm-dialog");
  return { ...view, body, onSelect, onConfirm, onCancel };
}

describe("BracketAlgorithmDialog", () => {
  it("opens with compact selected by default for SE and shows full descriptions", () => {
    const { body } = renderDialog();
    expect(
      screen.getByText(BRACKET_ALGORITHM_DIALOG.title),
    ).toBeInTheDocument();
    expect(
      within(body).getByText(BRACKET_ALGORITHM_OPTIONS.compact.description),
    ).toBeInTheDocument();
    expect(
      within(body).getByText(
        BRACKET_ALGORITHM_OPTIONS.power_of_two.description,
      ),
    ).toBeInTheDocument();
    const compactRadio = within(body).getByDisplayValue(
      "compact",
    ) as HTMLInputElement;
    expect(compactRadio.checked).toBe(true);
  });

  it("selecting classic calls onSelect with power_of_two", () => {
    const { body, onSelect } = renderDialog();
    fireEvent.click(within(body).getByTestId("bracket-algo-card-power_of_two"));
    expect(onSelect).toHaveBeenCalledWith("power_of_two");
  });

  it("submit confirms selected algorithm via parent (payload enum)", () => {
    const onConfirm = vi.fn();
    renderDialog({ selected: "power_of_two", onConfirm });
    const buttons = screen.getAllByRole("button", {
      name: BRACKET_ALGORITHM_DIALOG.submit,
    });
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancel does not confirm", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ onConfirm, onCancel });
    const buttons = screen.getAllByRole("button", {
      name: BRACKET_ALGORITHM_DIALOG.cancel,
    });
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("DE: both algorithms available; compact enabled", () => {
    const { body } = renderDialog({
      format: "double_elimination",
      selected: "compact",
    });
    const compactRadio = within(body).getByDisplayValue(
      "compact",
    ) as HTMLInputElement;
    expect(compactRadio.disabled).toBe(false);
    const po2 = within(body).getByDisplayValue(
      "power_of_two",
    ) as HTMLInputElement;
    expect(po2.disabled).toBe(false);
  });

  it("DE: submit with compact confirms", () => {
    const onConfirm = vi.fn();
    renderDialog({
      format: "double_elimination",
      selected: "compact",
      onConfirm,
    });
    const buttons = screen.getAllByRole("button", {
      name: BRACKET_ALGORITHM_DIALOG.submit,
    });
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows regen warning when requested", () => {
    const { body } = renderDialog({ showRegenWarning: true });
    expect(
      within(body).getByText(BRACKET_ALGORITHM_DIALOG.regenWarning),
    ).toBeInTheDocument();
  });

  it("keyboard: radio group is present for a11y", () => {
    const { body } = renderDialog();
    expect(
      within(body).getByTestId("bracket-algorithm-options"),
    ).toHaveAttribute("role", "radiogroup");
    expect(within(body).getAllByRole("radio")).toHaveLength(2);
  });
});
