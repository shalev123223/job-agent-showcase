// Portfolio excerpt from Job Agent (src/mcp/tools/save-jobs.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import { z } from "zod";
import { clientOrFail, defineTool, fail, ok } from "@/mcp/tools/types.ts";
import { recallFetchedJobs } from "@/data/fetched-jobs.ts";

/**
 * INSERT ONLY. There is no update path and no delete path, by construction.
 *
 * That asymmetry is the point (docs/AI_AGENT.md): an agent that could rewrite
 * the record of its own results — or the status Shalev set — could not be
 * trusted to learn from them. `status` is always the default `new`; only
 * Personal OS moves it, and only Shalev writes job_feedback.
 *
 * THE AGENT SENDS A VERDICT, NOT A JOB. It passes the `external_id` it is
 * choosing plus its own judgement (score, rationale, direction). Everything
 * factual — title, company, url, and above all `description` — is written from
 * what `search_jobs` actually fetched and stashed on the run.
 *
 * That inversion fixes two things the first real run exposed. The model had
 * been summarising descriptions on the way back, so the column meant to hold
 * the employer's words held a paraphrase instead; now it is verbatim by
 * construction rather than by instruction. And 80 full ads no longer make a
 * round trip through the conversation, which is what took a $1.50 run to $2.02.
 *
 * `unique (user_id, external_id)` makes re-runs idempotent: a duplicate insert
 * conflicts instead of creating a second row. Generation 1 deduplicated on the
 * COMPANY instead, so only one job per company ever survived.
 *
 * `agent_score` is nullable on purpose. A score the agent cannot justify from
 * the ad text should be omitted, not invented — the previous generation scored
 * two bootcamps 85 and 82 that Shalev rated 1/10.
 */
export const saveJobs = defineTool({
  name: "save_jobs",
  title: "Save jobs",
  description:
    "Save the jobs you judged worth Shalev's attention, by external_id. You do NOT resend the " +
    "posting — this run already holds exactly what the search returned, so the real title, url " +
    "and full description are written for you. Send only your verdict: the id, an optional score, " +
    "a rationale in your own words that Shalev will read on the card, and the search direction it " +
    "came from. Insert-only: re-saving a known job is a no-op, never a duplicate. Omit the score " +
    "when you cannot justify it from the ad; a confident wrong score costs more than no score.",
  inputSchema: z
    .object({
      run_id: z.string().uuid(),
      jobs: z
        .array(
          z
            .object({
              /** Must be an id this run actually fetched. */
              external_id: z.string().trim().min(1).max(200),
              agent_score: z.number().int().min(0).max(100).nullable().optional(),
              agent_rationale: z.string().trim().max(4000).nullable().optional(),
              /**
               * Which search direction surfaced this job, so results group by
               * kind of work. Stored in `custom_fields`: ADR-014 deliberately
               * built no link back to job_search_directions, and custom_fields
               * is this project's documented extensibility mechanism. A label
               * rather than an id, so a renamed or soft-deleted direction still
               * leaves a readable trail.
               */
              direction_label: z.string().trim().max(120).nullable().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),

  async handler(input, ctx) {
    const resolved = await clientOrFail(ctx);
    if (!resolved.ok) return resolved.failure;
    const { client } = resolved;

    const { data: run, error: runError } = await client
      .from("agent_runs")
      .select("id, jobs_saved, duplicates_skipped")
      .eq("id", input.run_id)
      .maybeSingle();
    if (runError) return fail("upstream_failure", `Could not read the run: ${runError.message}`);
    if (!run) return fail("not_found", `No run ${input.run_id} exists, or it is not yours.`);

    const fetched = await recallFetchedJobs(client, input.run_id);

    // Collapse repeats inside one call — the unique index would reject the
    // whole batch otherwise.
    const seen = new Set<string>();
    const unknown: string[] = [];
    const fixtures: string[] = [];
    const rows = [];

    for (const verdict of input.jobs) {
      if (seen.has(verdict.external_id)) continue;
      seen.add(verdict.external_id);

      const job = fetched[verdict.external_id];
      if (!job) {
        // Naming it is the useful part: the agent can correct itself rather
        // than guess why a save vanished.
        unknown.push(verdict.external_id);
        continue;
      }

      // A dry-run search returns the FIXTURE, which is test data: a bootcamp, a
      // mislabelled seniority, a prompt injection, and several plausible-looking
      // jobs that do not exist. Saving one would put an invented posting in the
      // real table, indistinguishable from a real one afterwards. Refused here
      // rather than left to the model to notice.
      if (job.dry_run) {
        fixtures.push(verdict.external_id);
        continue;
      }

      rows.push({
        run_id: input.run_id,
        // Everything below is the employer's own data, straight from the
        // search — never the model's recollection of it.
        external_id: job.external_id,
        title: job.title,
        company: job.company,
        url: job.url,
        location: job.location,
        posted_at: job.posted_at,
        description: job.description,
        employment_type: job.employment_type,
        salary_raw: job.salary_raw,
        applicants_count: job.applicants_count,
        company_url: job.company_url,
        industries: job.industries,
        job_function: job.job_function,
        // And these are the agent's judgement, which is all it gets to supply.
        agent_score: verdict.agent_score ?? null,
        agent_rationale: verdict.agent_rationale ?? null,
        custom_fields: {
          ...(verdict.direction_label ? { direction_label: verdict.direction_label } : {}),
          // LinkedIn's own label, kept for context but never trusted as truth.
          ...(job.seniority_level ? { linkedin_seniority: job.seniority_level } : {}),
          // PROVENANCE, taken from the cached record rather than from the
          // verdict. The connector that fetched the job stamped this; the model
          // has no input that could change it, which is what makes "found on the
          // company's own careers page" a fact the CRM can state rather than
          // infer from the URL (ADR-025).
          source: job.source ?? "linkedin",
          ...(job.source_company ? { source_company: job.source_company } : {}),
        },
        // status is deliberately not set: the column default is 'new', and
        // moving it belongs to Personal OS alone (docs/CONTRACT.md).
        // user_id is deliberately not set: the column default is auth.uid(),
        // and the RLS insert policy would reject anything else anyway.
      });
    }

    if (rows.length === 0 && fixtures.length > 0) {
      return fail(
        "not_permitted",
        `Those are dry-run fixture jobs and cannot be saved — APIFY_DRY_RUN is on, so search_jobs ` +
          `returned test data rather than real postings. Nothing was written. Report this in ` +
          `record_run_event and stop: there is no real search to work with in this configuration.`,
      );
    }

    if (rows.length === 0) {
      return fail(
        "not_found",
        `None of those external_ids were fetched by this run${
          unknown.length ? `: ${unknown.slice(0, 10).join(", ")}` : ""
        }. Save only ids that search_jobs returned to you in this run.`,
      );
    }

    const { data: inserted, error: insertError } = await client
      .from("job_postings")
      // ignoreDuplicates makes a re-run idempotent rather than an error.
      .upsert(rows, { onConflict: "user_id,external_id", ignoreDuplicates: true })
      .select("id, external_id");

    if (insertError) {
      return fail("upstream_failure", `Could not save jobs: ${insertError.message}`);
    }

    const savedCount = inserted?.length ?? 0;
    const skippedCount = rows.length - savedCount;

    await client
      .from("agent_runs")
      .update({
        jobs_saved: run.jobs_saved + savedCount,
        duplicates_skipped: run.duplicates_skipped + skippedCount,
      })
      .eq("id", input.run_id);

    return ok({
      saved_count: savedCount,
      skipped_as_duplicate: skippedCount,
      saved_external_ids: (inserted ?? []).map((row) => row.external_id as string),
      notes: [
        "Saved with the employer's own title, url and full description — you did not need to resend them.",
        "Jobs enter with status 'new'. Only Shalev moves that, through Personal OS.",
        ...(skippedCount > 0
          ? [`${skippedCount} were already in the database and were left untouched.`]
          : []),
        ...(unknown.length > 0
          ? [
              `Ignored ${unknown.length} id(s) this run never fetched: ${unknown.slice(0, 10).join(", ")}.`,
            ]
          : []),
        ...(fixtures.length > 0
          ? [
              `Refused ${fixtures.length} dry-run fixture job(s) — APIFY_DRY_RUN is on, so those are ` +
                `test data, not real postings: ${fixtures.slice(0, 10).join(", ")}.`,
            ]
          : []),
      ],
    });
  },
});
