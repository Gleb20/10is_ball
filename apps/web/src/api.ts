import { AUTH_UNAUTHORIZED_EVENT } from "./authEvents";

export type User = {
  id: string;
  email: string;
  role: "admin" | "user";
  mustChangePassword: boolean;
  firstName?: string;
  lastName?: string;
  avatarKey?: string | null;
  status?: "active" | "blocked";
  onboardingStep?: number;
  onboardingCompletedAt?: string | null;
};

export type ProfileIdentity = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarKey: string | null;
  organizationText: string | null;
  positionText: string | null;
  email?: string;
  birthDate?: string | null;
};

export type PlayerProfile = {
  isOwn: boolean;
  canChallenge: boolean;
  identity: ProfileIdentity;
  avatar: { key: string | null; editable: false };
  stats: {
    matchesPlayed: number;
    wins: number;
    losses: number;
    winRate: number;
    averagePoints: number;
    tournamentsPlayed: number;
    tournamentWins: number;
    tournamentsCreated: number;
    judgedMatches: number;
    rank: number | null;
  };
  facts: {
    longestMatch: {
      matchId: string;
      title: string;
      durationSeconds: number;
    } | null;
    bestWinningScore: { matchId: string; title: string; score: string } | null;
    frequentOpponent: {
      userId: string;
      displayName: string;
      matchCount: number;
    } | null;
    rival: { userId: string; displayName: string; matchCount: number } | null;
  };
  teams: Array<{ id: string; name: string; role: "captain" | "member" }>;
};

export type AuthSession = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};
export type HistoryItem = {
  type: "match" | "tournament";
  id: string;
  title: string;
  status: string;
  occurredAt: string;
  roles: Array<"player" | "judge" | "organizer" | "viewer">;
  result: "win" | "loss" | null;
  matchKind: string | null;
  scoreA: number | null;
  scoreB: number | null;
  format: string | null;
};
export type HistoryFilters = {
  role?: "player" | "judge";
  result?: "win" | "loss";
  eventType?: "match" | "tournament";
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
};
export type RankingScope = "all_time" | "calendar_week" | "calendar_month";
export type RankingRow = {
  userId: string;
  displayName: string;
  wins: number;
  losses: number;
  matchesPlayed: number;
  winRate: number;
  avatarKey: string | null;
};
export type RankingTeamOption = { id: string; name: string };
export type RankingResponse = {
  scope: "all_time" | "week" | "month";
  team: (RankingTeamOption & {
    activeMemberCount: number;
    winsAllTime: number;
  }) | null;
  availableTeams: RankingTeamOption[];
  rankings: RankingRow[];
};

export type DirectoryUser = {
  id: string;
  firstName: string;
  lastName: string;
  avatarKey?: string | null;
};

export type MatchCreateOptions = {
  users: DirectoryUser[];
  teams: Array<{ id: string; name: string; userIds: string[] }>;
  recentOpponentIds: string[];
  frequentOpponentIds: string[];
};

export type HomeRanking = {
  userId: string;
  displayName: string;
  wins: number;
  avatarKey?: string | null;
};

export type HomeMatchEvent = {
  type: "match";
  id: string;
  title: string;
  status: string;
  scoreA: number;
  scoreB: number;
  sideA?: string;
  sideB?: string;
  winnerName?: string | null;
  durationSeconds?: number | null;
  format?: string;
  judgeName?: string | null;
  userRole?: "participant" | "judge" | "organizer" | "viewer";
  occurredAt?: string;
};

export type HomeTournamentEvent = {
  type: "tournament";
  id: string;
  title: string;
  status: string;
  topThree?: string[];
  durationSeconds?: number | null;
  userRole?: "participant" | "judge" | "organizer" | "viewer";
  occurredAt?: string;
};

export type HomeResponse = {
  rankingPeriod: "all_time" | "month";
  myStats: {
    rank: number | null;
    matchesPlayed: number;
    wins: number;
    losses: number;
    winRate: number;
    averagePoints: number;
    displayName: string;
    avatarKey?: string | null;
    rival: {
      userId: string;
      displayName: string;
      matchCount: number;
    } | null;
  };
  activeEvents: {
    match: HomeMatchEvent | null;
    tournament: HomeTournamentEvent | null;
  };
  recentEvents: Array<HomeMatchEvent | HomeTournamentEvent>;
  topRankings: HomeRanking[];
  unreadNotifications: Array<Record<string, unknown>>;
  unreadCount: number;
};

/** Every delivery environment uses relative API paths through its same-origin proxy. */
const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

type ApiError = Error & {
  code?: string;
  status: number;
  details?: unknown;
};

let blockedByUnauthorized: ApiError | null = null;
let authGeneration = 0;

function isAuthRecoveryRequest(path: string): boolean {
  return path === "/api/v1/auth/login" || path === "/api/v1/auth/me";
}

function notifyUnauthorized(error: ApiError) {
  if (blockedByUnauthorized) return;
  blockedByUnauthorized = error;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AUTH_UNAUTHORIZED_EVENT, { detail: { error } }),
    );
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (blockedByUnauthorized && !isAuthRecoveryRequest(path)) {
    throw blockedByUnauthorized;
  }
  const requestAuthGeneration = authGeneration;
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
    const error = Object.assign(new Error(data.message ?? res.statusText), {
      code: data.code,
      status: res.status,
      details: data.details,
    }) as ApiError;
    if (
      res.status === 401 &&
      path !== "/api/v1/auth/login" &&
      requestAuthGeneration === authGeneration
    ) {
      notifyUnauthorized(error);
    }
    throw error;
  }
  if (isAuthRecoveryRequest(path)) {
    authGeneration += 1;
    blockedByUnauthorized = null;
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
  me: (options: { signal?: AbortSignal } = {}) =>
    request<{ user: User }>("/api/v1/auth/me", { signal: options.signal }),
  firstPasswordChange: (newPassword: string) =>
    request<{ ok: boolean }>("/api/v1/auth/password/first-change", {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),
  home: (period: "all_time" | "month" = "all_time") =>
    request<HomeResponse>(`/api/v1/home?period=${period}`),
  history: ({ signal, ...filters }: HistoryFilters = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return request<{ items: HistoryItem[]; nextCursor: string | null }>(
      `/api/v1/history${suffix}`,
      { signal },
    );
  },
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
  matchCreateOptions: () =>
    request<MatchCreateOptions>("/api/v1/matches/create-options"),
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
  unblockUser: (userId: string) =>
    request<{ ok: boolean }>(`/api/v1/admin/users/${userId}/unblock`, {
      method: "POST",
    }),
  resetPassword: (userId: string) =>
    request<{ temporaryPassword: string }>(
      `/api/v1/admin/users/${userId}/reset-password`,
      { method: "POST" },
    ),
  adminForceCloseMatch: (
    matchId: string,
    expectedVersion: number,
    idempotencyKey: string,
    reasonText?: string,
  ) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/admin/matches/${matchId}/force-close`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ expectedVersion, reasonText }),
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
  handoverJudge: (id: string, toUserId: string) =>
    request<{ reservation: Record<string, unknown> }>(
      `/api/v1/matches/${id}/judge/handover`,
      { method: "POST", body: JSON.stringify({ toUserId }) },
    ),
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
  manualCorrection: (
    id: string,
    payload: {
      expectedVersion: number;
      scoreA: number;
      scoreB: number;
      currentServerParticipantId: string;
    },
    key: string,
  ) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/matches/${id}/manual-correction`,
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(payload),
      },
    ),
  noShowMatch: (
    id: string,
    payload: {
      expectedVersion: number;
      absentSide: "A" | "B";
      reasonText?: string;
    },
    key: string,
  ) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/matches/${id}/no-show`,
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(payload),
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
  cancelMatch: (
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
    reasonText?: string,
  ) =>
    request<{ match: Record<string, unknown> }>(
      `/api/v1/matches/${id}/cancel`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ expectedVersion, reasonText }),
      },
    ),
  voidMatch: (
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
    reasonText?: string,
  ) =>
    request<{ match: Record<string, unknown> }>(`/api/v1/matches/${id}/void`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ expectedVersion, reasonText }),
    }),
  rankings: (scope: RankingScope = "all_time", teamId?: string) => {
    const query = new URLSearchParams({ scope });
    if (teamId) query.set("teamId", teamId);
    return request<RankingResponse>(`/api/v1/rankings?${query.toString()}`);
  },
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
  markNotificationsReadVisible: (notificationIds: string[]) =>
    request<{
      updated: number;
      notifications: Array<{ id: string; readAt: string }>;
    }>("/api/v1/notifications/read-visible", {
      method: "POST",
      body: JSON.stringify({ notificationIds }),
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
    request<{ user: User }>("/api/v1/me/onboarding", {
      method: "PATCH",
      body: JSON.stringify({ action: "complete" }),
    }),
  setOnboardingStep: (step: number) =>
    request<{ user: User }>("/api/v1/me/onboarding", {
      method: "PATCH",
      body: JSON.stringify({ action: "set-step", step }),
    }),
  restartOnboarding: () =>
    request<{ user: User }>("/api/v1/me/onboarding", {
      method: "PATCH",
      body: JSON.stringify({ action: "restart" }),
    }),
  ownProfile: () => request<{ profile: PlayerProfile }>("/api/v1/profile/me"),
  playerProfile: (userId: string) =>
    request<{ profile: PlayerProfile }>(
      `/api/v1/players/${encodeURIComponent(userId)}`,
    ),
  updateProfile: (payload: {
    firstName: string;
    lastName: string;
    birthDate: string | null;
    organizationText: string | null;
    positionText: string | null;
  }) =>
    request<{ user: User }>("/api/v1/profile/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  revokeSession: (sessionId: string) =>
    request<{ ok: boolean }>(
      `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    ),
  sessions: () =>
    request<{ sessions: AuthSession[] }>("/api/v1/auth/sessions"),
};
