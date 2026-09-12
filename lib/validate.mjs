const LEGACY_REQUIRED_HEADINGS = [
  "## Mission",
  "## Brand",
  "## Style Foundations",
  "## Accessibility",
  "## Writing Tone",
  "## Rules: Do",
  "## Rules: Don't",
  "## Guideline Authoring Workflow",
  "## Required Output Structure",
  "## Component Rule Expectations",
  "## Quality Gates"
];

const DESIGN_EVIDENCE_HEADINGS = [
  "## Evidence Classification",
  "## Brand / Source",
  "## OBSERVED FROM SOURCE",
  "## INFERRED — VERIFY",
  "## GENERIC GUIDANCE — NOT OBSERVED"
];

const SKILL_EVIDENCE_HEADINGS = [
  "## Mission",
  "## Evidence Classification",
  "## Brand",
  "## OBSERVED FROM SOURCE — Style Foundations",
  "## INFERRED — VERIFY",
  "## GENERIC GUIDANCE — NOT OBSERVED"
];

const REQUIRED_STATES = [
  "default",
  "hover",
  "focus-visible",
  "active",
  "disabled",
  "loading",
  "error"
];

export function validateMarkdownOutput(mode, markdown) {
  const errors = [];
  const warnings = [];
  const checks = [];

  if (mode === "skill") {
    runCheck(markdown.startsWith("---"), "Frontmatter block exists", checks, errors);
    runCheck(markdown.includes("name: design-system-"), "Frontmatter includes design-system name", checks, errors);
    runCheck(markdown.includes("description:"), "Frontmatter includes description", checks, errors);
    runCheck(
      markdown.includes("<!-- TYPEUI_SH_MANAGED_START -->") &&
        markdown.includes("<!-- TYPEUI_SH_MANAGED_END -->"),
      "Managed block markers exist",
      checks,
      errors
    );
  }

  const evidenceHeadings = mode === "skill" ? SKILL_EVIDENCE_HEADINGS : DESIGN_EVIDENCE_HEADINGS;
  const usesEvidenceSchema = evidenceHeadings.every((heading) => markdown.includes(heading));
  const usesLegacySchema = LEGACY_REQUIRED_HEADINGS.every((heading) => markdown.includes(heading));
  runCheck(
    usesEvidenceSchema || usesLegacySchema,
    `Recognized ${mode === "skill" ? "SKILL" : "DESIGN"} document schema`,
    checks,
    errors
  );

  for (const state of REQUIRED_STATES) {
    if (!markdown.toLowerCase().includes(state)) {
      warnings.push(`Missing explicit state mention: ${state}`);
    }
  }

  if (!markdown.includes("WCAG 2.2 AA")) {
    errors.push("Accessibility target 'WCAG 2.2 AA' is missing.");
  } else {
    checks.push({ label: "Accessibility target included", ok: true });
  }

  if (!markdown.includes("must")) {
    warnings.push("No 'must' wording detected for non-negotiable rules.");
  } else {
    checks.push({ label: "Contains non-negotiable rule wording", ok: true });
  }

  if (!markdown.includes("should")) {
    warnings.push("No 'should' wording detected for recommendation rules.");
  } else {
    checks.push({ label: "Contains recommendation wording", ok: true });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    checks
  };
}

function runCheck(condition, label, checks, errors) {
  if (condition) {
    checks.push({ label, ok: true });
    return;
  }
  checks.push({ label, ok: false });
  errors.push(label);
}
