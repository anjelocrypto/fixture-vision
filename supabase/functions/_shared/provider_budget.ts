export type ProviderStopReason =
  | "provider_call_budget_exhausted"
  | "provider_rate_limited";

export class ProviderControlError extends Error {
  readonly reason: ProviderStopReason;
  readonly status: number | null;

  constructor(reason: ProviderStopReason, status: number | null = null) {
    super(reason);
    this.name = "ProviderControlError";
    this.reason = reason;
    this.status = status;
  }
}

export class ProviderCallBudget {
  readonly limit: number;
  used = 0;
  failures = 0;
  stoppedReason: ProviderStopReason | null = null;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("provider call limit must be a positive integer");
    }
    this.limit = limit;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  reserve(): void {
    if (this.stoppedReason) throw new ProviderControlError(this.stoppedReason);
    if (this.used >= this.limit) {
      this.stoppedReason = "provider_call_budget_exhausted";
      throw new ProviderControlError(this.stoppedReason);
    }
    this.used += 1;
  }

  observeResponse(status: number): void {
    if (status >= 200 && status < 300) return;
    this.failures += 1;
    if (status === 429) {
      this.stoppedReason = "provider_rate_limited";
      throw new ProviderControlError(this.stoppedReason, status);
    }
  }

  observeNetworkFailure(): void {
    this.failures += 1;
  }

  snapshot(): Record<string, number | string | null> {
    return {
      provider_calls: this.used,
      provider_call_limit: this.limit,
      provider_failures: this.failures,
      provider_stop_reason: this.stoppedReason,
    };
  }
}

export async function fetchWithProviderBudget(
  input: string | URL | Request,
  init: RequestInit,
  budget: ProviderCallBudget,
): Promise<Response> {
  budget.reserve();
  try {
    const response = await fetch(input, init);
    budget.observeResponse(response.status);
    return response;
  } catch (error) {
    if (!(error instanceof ProviderControlError)) budget.observeNetworkFailure();
    throw error;
  }
}

export function boundedRotatingSelection<T>(
  values: readonly T[],
  limit: number,
  rotationBucket: number,
): T[] {
  if (values.length === 0 || limit <= 0) return [];
  const count = Math.min(Math.floor(limit), values.length);
  const offset = ((Math.floor(rotationBucket) % values.length) + values.length) % values.length;
  return Array.from({ length: count }, (_, index) => values[(offset + index) % values.length]);
}

export function clampProviderCallLimit(requested: unknown, hardLimit: number): number {
  const parsed = typeof requested === "number" ? requested : Number(requested);
  if (!Number.isFinite(parsed)) return hardLimit;
  return Math.min(Math.max(Math.floor(parsed), 1), hardLimit);
}
