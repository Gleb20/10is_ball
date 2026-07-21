import { useId } from "react";
import type { BracketConstructionAlgorithm } from "@tab10/shared";
import { Dialog } from "../ui";
import {
  BRACKET_ALGORITHM_DIALOG,
  BRACKET_ALGORITHM_OPTIONS,
  COMPACT_DE_DISABLED_REASON,
} from "../bracketAlgorithmCopy";
import "./BracketAlgorithmDialog.css";

export type BracketAlgorithmDialogProps = {
  open: boolean;
  format: "single_elimination" | "double_elimination";
  selected: BracketConstructionAlgorithm;
  onSelect: (algorithm: BracketConstructionAlgorithm) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  showRegenWarning?: boolean;
};

export function BracketAlgorithmDialog({
  open,
  format,
  selected,
  onSelect,
  onCancel,
  onConfirm,
  busy = false,
  showRegenWarning = false,
}: BracketAlgorithmDialogProps) {
  const groupId = useId();
  const compactDisabled = format === "double_elimination";
  const canSubmit =
    !busy &&
    !(compactDisabled && selected === "compact");

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onCancel()}
      title={BRACKET_ALGORITHM_DIALOG.title}
      width="md"
      secondaryButtonLabel={BRACKET_ALGORITHM_DIALOG.cancel}
      onSecondaryButton={() => !busy && onCancel()}
      mainButtonLabel={
        busy ? "…" : BRACKET_ALGORITHM_DIALOG.submit
      }
      onMainButton={() => {
        if (canSubmit) onConfirm();
      }}
    >
      <div data-testid="bracket-algorithm-dialog">
      <p className="bracket-algo-dialog__subtitle">
        {BRACKET_ALGORITHM_DIALOG.subtitle}
      </p>
      {showRegenWarning ? (
        <p className="bracket-algo-dialog__warning" role="status">
          {BRACKET_ALGORITHM_DIALOG.regenWarning}
        </p>
      ) : null}
      <div
        className="bracket-algo-dialog__options"
        role="radiogroup"
        aria-labelledby={groupId}
        data-testid="bracket-algorithm-options"
      >
        <span id={groupId} className="visually-hidden">
          Способ построения сетки
        </span>
        {(
          ["compact", "power_of_two"] as BracketConstructionAlgorithm[]
        ).map((key) => {
          const opt = BRACKET_ALGORITHM_OPTIONS[key];
          const disabled = key === "compact" && compactDisabled;
          const checked = selected === key;
          return (
            <label
              key={key}
              className={[
                "bracket-algo-card",
                checked ? "bracket-algo-card--selected" : "",
                disabled ? "bracket-algo-card--disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-testid={`bracket-algo-card-${key}`}
            >
              <input
                type="radio"
                name={`bracket-algo-${groupId}`}
                value={key}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  if (!disabled) onSelect(key);
                }}
              />
              <span className="bracket-algo-card__title">{opt.title}</span>
              <span className="bracket-algo-card__desc">{opt.description}</span>
              <span className="bracket-algo-card__hint">{opt.shortHint}</span>
              {disabled ? (
                <span className="bracket-algo-card__disabled-reason">
                  {COMPACT_DE_DISABLED_REASON}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      </div>
    </Dialog>
  );
}
