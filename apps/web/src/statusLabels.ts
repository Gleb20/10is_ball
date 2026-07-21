/** Localized status labels for match / tournament / user enums. */

const MATCH_STATUS: Record<string, string> = {
  waiting: "Ожидание",
  in_progress: "Идёт",
  pending_confirmation: "Подтверждение",
  finished: "Завершён",
  stopped: "Остановлен",
  cancelled: "Отменён",
};

const TOURNAMENT_STATUS: Record<string, string> = {
  collecting: "Сбор",
  bracket_generated: "Сетка готова",
  bracket_ready: "Сетка готова",
  in_progress: "Идёт",
  finished: "Завершён",
  stopped: "Остановлен",
  dissolved: "Распущен",
  needs_regeneration: "Нужна перегенерация",
};

const USER_STATUS: Record<string, string> = {
  active: "Активен",
  blocked: "Заблокирован",
};

const FORMAT_LABEL: Record<string, string> = {
  "1v1": "1×1",
  "2v2": "2×2",
  single_elimination: "Single elim.",
  double_elimination: "Double elim.",
};

export function statusLabel(
  status: string,
  domain: "match" | "tournament" | "user" = "match",
): string {
  const map =
    domain === "tournament"
      ? TOURNAMENT_STATUS
      : domain === "user"
        ? USER_STATUS
        : MATCH_STATUS;
  return map[status] ?? status;
}

export function formatLabel(format: string): string {
  return FORMAT_LABEL[format] ?? format;
}

export type StatusTone = "neutral" | "info" | "success" | "warning" | "error";

export function statusTone(
  status: string,
  domain: "match" | "tournament" | "user" = "match",
): StatusTone {
  if (status === "blocked" || status === "cancelled" || status === "stopped") {
    return "error";
  }
  if (
    status === "finished" ||
    status === "active" ||
    status === "bracket_ready" ||
    status === "bracket_generated"
  ) {
    return "success";
  }
  if (
    status === "in_progress" ||
    status === "pending_confirmation" ||
    status === "needs_regeneration"
  ) {
    return "warning";
  }
  if (status === "waiting" || status === "collecting") {
    return domain === "user" ? "success" : "info";
  }
  return "neutral";
}
