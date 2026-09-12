export function generateEvidenceJson(payload, normalized) {
  return JSON.stringify({
    schema: "design-intelligence-evidence-v1",
    generatedAt: new Date().toISOString(),
    source: payload.source || {},
    classification: {
      observed: "Direct browser observations and computed-style/layout evidence.",
      inferred: "Derived summaries; verify before treating as source truth.",
      generic: "Implementation guidance is never source evidence."
    },
    observed: payload,
    inferred: normalized
  }, null, 2);
}
