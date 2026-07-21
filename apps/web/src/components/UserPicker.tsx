import { useEffect, useMemo, useState } from "react";
import { Autocomplete } from "../ui";
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
  const [loadError, setLoadError] = useState<string | null>(null);
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
    const exclude = new Set(excludeUserIds);
    if (excludeSelf && user?.id) exclude.add(user.id);
    void api
      .directory()
      .then((res) =>
        setOptions(
          res.users
            .filter((u) => !exclude.has(u.id))
            .map((u) => ({ value: u.id, label: u.displayName })),
        ),
      )
      .catch(() => setLoadError("Не удалось загрузить список игроков"));
  }, [excludeKey, excludeUserIds, excludeSelf, user?.id]);

  // When parent clears value, also clear visible text if uncontrolled
  useEffect(() => {
    if (!value && !controlled) setInnerInput("");
  }, [value, controlled]);

  return (
    <div className="stack">
      <Autocomplete
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
        disabled={disabled}
      />
      {loadError ? <p className="muted">{loadError}</p> : null}
    </div>
  );
}
