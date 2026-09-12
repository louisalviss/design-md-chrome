export function generateDesignMarkdown(context) {
  const { normalized, metadata = {} } = context;
  const siteProfile = normalized.siteProfile || {};
  const systemName = metadata.systemName || inferSystemName(normalized.source?.title);
  const brand = metadata.brand || systemName;
  const extractionUrl = normalized.source?.url || "Unknown URL";
  const audience = metadata.audience || siteProfile.audience || "website visitors and product users";
  const productSurface = metadata.productSurface || siteProfile.productSurface || "web app";

  const visualStyle = inferVisualStyle(normalized);
  const mainFontStyle = formatMainFontStyle(normalized.mainFontStyle);
  const typographyScale = joinTokens(normalized.typographyScale, 8);
  const colors = joinTokens(normalized.colorPalette, 10);
  const spacing = joinTokens(normalized.spacingScale, 8);
  const radiusShadowMotion = joinTokenGroups(
    [normalized.radiusTokens, normalized.shadowTokens, normalized.motionDurationTokens],
    8
  );
  const componentNotes = normalized.componentHints
    .map((item) => `${item.type} (${item.count})`)
    .join(", ");
  const diagnosticsNote = normalized.diagnostics.length
    ? `\n- Extraction diagnostics: ${normalized.diagnostics.join(" ")}`
    : "";

  const layout = normalized.layoutProfile || {};
  const cssVariablePreview = (normalized.cssVariables || []).slice(0, 12).map((row) => `\`${row.name}=${row.value}\``).join(", ") || "none captured";
  const breakpointPreview = (normalized.breakpoints?.queries || []).slice(0, 12).map((value) => `\`${value}\``).join(", ") || "none captured";

  return `# ${systemName}

## Evidence Classification
- **OBSERVED FROM SOURCE** = direct browser evidence. Safe to use as reconstruction input.
- **INFERRED — VERIFY** = derived classification or summary. Do not treat as exact source truth.
- **GENERIC GUIDANCE — NOT OBSERVED** = implementation defaults added by this tool, not properties extracted from the source website.

## Brand / Source
- Product/brand: ${brand}
- URL: ${extractionUrl}

## OBSERVED FROM SOURCE
### Style Foundations
- Main font style: ${mainFontStyle}
- Typography scale: ${typographyScale}
- Color palette: ${colors}
- Spacing scale: ${spacing}
- Radius/shadow/motion tokens: ${radiusShadowMotion}
- CSS variables (sample): ${cssVariablePreview}
- Readable media queries/breakpoints: ${breakpointPreview}

### Layout Evidence
- Extraction viewport: ${layout.viewport?.width || 0}×${layout.viewport?.height || 0} @ ${layout.viewport?.devicePixelRatio || 1}x
- Layout samples: ${layout.sampledLayouts || 0}; flex=${layout.flexCount || 0}; grid=${layout.gridCount || 0}; fixed/sticky=${layout.fixedOrStickyCount || 0}
- Known page component density: ${componentNotes || "not enough evidence from extraction"}.

## INFERRED — VERIFY
- Audience: ${audience}
- Product surface: ${productSurface}
- Visual style: ${visualStyle}
- These values are heuristic summaries and should be checked against the source before implementation.

## GENERIC GUIDANCE — NOT OBSERVED
### Accessibility Defaults
- Target: WCAG 2.2 AA.
- Keyboard interactions, focus-visible behavior, and contrast should be tested during implementation.
- Hover/focus/active styling must not be claimed as source-derived unless separately observed.

### Implementation Rules
- Prefer semantic tokens over scattered one-off values.
- Define responsive and edge-case behavior explicitly where source evidence is incomplete.
- Preserve observed tokens/layout first; use generic guidance only to fill genuine gaps.

### Reconstruction Workflow
1. Start from OBSERVED evidence and DESIGN.raw.json.
2. Reproduce structure, typography, color, spacing, radius, shadow, and layout evidence.
3. Validate responsive behavior against captured breakpoints where available.
4. Screenshot-diff the implementation against the source at matching viewport sizes.
5. Treat INFERRED values as hypotheses and GENERIC guidance as fallback only.
${diagnosticsNote}
`
}

function inferSystemName(title) {
  if (!title) {
    return "Extracted Design System";
  }
  const clean = title
    .replace(/\s*\|\s*.*/g, "")
    .replace(/\s*-\s*.*/g, "")
    .trim();
  return clean || "Extracted Design System";
}

function inferVisualStyle(normalized) {
  const colorCount = normalized.colorPalette.length;
  const spacingCount = normalized.spacingScale.length;
  if (colorCount >= 8 && spacingCount >= 6) {
    return "structured, tokenized, content-first";
  }
  if (colorCount >= 5) {
    return "clean, functional, implementation-oriented";
  }
  return "minimal, utility-first, accessibility-prioritized";
}

function formatMainFontStyle(mainFontStyle) {
  if (!mainFontStyle || !mainFontStyle.familyStack) {
    return "No reliable primary font family detected from computed styles.";
  }

  const family = `\`font.family.primary=${mainFontStyle.primaryFamily || mainFontStyle.familyStack}\``;
  const stack = mainFontStyle.familyStack ? `\`font.family.stack=${mainFontStyle.familyStack}\`` : "";
  const size = mainFontStyle.size ? `\`font.size.base=${mainFontStyle.size}\`` : "";
  const weight = mainFontStyle.weight ? `\`font.weight.base=${mainFontStyle.weight}\`` : "";
  const lineHeight = mainFontStyle.lineHeight ? `\`font.lineHeight.base=${mainFontStyle.lineHeight}\`` : "";

  return [family, stack, size, weight, lineHeight].filter(Boolean).join(", ");
}

function joinTokens(rows, limit) {
  if (!rows || rows.length === 0) {
    return "No reliable extraction yet; teams should define explicit semantic tokens manually.";
  }
  return rows
    .slice(0, limit)
    .map((row) => `\`${row.token}=${row.value}\``)
    .join(", ");
}

function joinTokenGroups(groups, limitPerGroup) {
  const lines = groups
    .filter((rows) => rows && rows.length > 0)
    .map((rows) => rows.slice(0, limitPerGroup).map((row) => `\`${row.token}=${row.value}\``).join(", "));
  if (lines.length === 0) {
    return "No reliable extraction yet; motion and shape tokens should be defined manually.";
  }
  return lines.join(" | ");
}
