import { useState, type ComponentProps, type ReactNode } from "react";
import { Button, TextField } from "./ui";
import { copyText } from "./copyText";

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-layout" data-testid="auth-layout">
      <div className="auth-layout__card">
        <p className="auth-layout__brand" aria-label="Tab-10">
          Tab-10
        </p>
        <h1 className="auth-layout__title">{title}</h1>
        {subtitle ? <p className="auth-layout__subtitle">{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function AuthPasswordField({
  id,
  label,
  toggleLabel = label.toLowerCase(),
  ...props
}: Omit<ComponentProps<typeof TextField>, "type" | "endIcon"> & {
  id: string;
  label: string;
  toggleLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-password-field">
      <TextField id={id} label={label} type={visible ? "text" : "password"} fullWidth {...props} />
      <button
        className="auth-password-field__toggle"
        type="button"
        aria-label={`${visible ? "Скрыть" : "Показать"} ${toggleLabel}`}
        aria-controls={id}
        aria-pressed={visible}
        disabled={props.disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setVisible((value) => !value)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.5" />
          {visible ? <path d="M3 21 21 3" /> : null}
        </svg>
      </button>
    </div>
  );
}

export function TempPasswordPanel({
  password,
  onDismiss,
}: {
  password: string;
  onDismiss?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const ok = await copyText(password);
    if (ok) setCopied(true);
  }

  return (
    <div className="temp-password" data-testid="temp-password-panel">
      <p className="temp-password__label">
        Временный пароль (показывается один раз)
      </p>
      <code className="temp-password__value" data-testid="temp-password-value">
        {password}
      </code>
      <div className="row">
        <Button type="button" onClick={() => void onCopy()}>
          {copied ? "Скопировано" : "Скопировать"}
        </Button>
        {onDismiss ? (
          <Button type="button" variant="secondary" onClick={onDismiss}>
            Закрыть
          </Button>
        ) : null}
      </div>
    </div>
  );
}
