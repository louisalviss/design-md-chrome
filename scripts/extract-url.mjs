import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import { generateDesignMarkdown } from "../lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "../lib/generate-skill-md.mjs";
import { generateEvidenceJson } from "../lib/generate-evidence-json.mjs";
import { validateMarkdownOutput } from "../lib/validate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {
    url: "", outDir: "design-reference", width: 1440, height: 1000, timeoutMs: 45000, screenshot: true,
    preset: "", widthExplicit: false, heightExplicit: false, multiState: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") out.url = argv[++i] || "";
    else if (arg === "--out") out.outDir = argv[++i] || "";
    else if (arg === "--preset") out.preset = argv[++i] || "";
    else if (arg === "--width") { out.width = Number(argv[++i]); out.widthExplicit = true; }
    else if (arg === "--height") { out.height = Number(argv[++i]); out.heightExplicit = true; }
    else if (arg === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (arg === "--no-screenshot") out.screenshot = false;
    else if (arg === "--multi-state") out.multiState = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (out.preset === "android-pixel6") {
    if (!out.widthExplicit) out.width = 412;
    if (!out.heightExplicit) out.height = 915;
  }
  return out;
}

function validateOptions(options) {
  if (options.help) return;
  let parsed;
  try { parsed = new URL(options.url); } catch { throw new Error("--url must be a valid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("--url must use http or https");
  if (parsed.username || parsed.password) throw new Error("credentials embedded in --url are not allowed");
  if (options.preset && options.preset !== "android-pixel6") throw new Error("--preset must be android-pixel6 when set");
  if (!Number.isInteger(options.width) || options.width < 320 || options.width > 3840) throw new Error("--width must be an integer in [320,3840]");
  if (!Number.isInteger(options.height) || options.height < 320 || options.height > 2160) throw new Error("--height must be an integer in [320,2160]");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 5000 || options.timeoutMs > 120000) throw new Error("--timeout-ms must be an integer in [5000,120000]");
  if (!options.outDir) throw new Error("--out must not be empty");
}

function sha256(data) { return crypto.createHash("sha256").update(data).digest("hex"); }

async function invokeExtraction(page) {
  return page.evaluate(async () => new Promise((resolve, reject) => {
    const listener = window.__extractListener;
    if (!listener) return reject(new Error("extract listener missing"));
    listener({ type: "TYPEUI_EXTRACT_STYLES" }, null, (response) => response?.ok ? resolve(response.payload) : reject(new Error(response?.error || "extract failed")));
  }));
}

function stateEvidence(payload) {
  return {
    capturedAt: payload.sampledAt,
    viewport: payload.viewport,
    scroll: payload.scroll,
    layouts: payload.layouts || [],
    spatialGraph: payload.spatialGraph || null,
    mediaMap: payload.mediaMap || null
  };
}

function rectDelta(a = {}, b = {}) {
  return Math.max(
    Math.abs((a.x || 0) - (b.x || 0)),
    Math.abs((a.y || 0) - (b.y || 0)),
    Math.abs((a.width || 0) - (b.width || 0)),
    Math.abs((a.height || 0) - (b.height || 0))
  );
}

function buildMotionEvidence(states) {
  const baseline = states[0];
  const baselineLayouts = new Map((baseline?.evidence.layouts || []).map((row) => [row.key, row]));
  const baselineMedia = new Map((baseline?.evidence.mediaMap?.items || []).map((row) => [row.key, row]));
  const changes = [];
  for (const state of states.slice(1)) {
    const currentLayouts = new Map((state.evidence.layouts || []).map((row) => [row.key, row]));
    for (const [key, base] of baselineLayouts) {
      const current = currentLayouts.get(key);
      if (!current) continue;
      const geometryDelta = rectDelta(base.documentRect, current.documentRect);
      const visualChanged = base.transform !== current.transform || base.opacity !== current.opacity || base.position !== current.position;
      if (geometryDelta >= 2 || visualChanged) {
        changes.push({
          state: state.name,
          key,
          kind: "layout",
          geometryDelta: Math.round(geometryDelta * 100) / 100,
          transformChanged: base.transform !== current.transform,
          opacityChanged: base.opacity !== current.opacity,
          positionChanged: base.position !== current.position
        });
      }
    }
    const currentMedia = new Map((state.evidence.mediaMap?.items || []).map((row) => [row.key, row]));
    for (const [key, base] of baselineMedia) {
      const current = currentMedia.get(key);
      if (!current) continue;
      const geometryDelta = rectDelta(base.documentRect, current.documentRect);
      const visualChanged = base.transform !== current.transform || base.opacity !== current.opacity || base.objectFit !== current.objectFit || base.objectPosition !== current.objectPosition;
      if (geometryDelta >= 2 || visualChanged) {
        changes.push({
          state: state.name,
          key,
          kind: "media",
          geometryDelta: Math.round(geometryDelta * 100) / 100,
          transformChanged: base.transform !== current.transform,
          opacityChanged: base.opacity !== current.opacity,
          objectFitChanged: base.objectFit !== current.objectFit,
          objectPositionChanged: base.objectPosition !== current.objectPosition
        });
      }
    }
  }
  const dynamicKeys = [...new Set(changes.map((row) => row.key))];
  return {
    schema: "design-motion-v1",
    captured: true,
    baseline: baseline?.name || null,
    stateCount: states.length,
    states: states.map((state) => ({ name: state.name, scroll: state.evidence.scroll, screenshot: state.screenshot || null, json: state.json })),
    dynamicElementCount: dynamicKeys.length,
    dynamicElementKeys: dynamicKeys.slice(0, 240),
    changes: changes.slice(0, 1200)
  };
}

async function writeState({ page, payload, name, statesDir, screenshot }) {
  const evidence = stateEvidence(payload);
  const jsonName = `states/${name}.json`;
  const jsonPath = path.join(statesDir, `${name}.json`);
  const jsonBody = JSON.stringify({ schema: "design-state-v1", name, ...evidence }, null, 2) + "\n";
  await fs.writeFile(jsonPath, jsonBody, "utf8");
  let screenshotName = null;
  let screenshotBytes = null;
  if (screenshot) {
    screenshotName = `states/${name}.png`;
    screenshotBytes = await page.screenshot({ path: path.join(statesDir, `${name}.png`), fullPage: false });
  }
  return { name, evidence, json: jsonName, jsonBody, screenshot: screenshotName, screenshotBytes };
}

async function captureMultiState({ page, baselinePayload, outDir, screenshot }) {
  const statesDir = path.join(outDir, "states");
  await fs.mkdir(statesDir, { recursive: true });
  const states = [];
  states.push(await writeState({ page, payload: baselinePayload, name: "t000", statesDir, screenshot }));
  for (const [delay, name] of [[500, "t0500"], [500, "t1000"], [1000, "t2000"], [2000, "t4000"]]) {
    await page.waitForTimeout(delay);
    states.push(await writeState({ page, payload: await invokeExtraction(page), name, statesDir, screenshot }));
  }
  const maxScroll = await page.evaluate(() => Math.max(0, Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0) - window.innerHeight));
  for (const [fraction, name] of [[0.25, "scroll25"], [0.5, "scroll50"], [0.75, "scroll75"]]) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(maxScroll * fraction));
    await page.waitForTimeout(350);
    states.push(await writeState({ page, payload: await invokeExtraction(page), name, statesDir, screenshot }));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const motion = buildMotionEvidence(states);
  const index = {
    schema: "design-state-index-v1",
    count: states.length,
    states: states.map((state) => ({ name: state.name, scroll: state.evidence.scroll, screenshot: state.screenshot, json: state.json }))
  };
  return { states, motion, index };
}

async function extract(options) {
  const contentScript = await fs.readFile(path.join(root, "content-script.js"), "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: options.width, height: options.height } });
    page.setDefaultTimeout(options.timeoutMs);
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.__typeuiStyleExtractorInstalled = false;
      window.__extractListener = null;
      window.chrome = { runtime: { onMessage: { addListener(fn) { window.__extractListener = fn; } } } };
    });
    await page.addScriptTag({ content: contentScript });
    const payload = await invokeExtraction(page);
    const normalized = normalizeExtractedStyles(payload);
    const designMd = generateDesignMarkdown({ normalized });
    const skillMd = generateSkillMarkdown({ normalized });
    const rawJson = generateEvidenceJson(payload, normalized);
    const designValidation = validateMarkdownOutput("design", designMd);
    const skillValidation = validateMarkdownOutput("skill", skillMd);
    if (!designValidation.isValid || !skillValidation.isValid) {
      throw new Error(`generated output failed validation: ${[...designValidation.errors, ...skillValidation.errors].join("; ")}`);
    }

    const outDir = path.resolve(options.outDir);
    await fs.mkdir(outDir, { recursive: true });
    const spatialJson = JSON.stringify(payload.spatialGraph || { schema: "design-spatial-v1", coordinateSpace: "document-css-px", relations: [], viewportAnchors: [], sections: [] }, null, 2) + "\n";
    const mediaMapJson = JSON.stringify(payload.mediaMap || { schema: "design-media-map-v1", items: [] }, null, 2) + "\n";
    let motionJson = JSON.stringify({ schema: "design-motion-v1", captured: false, reason: "Run with --multi-state to capture temporal and scroll states." }, null, 2) + "\n";
    const textFiles = {
      "DESIGN.raw.json": rawJson,
      "DESIGN.md": designMd,
      "SKILL.md": skillMd,
      "spatial.json": spatialJson,
      "media-map.json": mediaMapJson,
      "motion.json": motionJson
    };
    for (const [name, body] of Object.entries(textFiles)) await fs.writeFile(path.join(outDir, name), body, "utf8");

    const fileProofs = Object.fromEntries(
      Object.entries(textFiles).map(([name, body]) => [name, { sha256: sha256(body), bytes: Buffer.byteLength(body) }])
    );
    if (options.screenshot) {
      const viewportShot = await page.screenshot({ path: path.join(outDir, "source.png"), fullPage: false });
      const fullShot = await page.screenshot({ path: path.join(outDir, "source-full.png"), fullPage: true });
      fileProofs["source.png"] = { sha256: sha256(viewportShot), bytes: viewportShot.byteLength };
      fileProofs["source-full.png"] = { sha256: sha256(fullShot), bytes: fullShot.byteLength };
    }

    let multiStateSummary = null;
    if (options.multiState) {
      const captured = await captureMultiState({ page, baselinePayload: payload, outDir, screenshot: options.screenshot });
      motionJson = JSON.stringify(captured.motion, null, 2) + "\n";
      await fs.writeFile(path.join(outDir, "motion.json"), motionJson, "utf8");
      fileProofs["motion.json"] = { sha256: sha256(motionJson), bytes: Buffer.byteLength(motionJson) };
      const stateIndexBody = JSON.stringify(captured.index, null, 2) + "\n";
      await fs.writeFile(path.join(outDir, "states", "index.json"), stateIndexBody, "utf8");
      fileProofs["states/index.json"] = { sha256: sha256(stateIndexBody), bytes: Buffer.byteLength(stateIndexBody) };
      for (const state of captured.states) {
        fileProofs[state.json] = { sha256: sha256(state.jsonBody), bytes: Buffer.byteLength(state.jsonBody) };
        if (state.screenshot && state.screenshotBytes) fileProofs[state.screenshot] = { sha256: sha256(state.screenshotBytes), bytes: state.screenshotBytes.byteLength };
      }
      multiStateSummary = {
        captured: true,
        state_count: captured.states.length,
        dynamic_element_count: captured.motion.dynamicElementCount,
        index: "states/index.json",
        motion: "motion.json"
      };
    }

    const summary = {
      ok: true,
      schema: "design-reference-run-v1",
      preset: options.preset || null,
      requested_url: options.url,
      resolved_url: page.url(),
      viewport: { width: options.width, height: options.height },
      sampled_elements: payload.sampledElements,
      capabilities: {
        spatial_graph: true,
        media_map: true,
        multi_state: options.multiState
      },
      multi_state: multiStateSummary,
      files: fileProofs,
      screenshot: options.screenshot ? "source.png" : null,
      screenshot_mode: options.screenshot ? "viewport" : null,
      full_screenshot: options.screenshot ? "source-full.png" : null,
      design_validation: designValidation,
      skill_validation: skillValidation
    };
    await fs.writeFile(path.join(outDir, "run.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
    return summary;
  } finally {
    await browser.close();
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log("Usage: node scripts/extract-url.mjs --url <https://...> [--out design-reference] [--preset android-pixel6] [--width 1440] [--height 1000] [--timeout-ms 45000] [--multi-state] [--no-screenshot]");
  process.exit(0);
}
validateOptions(options);
const result = await extract(options);
console.log(JSON.stringify(result, null, 2));
