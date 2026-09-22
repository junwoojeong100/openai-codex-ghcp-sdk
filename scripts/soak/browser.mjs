import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { bounded } from "../compatibility/util.mjs";

const require = createRequire(import.meta.url);

export async function createBrowserTerminal({ directory, rows = 40, columns = 120, signal } = {}) {
  signal?.throwIfAborted();
  const { chromium } = await import("playwright");
  const xterm = require.resolve("@xterm/xterm");
  const server = await chromium.launchServer({ host: "127.0.0.1", headless: true, timeout: 30_000 });
  let browser, page, closedServer = false;
  const closeServer = async () => {
    if (closedServer) return;
    try { await bounded(server.close(), AbortSignal.timeout(5000)); }
    catch (error) {
      await bounded(server.kill(), AbortSignal.timeout(5000));
      closedServer = true;
      throw new Error("Browser graceful cleanup failed; its owned process was forcibly stopped.", { cause: error });
    }
    closedServer = true;
  };
  try {
    signal?.throwIfAborted();
    browser = await chromium.connect(server.wsEndpoint(), { timeout: 10000 });
    page = await browser.newPage({ viewport: { width: Math.max(1100, columns * 9), height: rows * 17 + 280 } });
    let input, failed, failure;
    let screen = "", bracketedPaste = false, seenCodex = false, queue = [], bytes = 0, flushing = false, closed = false;
    const fail = error => { if (!closed) { failure ??= error; failed?.(failure); } };
    await page.exposeFunction("ptyInput", text => {
      if (closed || !input) throw new Error("The owned PTY is not ready for browser input.");
      input(text);
    });
    await page.setContent(fs.readFileSync(fileURLToPath(new URL("./browser-terminal.html", import.meta.url)), "utf8"));
    await page.addStyleTag({ path: path.resolve(path.dirname(xterm), "../css/xterm.css") });
    await page.addScriptTag({ path: xterm });
    await page.evaluate(options => window.initializeTerminal(options), { rows, cols: columns });
    page.on("pageerror", fail);
    page.on("crash", () => fail(new Error("The owned browser page crashed.")));
    const flush = async () => {
      if (flushing || closed) return;
      flushing = true;
      try {
        while (queue.length && !closed) {
          const text = queue.join(""); queue = []; bytes = 0;
          const snapshot = await bounded(page.evaluate(text => new Promise(resolve => {
            window.term.write(text, () => resolve({
              text: window.terminalText(), bracketedPaste: window.term.modes.bracketedPasteMode,
              inputError: window.inputError,
            }));
          }), text), AbortSignal.timeout(8000));
          if (snapshot.inputError) throw new Error(snapshot.inputError);
          screen = snapshot.text; bracketedPaste = snapshot.bracketedPaste;
          seenCodex ||= /OpenAI Codex|Codex CLI/i.test(screen);
        }
      } catch (error) { fail(error); }
      finally { flushing = false; }
    };
    return {
      driver: "playwright", version: browser.version(), pid: server.process().pid, replies: [],
      get bracketedPaste() { return bracketedPaste; },
      get seenCodex() { return seenCodex; },
      text: () => screen,
      attachInput(send, onError) { input = send; failed = onError; if (failure) failed(failure); },
      write(text) {
        if (closed) return;
        bytes += Buffer.byteLength(text);
        if (bytes > 4 * 1024 * 1024) throw new Error("Browser terminal render backlog exceeded 4 MiB.");
        queue.push(text);
        void flush();
      },
      async sendPrompt(text) {
        const before = await page.evaluate(() => window.submitted);
        await page.getByRole("textbox", { name: "Verification prompt", exact: true }).fill(text);
        await page.getByRole("button", { name: "Send prompt", exact: true }).click();
        await page.waitForFunction(before => window.submitted > before, before, { timeout: 10000 });
      },
      async pressEscape() {
        await page.getByRole("button", { name: "Escape", exact: true }).click();
      },
      async close() {
        if (closed) return;
        try {
          await bounded(page.screenshot({ path: path.join(directory, "terminal-browser.png"), fullPage: true }), AbortSignal.timeout(5000));
        } finally {
          closed = true;
          await closeServer();
        }
      },
    };
  } catch (error) {
    await closeServer();
    throw error;
  }
}
