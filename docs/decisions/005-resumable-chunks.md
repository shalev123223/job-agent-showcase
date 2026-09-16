# 005 — The runtime is an Edge Function running bounded, resumable chunks

**Status:** Accepted. Supersedes the earlier choice of a managed-agent platform.

## Context

The agent originally ran on a managed-agent platform, chosen because nothing else could host a
long-lived loop. Two things changed:

- The tool server already ran on an always-on Supabase Edge Function.
- I wanted on-demand buttons in the CRM rather than a schedule.

Moving the loop to an Edge Function removed a beta dependency, but it raised a new constraint:
**a single invocation is capped at 150 seconds**, and a real run doesn't fit.

## Decision

- **One conversation, many chunks.** Each call advances the run by one chunk. The message history
  is saved to the run record and reloaded in the next chunk, so the model truly continues. Using
  a fresh, short conversation per step would turn the agent back into a fixed workflow.
- **Yield before overrunning.** A chunk yields when its remaining time couldn't cover the next
  turn or tool call. This is the same "check before spending" rule the budget applies to money.
  A yield is not terminal; only completion, the cost ceiling or the turn ceiling close a run.
- **The CRM drives the sequence** while a run is in progress. Closing the tab only pauses it.
- **What the platform used to provide is replaced deliberately:** a pre-flight dollar cap
  (instead of the platform's cap) and a same-mode lease (instead of overlap prevention).
- **Two functions, two tokens:** one for the run trigger and one for the tool server, so each
  credential can do less damage if it leaks.

## Consequences

- A run needs the tab open, or reopened, to finish. This is a different guarantee from a
  scheduled run, and it is stated upfront.
- Resuming is cheap, because deduplication and the "only unenriched" filter make "press it again
  later" safe.
- If chunking becomes too tight, the fix is a runtime swap: every runtime calls the same
  `executeRun`.
