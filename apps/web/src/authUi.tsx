import { useState, type ReactNode } from "react";
import { Button } from "./ui";
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
