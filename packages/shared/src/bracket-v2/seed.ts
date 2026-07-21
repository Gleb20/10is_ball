/** Challonge-style R0 seed order (1-based), grow by complements. */
export function bracketSeedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed);
      next.push(sum - seed);
    }
    order = next;
  }
  return order;
}

export function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** 0-based seed index → R0 slot position. */
export function standardPlacement(size: number): number[] {
  const order = bracketSeedOrder(size);
  const placement = Array<number>(size);
  for (let pos = 0; pos < size; pos += 1) {
    placement[order[pos]! - 1] = pos;
  }
  return placement;
}

export function seedAtPosition(
  seedOrder: string[],
  bracketSize: number,
  position: number,
): { type: "seed"; seed: number } | { type: "empty" } {
  const placement = standardPlacement(bracketSize);
  // position → which seed index (0-based) sits there
  let seedIndex: number | null = null;
  for (let s = 0; s < bracketSize; s += 1) {
    if (placement[s] === position) {
      seedIndex = s;
      break;
    }
  }
  if (seedIndex == null || seedIndex >= seedOrder.length) {
    return { type: "empty" };
  }
  return { type: "seed", seed: seedIndex + 1 };
}
