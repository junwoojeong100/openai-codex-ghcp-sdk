import { CopilotClient } from "@github/copilot-sdk";
import { resolveCopilotHome } from "./copilot-home.mjs";
import { SUPPORTED_MODEL_IDS, supportedModels } from "./model-map.mjs";

const args = process.argv.slice(2);
if (args.some((argument) => argument !== "--json")) {
  console.error("Usage: ghcp-models [--json] (only the seven supported models are listed)");
  process.exitCode = 2;
} else {
  const client = new CopilotClient({
    mode: "empty",
    baseDirectory: resolveCopilotHome(process.env.COPILOT_HOME),
    logLevel: "error",
    enableRemoteSessions: false,
  });
  try {
    await client.start();
    const models = supportedModels(await client.listModels());
    if (args.includes("--json")) {
      console.log(JSON.stringify(models, null, 2));
    } else {
      for (const id of SUPPORTED_MODEL_IDS) {
        const model = models.find((entry) => entry.id === id);
        console.log([
          id,
          model?.name || "",
          model ? (model.policy?.state || "listed") : "not available",
        ].join("\t"));
      }
    }
  } catch (error) {
    console.error(`Cannot list Copilot models: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.stop().catch(() => {});
  }
}
