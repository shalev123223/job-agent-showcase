// Portfolio excerpt from Job Agent (src/mcp/tools/index.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import type { ToolDefinition } from "@/mcp/tools/types.ts";
import { getCandidateProfile } from "@/mcp/tools/get-candidate-profile.ts";
import { getSearchDirections } from "@/mcp/tools/get-search-directions.ts";
import { searchJobs } from "@/mcp/tools/search-jobs.ts";
import { checkJobsExist } from "@/mcp/tools/check-jobs-exist.ts";
import { saveJobs } from "@/mcp/tools/save-jobs.ts";
import { getFeedbackHistory } from "@/mcp/tools/get-feedback-history.ts";
import { getRecentSearches } from "@/mcp/tools/get-recent-searches.ts";
import { recordRunEvent } from "@/mcp/tools/record-run-event.ts";
import { getResumes } from "@/mcp/tools/get-resumes.ts";
import { listJobs } from "@/mcp/tools/list-jobs.ts";
import { enrichJob } from "@/mcp/tools/enrich-job.ts";
import { getTargetCompanies } from "@/mcp/tools/get-target-companies.ts";
import { fetchCompanyPage } from "@/mcp/tools/fetch-company-page.ts";
import { fetchCompanyJobs } from "@/mcp/tools/fetch-company-jobs.ts";

/**
 * The complete tool surface (docs/AI_AGENT.md).
 *
 * Adding one is a deliberate decision that gets recorded in docs/AI_AGENT.md
 * (CLAUDE.md rule 3) and, where it changes what the agent can write,
 * docs/DECISIONS.md — this array is the enforcement point. Anything not here
 * is not reachable by the agent, whatever it asks for.
 *
 * Note what is absent and must stay absent: no SQL, no schema access, no
 * arbitrary HTTP, no actor selection, no write path to job_feedback, and no
 * send capability of any kind. `fetch_company_page` and `fetch_company_jobs`
 * are NOT an exception to "no arbitrary HTTP": each takes a company_id and a
 * path, and the origin is read from the job_target_companies row Shalev wrote
 * (ADR-025). There is still no tool here that fetches a URL the model chose. `enrich_job` (ADR-024, added alongside the
 * other stage-2 tools) is the one write path onto an already-saved job, and
 * it is narrowly scoped to a single JSONB key — not a general update tool.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous input types
export const allTools: ToolDefinition<any>[] = [
  getCandidateProfile,
  getSearchDirections,
  searchJobs,
  checkJobsExist,
  saveJobs,
  getFeedbackHistory,
  getRecentSearches,
  recordRunEvent,
  getResumes,
  listJobs,
  enrichJob,
  getTargetCompanies,
  fetchCompanyPage,
  fetchCompanyJobs,
];

export const TOOL_NAMES = allTools.map((tool) => tool.name);

export {
  getCandidateProfile,
  getSearchDirections,
  searchJobs,
  checkJobsExist,
  saveJobs,
  getFeedbackHistory,
  getRecentSearches,
  recordRunEvent,
  getResumes,
  listJobs,
  enrichJob,
  getTargetCompanies,
  fetchCompanyPage,
  fetchCompanyJobs,
};
