# 002 — The agent sends a verdict; the server writes the posting

**Status:** Accepted

## Context

The first real production run exposed two problems with letting the model send back complete
job records:

1. **Paraphrase.** The `description` column was meant to hold the employer's own words, but it
   held the model's summary of them. The instruction "copy it verbatim" was not a guarantee.
2. **Cost.** Every full ad travelled through the conversation twice, once in and once back out.
   That round trip took a $1.50 run to $2.02.

## Decision

- `search_jobs` caches the full fetched postings on the run record, and the model sees excerpts.
- `save_jobs` accepts only `external_id`, an optional score, a rationale and the search direction.
- The server looks each ID up in the run's cache and writes the title, company, URL, location and
  the full description **from the cache**.
- An ID the run never fetched is rejected and named, so the agent can correct itself.
- Dry-run fixture jobs are refused at this boundary, so test data can never be saved as real
  postings.
- Provenance (LinkedIn or the company's own site) is also taken from the cache, never from the
  model.

## Consequences

- Verbatim descriptions are guaranteed by the code, not by an instruction.
- Runs are cheaper, and the conversation stays focused on judgement.
- Both discovery channels, LinkedIn and company-direct, enter through the same cache and the same
  save path, so there is only one set of rules to maintain.
