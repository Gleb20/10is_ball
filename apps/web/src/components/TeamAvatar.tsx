import { useId, useState, type SyntheticEvent } from "react";
import { AVATAR_PRESET_COUNT, type AvatarKey } from "@tab10/shared";
import { Avatar } from "../ui";
import { avatarSrc } from "../avatarSrc";
import { initialsFromName } from "../rankingUi";

const TEAM_AVATAR_KEYS = Array.from(
  { length: AVATAR_PRESET_COUNT },
  (_, index) => `avatar_${index + 1}` as AvatarKey,
);

type TeamAvatarProps = {
  avatarKey?: AvatarKey | string | null;
  teamName: string;
  size?: "sm" | "md";
  alt?: string;
  className?: string;
  decorative?: boolean;
};

export function TeamAvatar({
  avatarKey,
  teamName,
  size = "sm",
  alt,
  className,
  decorative = false,
}: TeamAvatarProps) {
  const validAvatarKey = typeof avatarKey === "string" &&
    TEAM_AVATAR_KEYS.includes(avatarKey as AvatarKey)
    ? avatarKey
    : null;
  const src = avatarSrc(validAvatarKey);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const visibleSrc = src === failedSrc ? undefined : src;

  function handleImageError(event: SyntheticEvent<HTMLElement>) {
    if (src && event.target instanceof HTMLImageElement) {
      setFailedSrc(src);
    }
  }

  return (
    <Avatar
      className={className}
      size={size}
      variant="tonal"
      src={visibleSrc}
      initials={initialsFromName(teamName)}
      alt={decorative ? "" : (alt ?? `Аватар команды «${teamName}»`)}
      aria-hidden={decorative || undefined}
      onError={handleImageError}
    />
  );
}

type TeamAvatarPickerProps = {
  value: AvatarKey | null;
  onChange: (value: AvatarKey | null) => void;
  name?: string;
  disabled?: boolean;
};

export function TeamAvatarPicker({
  value,
  onChange,
  name,
  disabled = false,
}: TeamAvatarPickerProps) {
  const generatedName = useId();
  const groupName = name ?? `team-avatar-${generatedName}`;

  return (
    <fieldset className="team-avatar-picker" disabled={disabled}>
      <legend className="team-avatar-picker__legend">
        Аватар команды <span>(необязательно)</span>
      </legend>
      <div className="team-avatar-picker__options">
        <label className="team-avatar-picker__option">
          <input
            className="visually-hidden"
            type="radio"
            name={groupName}
            value=""
            checked={value === null}
            onChange={() => onChange(null)}
          />
          <TeamAvatar avatarKey={null} teamName="Без аватара" decorative />
          <span className="visually-hidden">Без аватара</span>
          {value === null ? <span className="team-avatar-picker__check" aria-hidden="true">✓</span> : null}
        </label>
        {TEAM_AVATAR_KEYS.map((avatarKey, index) => {
          const label = `Аватар ${index + 1}`;
          const selected = value === avatarKey;
          return (
            <label className="team-avatar-picker__option" key={avatarKey}>
              <input
                className="visually-hidden"
                type="radio"
                name={groupName}
                value={avatarKey}
                checked={selected}
                onChange={() => onChange(avatarKey)}
              />
              <TeamAvatar avatarKey={avatarKey} teamName={label} decorative />
              <span className="visually-hidden">{label}</span>
              {selected ? <span className="team-avatar-picker__check" aria-hidden="true">✓</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
