/** Split rankings into podium (top 3) and the rest for list UI. */
export function splitPodium<T>(items: T[]): { podium: T[]; rest: T[] } {
  return {
    podium: items.slice(0, 3),
    rest: items.slice(3),
  };
}

export function initialsFromName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}
