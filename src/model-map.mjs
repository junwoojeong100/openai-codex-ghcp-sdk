// This order is also the fixed Codex /model picker order.
export const SUPPORTED_MODEL_IDS = Object.freeze([
  "claude-opus-5.5",
  "claude-sonnet-5",
  "claude-haiku-4.5",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
]);
export const DEFAULT_MODEL = "gpt-6-astra";

export class ModelUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelUnavailableError";
    this.status = 400;
    this.code = "model_unavailable";
  }
}

export function supportedModels(models) {
  return SUPPORTED_MODEL_IDS.flatMap((id) => {
    const model = models.find((entry) => entry.id === id);
    return model ? [model] : [];
  });
}

function reasoningEfforts(model) {
  if (model?.capabilities?.supports?.reasoningEffort === false) return [];
  return [...new Set([
    ...(model?.supportedReasoningEfforts || []),
    ...(model?.capabilities?.supportedReasoningEfforts || []),
  ])];
}

function contextBudget(model) {
  const limits = model.capabilities?.limits || {};
  // Sessions use the default SDK tier, not the advertised long-context maximum.
  const prices = model.billing?.tokenPrices;
  const defaultTier = prices?.longContext ? prices : {};
  const budgets = [
    limits.max_context_window_tokens,
    limits.max_prompt_tokens,
    defaultTier.maxPromptTokens,
    defaultTier.contextMax,
  ].filter(value => Number.isSafeInteger(value) && value > 0);
  if (Number.isSafeInteger(limits.max_context_window_tokens) && Number.isSafeInteger(limits.max_output_tokens)
      && limits.max_output_tokens > 0 && limits.max_context_window_tokens > limits.max_output_tokens) {
    budgets.push(limits.max_context_window_tokens - limits.max_output_tokens);
  }
  return budgets.length ? Math.min(...budgets) : undefined;
}

export function modelCatalog(models) {
  const available = supportedModels(models).filter((model) => model.policy?.state !== "disabled");
  return {
    object: "list",
    data: available.map((model) => ({ id: model.id, object: "model", owned_by: "github-copilot" })),
    models: available.map((model, priority) => {
      const efforts = reasoningEfforts(model);
      const contextWindow = contextBudget(model);
      return {
        slug: model.id,
        display_name: model.name || model.id,
        supported_reasoning_levels: efforts.map((effort) => ({ effort, description: `${effort} reasoning effort` })),
        default_reasoning_level: efforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : efforts.includes("low") ? "low" : null,
        shell_type: "unified_exec",
        // Offer Codex's native freeform apply_patch; the bridge keeps custom tool input byte-exact.
        apply_patch_tool_type: "freeform",
        visibility: "list",
        supported_in_api: true,
        priority,
        support_verbosity: false,
        supports_reasoning_summary_parameter: false,
        input_modalities: ["text"],
        // Codex's fallback tool-output cap, not a model context or output-token limit.
        truncation_policy: { mode: "bytes", limit: 10_000 },
        experimental_supported_tools: [],
        base_instructions: "You are a coding assistant. Follow the user's instructions and use only the provided tools. Respect the client's sandbox and approval requirements.",
        ...(contextWindow
          ? {
            context_window: contextWindow,
            max_context_window: contextWindow,
            // Leave room for SDK instructions, replay framing and the next tool result.
            auto_compact_token_limit: Math.max(1, Math.floor(contextWindow * 0.8)),
          } : {}),
      };
    }),
  };
}

export function resolveCopilotModel({ requested, models, preferredModel = DEFAULT_MODEL }) {
  const id = requested || preferredModel;
  if (!SUPPORTED_MODEL_IDS.includes(id)) {
    throw new ModelUnavailableError(
      `Unsupported model: ${id}. This bridge only supports: ${SUPPORTED_MODEL_IDS.join(", ")}.`,
    );
  }
  const model = models.find((entry) => entry.id === id);
  if (!model || model.policy?.state === "disabled") {
    throw new ModelUnavailableError(
      `GitHub Copilot model is unavailable for this account: ${id}. Run ./bin/ghcp-models and check your organization's model policy.`,
    );
  }
  return id;
}

export function resolveReasoningEffort({ requested, model }, onDiagnostic = () => {}) {
  if (!requested) return undefined;
  const levels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  if (!levels.includes(requested)) {
    throw new ModelUnavailableError(`Unknown reasoning effort: ${requested}.`);
  }
  const supported = reasoningEfforts(model);
  if (model?.capabilities?.supports?.reasoningEffort === false) {
    onDiagnostic({ event: "bridge.reasoning_not_configurable", model: model.id, requested });
    return undefined;
  }
  if (supported.length && !supported.includes(requested)) {
    throw new ModelUnavailableError(
      `Reasoning effort ${requested} is unavailable for ${model.id}; supported: ${supported.join(", ")}. Pass -c model_reasoning_effort=\"<effort>\" to Codex.`,
    );
  }
  return requested;
}
