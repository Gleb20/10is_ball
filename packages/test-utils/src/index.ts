export type Clock = {
  now(): Date;
};

export type Rng = {
  /** Returns float in [0, 1). */
  next(): number;
  /** Inclusive integer range. */
  int(min: number, max: number): number;
};

export type IdGenerator = {
  next(): string;
};

export class FakeClock implements Clock {
  private current: Date;

  constructor(initial: Date = new Date("2026-01-01T12:00:00.000Z")) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}

export class SeededRng implements Rng {
  private state: number;

  constructor(seed = 1) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return (this.state >>> 0) / 0x100000000;
  }

  int(min: number, max: number): number {
    if (max < min) throw new Error("max < min");
    const span = max - min + 1;
    return min + Math.floor(this.next() * span);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix = "id") {}

  next(): string {
    this.n += 1;
    return `${this.prefix}_${String(this.n).padStart(8, "0")}`;
  }
}

export class UlidGenerator implements IdGenerator {
  private counter = 0;
  constructor(
    private readonly clock: Clock = { now: () => new Date() },
    private readonly rng: Rng = new SeededRng(42),
  ) {}

  next(): string {
    const t = this.clock.now().getTime().toString(36);
    const r = Math.floor(this.rng.next() * 1e9).toString(36);
    this.counter += 1;
    return `ulid_${t}_${r}_${this.counter}`;
  }
}
