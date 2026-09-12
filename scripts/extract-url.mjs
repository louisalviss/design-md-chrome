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
  const out = { url: "", outDir: "design-reference", width: 1440, height: 1000, timeoutMs: 45000, screenshot: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") out.url = argv[++i] || "";
    else if (arg === "--out") out.outDir = argv[++i] || "";
    else if (arg === "--width") out.width = Number(argv[++i]);
    else if (arg === "--height") out.height = Number(argv[++i]);
    else if (arg === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (arg === "--no-screenshot") out.screenshot = false;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function validateOptions(options) {
  if (options.help) return;
  let parsed;
  try { parsed = new URL(options.url); } catch { throw new Error("--url must be a valid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("--url must use http or https");
  if (parsed.username || parsed.password) throw new Error("credentials embedded in --url are not allowed");
  if (!Number.isInteger(options.width) || options.width < 320 || options.width > 3840) throw new Error("--width must be an integer in [320,3840]");
  if (!Number.isInteger(options.height) || options.height < 320 || options.height > 2160) throw new Error("--height must be an integer in [320,2160]");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 5000 || options.timeoutMs > 120000) throw new Error("--timeout-ms must be an integer in [5000,120000]");
  if (!options.outDir) throw new Error("--out must not be empty");
}

function sha256(data) { return crypto.createHash("sha256").update(data).digest("hex"); }

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
    const payload = await page.evaluate(async () => new Promise((resolve, reject) => {
      const listener = window.__extractListener;
      if (!listener) return reject(new Error("extract listener missing"));
      listener({ type: "TYPEUI_EXTRACT_STYLES" }, null, (response) => response?.ok ? resolve(response.payload) : reject(new Error(response?.error || "extract failed")));
    }));
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
    const files = {
      "DESIGN.raw.json": rawJson,
      "DESIGN.md": designMd,
      "SKILL.md": skillMd
    };
    for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(outDir, name), body, "utf8");
    if (options.screenshot) await page.screenshot({ path: path.join(outDir, "source.png"), fullPage: true });
    const summary = {
      ok: true,
      schema: "design-reference-run-v1",
      requested_url: options.url,
      resolved_url: page.url(),
      viewport: { width: options.width, height: options.height },
      sampled_elements: payload.sampledElements,
      files: Object.fromEntries(Object.entries(files).map(([name, body]) => [name, { sha256: sha256(body), bytes: Buffer.byteLength(body) }])),
      screenshot: options.screenshot ? "source.png" : null,
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
  console.log("Usage: node scripts/extract-url.mjs --url <https://...> [--out design-reference] [--width 1440] [--height 1000] [--timeout-ms 45000] [--no-screenshot]");
  process.exit(0);
}
validateOptions(options);
const result = await extract(options);
console.log(JSON.stringify(result, null, 2));
