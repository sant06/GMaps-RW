import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/utils/rate-limiter';

describe('RateLimiter', () => {
  it('applies jittered delays within specified boundaries', async () => {
    const limiter = new RateLimiter({ minDelayMs: 20, maxDelayMs: 50, coolingIntervalCycles: 100, microPauseProbability: 0 });
    const start = Date.now();
    const delay = await limiter.applyAdaptiveDelay();
    const elapsed = Date.now() - start;

    expect(delay).toBeGreaterThanOrEqual(20);
    expect(delay).toBeLessThanOrEqual(60); // Allow small execution margin
    expect(elapsed).toBeGreaterThanOrEqual(18);
  });

  it('retries with exponential backoff on transient errors', async () => {
    const limiter = new RateLimiter();
    let attempts = 0;

    const result = await limiter.executeWithBackoff(
      async (attempt) => {
        attempts++;
        if (attempt < 2) {
          throw new Error('Transient network error');
        }
        return 'success_value';
      },
      3,
      10 // small initial delay for fast test
    );

    expect(attempts).toBe(3);
    expect(result).toBe('success_value');
  });
});
