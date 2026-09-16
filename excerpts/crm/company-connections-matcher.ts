// Portfolio excerpt from Shalev CRM (src/lib/validation/company-connections.ts — matching). Shown for reading only.

import { z } from "zod";

/**
 * Company-connection validation and matching — mirrors the constraints in
 * supabase/migrations/20260914120000_create_job_company_connections.sql.
 *
 * THE MATCHER IN THIS FILE IS THE SOURCE OF THE RED FLAG (agent repo ADR-034),
 * and that placement is the whole design. The agent also reasons about this
 * list — it is what lets a weaker job be saved at all — but the badge Shalev
 * sees is never computed from the agent's judgement. It is re-derived here,
 * from the table, every time the page renders. Three consequences, all wanted:
 *
 *   - A connection the model imagines cannot produce a badge.
 *   - A connection added today lights up jobs saved months ago, with no re-run.
 *   - A contact who leaves is removed once, and every card updates.
 *
 * WHY WORD BOUNDARIES RATHER THAN `includes`. Job titles carry the employer's
 * legal name, not the one Shalev typed: "NVIDIA" has to match "NVIDIA ISRAEL
 * R&D LTD", and "Meta" has to match "Meta Platforms". But a plain substring
 * test also matches "Meta" inside "Metaphor Labs", and a false warm-intro badge
 * is worse than a missing one — it sends him to a contact who cannot help.
 * Matching whole words gets both cases right.
 *
 * `aliases` is the escape hatch for what word boundaries still cannot reach,
 * such as a company trading under a different name entirely. It is typed by
 * Shalev, never inferred, because a matcher that guesses guesses wrong quietly.
 */

export const connectionSources = ["personal", "referrer_list"] as const;
export type ConnectionSource = (typeof connectionSources)[number];

export const connectionSourceLabels: Record<ConnectionSource, string> = {
  personal: "Personal",
  referrer_list: "Referrer list",
};

/**
 * What each source means for behaviour. Kept next to the labels so the
// … (form validation schemas omitted)

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/**
 * Lowercase, strip punctuation to spaces, collapse runs of whitespace.
 *
 * Punctuation becomes a SPACE rather than nothing, so "Wix.com" normalises to
 * "wix com" and still matches the word "wix" — whereas deleting it would give
 * "wixcom", where the word boundary no longer exists.
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‎‏⁦-⁩]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Does `needle` appear in `haystack` as a whole word (or run of words)? */
function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (haystack === needle) return true;
  return (
    haystack.startsWith(`${needle} `) ||
    haystack.endsWith(` ${needle}`) ||
    haystack.includes(` ${needle} `)
  );
}

export type ConnectionLike = {
  companyName: string;
  aliases: string[];
  source: ConnectionSource;
  enabled: boolean;
};

/**
 * Every enabled connection whose company appears in `company`.
 *
 * Returns all of them rather than the first: several people can work at the same
 * company, and showing one of them would hide the rest — which is precisely the
 * information he opened the card for.
 */
export function matchConnections<T extends ConnectionLike>(
  company: string | null | undefined,
  connections: readonly T[],
): T[] {
  const target = normalise(company ?? "");
  if (!target) return [];

  return connections.filter((connection) => {
    if (!connection.enabled) return false;
    const names = [connection.companyName, ...connection.aliases];
    return names.some((name) => containsWholeWord(target, normalise(name)));
  });
}

/**
 * What the job card should show, if anything.
 *
 * `personal` wins over `referrer_list` when both match, because they are not
 * equivalent claims: one is a person Shalev can call, the other is a volunteer
 * on a public sheet. A card that showed the weaker of the two would understate
 * what he has.
 */
export function connectionFlag<T extends ConnectionLike>(
  company: string | null | undefined,
  connections: readonly T[],
): { tier: ConnectionSource; matches: T[] } | null {
  const matches = matchConnections(company, connections);
  if (matches.length === 0) return null;

  const personal = matches.filter((m) => m.source === "personal");
  return personal.length > 0
    ? { tier: "personal", matches: personal }
    : { tier: "referrer_list", matches };
}
