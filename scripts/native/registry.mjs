import { CORE_DRIVERS } from "./drivers/core.mjs";
import { FILE_DRIVERS } from "./drivers/files.mjs";
import { RUNTIME_DRIVERS } from "./drivers/runtime.mjs";
import { PROTOCOL_DRIVERS } from "./drivers/protocol.mjs";

// A catalog row is not an implementation. Only explicitly registered native
// executors with independent artifact evaluators may receive readiness credit.
export const NATIVE_DRIVERS = Object.freeze({ ...FILE_DRIVERS, ...CORE_DRIVERS, ...RUNTIME_DRIVERS, ...PROTOCOL_DRIVERS });
export function driverFor(scenario) { return NATIVE_DRIVERS[typeof scenario === "string" ? scenario : scenario.id]; }
