# 003 — Three kinds of company intent, and why connections are split by source

**Status:** Accepted. The CRM side (data, management screen, red flag) is live. The agent-side
relaxation described below is being rolled out.

## Context

"I care about this company" can mean three different things, and each should change the agent's
behaviour differently.

| | Kind | Example | Effect |
|---|---|---|---|
| Search directions | semantic | "operations and data analysis roles, junior to mid" | Where to look |
| Target companies | literal | "read this employer's careers page" | Where to look; **does not** relax judgement |
| Connections | social | "a friend works here" | **Relaxes** judgement: a weaker fit is still worth seeing, because a warm introduction changes the odds |

## Decision

- **Three separate tables.** A connection has no careers URL and is never fetched. A target
  company is never a reason to relax a verdict.
- **Connections have a `source`:** `personal` (people I know) or `referrer_list` (a community
  sheet of volunteer referrers, many times larger).
  - Only `personal` rows ever reach the agent, and only they relax a verdict.
  - `referrer_list` is reference material the CRM shows and the agent never sees. It covers
    almost the whole market, so letting it count would make "relax" the default and the flag
    meaningless.
- **`contact_name` is nullable.** "I know there's a way in here, I need to find out who" is a
  real state, and a placeholder name would be fake data.
- **Phone and email are never selected for the model.** The agent never contacts anyone, so it
  has no use for a way to.
- **Imports are idempotent** thanks to a unique expression index on source, company and contact,
  which covers only live rows.

## Consequences

- The card badge is computed by the CRM from the table at render time, never from anything the
  agent wrote. See the README, section 4.
- A personal connection outranks a referrer-list match on the same card, because the two are not
  equivalent claims.
