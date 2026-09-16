// Portfolio excerpt from Job Agent (src/run/budget.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

/**
 * Spend accounting for a local dev run.
 *
 * Cost is a correctness property here (CLAUDE.md rule 7): every path that can
 * spend money is capped, counted, and ends up visible in `agent_runs`. In
 * production Managed Agents enforces a hard per-run dollar cap; locally there is
 * no platform to do that, so this module is the ceiling.
 *
 * Rates are the STANDARD list prices, deliberately not the promotional ones.
 * Sonnet 5 is on introductory pricing ($2/$10 per MTok) until 2026-08-31, so
 * estimating at $3/$15 over-states spend rather than under-stating it — the
 * safe direction for a ceiling.
 */

export type ModelRates = { inputPerMTok: number; outputPerMTok: number };

const RATES: Record<string, ModelRates> = {
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

/** Falls back to Opus rates for an unknown model — again, over- not under-stating. */
export function ratesFor(model: string): ModelRates {
  return RATES[model] ?? { inputPerMTok: 5, outputPerMTok: 25 };
}

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function createBudget(model: string, ceilingUsd: number) {
  const rates = ratesFor(model);
  let inputTokens = 0;
  let outputTokens = 0;
  let apifyUsd = 0;

  function addUsage(usage: Usage | null | undefined): void {
    if (!usage) return;
    // Cache writes and reads are billed against the input side; counting them
    // at the full input rate keeps the estimate conservative.
    inputTokens +=
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    outputTokens += usage.output_tokens ?? 0;
  }

  function addApifyCost(usd: number): void {
    apifyUsd += usd;
  }

  function anthropicUsd(): number {
    return (
      (inputTokens / 1_000_000) * rates.inputPerMTok +
      (outputTokens / 1_000_000) * rates.outputPerMTok
    );
  }

  function totalUsd(): number {
    return anthropicUsd() + apifyUsd;
  }

  /** True once the run has spent its allowance and must wind down. */
  function exceeded(): boolean {
    return anthropicUsd() >= ceilingUsd;
  }

  /**
   * Would sending a request of roughly this size push us past the ceiling?
   *
   * Checking only AFTER a turn made the ceiling advisory rather than binding: a
   * live run breached $1.50 and finished at $2.02, because by the time the
   * check ran the expensive request had already been paid for. Asking BEFORE
   * sending is what makes it a cap.
   *
   * Estimated, not exact — but it errs high (see `estimateInputTokens`), and a
   * cap that stops slightly early is the right direction to be wrong in.
   */
  function wouldExceed(
    estimatedInputTokens: number,
    estimatedOutputTokens = 2000,
    /**
     * Extra allowance above the ceiling for this one request.
     *
     * Used only by the wind-down turn. Once the ceiling is breached, a strict
     * check would also forbid the turn that RECORDS why the run stopped — and
     * `stop_reason` is the part Shalev actually reads. A few cents to leave a
     * legible run record is worth more than a ceiling enforced to the penny on
     * a run that is already ending.
     */
    graceUsd = 0,
  ): boolean {
    const projected =
      anthropicUsd() +
      (estimatedInputTokens / 1_000_000) * rates.inputPerMTok +
      (estimatedOutputTokens / 1_000_000) * rates.outputPerMTok;
    return projected >= ceilingUsd + graceUsd;
  }

  function snapshot() {
    return {
      model,
      ceilingUsd,
      inputTokens,
      outputTokens,
      anthropicUsd: Number(anthropicUsd().toFixed(4)),
      apifyUsd: Number(apifyUsd.toFixed(4)),
      totalUsd: Number(totalUsd().toFixed(4)),
      exceeded: exceeded(),
    };
  }

  return { addUsage, addApifyCost, anthropicUsd, totalUsd, exceeded, wouldExceed, snapshot };
}

export type Budget = ReturnType<typeof createBudget>;

/**
 * Rough token count for a request body, used only by the pre-flight check.
 *
 * Deliberately crude and deliberately HIGH: ~3.2 characters per token rather
 * than the usual ~4, because job ads are dense and mixed Hebrew/English, which
 * tokenises worse than plain English prose. Over-estimating stops the run a
 * little early; under-estimating lets it overspend, which is the failure this
 * function exists to prevent.
 */
export function estimateInputTokens(payload: unknown): number {
  return Math.ceil(JSON.stringify(payload ?? "").length / 3.2);
}
