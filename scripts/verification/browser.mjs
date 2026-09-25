import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { bounded, sha } from "./util.mjs";

const require = createRequire(import.meta.url);

export async function createBrowserTerminal({ directory, rows = 40, columns = 120, signal } = {}) {
  signal?.throwIfAborted();
  const { chromium } = await import("playwright");
  const xterm = require.resolve("@xterm/xterm");
  const server = await chromium.launchServer({ host: "127.0.0.1", headless: true, timeout: 30_000 });
  let browser, context, page, closedServer = false;
  const closeServer = async () => {
    if (closedServer) return;
    try {
      if (browser?.isConnected()) await bounded(browser.close(), AbortSignal.timeout(5000));
      await bounded(server.close(), AbortSignal.timeout(5000));
    }
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
    const viewport = { width: Math.max(1100, columns * 9), height: rows * 17 + 280 };
    context = await browser.newContext({ viewport, recordVideo: { dir: directory, size: viewport } });
    const recordingStarted = performance.now();
    page = await context.newPage();
    const video = page.video();
    let input, failed, failure;
    let screen = "", bracketedPaste = false, seenCodex = false, queue = [], bytes = 0, flushing, closing, closed = false;
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
    const flush = () => {
      if (closed) return Promise.resolve();
      if (flushing) return flushing;
      flushing = Promise.resolve().then(async () => {
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
      }).finally(() => { flushing = null; });
      return flushing;
    };
    const capture = async (file = "terminal-browser.png") => {
      if (closed) throw new Error("Cannot capture a closed browser terminal.");
      await flush();
      if (failure) throw failure;
      const videoOffsetMs = Math.round(performance.now() - recordingStarted);
      const image = await bounded(page.screenshot({ path: path.join(directory, file), fullPage: true }), AbortSignal.timeout(5000));
      return { file, videoOffsetMs, at: Date.now(), bytes: image.length, sha256: sha(image) };
    };
    return {
      driver: "playwright", version: browser.version(), pid: server.process().pid, replies: [],
      get bracketedPaste() { return bracketedPaste; },
      get seenCodex() { return seenCodex; },
      text: () => screen,
      capture,
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
      // Real keyboard events through xterm.js (arrows, Enter, slash commands).
      async typeKeys(text) {
        await page.locator(".xterm-helper-textarea").focus();
        await page.keyboard.type(text, { delay: 15 });
      },
      async press(key) {
        await page.locator(".xterm-helper-textarea").focus();
        await page.keyboard.press(key);
      },
      close() {
        return closing ??= (async () => {
          let screenshot;
          try { screenshot = await capture(); }
          finally {
            closed = true;
            try {
              await bounded(context.close(), AbortSignal.timeout(15000));
              await bounded(video.saveAs(path.join(directory, "terminal-browser.webm")), AbortSignal.timeout(15000));
              await bounded(video.delete(), AbortSignal.timeout(5000));
            } finally { await closeServer(); }
          }
          const bytes = fs.readFileSync(path.join(directory, "terminal-browser.webm"));
          return { screenshot, video: { file: "terminal-browser.webm", bytes: bytes.length, sha256: sha(bytes), viewport } };
        })();
      },
    };
  } catch (error) {
    await closeServer();
    throw error;
  }
}
