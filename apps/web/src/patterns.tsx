import { Link } from "react-router-dom";
import {
  Alert,
  ButtonGroup,
  Chip,
  EmptyState,
  Skeleton,
  type ButtonGroupOption,
} from "./ui";
import {
  formatLabel,
  statusLabel,
  statusTone,
  type StatusTone,
} from "./statusLabels";

export { formatLabel, statusLabel, statusTone };
export type { StatusTone };

const CHIP_COLOR: Record<
  StatusTone,
  "primary" | "neutral" | "success" | "error"
> = {
  neutral: "neutral",
  info: "primary",
  success: "success",
  warning: "neutral",
  error: "error",
};

export function StatusChip({
  status,
  domain = "match",
}: {
  status: string;
  domain?: "match" | "tournament" | "user";
}) {
  const tone = statusTone(status, domain);
  return (
    <Chip
      size="sm"
      variant="tonal"
      color={CHIP_COLOR[tone]}
      label={statusLabel(status, domain)}
    />
  );
}

export function ListRow({
  to,
  title,
  subtitle,
  leading,
  trailing,
  onClick,
}: {
  to?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      {leading ? <div className="list-row__leading">{leading}</div> : null}
      <div className="list-row__body">
        <strong className="list-row__title">{title}</strong>
        {subtitle ? <span className="muted">{subtitle}</span> : null}
      </div>
      {trailing ? <div className="list-row__trailing">{trailing}</div> : null}
      {to ? (
        <span className="list-row__chevron" aria-hidden>
          ›
        </span>
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="list-row">
        {body}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" className="list-row list-row--button" onClick={onClick}>
        {body}
      </button>
    );
  }

  return <div className="list-row list-row--static">{body}</div>;
}

export function AsyncState({
  loading,
  error,
  empty,
  emptyTitle = "Пока пусто",
  emptyDescription,
  emptyAction,
  skeletonCount = 2,
  children,
}: {
  loading: boolean;
  error?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  skeletonCount?: number;
  children: React.ReactNode;
}) {
  if (error) {
    return (
      <Alert type="error" variant="tonal" title="Ошибка" description={error} />
    );
  }
  if (loading) {
    return (
      <div className="stack">
        {Array.from({ length: skeletonCount }, (_, i) => (
          <Skeleton key={i} variant="rectangular" height={72} />
        ))}
      </div>
    );
  }
  if (empty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }
  return <>{children}</>;
}

export function FilterBar({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ButtonGroupOption[];
}) {
  return (
    <div className="filter-bar">
      <ButtonGroup
        aria-label={label}
        value={value}
        onChange={onChange}
        options={options}
      />
    </div>
  );
}
