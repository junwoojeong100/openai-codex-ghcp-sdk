import path from "node:path";

// Shell tools inherit this allowlist, not the caller's credentials, proxy, or
// code-loading environment. Authentication stays with the parent SDK client.
export function isolatedCodexEnvironment(env, { home, codexHome, temporary, token }) {
  const safe = {};
  for (const name of ["PATH", "SHELL", "LANG", "LC_ALL", "SystemRoot", "WINDIR"]) {
    if (env[name]) safe[name] = env[name];
  }
  return { ...safe, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"),
    TMPDIR: temporary, TMP: temporary, TEMP: temporary, NO_COLOR: "1", TERM: "dumb",
    NO_PROXY: "127.0.0.1,localhost,::1", CODEX_GHCP_BRIDGE_TOKEN: token };
}
