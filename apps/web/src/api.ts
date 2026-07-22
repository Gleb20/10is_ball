export type User = {
  id: string;
  email: string;
  role: "admin" | "user";
  mustChangePassword: boolean;
  firstName?: string;
  lastName?: string;
  avatarKey?: string | null;
};

/** Production: set VITE_API_BASE_URL to API origin (no trailing slash). Dev: empty + Vite proxy. */
const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && typeof document !== "undefined") {
    const csrf = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("tab10_csrf="))
      ?.slice("tab10_csrf=".length);
    if (csrf) headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message ?? res.statusText), {
      code: data.code,
      status: res.status,
      details: data.details,
    });
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () =>
    request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/api/v1/auth/me"),
  firstPasswordChange: (newPassword: string) =>
    request<{ ok: boolean }>("/api/v1/auth/password/first-change", {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),
  home: () => request<Record<string, unknown>>("/api/v1/home"),
  directory: (q?: string) =>
    request<{
      users: Array<{
        id: string;
        firstName: string;
        lastName: string;
        displayName: string;
        avatarKey?: string | null;
      }>;
    }>(`/api/v1/users/directory${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  listUsers: (q?: string) =>
    request<{ users: User[] }>(
      `/api/v1/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  createUser: (payload: {
    email: string;
    firstName: string;
    lastName: string;
    role?: "admin" | "user";
  }) =>
    request<{ user: User; temporaryPassword: string }>("/api/v1/admin/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateUserRole: (userId: string, role: "admin" | "user") =>
    request<{ user: User }>(`/api/v1/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  blockUser: (userId: string) =>
    request<{ ok: boolean }>(`/api/v1/admin/users/${userId}/block`, {
      method: "POST",
    }),
  resetPassword: (userId: string) =>
    request<{ temporaryPassword: string }>(
      `/api/v1/admin/users/${userId}/reset-password`,
      { method: "POST" },
    ),
  adminForceCloseMatch: (matchId: string, reasonText?: string) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/admin/matches/${matchId}/force-close`,
      {
        method: "POST",
        body: JSON.stringify(reasonText ? { reasonText } : {}),
      },
    ),
  adminDeleteMatch: (matchId: string) =>
    request<{ ok: boolean }>(`/api/v1/admin/matches/${matchId}`, {
      method: "DELETE",
    }),
  listMatches: () =>
    request<{ matches: Array<Record<string, unknown>> }>("/api/v1/matches"),
  createMatch: (payload: unknown) =>
    request<{ match: Record<string, unknown> }>("/api/v1/matches", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getMatch: (id: string) =>
    request<{ match: Record<string, unknown> }>(`/api/v1/matches/${id}`),
  startMatch: (id: string, body?: { firstServerParticipantId?: string }) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/matches/${id}/start`,
      { method: "POST", body: JSON.stringify(body ?? {}) },
    ),
  judgeSetup: (
    id: string,
    body: {
      firstServerParticipantId?: string;
      swapSides?: boolean;
      displayFlipped?: boolean;
    },
  ) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/matches/${id}/judge/setup`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  acquireJudge: (id: string) =>
    request(`/api/v1/matches/${id}/judge/acquire`, { method: "POST" }),
  heartbeatJudge: (id: string) =>
    request(`/api/v1/matches/${id}/judge/heartbeat`, { method: "POST" }),
  releaseJudge: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/matches/${id}/judge/release`, {
      method: "POST",
    }),
  awardPoint: (
    id: string,
    side: "A" | "B",
    expectedVersion: number,
    idempotencyKey: string,
  ) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/matches/${id}/points`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ side, expectedVersion }),
      },
    ),
  undoPoint: (id: string, expectedVersion: number, key: string) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/matches/${id}/undo`,
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ expectedVersion }),
      },
    ),
  confirmFinish: (id: string) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/matches/${id}/confirm-finish`,
      { method: "POST" },
    ),
  revertFinish: (id: string) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/matches/${id}/revert-finish`,
      { method: "POST" },
    ),
  stopMatch: (
    id: string,
    payload: { winnerSide: "A" | "B"; reasonCode: string; reasonText?: string },
  ) =>
    request<{ match: Record<string, unknown> }>(`/api/v1/matches/${id}/stop`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  rankings: (period = "all_time") =>
    request<{ rankings: Array<Record<string, unknown>> }>(
      `/api/v1/rankings?period=${period}`,
    ),
  listTournaments: () =>
    request<{ tournaments: Array<Record<string, unknown>> }>(
      "/api/v1/tournaments",
    ),
  createTournament: (payload: unknown) =>
    request<{ tournament: Record<string, unknown> }>("/api/v1/tournaments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getTournament: (id: string) =>
    request<{ tournament: Record<string, unknown> }>(
      `/api/v1/tournaments/${id}`,
    ),
  addTournamentParticipant: (id: string, payload: unknown) =>
    request(`/api/v1/tournaments/${id}/participants`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateBracket: (
    id: string,
    payload?: { constructionAlgorithm?: "compact" | "power_of_two" },
  ) =>
    request(`/api/v1/tournaments/${id}/bracket`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),
  patchTournament: (id: string, payload: unknown) =>
    request<{ tournament: Record<string, unknown> }>(
      `/api/v1/tournaments/${id}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  removeTournamentParticipant: (id: string, participantId: string) =>
    request(`/api/v1/tournaments/${id}/participants/${participantId}`, {
      method: "DELETE",
    }),
  inviteTournament: (id: string, userId: string) =>
    request(`/api/v1/tournaments/${id}/invitations`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  cancelTournamentInvitation: (id: string, invitationId: string) =>
    request(`/api/v1/tournaments/${id}/invitations/${invitationId}`, {
      method: "DELETE",
    }),
  respondTournamentInvitation: (invitationId: string, accept: boolean) =>
    request(`/api/v1/tournament-invitations/${invitationId}/respond`, {
      method: "POST",
      body: JSON.stringify({ accept }),
    }),
  dissolveBracket: (id: string) =>
    request(`/api/v1/tournaments/${id}/dissolve-bracket`, { method: "POST" }),
  withdrawTournament: (id: string) =>
    request(`/api/v1/tournaments/${id}/withdraw`, { method: "POST" }),
  patchTournamentBracket: (
    id: string,
    swaps: Array<{ slotIdA: string; slotIdB: string }>,
  ) =>
    request(`/api/v1/tournaments/${id}/bracket`, {
      method: "PATCH",
      body: JSON.stringify({ swaps }),
    }),
  startTournament: (id: string) =>
    request<{ tournament: Record<string, unknown> }>(
      `/api/v1/tournaments/${id}/start`,
      { method: "POST" },
    ),
  stopTournament: (id: string, payload?: { code?: string; text?: string }) =>
    request<{ tournament: Record<string, unknown> }>(
      `/api/v1/tournaments/${id}/stop`,
      { method: "POST", body: JSON.stringify(payload ?? {}) },
    ),
  cancelTournament: (id: string) =>
    request<{ tournament: Record<string, unknown> }>(
      `/api/v1/tournaments/${id}/cancel`,
      { method: "POST" },
    ),
  listTeams: () =>
    request<{ teams: Array<Record<string, unknown>> }>("/api/v1/teams"),
  createTeam: (payload: unknown) =>
    request<{ team: Record<string, unknown> }>("/api/v1/teams", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  notifications: () =>
    request<{ notifications: Array<Record<string, unknown>> }>(
      "/api/v1/notifications",
    ),
  markNotificationRead: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/notifications/${id}/read`, {
      method: "POST",
    }),
  respondTeamInvitation: (invitationId: string, accept: boolean) =>
    request<{ ok?: boolean; team?: Record<string, unknown> }>(
      `/api/v1/team-invitations/${invitationId}/respond`,
      {
        method: "POST",
        body: JSON.stringify({ accept }),
      },
    ),
  faq: () =>
    request<{ articles: Array<Record<string, unknown>> }>("/api/v1/faq"),
  feedback: (kind: string, message: string) =>
    request("/api/v1/feedback", {
      method: "POST",
      body: JSON.stringify({ kind, message }),
    }),
  tutorial: () =>
    request<{ match: Record<string, unknown> }>("/api/v1/matches/tutorial", {
      method: "POST",
    }),
  completeOnboarding: () =>
    request("/api/v1/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ onboardingCompleted: true }),
    }),
  sessions: () =>
    request<{
      sessions: Array<{
        id: string;
        userAgent: string | null;
        current: boolean;
      }>;
    }>("/api/v1/auth/sessions"),
};
