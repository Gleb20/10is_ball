import { useEffect, useId, useMemo, useState } from "react";
import { Autocomplete, Button } from "../ui";
import { api } from "../api";
import { useAuth } from "../auth";

const EMPTY_IDS: string[] = [];

type UserPickerProps = {
  label: string;
  value: string;
  onChange: (userId: string) => void;
  /** Cleared together with value after successful add/invite. */
  inputValue?: string;
  onInputChange?: (text: string) => void;
  /** User IDs already in roster (or otherwise unavailable). */
  excludeUserIds?: string[];
  /** Also exclude the current user (default true). */
  excludeSelf?: boolean;
  placeholder?: string;
  disabled?: boolean;
};

/** Directory Autocomplete by display name — same pattern as MatchCreate. */
export function UserPicker({
  label,
  value,
  onChange,
  inputValue: inputValueProp,
  onInputChange,
  excludeUserIds = EMPTY_IDS,
  excludeSelf = true,
  placeholder = "Начните вводить имя",
  disabled,
}: UserPickerProps) {
  const { user } = useAuth();
  const [options, setOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [directoryState, setDirectoryState] = useState<"loading" | "ready" | "error">("loading");
  const [requestVersion, setRequestVersion] = useState(0);
  const [focusAfterRetry, setFocusAfterRetry] = useState(false);
  const fieldId = useId();
  const retryId = useId();
  const [innerInput, setInnerInput] = useState("");
  const controlled = inputValueProp !== undefined;
  const inputValue = controlled ? inputValueProp : innerInput;

  const excludeKey = useMemo(
    () =>
      [...excludeUserIds, excludeSelf ? user?.id : null]
        .filter(Boolean)
        .sort()
        .join(","),
    [excludeUserIds, excludeSelf, user?.id],
  );

  useEffect(() => {
    let current = true;
    const exclude = new Set(excludeKey.split(",").filter(Boolean));
    setDirectoryState("loading");
    void api
      .directory()
      .then((res) => {
        if (!current) return;
        setOptions(
          res.users
            .filter((u) => !exclude.has(u.id))
            .map((u) => ({ value: u.id, label: u.displayName })),
        );
        setDirectoryState("ready");
      })
      .catch(() => {
        if (current) setDirectoryState("error");
      });
    return () => { current = false; };
  }, [excludeKey, requestVersion, user?.id]);

  useEffect(() => {
    if (!focusAfterRetry || (directoryState !== "ready" && directoryState !== "error")) return;
    if (document.activeElement === document.body) document.getElementById(directoryState === "ready" ? fieldId : retryId)?.focus();
    setFocusAfterRetry(false);
  }, [directoryState, fieldId, focusAfterRetry, retryId]);

  // When parent clears value, also clear visible text if uncontrolled
  useEffect(() => {
    if (!value && !controlled) setInnerInput("");
  }, [value, controlled]);

  return (
    <div className="stack" aria-busy={directoryState === "loading"}>
      <Autocomplete
        id={fieldId}
        label={label}
        placeholder={placeholder}
        options={options}
        value={value}
        onChange={onChange}
        inputValue={inputValue}
        onInputChange={(text) => {
          if (controlled) onInputChange?.(text);
          else setInnerInput(text);
        }}
        clearable
        fullWidth
        disabled={disabled || directoryState !== "ready"}
        error={directoryState === "error"}
        helperText={directoryState === "error" ? "Не удалось загрузить игроков" : undefined}
      />
      {directoryState === "loading" ? <p className="muted" role="status" aria-live="polite">Загружаем игроков…</p> : null}
      {directoryState === "ready" && options.length === 0 ? <p className="muted" role="status" aria-live="polite">Нет доступных игроков</p> : null}
      {directoryState === "error" ? (
        <div className="stack">
          <Button id={retryId} variant="secondary" type="button" onClick={() => { setFocusAfterRetry(true); setDirectoryState("loading"); setRequestVersion((version) => version + 1); }}>Повторить загрузку</Button>
        </div>
      ) : null}
    </div>
  );
}
