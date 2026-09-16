# 004 — Feedback has two axes; system facts are neither

**Status:** Accepted

## Context

The previous generation's tracking sheet used a single "Decision" vocabulary: *Selected,
Not Relevant, Too Senior, Duplicate, Repost, Already Applied, Closed, Location Mismatch, …*
It was expressive, but it mixed three different kinds of statement:

| Kind | Example | Who asserts it |
|---|---|---|
| A decision | Submitted, Not relevant | me |
| A reason for rejecting | Too senior, Location mismatch | me |
| A fact about the posting | Duplicate, Repost, Closed | the system |

Merging them corrupts the signal the agent learns from. "Rejected 40 jobs" is wrong if 30 of
them were stale listings I never judged.

## Decision

1. **`decision`** has exactly two values, `submitted` and `not_relevant`. They drive the two
   primary buttons and the job's status.
2. **`reason`** is optional, structured and allowed only on `not_relevant`. A `submitted` row
   with `too_senior` can't be stored at all; it isn't just discouraged.
3. **System facts stay out.** Duplicates are prevented by a unique index. "Reposted" and "closed"
   would belong on the posting if they are ever modelled.
4. **Append-only.** Adding a reason later means inserting a new row, and the current decision is
   the latest row.
5. **A `seq` identity column** makes "latest" a total order. `now()` is transaction-scoped in
   Postgres, so rows written in one transaction share a timestamp. A dry run reproduced this and
   returned the wrong row.

## Consequences

- Adding a new reason is a one-line migration. Adding a new decision is a breaking change for
  both repositories, which is the asymmetry I want: one should be cheap and one should hurt.
- Clearing stale listings is a soft delete **without** a feedback row, so housekeeping never
  looks like judgement.
- The agent can tell "too senior" from "wrong industry" and adjust differently for each.
