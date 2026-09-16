-- Portfolio excerpt from Job Agent (supabase/migrations — job_feedback). Shown for reading only.

-- Job Search Agent, Phase 1: job_feedback.
--
-- Shalev's explicit decisions. This is the table that makes the agent learn.
--
-- Its absence is precisely what broke the previous generation: it re-surfaced a
-- bootcamp four days after he had rated it 1/10, because it kept no memory of
-- rejections (docs/PRODUCT.md "The calibration failure").
--
-- Append-only — select and insert policies only, no update and no delete, the
-- same shape as activity_log and ai_usage. Two reasons:
--   1. A decision history that can be rewritten is not evidence.
--   2. The agent reads this table and must never be able to edit it. The MCP
--      server exposes no write path to it at all (docs/AI_AGENT.md).
--
-- TWO SEPARATE AXES (ADR-012). `decision` is what the user did. `reason` is why
-- a rejection happened. They are deliberately not one enum:
--
--   * `decision` stays at exactly two values, because it drives the CRM's two
--     primary actions and the job's `status`. Adding a third value here would
--     mean a UI change and a status-vocabulary change in the same breath.
--   * `reason` is optional and can grow without touching `decision`, the UI, or
--     `job_postings.status`.
--
-- SUPERSEDING. Because the table is append-only and the initial UI does not
-- collect a reason, adding one later means INSERTING A NEW ROW for the same
-- job_posting_id, not updating the old one. Readers must not assume one row per
-- job — the current decision is the most recent row by (decided_at desc, seq desc).
--
-- `seq` exists because timestamps alone are not a total order here: now() is
-- TRANSACTION-scoped in Postgres, so two rows written in one transaction share
-- an identical created_at/decided_at and "latest" becomes ambiguous. A dry-run
-- hit exactly that. Since docs/CONTRACT.md requires both repos to resolve
-- "latest" identically, an ambiguous ordering is a contract bug, not a nit.
-- `seq` is a monotonic identity column and makes the rule total.
--
-- System facts are NOT feedback and do not belong in either column. "Duplicate"
-- is already handled structurally by job_postings' unique (user_id,
-- external_id). "Reposted" and "closed" are properties of the posting that the
-- agent observes, not judgements the user made; if they are ever modelled they
-- belong on job_postings. Mixing them in here would corrupt the very signal the
-- agent learns from — it would read "the user rejected 40 jobs" when 30 of them
-- were merely stale listings.

create table if not exists public.job_feedback (
  id uuid primary key default gen_random_uuid(),
  -- Monotonic insertion order. The tiebreaker that makes "latest row wins" a
  -- total order — see SUPERSEDING above. Never exposed to the user.
  seq bigint generated always as identity,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_posting_id uuid not null references public.job_postings (id) on delete cascade,

  -- What the user did. Exactly the two primary actions in the CRM.
  decision text not null
    check (decision in ('submitted', 'not_relevant')),

  -- Why a rejection happened. Optional — the CRM's initial UI offers only the
  -- two primary actions above and leaves this null. Populated later by a
  -- secondary control, or inferred and confirmed rather than guessed.
  reason text
    check (reason is null or reason in (
      'too_senior',
      'role_mismatch',
      'location_mismatch',
      'industry_mismatch',
      'salary_mismatch',
      'already_applied',
      'other'
    )),

  decided_at timestamptz not null default now(),
  note text,

  created_at timestamptz not null default now(),

  -- A reason qualifies a rejection. Pairing one with 'submitted' is nonsense,
  -- so it is made unrepresentable rather than merely discouraged.
  constraint job_feedback_reason_requires_rejection
    check (reason is null or decision = 'not_relevant')
);

comment on table public.job_feedback is
  'Append-only record of the user''s Submitted / Not Relevant decisions. Read by the agent, never written by it.';
comment on column public.job_feedback.decision is
  'What the user did. Exactly two values, matching the two primary CRM actions.';
comment on column public.job_feedback.reason is
  'Optional structured rejection reason. Nullable by design — the initial CRM UI does not collect it. Never holds system facts such as duplicate/repost/closed.';
comment on column public.job_feedback.note is
  'Free text. The agent reads the reason before generalising from a rejection rather than avoiding anything that resembles it.';

create index if not exists job_feedback_user_id_idx on public.job_feedback (user_id);
create index if not exists job_feedback_job_posting_id_idx on public.job_feedback (job_posting_id);
create index if not exists job_feedback_decided_at_idx on public.job_feedback (decided_at desc);
create index if not exists job_feedback_decision_idx on public.job_feedback (decision);
-- Supports "latest row per job" lookups, which is how the current decision is
-- resolved now that a later row can supersede an earlier one. Column order
-- matches the contract's ordering rule exactly.
create index if not exists job_feedback_latest_idx
  on public.job_feedback (job_posting_id, decided_at desc, seq desc);
-- Supports "what do my rejections have in common?" without scanning the table.
create index if not exists job_feedback_reason_idx on public.job_feedback (reason) where reason is not null;

alter table public.job_feedback enable row level security;

drop policy if exists "job_feedback_select_own" on public.job_feedback;
create policy "job_feedback_select_own"
  on public.job_feedback
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "job_feedback_insert_own" on public.job_feedback;
create policy "job_feedback_insert_own"
  on public.job_feedback
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- No update or delete policy, and no update/delete grant: append-only by
-- construction, not by convention.
grant select, insert on public.job_feedback to authenticated;
