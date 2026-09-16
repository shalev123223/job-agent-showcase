// Portfolio excerpt from Job Agent (Shalev CRM: src/components/jobs/ApplyPanel.test.tsx — structural "never sends" tests). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApplyPanel } from "@/components/jobs/ApplyPanel";
import type { Stage2 } from "@/lib/data/job-feedback";
import type { Resume } from "@/lib/actions/resumes";

/**
 * THIS FILE IS THE UI HALF OF CLAUDE.md RULE 11.
 *
 * The agent repo enforces "no send capability" at the tool boundary
 * (src/mcp/tools/tools.test.ts). This enforces it on the one surface in this app
 * where adding "just a quick submit button" will one day look reasonable: a
 * panel that already holds a finished cover letter next to an apply link.
 *
 * If a future change makes these fail, that is the point. Read ADR-032 before
 * deleting them.
 */

const stage2: Stage2 = {
  matchedResumeLabel: "Data/BI focus",
  matchedResumeSlot: 2,
  resumeMatchScore: 82,
  personalNote: "Close to the automation work he already does.",
  coverLetter: "שלום,\nראיתי את המשרה ואני מתאים לה כי...",
  coverLetterLanguage: "he",
  contactName: "Example Contact",
  contactUrl: "https://www.linkedin.com/in/example-contact",
  contactSource: "posting_text",
  enrichedAt: "2026-09-01T10:00:00.000Z",
};

const resumes: Resume[] = [
  {
    id: "r2",
    slot: 2,
    label: "Data/BI focus",
    content: "(example resume text)",
    enabled: true,
    updatedAt: "2026-08-30T10:00:00.000Z",
  },
];

function renderPanel(overrides: Partial<Stage2> = {}) {
  return render(
    <ApplyPanel
      stage2={{ ...stage2, ...overrides }}
      jobUrl="https://www.linkedin.com/jobs/view/123"
      resumes={resumes}
      standingAnswers={{ salary_expectation: "(example answer)" }}
    />,
  );
}

describe("ApplyPanel — prepares, never sends (rule 11)", () => {
  it("renders no form", () => {
    const { container } = renderPanel();
    expect(container.querySelector("form")).toBeNull();
  });

  it("renders no input of any kind — nothing here is fillable", () => {
    const { container } = renderPanel();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("select")).toBeNull();
  });

  it("has no submit button", () => {
    const { container } = renderPanel();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it("opens every external link safely, in a new tab", () => {
    const { container } = renderPanel();
    const external = [...container.querySelectorAll("a")].filter((a) =>
      a.getAttribute("href")?.startsWith("http"),
    );
    expect(external.length).toBeGreaterThan(0);
    for (const anchor of external) {
      expect(anchor.getAttribute("target")).toBe("_blank");
      expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });
});

describe("ApplyPanel — what it shows", () => {
  it("shows the matched resume, its score, and the letter", () => {
    renderPanel();
    expect(screen.getByText("Data/BI focus")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText(/ראיתי את המשרה/)).toBeInTheDocument();
  });

  it("sets rtl on a Hebrew letter so it is readable", () => {
    const { container } = renderPanel();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });

  it("sets ltr on an English one", () => {
    const { container } = renderPanel({ coverLetterLanguage: "en", coverLetter: "Dear team," });
    expect(container.querySelector('[dir="ltr"]')).not.toBeNull();
  });

  it("says so plainly when no resume fitted, rather than rendering an empty slot", () => {
    renderPanel({ matchedResumeLabel: null, matchedResumeSlot: null, coverLetter: null });
    expect(screen.getByText(/No resume fitted this one/)).toBeInTheDocument();
  });

  it("flags a resume renamed since the run instead of silently showing nothing", () => {
    renderPanel({ matchedResumeSlot: 3, matchedResumeLabel: "Old name" });
    expect(screen.getByText(/no longer one of your resume slots/)).toBeInTheDocument();
  });

  it("never renders a contact_url that survived neither scheme check", () => {
    // readStage2 nulls a non-http(s) URL before it reaches here; this asserts
    // the panel does not resurrect one from the name alone.
    const { container } = renderPanel({ contactUrl: null });
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((href) => href.startsWith("javascript:"))).toBe(false);
  });
});
