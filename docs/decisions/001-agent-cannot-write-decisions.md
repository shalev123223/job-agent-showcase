# 001 — The agent can read my decisions and can never write them

**Status:** Accepted

## Context

The agent improves by reading what I did with its earlier suggestions. If it could change that
record, whether by marking a job submitted, revising a rejection, or deciding it was right after
all, the learning signal would be contaminated by its own opinions.

## Decision

- `job_feedback` is **append-only** at the database level: only select and insert policies
  exist.
- **No tool writes to `job_feedback`**, and no tool changes `job_postings.status`.
- `save_jobs` is insert-only, and the column defaults set `status = 'new'` and
  `user_id = auth.uid()`.
- The only stage-2 write, `enrich_job`, builds an update containing exactly one column
  (`custom_fields`) and replaces exactly one key inside it (`stage2`). Its input schema is
  `.strict()`, so an attempt to pass `status` or `agent_score` is rejected outright.
- The stage-1 score and rationale are never overwritten by stage 2. They are different kinds of
  claim, made at different times, with different evidence.

## Consequences

- The guarantee comes from the **tool surface**, and tests hold it in place. I've written down
  that the database alone would allow the update; the tool list is where the rule is enforced.
- If the agent wants to express "this looked better than I thought", it does so in a new field,
  never by editing history.
- Facts about me (salary expectation, notice period) follow the same rule: they are quoted,
  never generated.
