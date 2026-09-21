// Deterministic projections used both when writing and independently verifying
// evidence. A saved check flag is never an oracle input.
export function artifactContents(config, scenario, evidence, checks, status) {
  const json = value => JSON.stringify(value, null, 2) + "\n";
  const lines = value => value.map(row => JSON.stringify(row)).join("\n") + "\n";
  const contents = {
    "observation.json": json(evidence),
    "case.json": json({ runId: config.runId, scenarioId: scenario.id, provider: config.provider, model: config.model,
      catalogHash: config.catalogHash, fixtureHash: evidence.fixtureHash, prompts: evidence.logicalPrompts, timeoutSeconds: scenario.timeoutSeconds }),
    "native.jsonl": lines(evidence.native || []), "transport.jsonl": lines(evidence.transport || []), "sdk.jsonl": lines(evidence.sdk || []),
    "oracle.json": json({ checks, result: status }),
    "state.json": json({ before: evidence.before, after: evidence.after, protectedBefore: evidence.protectedBefore, protectedAfter: evidence.protectedAfter,
      gitBefore: evidence.gitBefore, gitAfter: evidence.gitAfter }),
    "resources.json": json(evidence.resources || {}),
  };
  const extras = {
    "routing.json": { hosts: evidence.hosts, sdk: evidence.sdk }, "diff.patch": evidence.diff || "",
    "test-results.json": { native: evidence.native, independent: evidence.independentTest }, "tool-ledger.json": evidence.toolLedger,
    "approvals.json": evidence.approvals, "sandbox.json": { preflight: evidence.sandboxPreflight, resources: evidence.resources },
    "resume.json": { restart: evidence.restart, phases: evidence.phases },
    "skill.json": evidence.skill || {}, "mcp.json": evidence.mcp || {},
    "launcher.json": evidence.launcher || {}, "clarification.json": evidence.clarifications || [],
    "compaction.json": evidence.compaction || {}, "interruption.json": evidence.interruption || {},
    "agents.json": { native: evidence.native, sdk: evidence.sdk }, "retry.json": { retry: evidence.retry, transport: evidence.transport },
    "review.json": { native: evidence.native, diff: evidence.diff },
  };
  for (const name of new Set(scenario.assertions.map(a => a.evidence))) if (!contents[name]) {
    const value = extras[name] ?? evidence; contents[name] = typeof value === "string" ? value : json(value);
  }
  return contents;
}
