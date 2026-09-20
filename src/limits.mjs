// Large but finite byte limits for long, tool-heavy conversations.
// These do not change the upstream model's context window or memory needs.
export const DEFAULT_MAX_REPLAY_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_BODY_BYTES = DEFAULT_MAX_REPLAY_BYTES;
