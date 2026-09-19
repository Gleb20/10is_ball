import { useId, useLayoutEffect, useRef } from "react";
import type { BracketConstructionAlgorithm } from "@tab10/shared";
import { Alert, Button, Dialog } from "../ui";
import {
  BRACKET_ALGORITHM_DIALOG,
  BRACKET_ALGORITHM_OPTIONS,
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
  error?: string | null;
  errorTitle?: string;
  errorRevision?: number;
  retryBlocked?: boolean;
  onCheckState?: () => void;
  showRegenWarning?: boolean;
};

export function BracketAlgorithmDialog({
  open,
  format: _format,
  selected,
  onSelect,
  onCancel,
  onConfirm,
  busy = false,
  error = null,
  errorTitle = "Состояние построения сетки",
  errorRevision = 0,
  retryBlocked = false,
  onCheckState,
  showRegenWarning = false,
}: BracketAlgorithmDialogProps) {
  const groupId = useId();
  const errorFocusRef = useRef<HTMLDivElement>(null);
  void _format;
  const canSubmit = !busy && !retryBlocked;

  useLayoutEffect(() => {
    if (open && error && errorRevision > 0) errorFocusRef.current?.focus();
  }, [open, error, errorRevision]);

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onCancel()}
      title={BRACKET_ALGORITHM_DIALOG.title}
      width="md"
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
          const checked = selected === key;
          return (
            <label
              key={key}
              className={[
                "bracket-algo-card",
                checked ? "bracket-algo-card--selected" : "",
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
                disabled={busy || retryBlocked}
                onChange={() => onSelect(key)}
              />
              <span className="bracket-algo-card__title">{opt.title}</span>
              <span className="bracket-algo-card__desc">{opt.description}</span>
              <span className="bracket-algo-card__hint">{opt.shortHint}</span>
            </label>
          );
        })}
      </div>
      {error ? (
        <div ref={errorFocusRef} tabIndex={-1} className="bracket-algo-dialog__error">
          <Alert type="error" variant="tonal" title={errorTitle} description={error} />
          {onCheckState ? <Button variant="secondary" disabled={busy} onClick={onCheckState}>Проверить состояние</Button> : null}
        </div>
      ) : null}
      <div className="row bracket-algo-dialog__actions">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>{BRACKET_ALGORITHM_DIALOG.cancel}</Button>
        <Button disabled={!canSubmit} onClick={() => { if (canSubmit) onConfirm(); }}>{busy ? "…" : BRACKET_ALGORITHM_DIALOG.submit}</Button>
      </div>
      </div>
    </Dialog>
  );
}
