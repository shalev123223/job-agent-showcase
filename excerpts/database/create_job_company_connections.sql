-- Portfolio excerpt from Shalev CRM (supabase/migrations — job_company_connections). Shown for reading only.

-- Job Search Agent, Phase 3.6: job_company_connections.
--
-- People Shalev can be referred by, and the company they can refer him into.
-- This is a THIRD kind of company intent, and it is the deliberate OPPOSITE of
-- job_target_companies on the one axis that matters — the bar. See ADR-034.
--
--   job_search_directions   semantic   "this KIND of work, wherever it is"
--   job_target_companies    literal    "fetch THIS employer's own careers page"
--                                      -> a company here is NOT a reason to lower the bar
--   job_company_connections social     "I know someone here"
--                                      -> a personal connection IS a reason to lower the bar
--
-- Collapsing any two of these would collapse the kinds of intent they exist to
-- keep apart. A connection has no careers_url and is never fetched; a target
-- company is never a reason to relax a verdict.
--
-- WHY `source` IS NOT COSMETIC. Shalev's two sheets are different things
-- wearing the same shape. The personal one is people he actually knows. The
-- community referrer list — several times larger — is volunteers he has never met, most with a first name and no way to reach them.
-- Together they cover essentially the whole Israeli tech market, so letting the
-- referrer list lower the bar would make "lower the bar" the default rule and
-- the red flag meaningless. Only `personal` reaches the agent, and only
-- `personal` relaxes a verdict. `referrer_list` is reference material the CRM
-- shows and the agent never sees.

create table if not exists public.job_company_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  company_name text not null check (char_length(btrim(company_name)) > 0),

  -- For the cases name matching cannot reach on its own: "NVIDIA" will not
  -- match "NVIDIA ISRAEL R&D LTD" on a word-boundary test alone. Kept as an
  -- explicit, user-edited escape hatch rather than a cleverer matcher, because
  -- a matcher that guesses is a matcher that guesses wrong silently.
  aliases text[] not null default '{}'::text[],

  -- NULLABLE ON PURPOSE. Some imported rows name a company Shalev has a way
  -- into but do not record who. That is a real, useful state — "I know there is
  -- a door here, I have to go find the name" — and forcing a placeholder in
  -- would turn a known gap into fake data.
  contact_name text,

  -- NEVER SENT TO THE MODEL. get_company_connections selects company_name,
  -- aliases and contact_name only. Rule 11 in CLAUDE.md says the agent may
  -- never send anything on Shalev's behalf; handing it a phone number or an
  -- email address is the exact shape of that capability, and the agent has no
  -- decision that needs them. The CRM shows them to Shalev, who does the
  -- reaching out himself.
  contact_phone text,
  contact_email text,

  -- Free text from the source sheet: "email me the link and your CV first",
  -- "be in touch before applying", "simulator instructor roles". Shown to
  -- Shalev. Never fetched, never treated as instructions to anyone.
  notes text,

  source text not null default 'personal'
    check (source in ('personal', 'referrer_list')),

  -- Toggle a connection off without losing it — a contact who left the company,
  -- or a referrer who is no longer worth approaching.
  enabled boolean not null default true,

  custom_fields jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.job_company_connections is
  'Companies Shalev has a referral path into, and who the path is. source=personal lowers the agent''s bar and flags the job red; source=referrer_list is CRM-only reference the agent never sees. The social counterpart to job_target_companies (literal) and job_search_directions (semantic). See ADR-034.';
comment on column public.job_company_connections.source is
  'personal = someone Shalev knows; the only rows get_company_connections returns and the only ones that relax a verdict. referrer_list = a community referral sheet, reference material in the CRM only.';
comment on column public.job_company_connections.contact_phone is
  'Never exposed to the agent. Rule 11: the agent never contacts anyone, so it has no use for a way to.';
comment on column public.job_company_connections.contact_email is
  'Never exposed to the agent. See contact_phone.';
comment on column public.job_company_connections.aliases is
  'Extra company spellings for matching, e.g. NVIDIA -> {"NVIDIA Israel R&D"}. User-edited, never inferred.';

-- One row per (source, company, contact). Scoped to live rows so a soft-deleted
-- pair can be re-added, and expression-based, so it must be an index rather
-- than a table constraint — same shape as job_target_companies_user_name_key.
-- This is also what makes re-running the sheet import idempotent.
create unique index if not exists job_company_connections_user_company_contact_key
  on public.job_company_connections
     (user_id, source, lower(btrim(company_name)), lower(btrim(coalesce(contact_name, ''))))
  where deleted_at is null;

create index if not exists job_company_connections_user_id_idx
  on public.job_company_connections (user_id);
-- Covers the agent's only read: enabled, live, personal connections.
create index if not exists job_company_connections_source_idx
  on public.job_company_connections (user_id, source, enabled) where deleted_at is null;
create index if not exists job_company_connections_company_idx
  on public.job_company_connections (lower(btrim(company_name))) where deleted_at is null;
create index if not exists job_company_connections_deleted_at_idx
  on public.job_company_connections (deleted_at) where deleted_at is not null;
create index if not exists job_company_connections_custom_fields_idx
  on public.job_company_connections using gin (custom_fields jsonb_path_ops);

alter table public.job_company_connections enable row level security;

drop policy if exists "job_company_connections_select_own" on public.job_company_connections;
create policy "job_company_connections_select_own"
  on public.job_company_connections
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "job_company_connections_insert_own" on public.job_company_connections;
create policy "job_company_connections_insert_own"
  on public.job_company_connections
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "job_company_connections_update_own" on public.job_company_connections;
create policy "job_company_connections_update_own"
  on public.job_company_connections
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "job_company_connections_delete_own" on public.job_company_connections;
create policy "job_company_connections_delete_own"
  on public.job_company_connections
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace trigger job_company_connections_set_updated_at
  before update on public.job_company_connections
  for each row
  execute function public.set_updated_at();

-- Full CRUD for authenticated: genuinely user-editable, like
-- job_target_companies. anon deliberately gets nothing.
grant select, insert, update, delete on public.job_company_connections to authenticated;
