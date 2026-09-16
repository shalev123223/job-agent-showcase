// Portfolio excerpt from Job Agent (src/mcp/tools/enrich-job.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import { z } from "zod";
import { clientOrFail, defineTool, fail, ok } from "@/mcp/tools/types.ts";

/**
 * Stage 2's only write (ADR-024).
 *
 * THE ONE COLUMN RULE. This tool's update payload contains exactly one column:
 * `custom_fields`. It cannot reach `status`, `agent_score`, `agent_rationale`,
 * `title`, `url`, `description`, or `job_feedback` — not because it politely
 * declines to, but because no code path here builds an update that names them.
 *
 * That matters because stage 1 and stage 2 make different KINDS of claim.
 * Stage 1's score and rationale are a judgement about the ad, formed while
 * looking at the ad. Stage 2 runs later, over a saved row, with a resume in
 * hand. Letting the later pass rewrite the earlier one would quietly destroy
 * the record of what the agent originally thought — and `job_feedback` is
 * Shalev's, never the agent's, at any stage.
 *
 * WHY IT UPDATES RATHER THAN UPSERTS. `save_jobs` inserts with
 * `ignoreDuplicates`, which is right for discovery and wrong here: an upsert
 * whose row does not exist would CREATE a job posting out of an enrichment
 * patch. The read-then-update below means an unknown id is reported by name and
 * skipped, never invented.
 *
 * `matched_resume_label` is validated against live `candidate_resumes` labels
 * rather than accepted blind, so a hallucinated resume name is rejected with the
 * offending value rather than persisted as if real.
 */

const jobPatchSchema = z
  .object({
    job_id: z.string().uuid(),
    matched_resume_label: z.string().trim().min(1).max(120).nullable().optional(),
    resume_match_score: z.number().int().min(0).max(100).nullable().optional(),
    personal_note: z.string().trim().max(2000).nullable().optional(),
    contact_name: z.string().trim().max(200).nullable().optional(),
    contact_url: z.string().trim().url().max(500).nullable().optional(),
    contact_source: z.string().trim().max(120).nullable().optional(),
  })
  // .strict() is the enforcement mechanism ADR-024 names: a `status` or
  // `agent_score` key in the input is a validation error, not a silently
  // ignored field.
  .strict();

export const enrichJob = defineTool({
  name: "enrich_job",
  title: "Enrich a saved job (stage 2)",
  description:
    "Record stage-2 findings — matched resume, a match score, a personal note, any contact found on " +
    "the posting — onto a job list_jobs already returned. Writes only to custom_fields.stage2: it " +
    "cannot touch status, agent_score, agent_rationale, title, url, description, or job_feedback. " +
    "matched_resume_label must be one of get_resumes's labels exactly, or omitted/null when nothing " +
    "genuinely fits. Send null for a field you deliberately found nothing for, not your own guess.",
  inputSchema: z
    .object({
      run_id: z.string().uuid(),
      jobs: z.array(jobPatchSchema).min(1).max(100),
    })
    .strict(),

  async handler(input, ctx) {
    const resolved = await clientOrFail(ctx);
    if (!resolved.ok) return resolved.failure;
    const { client } = resolved;

    const { data: run, error: runError } = await client
      .from("agent_runs")
      .select("id")
      .eq("id", input.run_id)
      .maybeSingle();
    if (runError) return fail("upstream_failure", `Could not read the run: ${runError.message}`);
    if (!run) return fail("not_found", `No run ${input.run_id} exists, or it is not yours.`);

    // One read for every id in the batch. RLS scopes it to this user, so a job
    // belonging to someone else is indistinguishable from one that does not
    // exist — which is the correct answer to give in both cases.
    const jobIds = [...new Set(input.jobs.map((j) => j.job_id))];
    const { data: rows, error: jobsError } = await client
      .from("job_postings")
      .select("id, custom_fields")
      .in("id", jobIds)
      .is("deleted_at", null);
    if (jobsError)
      return fail("upstream_failure", `Could not read job_postings: ${jobsError.message}`);

    const byId = new Map(
      (rows ?? []).map((row) => [
        row.id as string,
        (row.custom_fields ?? {}) as Record<string, unknown>,
      ]),
    );

    // Only pay for the resume read when a label is actually being claimed.
    let validLabels: Set<string> | null = null;
    if (input.jobs.some((j) => j.matched_resume_label)) {
      const { data: resumeRows, error: resumeError } = await client
        .from("candidate_resumes")
        .select("label")
        .eq("enabled", true)
        .is("deleted_at", null);
      if (resumeError) {
        return fail("upstream_failure", `Could not read candidate_resumes: ${resumeError.message}`);
      }
      validLabels = new Set((resumeRows ?? []).map((r) => r.label as string));
    }

    const unknownJobs: string[] = [];
    const invalidLabels: string[] = [];
    let enrichedCount = 0;

    for (const patch of input.jobs) {
      const existingCustomFields = byId.get(patch.job_id);
      if (!existingCustomFields) {
        unknownJobs.push(patch.job_id);
        continue;
      }

      if (
        patch.matched_resume_label &&
        validLabels &&
        !validLabels.has(patch.matched_resume_label)
      ) {
        invalidLabels.push(`${patch.job_id}: ${patch.matched_resume_label}`);
        continue;
      }

      // Only keys the model actually sent are written. `undefined` means "did
      // not look at this"; an explicit `null` means "looked, found nothing" —
      // and the two must stay distinguishable in the stored row.
      const stage2: Record<string, unknown> = {};
      if (patch.matched_resume_label !== undefined)
        stage2.matched_resume_label = patch.matched_resume_label;
      if (patch.resume_match_score !== undefined)
        stage2.resume_match_score = patch.resume_match_score;
      if (patch.personal_note !== undefined) stage2.personal_note = patch.personal_note;
      if (patch.contact_name !== undefined) stage2.contact_name = patch.contact_name;
      if (patch.contact_url !== undefined) stage2.contact_url = patch.contact_url;
      if (patch.contact_source !== undefined) stage2.contact_source = patch.contact_source;

      // Spread the existing custom_fields so `direction_label` (and anything
      // else a prior stage wrote) survives; only the `stage2` key is replaced.
      const { error: updateError } = await client
        .from("job_postings")
        .update({ custom_fields: { ...existingCustomFields, stage2 } })
        .eq("id", patch.job_id);

      if (updateError) {
        return fail(
          "upstream_failure",
          `Could not update job ${patch.job_id}: ${updateError.message}`,
        );
      }

      enrichedCount++;
    }

    return ok({
      enriched_count: enrichedCount,
      notes: [
        "Only custom_fields.stage2 was written — status, agent_score, agent_rationale and " +
          "job_feedback are untouched, and always will be through this tool.",
        ...(unknownJobs.length > 0
          ? [
              `Skipped ${unknownJobs.length} job id(s) not found (wrong id, deleted, or not yours): ${unknownJobs
                .slice(0, 10)
                .join(", ")}.`,
            ]
          : []),
        ...(invalidLabels.length > 0
          ? [
              `Skipped ${invalidLabels.length} entr${invalidLabels.length === 1 ? "y" : "ies"} with a ` +
                `matched_resume_label that doesn't match any of get_resumes's labels: ${invalidLabels
                  .slice(0, 10)
                  .join(", ")}.`,
            ]
          : []),
      ],
    });
  },
});
