/**
 * Pacing and rate-limiting engine.
 * Implements anti-bot jitter delays, periodic cooling intervals,
 * and exponential backoff retry mechanisms to prevent Google action throttling.
 */

export interface RateLimiterOptions {
  minDelayMs: number;
  maxDelayMs: number;
  coolingIntervalCycles: number;
  coolingDurationMs: number;
  microPauseProbability: number;
}

export const DEFAULT_RATE_LIMITER_OPTIONS: RateLimiterOptions = {
  minDelayMs: 1200,
  maxDelayMs: 2500,
  coolingIntervalCycles: 35,
  coolingDurationMs: 4000,
  microPauseProbability: 0.08,
};

export class RateLimiter {
  private options: RateLimiterOptions;
  private actionCounter = 0;

  constructor(options: Partial<RateLimiterOptions> = {}) {
    this.options = { ...DEFAULT_RATE_LIMITER_OPTIONS, ...options };
  }

  /**
   * Applies an adaptive jitter delay before the next operation.
   * Periodically triggers extended cooling or human-like micro-pauses.
   */
  public async applyAdaptiveDelay(): Promise<number> {
    this.actionCounter++;

    // 1. Periodic cooling interval check
    if (this.actionCounter % this.options.coolingIntervalCycles === 0) {
      const coolingTime = this.options.coolingDurationMs + Math.floor(Math.random() * 1000);
      await this.sleep(coolingTime);
      return coolingTime;
    }

    // 2. Uniform random jitter between min and max
    const { minDelayMs, maxDelayMs } = this.options;
    const baseJitter = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;

    // 3. Occasional micro-pause to mirror human distraction/inspection
    const isMicroPause = Math.random() < this.options.microPauseProbability;
    const finalDelay = isMicroPause ? baseJitter + 1800 : baseJitter;

    await this.sleep(finalDelay);
    return finalDelay;
  }

  /**
   * Executes an async operation with exponential backoff on transient errors.
   */
  public async executeWithBackoff<T>(
    operation: (attempt: number) => Promise<T>,
    maxRetries = 3,
    initialDelayMs = 1500
  ): Promise<T> {
    let attempt = 0;
    let delay = initialDelayMs;

    while (attempt < maxRetries) {
      try {
        return await operation(attempt);
      } catch (error) {
        attempt++;
        if (attempt >= maxRetries) {
          throw error;
        }
        // Jittered exponential backoff: delay * 1.5 + jitter
        const jitter = Math.floor(Math.random() * 500);
        const sleepTime = delay + jitter;
        await this.sleep(sleepTime);
        delay = Math.min(delay * 2, 15000);
      }
    }

    throw new Error(`Execution exceeded maximum retries (${maxRetries}).`);
  }

  public reset(): void {
    this.actionCounter = 0;
  }

  public sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
