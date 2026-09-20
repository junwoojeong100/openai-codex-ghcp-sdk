import { createHash } from "node:crypto";
import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";
import { SOURCE_SNAPSHOT } from "./sources.mjs";

export const NATIVE_MODELS = SUPPORTED_MODEL_IDS;
export const DIMENSIONS = Object.freeze(["normal", "failure", "lifecycle"]);
export const CATALOG_ID = "codex-0.154.0-ghcp-native-v1";
export const REQUIRED_ROUTE = "codex>responses-bridge>github-copilot-sdk>selected-model";
export const EVIDENCE_NAMES = Object.freeze([
  "native.json", "sdk.json", "http.json", "diagnostics.json", "observations.json", "state.json", "processes.json",
]);

function feature(id, name, cases, { surface = "codex-app-server", mapping = "adapted", sources = ["host", "schema"], prerequisite,
  note = "Use Codex's native behavior, not Claude command/tool names." } = {}) {
  if (cases.length !== 3) throw new Error(`${id} must have all three dimensions.`);
  return Object.freeze({ id, name, siblingId: id, mapping, surface, sources,
    adaptation: note,
    prerequisite: prerequisite || "Pinned Codex executable, an authenticated Copilot SDK, an owned loopback bridge and private fixtures.",
    scenarios: cases.map(([stimulus, primary, secondary], index) => {
      const dimension = DIMENSIONS[index];
      const scenarioId = `${id}.${dimension}`;
      return Object.freeze({ id: scenarioId, featureId: id, dimension, surface, route: REQUIRED_ROUTE,
        steps: [
          "Create isolated HOME/CODEX_HOME, workspace, sibling sentinel, explicit fixture permissions and private evidence storage.",
          stimulus,
          "Retain native request/event IDs, bridge exchanges, SDK session/model/usage and fixture before/after state; run independent assertions.",
          "Close only owned resources and retain failed/interrupted evidence; never read or import another run's results.",
        ],
        predicates: { primary, secondary },
        assertions: [
          { id: `${scenarioId}.primary`, expected: primary, evidence: "native.json" },
          { id: `${scenarioId}.secondary`, expected: secondary, evidence: "native.json" },
          { id: `${scenarioId}.route`, expected: "A real native control turn and every successful model turn are correlated to SDK session/model evidence. Direct HTTP probes or fake clients receive no native/live credit.", evidence: "sdk.json" },
          { id: `${scenarioId}.isolation`, expected: "Observed user config and unrelated fixture files are unchanged; every allowed mutation has an exact path and expected final content, not a directory-wide exemption.", evidence: "state.json" },
          { id: `${scenarioId}.cleanup`, expected: "Owned processes, listeners and SDK sessions have cleanup receipts. No user daemon or other session was stopped.", evidence: "processes.json" },
        ], evidence: EVIDENCE_NAMES,
      });
    }),
  });
}
const boundary = { mapping: "bridge-boundary", sources: ["compatibility", "host", "schema"] };
const ui = { surface: "codex-pty", mapping: "native-surface", prerequisite: "A disposable PTY, terminal state capture and a real UI driver; JSONL text is not visual/accessibility evidence." };
const unmapped = { mapping: "needs-native-equivalent", note: "The sibling feature is retained in the denominator. A Codex-native equivalent and complete oracle must be established; a generic prompt is not an implementation." };

export const NATIVE_FEATURES = Object.freeze([
  feature("cli-runtime", "CLI invocation, cwd and output modes", [
    ["Run text and JSONL exec modes in a path containing spaces; read Unicode/CRLF/empty fixtures with one bounded command.", "Both modes exit zero and return the exact tool-derived value; JSONL includes a completed command and turn.", "Native cwd equals the private workspace and fixture bytes, including CRLF/empty cases, match independently read files."],
    ["Try an invalid CLI flag, then a missing-file command in a valid native run.", "The invalid invocation exits nonzero without bridge inference; the valid run records a nonzero command exit.", "The assistant reports the real ENOENT result, not a fabricated file value; the workspace is unchanged."],
    ["Run two ephemeral invocations with distinct homes/workspaces and hidden values.", "Native thread identities and SDK sessions are distinct and each final answer uses its own hidden value.", "Neither run writes a retained session in the other home or reads the other workspace's marker."],
  ], { surface: "codex-cli", sources: ["exec", "commands"] }),
  feature("terminal-interaction", "Terminal composer, shortcuts and reflow", [
    ["Enter multiline Unicode text in a disposable TUI, resize narrow/wide and inspect tool/diff views.", "The exact input is sent once and controls remain operable after resize.", "Captured terminal frames demonstrate readable composition/diff rendering rather than just a successful exec result."],
    ["Cancel generation using Escape and decline a proposed edit; submit an invalid shortcut.", "Cancellation and rejection are visible and no edit is applied.", "The shortcut error does not leave the composer or terminal modes unusable."],
    ["Suspend/resume the terminal and reattach to the same native conversation.", "The conversation continues without repeated commands or lost input.", "Original terminal size and modes are restored at cleanup."],
  ], ui),
  feature("accessibility", "Keyboard and assistive-technology access", [
    ["Use keyboard and screen reader to read a stream, tool status and an approval prompt.", "Prompt, status, options and final text are exposed in usable reading order.", "The control can be activated without pointer-only or image-only evidence."],
    ["Trigger a tool error and dismiss a dialog from the keyboard.", "Error/cancellation is announced and the intended action remains denied.", "Focus returns to the composer without duplicate activation."],
    ["Resume after long output, then restore accessibility preferences.", "Focus and announcements remain correct after resume.", "Before/after preferences and user terminal state match."],
  ], ui),
  feature("statusline", "Status and context display", [
    ["Show /status and the native status line during a real tool turn.", "Displayed model/provider/cwd agree with native and SDK observations.", "Token/context display is labelled as native usage and is not inferred from byte limits."],
    ["Give invalid display configuration in an isolated home.", "The error is visible and does not silently select another provider.", "A valid session remains operable without changing user configuration."],
    ["Switch model/effort and resize the terminal before checking status again.", "Status reflects the new turn configuration, not stale values.", "Display-only changes have not altered conversation tool results."],
  ], ui),
  feature("settings", "Configuration precedence and isolation", [
    ["Layer fixture HOME config and explicit CLI overrides; inspect effective config then run a hidden-file turn.", "Explicit overrides win for a harmless setting and the selected GHCP provider remains effective.", "Returned config layers identify the isolated source files and the model uses the intended cwd."],
    ["Start an isolated native client with malformed TOML, then repair only that fixture.", "Invalid configuration fails explicitly before inference.", "The corrected client starts and completes a control turn without modifying actual user config."],
    ["Restart the host with a changed fixture default and then an explicit override.", "Each newly loaded effective config reflects the documented precedence.", "Previous process configuration is not cached into the fresh host."],
  ], { sources: ["config", "host", "schema"] }),
  feature("model-routing", "Native model selection and exact SDK identity", [
    ["Start a native thread with the selected exact allowlisted ID and read an unprompted fixture value.", "Native thread model/provider and SDK session configuration match the selected ID.", "Root SDK usage identifies that same model and the answer uses the actual tool output."],
    ["Attempt a native thread/turn with an unknown model while fallback is disabled, then run the selected model.", "Unknown-model execution fails without any successful usage attributed to a substitute model.", "The valid control still works and all successful SDK records name the selected model."],
    ["Start two separate native threads with the same selected model and different hidden values.", "Each native thread maps to its own SDK conversation without silent model replacement.", "Continuing both threads recalls only its own value and preserves thread identity."],
  ]),
  feature("reasoning-effort", "Catalog-backed reasoning effort", [
    ["Request a catalog-advertised native effort; explicitly test a nonconfigurable model without inventing effort.", "SDK session configuration matches the requested supported effort, or omits it with the documented nonconfigurable diagnostic.", "The native answer is grounded in a hidden fixture and SDK usage remains model-attributed."],
    ["Supply an invalid effort through the native configuration and then a valid control turn.", "Invalid effort is rejected before a prompt is submitted; no fallback effort receives credit.", "The control uses the selected model and user effort configuration is unchanged."],
    ["Change between two advertised effort levels within the same native thread while remembering a fixture value.", "SDK setModel receives the exact changed effort and the same conversation is used.", "A no-effort model remains unconfigured with an explicit diagnostic, not a claimed low/high change."],
  ]),
  feature("gateway-protocol", "Native Responses translation and tools", [
    ["Run a real native file-read turn and correlate client HTTP request, SDK call, tool output and final answer.", "Native tool identities and corresponding Responses call/output IDs remain paired in order.", "Model, meaningful instructions and actual final text agree across native, bridge and SDK evidence."],
    ["Run a native client against an owned bridge with an intentionally invalid local credential.", "The native run fails and the bridge records authentication rejection before SDK inference.", "A valid credential works afterward; neither token is retained in artifacts."],
    ["Continue a native conversation after a real tool result and inspect subsequent full-history requests.", "The existing SDK session is reused without re-executing the first tool effect.", "Native continuation returns the remembered unprompted value with a new completed turn ID."],
  ]),
  feature("streaming", "Native streaming, interruption and continuation", [
    ["Run two native turns and collect item/delta/turn lifecycle notifications.", "Every turn has one completion and final agent-message deltas equal its final text.", "Thread, turn and item IDs correlate across all events with no duplicate completed items."],
    ["Interrupt a native turn after its first started event, retaining partial output.", "The turn ends interrupted rather than completed and its SDK session is aborted.", "No interrupted output is counted as a successful answer or a completed side effect."],
    ["After interruption, send a fresh native turn on the same client.", "The new turn completes with a unique ID and correct hidden fixture value.", "Old deltas/completions are not attributed to the new turn."],
  ]),
  feature("structured-output", "Structured-output support boundary", [
    ["Pass a nested outputSchema via native turn/start after a valid plain-text control.", "The current bridge explicitly rejects structured output rather than claiming schema-constrained generation.", "The failed native turn is retained as unsupported, never as successful feature compatibility."],
    ["Use contradictory/type-invalid schemas with the native structured-output path.", "A protocol or bridge error is explicit and no fabricated JSON success is accepted.", "No schema is silently weakened and no failed turn is credited with model usage."],
    ["Clear the unsupported schema and execute a plain-text turn.", "Plain text recovers with the real hidden fixture value.", "The earlier schema rejection remains a separate unsupported result, not converted to a pass."],
  ], boundary),
  feature("file-read", "Text file contents and path semantics", [
    ["Read Unicode, CRLF, empty and spaced-path files using the native shell tool and return their JSON values.", "Parsed final values equal independent fixture bytes for every file.", "Completed native command output contains the exact data, so merely guessing the final marker is insufficient."],
    ["Read an absent file and a dangling symlink with native tools.", "Both actual reads return ENOENT and no content is invented.", "Known fixture files and symlink targets are unchanged."],
    ["Read a file, replace it as the fixture owner between turns and read it again.", "The second native tool result reflects the new on-disk value, not stale model memory.", "Both completed commands and distinct output values are retained on the same thread."],
  ]),
  feature("file-search", "Path discovery, content search and bounds", [
    ["Search a private repository with Unicode/spaced names and repeated matches.", "Returned paths and line-numbered matches equal an independent scan, including all expected matches.", "Search stays under the requested workspace and excludes the sibling sentinel."],
    ["Run no-match and invalid-regex searches through native commands.", "No-match is distinguished from command/regex failure by real exit codes.", "The assistant does not fabricate matching files or suppress the invalid-regex error."],
    ["Add/remove a matched fixture file between native turns and repeat the search.", "The refreshed result set reflects both addition and removal.", "Earlier matches are not reused without a new tool execution."],
  ]),
  feature("file-edit", "Exact edits, conflicts and diff preservation", [
    ["Use native apply_patch to change one repeated line and add a file in the workspace-write fixture.", "Only the specified occurrence and new file content change exactly as expected.", "A native completed fileChange and independent before/after diff both prove the change."],
    ["Ask native apply_patch to apply a stale-context patch.", "The patch fails with a real tool error and the conflict file remains byte-identical.", "No fallback destructive rewrite or unrelated file change occurs."],
    ["Apply an edit in one turn and a second edit based on the first result in another.", "The final file contains both ordered edits exactly once.", "Native change events, intermediate snapshots and final diff agree."],
  ]),
  feature("notebooks", "Notebook edits through ordinary Codex file tools", [
    ["Edit a fixture ipynb using ordinary native file tools, not an invented NotebookEdit tool.", "Only the requested cell source changes and the document remains valid JSON/nbformat.", "Cell IDs, metadata, execution count and unrelated outputs are preserved."],
    ["Attempt to edit an invalid notebook without permission to recreate it.", "The parser error is reported from an actual command and no rewritten notebook is produced.", "Malformed input bytes and unrelated files remain unchanged."],
    ["Insert then edit a cell in two native turns using a stable cell ID.", "The inserted cell is found by ID and appears exactly once after the second turn.", "Existing cell order/metadata and authorized output changes match the expected final document."],
  ]),
  feature("shell-execution", "Commands, stdin, PTYs and background processes", [
    ["Use the native exec tool to run argv/cwd/Unicode stdout-stderr probes and a stdin round trip.", "Actual exit codes, working directory and both output streams match the fixture contract.", "Stdin is delivered once to the returned process/session identity."],
    ["Run an exit-7 command and a bounded sleeping command that must time out.", "Failure and timeout are visible native results, never successful command completions.", "The timed-out process group is gone and no background writer survives."],
    ["Start a long-running native command, poll/write stdin, then terminate the owned session.", "The same native process identity is used across operations with no duplicated writes.", "Termination and drain receipts prove no child remains after cleanup."],
  ]),
  feature("code-intelligence", "Code navigation and diagnostics", [
    ["Invoke the documented native navigation/diagnostic surface on a typed fixture.", "Definition/reference ranges and diagnostics match independently known source locations.", "Evidence identifies the actual native provider; grep output is not mislabelled as LSP support."],
    ["Disable or break the local language provider.", "The native error or unavailable capability is explicit.", "No synthetic navigation result is accepted as native evidence."],
    ["Edit a symbol and request fresh navigation/diagnostics.", "Results reflect the new source revision rather than a stale index.", "The owned language process is stopped and only authorized edits remain."],
  ], unmapped),
  feature("web-fetch", "Client-side loopback HTTP fetch", [
    ["Fetch two synthetic pages from an owned loopback server using a native command.", "Final answer and completed tool output contain the server's hidden values.", "The server audit confirms exactly the allowed paths and no external web request."],
    ["Fetch one 404 and one timed-out fixture endpoint.", "Actual status and timeout are distinguished and no page content is fabricated.", "The native command terminates and pending fixture connections are closed."],
    ["Change the fixture response and fetch again in the same thread.", "A fresh request observes the new content rather than a cached answer.", "The before/after request audit has the expected bounded call count."],
  ]),
  feature("permission-modes", "Native approval decisions and transitions", [
    ["Trigger a bounded command approval and explicitly accept only that fixture command.", "A real approval callback precedes execution and its correlated response authorizes exactly one action.", "The authorized effect matches an exact fixture path/content and no persistent global rule is added."],
    ["Trigger the same approval and decline it.", "A native declined callback is observed and the requested effect never happens.", "The agent reports denial rather than claiming the command succeeded."],
    ["Decline an action, then accept a newly requested action within the same thread.", "The first action stays denied and the second has its own explicit approval.", "No stale accept decision is reused across request IDs or sibling threads."],
  ]),
  feature("planning", "Native plan mode and plan updates", [
    ["Enter native plan collaboration mode and ask for a bounded multistep repair plan.", "Plan-update or plan-mode events expose real steps and statuses.", "Planning does not modify source files before an execution turn is requested."],
    ["Ask for an immediate write while the fixture is restricted to plan/read-only operation.", "No source mutation occurs and native evidence reflects the restriction.", "A prose claim of a completed repair is rejected without file/tool evidence."],
    ["Approve a plan via an explicit next execution turn and complete one scoped change.", "Execution applies the authorized change and plan status advances on the same thread.", "Plan and execution remain separate captured turns with distinct evidence."],
  ]),
  feature("sandboxing", "Filesystem and network permission boundaries", [
    ["Run a workspace-write native turn that changes one allowed file and reads its value back.", "The expected workspace write succeeds under the recorded sandbox policy.", "A sibling sentinel and real user settings stay byte-identical."],
    ["Attempt writes outside writable roots and a disallowed outbound network connection.", "Both are denied by the actual sandbox, not merely discouraged in the prompt.", "The sentinel/remote fixture audit proves no forbidden effect occurred."],
    ["Change a thread from workspace-write to read-only and attempt another edit.", "The initial authorized write persists but the later write is denied.", "The effective policy and native denial belong to the correct turns."],
  ]),
  feature("user-input", "Native clarification and user-input callbacks", [
    ["In plan mode ask a real request_user_input question and answer it through the host protocol.", "A callback with stable question/option IDs is observed and the response uses those IDs.", "The following answer incorporates the chosen option rather than an assumed answer."],
    ["Decline/cancel or supply an invalid answer ID in a disposable thread.", "Native behavior exposes cancellation/validation instead of fabricating user consent.", "No approval-sensitive mutation occurs from a missing answer."],
    ["Answer two different questions across two turns.", "Each answer maps to its own callback/question ID.", "The second response does not reuse or overwrite the first answer."],
  ]),
  feature("project-instructions", "AGENTS.md hierarchy and scoped instructions", [
    ["Create root and nested AGENTS.md files with distinct synthetic output requirements and start at each cwd.", "Native instructionSources and observed answers respect root versus nested scope.", "The instructions are loaded from files, not copied into the task prompt."],
    ["Place a conflicting AGENTS.md in an unrelated sibling workspace.", "The unrelated instruction marker never affects the native answer.", "Only legitimate instruction source paths are reported for the selected workspace."],
    ["Change the fixture instruction and start a fresh native thread.", "The fresh thread uses the updated instruction marker.", "The original user AGENTS.md/configuration is unchanged and no prior fixture marker leaks."],
  ]),
  feature("auto-memory", "Optional Codex memory and local files", [
    ["Enable documented memory only in an isolated Codex home and exercise a synthetic remembered preference.", "The native memory path/provider and persisted content are identified from real artifacts.", "No ordinary recalled chat turn is mislabelled as cross-session automatic memory."],
    ["Disable memory or make the fixture store invalid.", "The disabled/error behavior is explicit and no new memory is written.", "The user memory store is never read or overwritten."],
    ["Restart the native process using the same isolated store, then a different store.", "Only the intended store makes the synthetic memory available.", "Refresh/cleanup leaves the separate store isolated."],
  ]),
  feature("skills", "Native skill discovery, invocation and refresh", [
    ["Create a fixture skill with frontmatter and a hidden-file instruction; list and invoke it through native skill input.", "skills/list identifies the exact name/path and the native result follows its instruction.", "The returned hidden marker is proven by native tool output, not only skill prose."],
    ["Add malformed/disabled fixture skills and request a missing skill.", "Native discovery/errors do not advertise malformed content as a valid skill.", "The invalid invocation does not run its forbidden fixture command."],
    ["Change a fixture skill, force native reload and invoke again.", "The updated instructions, not cached text, govern the new turn.", "A second home without that skill does not discover or execute it."],
  ]),
  feature("hook-lifecycle", "Documented Codex hook lifecycle", [
    ["Configure a local fixture hook using the pinned native hook interface.", "Actual hook event names/payloads and ordering are recorded for a model tool turn.", "Hook output/decision has the documented effect, not a harness-injected surrogate."],
    ["Make the fixture hook reject or fail with a bounded timeout.", "Native failure/rejection is explicit and the denied effect does not occur.", "The failed hook process is reaped without leaking credentials."],
    ["Change/disable the fixture hook and start another turn.", "The new setting applies only after native reload/restart as documented.", "No old hook execution or persistent user hook change remains."],
  ], unmapped),
  feature("hook-transports", "Hook transport equivalents and boundaries", [
    ["Exercise each documented local/HTTP Codex hook transport with an owned endpoint.", "Native transport payloads and effects match the published contract.", "Unsupported Claude-only hook types are recorded as gaps, not silently approximated."],
    ["Return invalid hook output and drop a fixture hook connection.", "Native errors are visible and incomplete decisions never authorize actions.", "No timed-out hook callback is later credited as successful."],
    ["Reconnect and disable the hook between two turns.", "Callback IDs/order remain unique and disabled hooks no longer execute.", "Owned sockets/processes are closed and config restored."],
  ], unmapped),
  feature("plugin-lifecycle", "Codex plugin components and isolation", [
    ["Install a local fixture plugin with a skill and MCP tool in an isolated Codex home.", "Native plugin inventory, discovered skill and real MCP call all refer to the fixture plugin.", "The model/tool round trip returns a hidden value with correct plugin provenance."],
    ["Use a malformed manifest and disable the plugin.", "Malformed installation fails explicitly and disabled components are absent from the next native session.", "No partial cache is treated as an enabled plugin."],
    ["Update then remove the fixture plugin via native commands.", "New version components replace old ones; removed components no longer execute.", "Only fixture marketplace/cache/config paths change."],
  ]),
  feature("plugin-distribution", "Local marketplaces and dependency handling", [
    ["Register an owned local marketplace and install a fixture plugin with a dependency.", "Native inventory resolves the requested plugin/dependency from that marketplace.", "No remote account marketplace is mutated or implicitly trusted."],
    ["Use an absent dependency or invalid marketplace manifest.", "Native installation reports the failure and does not claim a complete install.", "No orphan enabled components survive the failed transaction."],
    ["Upgrade, uninstall and remove the owned marketplace.", "Native inventory and cache contents track each transition.", "User plugin configuration and other marketplaces remain unchanged."],
  ], { surface: "codex-plugin-cli", sources: ["commands", "config"] }),
  feature("plugin-evaluations", "Plugin evaluation equivalent discovery", [
    ["Locate a documented native plugin-evaluation API and run a synthetic fixture if available.", "Evaluation output is emitted by the native product, not fabricated by this runner.", "If there is no Codex equivalent, the feature remains unsupported/unmapped with no pass credit."],
    ["Supply an invalid evaluation fixture to the established native API.", "The native failure identifies the invalid input.", "No generic unit-test success substitutes for plugin-evaluation evidence."],
    ["Change the fixture and rerun via the native API.", "The new result identifies the changed fixture revision.", "Prior evaluation evidence is never reused as a fresh result."],
  ], unmapped),
  feature("mcp-transports", "Native MCP stdio and HTTP lifecycle", [
    ["Configure owned stdio and loopback Streamable HTTP MCP servers, then call their hidden-value tools from native turns.", "Both real MCP transports initialize and receive a tools/call matching native mcpToolCall events.", "Final answers match values absent from the prompt and declared schemas/arguments match the server audit."],
    ["Break one server's initialization and make one tool return isError=true.", "Native startup/tool errors are explicit and never parsed as a success-shaped tool result.", "A required failed server prevents execution as configured without falling back to undeclared tools."],
    ["Restart/reload the owned server with a changed value and reconnect.", "New calls see the new value and use the new initialized transport session.", "The previous process/HTTP listener is stopped and no duplicate tools/calls survive."],
  ], { sources: ["mcp", "host", "schema"] }),
  feature("mcp-authentication", "Independent MCP authentication", [
    ["Use a synthetic bearer token with a private MCP endpoint while keeping Copilot model auth separate.", "The endpoint accepts only the fixture credential and a native tool returns its hidden value.", "No gh/GHCP token is forwarded to the fixture or written into evidence."],
    ["Omit and corrupt the fixture MCP credential.", "401/403 startup/tool errors are visible and the protected tools never execute.", "No unauthenticated retry is granted success or silently routed to another server."],
    ["Rotate the fixture credential, reconnect and repeat the native tool call.", "The old credential stops working and the new one succeeds in the new connection.", "Token redaction and independent model-account identity hold across rotation."],
  ], { sources: ["mcp", "host", "schema"] }),
  feature("mcp-resources", "MCP resources, prompts and elicitation", [
    ["Expose a text resource, prompt and eliciting tool from an owned MCP server and exercise available native APIs.", "Actual list/read/prompt/elicitation RPCs correspond to native events and correct hidden content.", "Unsupported prompt/resource APIs are not replaced with ordinary tool calls and called equivalent."],
    ["Return an absent resource and cancel elicitation.", "Native errors/cancel callbacks are preserved and protected tool effects do not occur.", "No fabricated user input or resource content is accepted."],
    ["Update the resource and repeat elicitation on a new native turn.", "The fresh value and callback identity are used without stale results.", "Only the explicitly owned MCP session is disconnected."],
  ], { sources: ["mcp", "host", "schema"] }),
  feature("mcp-tool-search", "Native MCP discovery and tool search", [
    ["Register a large synthetic MCP tool catalog and request one uniquely named tool.", "The native discovery/search surface selects the declared target before tools/call.", "The actual selected schema and hidden return value match the fixture audit."],
    ["Request a missing tool and return a conflicting tool schema from a second server.", "Unknown/ambiguous tools fail explicitly rather than dispatching to an arbitrary server.", "No unintended fixture tool is executed."],
    ["Change the catalog, reload and request the changed tool.", "The new schema is used and removed tools are not callable.", "Native discovery evidence is distinct from a direct harness tools/list probe."],
  ]),
  feature("subagents", "Codex native subagent delegation", [
    ["Explicitly ask the native agent to spawn two same-model read-only workers on disjoint fixtures.", "Native spawn/wait events show distinct child IDs and actual child tool-derived values.", "Every child has selected-model SDK route evidence and results are integrated by the parent."],
    ["Give one child a missing file and cancel another bounded child.", "Each failure/cancellation is attributed to its child and does not become a success answer.", "No child writes outside its allowed fixture or survives cleanup."],
    ["Wait for child results, close both children and start a fresh worker.", "Native child lifecycle states and IDs are consistent without repeated file effects.", "Closed children no longer accept work and the new child remains isolated."],
  ]),
  feature("agent-continuation", "Child continuation and handback", [
    ["Send a follow-up to an existing native child that read a hidden marker.", "The same child identity recalls the value without a new parent-provided answer.", "Native send/wait and SDK conversation evidence prove continuation, not a replacement child."],
    ["Send input to a closed or unknown child.", "The native failure is explicit and no other child's session is used.", "Parent and sibling agent state remains intact."],
    ["Close/resume a documented resumable child then send a new request.", "Resume either uses the same valid identity or explicitly reports the documented boundary.", "Prior tool effects are not executed twice during handback."],
  ]),
  feature("agent-teams", "Native multi-agent coordination equivalents", [
    ["Coordinate multiple Codex children with explicit ownership and a parent integration task.", "Native child identities, disjoint work and parent integration are recorded.", "This is labelled Codex subagent coordination, not an invented Claude team protocol."],
    ["Introduce a conflicting child edit and a failed integration check.", "The conflict is preserved and native evidence shows which worker failed.", "No worker silently overwrites another's output or receives false pass credit."],
    ["Replace a failed worker and clean up all children after integration.", "Only failed work is retried and the final state passes independent checks.", "Every spawned native child has an explicit terminal/closed lifecycle record."],
  ]),
  feature("dynamic-workflows", "Workflow API equivalence boundary", [
    ["Identify and invoke a documented Codex workflow surface, if available.", "The observed workflow has native state and execution IDs rather than runner-synthesized ones.", "No equivalent means an explicit gap, not generic sequential prompting passed as a workflow."],
    ["Supply a cyclic/invalid workflow to the established native API.", "Native validation rejects it without starting unintended work.", "Failure evidence identifies the rejected node/dependency."],
    ["Resume/cancel a native workflow using its own lifecycle API.", "Only unfinished native work continues and effects are not duplicated.", "All owned native workflow resources are cleaned up."],
  ], unmapped),
  feature("background-agents", "Background native tasks and loaded threads", [
    ["Start a bounded native background agent and inspect its progress from the parent.", "The background session has a real native ID and produces a hidden fixture result.", "Foreground interaction remains live and is not blocked by a harness sleep."],
    ["Cancel a running background agent.", "Native interrupted/closed status is observed and no final success is credited.", "Its SDK work and owned processes stop without affecting unrelated threads."],
    ["Detach/reattach to the documented background surface and retrieve completion.", "The original identity/result is preserved without restarting effects.", "Completed agents are closed and released."],
  ]),
  feature("local-session-messaging", "Queueing input to local threads", [
    ["Send a bounded queued request to an owned native thread using the documented queue/steer surface.", "The target thread receives exactly the intended input and returns the corresponding hidden value.", "Another simultaneously loaded thread receives no copy of the message."],
    ["Queue to an unknown or closed owned thread.", "Native error is explicit and no nearby session is chosen as a fallback.", "No unrelated daemon or thread is inspected or mutated."],
    ["Queue two numbered messages across a busy-to-idle transition.", "Message order and native turn IDs reflect both inputs exactly once.", "Reconnection does not duplicate an acknowledged request."],
  ]),
  feature("worktrees", "Git worktree isolation and integration", [
    ["Create a disposable repository and run native --worktree with a bounded file edit.", "Native cwd and Git metadata identify a separate worktree/branch containing exactly the intended change.", "The original dirty working tree and sibling branch remain unchanged."],
    ["Use a non-Git fixture and an unavailable target branch.", "Native worktree failure is explicit with no fabricated workspace path.", "No partial unmanaged worktree or lost original dirty change remains."],
    ["Resume the created worktree session and integrate or discard only its own changes.", "The same worktree/session is used and the final Git diff matches expected changes.", "Owned worktree/branch cleanup leaves the original repo intact."],
  ], { surface: "codex-cli", sources: ["commands", "config"] }),
  feature("task-tracking", "Plan/task dependency semantics", [
    ["Use the actual Codex plan/task surface for multiple dependent steps.", "Native step identifiers/statuses advance only after corresponding verified effects.", "If only a plan exists, do not claim Claude-style dependency task APIs."],
    ["Fail a prerequisite and attempt a dependent task.", "The native status reflects the failure/block and no dependent effect is miscredited.", "The failed step's evidence remains distinct from later recovery."],
    ["Retry the failed step and finish the dependent step.", "The state transition is visible and prior successful effects are not repeated.", "Final native plan/task status agrees with independent fixture checks."],
  ], unmapped),
  feature("monitoring-tools", "Native monitoring and wakeup behavior", [
    ["Use a documented native monitor on an owned bounded process.", "A real native wakeup/event reports the process transition.", "A harness poll loop is not counted as a native monitoring feature."],
    ["Monitor a nonexistent or failed process.", "The native error identifies the missing/failed source.", "No wakeup success is fabricated from a timeout."],
    ["Unsubscribe and restart the owned monitor.", "Only current subscriptions receive events, once each.", "No watcher/process survives cleanup."],
  ], unmapped),
  feature("scheduling", "Local native schedules", [
    ["Create a short-lived synthetic schedule through a documented Codex local scheduling surface.", "Native schedule/job identity and actual firing are captured.", "No external calendar/task is created and no in-run setTimeout substitutes for product scheduling."],
    ["Provide an invalid schedule and cancel before firing.", "Native validation/cancellation is explicit.", "The canceled job never performs the fixture effect."],
    ["Modify then remove the owned schedule and restart its host.", "Only the updated schedule fires and deletion survives restart.", "No scheduled job is left running after cleanup."],
  ], unmapped),
  feature("goals", "Native goal state and budget controls", [
    ["Set and read a synthetic goal for an owned thread, then run a bounded control turn.", "thread/goal/get returns the exact objective, active status and requested token budget.", "The native goal update event belongs to that thread and does not affect a second thread."],
    ["Set an invalid budget or mutate a nonexistent thread goal.", "Native validation rejects invalid data without changing the existing goal.", "The earlier valid objective/budget remains readable."],
    ["Update objective/status, clear the goal and read it again.", "Native goal transitions and clear notification match the requested lifecycle.", "No cleared goal is applied to the next owned thread."],
  ]),
  feature("session-resume", "Saved thread resume and independent fork", [
    ["Persist a native thread after reading a hidden value, restart the app-server and resume by ID.", "The same native thread ID recalls the value after process restart.", "Persisted native history and replayed/live SDK evidence agree without re-running the initial command."],
    ["Resume an unknown thread and a thread from another isolated home.", "Both fail explicitly without falling back to the latest session.", "The original valid thread/history is untouched."],
    ["Fork a persisted thread, append different facts to source and fork and resume both.", "Distinct native IDs retain the common prefix and their own new facts only.", "Source/fork tool effects and stored histories stay isolated."],
  ]),
  feature("checkpoint-rewind", "Native fork/rollback and file checkpoint boundary", [
    ["Use the documented Codex rollback/fork surface on a disposable history and separately inspect file state.", "Native history truncation/fork is proven by turn IDs and subsequent recall.", "Conversation rollback is not falsely advertised as automatic filesystem restoration."],
    ["Request rollback beyond available turns or a nonexistent checkpoint.", "Native validation reports the invalid operation.", "Stored history and files remain at the pre-error state."],
    ["Resume after rollback/fork and perform one new bounded change.", "New history continues from the intended prefix without replaying removed tool effects.", "File differences follow only explicitly requested edits."],
  ]),
  feature("context-compaction", "Compaction and long-context boundary", [
    ["Request native compaction after a multi-turn tool conversation.", "Native events either show genuine supported compaction or the bridge's explicit unsupported boundary.", "A bridge /compact rejection is not counted as completed compaction."],
    ["Interrupt/fail compaction with owned fault injection.", "No partial compaction is labelled successful and the native error is retained.", "No history/fixture change is silently lost."],
    ["Continue with a fresh supported full-history turn after the boundary/error.", "Previously recorded synthetic facts are handled consistently with documented replay limits.", "Native and SDK history IDs are correctly correlated after recovery."],
  ], boundary),
  feature("crash-recovery", "Owned process/bridge restart", [
    ["Stop only the owned bridge between native turns, restart it and continue a persisted thread.", "The native client either explicitly recovers by full history or reports an expired-session boundary.", "No duplicate initial tool effect occurs during recovery."],
    ["Kill the owned host during a pending tool/stream and retain partial evidence.", "The interrupted attempt is not marked completed.", "Owned SDK work/listeners/processes are cleaned with no unrelated session signal."],
    ["Launch a fresh host/bridge and resume the saved thread after failure.", "The final native result is correct or a precise unrecoverable boundary is recorded.", "Recovery receives a fresh attempt identity and never overwrites failed artifacts."],
  ]),
  feature("output-styles", "Personality and output instruction scoping", [
    ["Apply a fixture native personality/developer instruction and request a hidden-file answer.", "The answer follows the explicit style while preserving the exact factual tool value.", "Native config/request evidence proves the style source, not a rewritten final artifact."],
    ["Supply an invalid native personality value.", "The API/configuration rejects it explicitly before a model turn.", "The existing valid style remains effective."],
    ["Change the style between turns on one thread.", "The new style applies only to the intended subsequent turn.", "Remembered fixture facts survive without prior style leaking into a sibling thread."],
  ]),
  feature("image-input", "Native image support boundary", [
    ["Submit a synthetic local PNG via the native image input after a plain-text control.", "The current text-only bridge explicitly rejects image input.", "The result remains unsupported, not a vision success inferred from a filename or prompt."],
    ["Supply a missing image and an invalid image encoding.", "Native file/decode errors are distinguished from bridge modality rejection.", "No fake visual description is accepted and no external image is fetched."],
    ["Remove image input and continue with text/tools.", "The supported native path recovers with an actual hidden-file value.", "No prior unsupported image is silently replayed as supported content."],
  ], boundary),
  feature("pdf-input", "PDF attachment versus text extraction", [
    ["Exercise documented native PDF attachment input with a synthetic fixture, if available.", "Direct attachment support/rejection is identified from native request shape.", "Shell-extracted text is labelled text extraction, never passed as native PDF grounding."],
    ["Supply a corrupt or oversized PDF through the native surface.", "Native/bridge rejection is explicit without a fabricated page summary.", "The original binary and workspace remain unchanged."],
    ["Continue using explicitly extracted text only after the attachment boundary.", "The text-only result matches independent extraction.", "Unsupported PDF capability retains zero compatibility credit."],
  ], boundary),
  feature("binary-tool-results", "Non-text MCP/tool result boundary", [
    ["Return a tiny synthetic image/document from an owned MCP tool.", "Native and bridge evidence identify the non-text result and explicit unsupported boundary.", "No prose fallback is counted as image/document tool-result fidelity."],
    ["Return malformed binary metadata and a non-text tool error.", "Failures are explicit and no malformed blob executes or becomes a successful result.", "Text-only neighboring calls remain isolated."],
    ["Change the fixture to return a text-only result and repeat.", "The supported text path succeeds with the correct hidden value.", "The prior binary failure remains separately recorded as unsupported."],
  ], boundary),
  feature("tool-choice", "Native parallel/tool declaration fidelity", [
    ["Ask for two bounded disjoint reads and correlate all native tool calls/results.", "Only declared tools execute and every call ID has exactly one matching result.", "Actual final values equal independently read fixtures across serial/parallel behavior."],
    ["Use a forbidden tool or request required/named tool choice through the native client where exposed.", "The unsupported/invalid selection fails explicitly without an undeclared effect.", "No fallback to a different tool is credited as the requested choice."],
    ["Continue after a multi-call batch and repeat the client request safely.", "No completed tool effect is repeated and native conversation continuity holds.", "Raw custom input and function argument semantics remain stable across history replay."],
  ]),
  feature("usage-context", "Token usage, context and byte measurements", [
    ["Run a native text/tool turn and compare native usage with actual root SDK events.", "Reported usage is derived from recorded counts; missing counts stay unknown.", "HTTP/replay UTF-8 byte measurements are separate from model token/context limits."],
    ["Apply small fixture-only body/history caps and exceed them through native requests.", "Native failure corresponds to bridge 413 rather than a model success.", "No invalid byte-to-token conversion or estimated usage is credited."],
    ["Run multiple turns and inspect cumulative versus per-turn counts.", "Native totals and each turn's SDK evidence are attributed without double-counting retries.", "No model context-window or billing equivalence claim is inferred from the bridge's byte cap."],
  ]),
  feature("prompt-cache", "Cache metadata and exact retry boundaries", [
    ["Repeat a safe native request and capture cache-related request/SDK metadata.", "Cache counts are accepted only when the upstream SDK actually reports them.", "Prompt cache hints are not mislabelled as guaranteed cache hits or billable savings."],
    ["Change instructions/tools/history and repeat a previous prompt.", "The changed semantics are not served as an exact retry of a different request.", "No stale tool result or another session's output is returned."],
    ["Reconnect or evict an owned session before reusing a response ID.", "Expired IDs fail explicitly and only a fresh full-history request can continue.", "In-memory retry behavior is distinguished from durable upstream caching."],
  ]),
  feature("desktop-gateway", "Desktop local Codex surface", [
    ["Connect the actual desktop local Code surface to the owned provider and perform a fixture task.", "Visible desktop events/actions and SDK routing agree for the selected model.", "App-server JSONL alone is not credited as desktop UI evidence."],
    ["Decline a desktop approval and disconnect the owned provider.", "The UI displays denial/connection failure with no unintended edit.", "Other open user conversations remain unaffected."],
    ["Reconnect/reopen only the disposable desktop session.", "Its history and approved fixture state are preserved correctly.", "Desktop preferences and unrelated windows remain unchanged."],
  ], { surface: "codex-desktop", mapping: "native-surface" }),
  feature("ci-integrations", "Isolated CI invocation and artifacts", [
    ["Run pinned codex exec in a clean local CI-like workspace with credentials isolated from generated commands.", "Machine-readable output and exit codes match the task and raw artifacts are retained.", "No external workflow, PR or repository setting is mutated by preparation."],
    ["Simulate missing runtime/config and a failed verification command.", "The job exits nonzero and preserves the failing native evidence.", "No success artifact or credential-bearing environment dump is published."],
    ["Retry the failed local job in a fresh workspace with a corrected fixture.", "The new attempt has distinct immutable artifacts and reflects the fix.", "Previous failure evidence is preserved, not relabelled passed."],
  ], { surface: "codex-cli", sources: ["exec"] }),
  feature("agent-sdk-host", "Codex app-server host contract", [
    ["Initialize a real app-server, create a read-only thread, run a fixture turn and read native state.", "Initialize/initialized, thread/start and turn/start/completed correlate correctly.", "Native model/provider/thread metadata and actual SDK route agree."],
    ["Send a method before initialization, an unknown method and invalid parameters in disposable hosts.", "Each native protocol failure is explicit without a fabricated successful result.", "A correctly initialized host still completes a control turn."],
    ["Start, read, rename, list, archive and unarchive a persisted owned thread.", "Native thread identity/status events match each requested transition.", "History and hidden fixture recall survive the supported lifecycle."],
  ], { note: "The sibling Agent SDK host is adapted to Codex's version-pinned bidirectional app-server protocol, not the Claude Agent SDK." }),
  feature("external-session-storage", "External transcript storage equivalent", [
    ["Identify a documented Codex external transcript-store interface, if any.", "Native store calls and persisted thread identity are recorded.", "A copied rollout file or fabricated store callback is not equivalent evidence."],
    ["Inject a bounded store read/write failure through that native interface.", "Native failure prevents a false persisted-success result.", "Existing stored data remains intact."],
    ["Reconnect the same store from a new owned host.", "The intended thread resumes with correct history and no duplicate effects.", "No unrelated store/session is accessed."],
  ], unmapped),
  feature("managed-local-policy", "Managed requirements and local policy", [
    ["Load managed requirements in a disposable OS/user context and inspect effective native permissions.", "The actual native requirements constrain sandbox/provider/MCP options.", "No global managed-policy file is modified by the harness."],
    ["Attempt a prohibited native override or MCP server.", "Native policy rejects the change instead of silently relaxing enforcement.", "Forbidden tool effects and outbound calls do not occur."],
    ["Change the isolated managed policy and restart the client.", "The fresh effective policy reflects only authorized changes.", "Previous global/user policy state remains intact."],
  ], { surface: "codex-isolated-os-user", prerequisite: "Disposable OS user/container for managed policy; never write the actual managed policy." }),
  feature("network-containers", "Proxy, TLS and container boundaries", [
    ["Use owned proxy/TLS endpoints in a disposable container for native bridge communication.", "Transport traverses the intended proxy with validated certificates.", "No real credential is sent to a fixture origin or captured in proxy logs."],
    ["Break trust roots and proxy connectivity in the isolated container.", "Native errors are explicit; TLS validation is not disabled to manufacture success.", "No direct-network fallback bypasses the intended policy."],
    ["Restore transport and restart the owned container/client.", "A fresh native tool turn succeeds through the validated route.", "Owned containers/proxy listeners are removed and host configuration is untouched."],
  ], { surface: "codex-container", prerequisite: "Approved disposable container runtime and local TLS fixtures." }),
  feature("launchers", "Production launcher routing and ownership", [
    ["Run bin/codex-ghcp with the selected model and an isolated native fixture.", "The actual launcher creates/reuses only its owned provider and passes sandbox/approval/cwd arguments correctly.", "Native and SDK model evidence agree without leaked GitHub token environment variables."],
    ["Supply conflicting provider/model overrides and an occupied fixed port.", "Launcher failures are explicit before inference or unverified process reuse.", "No existing daemon or unrelated PID is signalled."],
    ["Exercise foreground exit and a private background registry, then stop only the verified owned instance.", "Foreground resources close and private background lifecycle is consistent.", "The real user's daemon registry/session is unchanged."],
  ], { surface: "codex-launcher", sources: ["commands", "compatibility"] }),
  feature("telemetry", "Local diagnostics and telemetry privacy", [
    ["Enable a fixture-only local telemetry collector and run a native tool turn.", "Actual emitted events correlate to the owned thread/model without invented usage counts.", "Authentication headers, tokens and unapproved prompt contents are absent from the retained telemetry."],
    ["Disconnect the local collector and redact a synthetic secret in tool output.", "Collector failure is visible without falsely failing a completed task or leaking the secret.", "No external telemetry endpoint is used by the fixture."],
    ["Disable telemetry and start a fresh native client.", "The collector receives no new events from the disabled client.", "Collector/listener cleanup and configuration restoration are confirmed."],
  ]),
  feature("diagnostics", "Version and runtime diagnostics", [
    ["Capture pinned runtime versions and run the native diagnostic surface in an isolated home.", "Reported versions/configuration identify the executable actually used by the control turn.", "Diagnostic output is redacted and does not claim account/model health from version checks alone."],
    ["Use a missing Codex binary and invalid fixture configuration.", "Each prerequisite failure is attributed to runtime/setup, not a model behavior failure.", "No model call occurs for the failed prerequisite."],
    ["Restore the executable/configuration and rerun in a fresh fixture.", "Diagnostics and a real native control turn succeed on the current source hash.", "Old failed logs remain immutable and are not counted as new proof."],
  ]),
  feature("local-notifications", "Local desktop notification behavior", [
    ["Complete an owned native task with fixture-only notifications enabled.", "The actual notification surface emits the expected title/thread reference.", "A log line alone is not treated as an OS notification."],
    ["Deny or disable notification permission in a disposable OS context.", "The notification is not delivered and the native task state remains accurate.", "Actual user notification permissions are not modified."],
    ["Restore the isolated permission and finish another task.", "Only the new task produces a notification, without stale duplicates.", "OS notification settings and owned hooks are restored."],
  ], { ...ui, surface: "codex-desktop-notifications" }),
  feature("local-code-review", "Native review and verifiable findings", [
    ["Run native review against a synthetic known-defect diff.", "A real review finding names the affected fixture file/range and identifies the seeded defect.", "The native review mode is observed and the worktree is not modified."],
    ["Review an invalid base/commit and a clean synthetic diff.", "Invalid revision fails explicitly; a clean diff does not produce a fabricated seeded finding.", "No writes or external PR review publication occurs."],
    ["Fix only the seeded defect and rerun native review.", "The previous finding is resolved for the changed source, with fresh review evidence.", "Unrelated dirty fixture changes are preserved."],
  ]),
  feature("local-retention", "Local thread retention and deletion", [
    ["Run a persisted native thread and inspect only its isolated history store.", "The completed turn/tool result is retrievable by native thread/read.", "An ephemeral comparison run does not persist a resumable history in the same way."],
    ["Read/delete an unknown thread and try to resume an ephemeral thread after process exit.", "Native failures are explicit and no other thread is substituted.", "The valid retained thread remains retrievable unchanged."],
    ["Archive, unarchive and delete one owned persisted thread.", "Native list/read and lifecycle notifications reflect each transition, ending with non-retrievability.", "The second owned thread and actual user history store are unchanged."],
  ]),
  feature("auto-permission-policy", "Optional automatic approval reviewer", [
    ["Use an isolated documented native automatic-review policy for a bounded benign fixture action.", "Native reviewer decisions and the authorized action are captured separately from the model request.", "The policy is not an unconditional approvals/sandbox bypass."],
    ["Ask the reviewer for a prohibited fixture action.", "The native reviewer denies it and independent state shows no effect.", "No fallback manual/global approval is silently supplied."],
    ["Change to explicit user approvals on a new turn.", "The new decision path is observed and old automatic consent is not reused.", "Policy changes stay isolated to the fixture."],
  ], { surface: "codex-app-server", mapping: "capability-dependent" }),
  feature("provider-controls", "Unsupported provider semantics and feature gates", [
    ["Run a native text/tool turn with the production transport/search settings.", "Native requests use HTTP Responses without websocket/compression/hosted search features.", "Actual request fields and native config agree with the documented adapter scope."],
    ["Attempt launcher overrides for model/provider, hosted search, compression and remote transport.", "Each protected override fails explicitly before any model call.", "No alternative provider or authentication route is started."],
    ["Run a supported native control after rejected overrides.", "The selected GHCP model still receives the valid turn.", "Rejected flags do not persist in isolated or real user settings."],
  ], { surface: "codex-launcher", sources: ["compatibility", "config", "commands"] }),
]);

export const NATIVE_SCENARIOS = Object.freeze(NATIVE_FEATURES.flatMap(({ scenarios }) => scenarios));
export const NATIVE_CATALOG = Object.freeze({ id: CATALOG_ID, features: NATIVE_FEATURES, models: NATIVE_MODELS,
  sourceSnapshot: SOURCE_SNAPSHOT, scopeExclusions: [
    { id: "cloud-account-services", reason: "Remote cloud jobs, billing, account administration and external integrations require separate authorization; no local harness claim covers them." },
    { id: "external-ide-hosts", reason: "VS Code/JetBrains extension-host UI is not substituted by app-server tests. Desktop/TUI remain explicit in-catalog gaps." },
  ],
  verificationController: "Version-pinned real Codex CLI/app-server, owned fixtures, native + bridge + SDK evidence; no model-as-judge or borrowed sibling results.",
});
export function catalogFingerprint() {
  return createHash("sha256").update(JSON.stringify(NATIVE_CATALOG)).digest("hex");
}
