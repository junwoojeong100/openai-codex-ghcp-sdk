// Parse native presentation, not model self-reports. These helpers only inspect
// evidence; they must never be used to authorize shell commands.
export function reviewFindings(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(text);
  const raw = (fenced?.[1] ?? text).trim();
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const review = JSON.parse(raw);
      if (!Array.isArray(review?.findings)) return [];
      return review.findings.map(finding => ({
        path: finding?.code_location?.absolute_file_path,
        start: finding?.code_location?.line_range?.start,
        end: finding?.code_location?.line_range?.end,
        text: `${finding?.title ?? ""}\n${finding?.body ?? ""}`,
      }));
    } catch { return []; }
  }
  // Codex's exitedReviewMode.review is normally rendered text. Require actual
  // finding headers, a concrete path/range, and exactly the declared findings.
  const headers = [...raw.matchAll(/^[ \t]*[-*][ \t]+\[P\d+\][^\n]*$/gm)];
  if (!headers.length) return [];
  const findings = [];
  for (const [index, header] of headers.entries()) {
    const match = /^[ \t]*[-*][ \t]+\[P[0-3]\][ \t]+(.+?)[ \t]+[—–][ \t]+(.+?):(\d+)(?:-(\d+))?[ \t]*$/.exec(header[0]);
    if (!match) return [];
    findings.push({ path: match[2], start: Number(match[3]), end: Number(match[4] ?? match[3]),
      text: `${match[1]}\n${raw.slice(header.index + header[0].length, headers[index + 1]?.index ?? raw.length).trim()}` });
  }
  return findings;
}

function shellTokens(text) {
  const tokens = []; let value = "", quote = null, started = false;
  const word = () => { if (started) tokens.push({ word: value }); value = ""; started = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (quote === '"' && c === "\\" && /[\\$`"\n]/.test(text[i + 1] ?? "")) {
        if (text[i + 1] !== "\n") value += text[i + 1]; i++; continue;
      }
      value += c; continue;
    }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (c === "\\") {
      if (i + 1 >= text.length) return null;
      if (text[i + 1] !== "\n") { value += text[i + 1]; started = true; } i++; continue;
    }
    if (";|&\n".includes(c)) { word(); tokens.push({ separator: c }); continue; }
    if (/\s/.test(c)) { word(); continue; }
    value += c; started = true;
  }
  if (quote) return null;
  word(); return tokens;
}
export function gitDiffCommand(command = "", depth = 0) {
  if (typeof command !== "string" || depth > 3) return false;
  const tokens = shellTokens(command);
  if (!tokens) return false;
  const groups = [[]];
  for (const token of tokens) {
    if (token.separator) { if (groups.at(-1).length) groups.push([]); }
    else groups.at(-1).push(token.word);
  }
  return groups.some(words => {
    if (words.length === 3 && /^(?:\/(?:[^/\s]+\/)*)(?:sh|bash|zsh)$|^(?:sh|bash|zsh)$/.test(words[0]) && /^-(?:l?c|cl)$/.test(words[1]))
      return gitDiffCommand(words[2], depth + 1);
    let i = 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] ?? "")) i++;
    if (!/^(?:.*\/)?git$/.test(words[i++] ?? "")) return false;
    while (i < words.length) {
      const arg = words[i++];
      if (["-c", "-C", "--git-dir", "--work-tree", "--namespace"].includes(arg)) { if (i >= words.length) return false; i++; continue; }
      if (["--no-pager", "--no-optional-locks", "--literal-pathspecs"].includes(arg) || /^(?:-c|-C).+|^--(?:git-dir|work-tree|namespace)=/.test(arg)) continue;
      return arg === "diff";
    }
    return false;
  });
}
