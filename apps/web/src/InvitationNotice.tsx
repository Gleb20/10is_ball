import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { Button } from "./ui";
import { useVisibleRefresh } from "./useVisibleRefresh";

type Notice = { id: string; title: string; body?: string; expiresAt: string };
const invitationTypes = new Set(["team_invitation", "tournament_invitation", "match_invitation", "judge_invitation"]);

export function InvitationNotice({ userId, enabled }: { userId: string; enabled: boolean }) {
  const location = useLocation();
  if (!enabled || location.pathname === "/notifications" || /\/judge\/?$/.test(location.pathname) || new URLSearchParams(location.search).get("tutorial") === "1") return null;
  return <ActiveNotice key={userId} />;
}

function ActiveNotice() {
  const navigate = useNavigate();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const mutating = useRef(false);
  const dismissed = useRef(new Set<string>());
  useVisibleRefresh(async () => {
    if (mutating.current) return;
    const request = ++sequence.current;
    const response = await api.notifications();
    if (!mounted.current || request !== sequence.current) return;
    const fresh = response.notifications.find((row) =>
      typeof row.id === "string" && !dismissed.current.has(row.id) &&
      invitationTypes.has(String(row.type)) && row.actionable === true && !row.readAt &&
      typeof row.expiresAt === "string" && Date.parse(row.expiresAt) > Date.now(),
    );
    setNotice(fresh ? { id: String(fresh.id), title: String(fresh.title), body: typeof fresh.body === "string" ? fresh.body : undefined, expiresAt: String(fresh.expiresAt) } : null);
  });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), Math.max(0, Date.parse(notice.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function dismiss(open: boolean) {
    if (!notice || mutating.current) return;
    mutating.current = true;
    sequence.current += 1;
    setPending(true);
    setError(null);
    try {
      await api.markNotificationRead(notice.id);
      if (!mounted.current) return;
      dismissed.current.add(notice.id);
      setNotice(null);
      if (open) navigate("/notifications");
    } catch (cause) {
      if (!mounted.current) return;
      if ((cause as { status?: number }).status !== 401) setError(cause instanceof Error ? cause.message : "Не удалось сохранить прочтение");
    } finally {
      mutating.current = false;
      if (mounted.current) setPending(false);
    }
  }
  if (!notice) return null;
  return <aside className="card stack invitation-notice" aria-label="Новое приглашение">
    <div role="status" aria-live="polite"><strong>{notice.title}</strong>{notice.body ? <p>{notice.body}</p> : null}</div>
    {error ? <p role="alert">{error}</p> : null}
    <div className="actions"><Button disabled={pending} onClick={() => void dismiss(true)}>Открыть уведомления</Button><Button disabled={pending} onClick={() => void dismiss(false)} aria-label="Закрыть уведомление">Закрыть</Button></div>
  </aside>;
}
