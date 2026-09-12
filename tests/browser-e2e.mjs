import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import { generateDesignMarkdown } from "../lib/generate-design-md.mjs";
import { generateEvidenceJson } from "../lib/generate-evidence-json.mjs";
import { validateMarkdownOutput } from "../lib/validate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const contentScript = await fs.readFile(path.join(root, "content-script.js"), "utf8");

const html = `<!doctype html>
<html><head><style>
:root { --brand: #2563eb; --space-card: 24px; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, Arial, sans-serif; font-size: 16px; line-height: 24px; color: rgb(17,24,39); }
header { display:flex; align-items:center; gap:16px; height:64px; padding:0 24px; border-bottom:1px solid #e5e7eb; }
main { display:grid; grid-template-columns: 220px 1fr; gap:24px; padding:24px; }
.card { border:1px solid #e5e7eb; border-radius:12px; padding:24px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
button { background:var(--brand); color:white; border:0; border-radius:8px; padding:10px 16px; transition: transform 150ms ease-in-out; }
h1 { font-size:32px; line-height:40px; } h2 { font-size:20px; line-height:28px; }
 .media-shell { position:relative; width:320px; height:180px; overflow:hidden; border-radius:16px; background:linear-gradient(135deg,#111827,#2563eb); }
.media-shell img { width:100%; height:100%; object-fit:cover; opacity:.82; }
.badge { position:absolute; right:12px; bottom:12px; z-index:2; }
.floating { position:fixed; right:12px; bottom:12px; z-index:10; }
@media (max-width: 800px) { main { grid-template-columns: 1fr; } }
</style></head><body>
<header><strong>Canary</strong><nav><a href="#">Dashboard</a><a href="#">Reports</a></nav></header>
<main><aside class="card">Sidebar</aside><section><h1>Team Dashboard</h1><article class="card"><h2>Usage Analytics</h2><p>Workspace reports and billing.</p><button>Invite user</button></article><div class="media-shell"><img alt="fixture" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='%237c3aed'/%3E%3C/svg%3E"><span class="badge">Media</span></div></section></main>
<button class="floating">Help</button>
</body></html>`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await page.evaluate(() => {
    window.__extractListener = null;
    window.chrome = { runtime: { onMessage: { addListener(fn) { window.__extractListener = fn; } } } };
  });
  await page.addScriptTag({ content: contentScript });
  const payload = await page.evaluate(async () => new Promise((resolve, reject) => {
    const listener = window.__extractListener;
    if (!listener) return reject(new Error("extract listener missing"));
    listener({ type: "TYPEUI_EXTRACT_STYLES" }, null, (response) => response?.ok ? resolve(response.payload) : reject(new Error(response?.error || "extract failed")));
  }));

  const normalized = normalizeExtractedStyles(payload);
  const designMd = generateDesignMarkdown({ normalized, metadata: { systemName: "Browser Canary", brand: "Canary" } });
  const raw = JSON.parse(generateEvidenceJson(payload, normalized));
  const validation = validateMarkdownOutput("design", designMd);

  assert.ok(payload.sampledElements >= 10, "browser should sample visible elements");
  assert.equal(normalized.mainFontStyle.primaryFamily, "Inter", "computed font family should be observed");
  assert.ok(normalized.typographyScale.some((row) => row.value === "16px"), "computed px typography should be preserved");
  assert.ok(normalized.radiusTokens.some((row) => row.value === "12px"), "card radius should be observed");
  assert.ok(normalized.motionDurationTokens.some((row) => row.value === "150ms"), "real browser should resolve transition duration");
  assert.ok(normalized.cssVariables.some((row) => row.name === "--brand"), "CSS variables should be captured");
  assert.ok(normalized.breakpoints.queries.some((q) => q.includes("800px")), "readable media query should be captured");
  assert.ok(normalized.layoutProfile.gridCount >= 1, "grid layout evidence should be captured");
  assert.ok(normalized.layoutProfile.flexCount >= 1, "flex layout evidence should be captured");
  assert.equal(payload.spatialGraph?.schema, "design-spatial-v1", "spatial graph schema should be emitted");
  assert.ok(payload.spatialGraph?.relations?.some((row) => row.type === "contained-by"), "containment relationships should be captured");
  assert.ok(payload.spatialGraph?.relations?.some((row) => row.type === "overlaps"), "overlap relationships should be captured");
  assert.ok(payload.spatialGraph?.viewportAnchors?.some((row) => row.position === "fixed"), "fixed viewport anchors should be captured");
  assert.equal(payload.mediaMap?.schema, "design-media-map-v1", "media map schema should be emitted");
  assert.ok(payload.mediaMap?.items?.some((row) => row.kind === "img" && row.objectFit === "cover"), "image crop/object-fit should be captured");
  assert.ok(payload.mediaMap?.items?.some((row) => row.kind === "css-background" && row.backgroundKind === "gradient"), "CSS gradient media should be captured without copying asset URLs");
  assert.ok(payload.layouts.some((row) => row.documentRect && row.key), "layouts should include stable keys and document coordinates");
  assert.equal(raw.schema, "design-intelligence-evidence-v1", "raw evidence schema should be stable");
  assert.equal(raw.observed.evidence.hoverStateObserved, false, "unobserved pseudo states must stay explicit");
  assert.ok(designMd.includes("OBSERVED FROM SOURCE"), "design document must label observed evidence");
  assert.ok(designMd.includes("GENERIC GUIDANCE — NOT OBSERVED"), "generic guidance must be segregated");
  assert.ok(validation.isValid, validation.errors.join("; "));

  console.log(JSON.stringify({
    ok: true,
    sampledElements: payload.sampledElements,
    typography: normalized.typographyScale,
    motion: normalized.motionDurationTokens,
    cssVariables: normalized.cssVariables.slice(0, 8),
    breakpoints: normalized.breakpoints,
    layout: normalized.layoutProfile,
    spatial: { relations: payload.spatialGraph?.relations?.length, anchors: payload.spatialGraph?.viewportAnchors?.length, sections: payload.spatialGraph?.sections?.length },
    media: payload.mediaMap?.items?.map((row) => ({ key: row.key, kind: row.kind, objectFit: row.objectFit, backgroundKind: row.backgroundKind })).slice(0, 8),
    validation
  }, null, 2));
} finally {
  await browser.close();
}
