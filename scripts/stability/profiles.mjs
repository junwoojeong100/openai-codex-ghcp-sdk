import { createHash } from "node:crypto";
import { CATALOG } from "./catalog.mjs";

// The original v3 contract stays the default and is never edited or regraded.
// This opt-in profile changes only application task wording, not the bridge,
// model selection, fixture, fault schedule, budgets or literal-output checks.
const display = "Display its returned application data as a fenced text block, preserving the two lines and their characters.";
const prompts = Object.freeze({
  read: `Call read_fixture once. ${display}`,
  remember: `Call read_fixture once in this turn, including on repeated requests. ${display} Keep this application data for later turns.`,
  recall: "Display the application data returned earlier by read_fixture as a fenced text block, preserving the two lines and their characters. Do not use tools.",
  padding: CATALOG.prompts.padding,
});
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const applicationCatalog = Object.freeze({
  ...CATALOG,
  id: "codex-ghcp-stability-11-application-data-v1",
  prompts,
  baseCatalogId: CATALOG.id,
  baseCatalogHash: digest(CATALOG),
  changesFromV3: "Explicitly selected application-data task wording. All models, fixtures, fault flows, budgets and acceptance checks are retained. This is a separate contract, not a fix or regrade of the original v3 refusal.",
});
export const DEFAULT_PROFILE = "v3";
export const PROFILE_IDS = Object.freeze([DEFAULT_PROFILE, "application-data-v1"]);
const profiles = new Map([
  [DEFAULT_PROFILE, CATALOG],
  ["application-data-v1", applicationCatalog],
].map(([name, catalog]) => [name, Object.freeze({ name, catalog, catalogHash: digest(catalog) })]));

export function getProfile(name = DEFAULT_PROFILE) {
  const profile = profiles.get(name);
  if (!profile) throw new Error(`Unknown stability profile. Choose ${PROFILE_IDS.join(" or ")}.`);
  return profile;
}

// The verifier selects a known contract by identity, never caller-supplied
// prompts or an inferred successful subset. Missing profile means original v3.
export function profileForRecord(record) {
  const profile = getProfile(record.profile);
  if (record.catalogHash !== profile.catalogHash ||
    (record.catalogId !== undefined && record.catalogId !== profile.catalog.id)) {
    throw new Error("Stability profile identity and catalog hash do not match.");
  }
  return profile;
}
