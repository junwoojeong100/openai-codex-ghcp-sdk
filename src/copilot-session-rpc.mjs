export async function submitToolResult(session, request) {
  const method = session?.rpc?.tools?.handlePendingToolCall;
  if (typeof method !== "function") {
    throw new Error("The installed Copilot SDK cannot accept pending tool results.");
  }
  const response = await method(request);
  if (response?.success === false) {
    throw new Error("GitHub Copilot rejected the pending tool result.");
  }
  return response;
}

export async function abortSession(session) {
  await session?.abort?.();
}

export async function disconnectSession(session) {
  await session?.disconnect?.();
}

export async function deleteClientSession(client, sessionId) {
  await client?.deleteSession?.(sessionId);
}

export async function withinDeadline(operation, timeoutMs, signal) {
  let timer;
  let onAbort;
  try {
    if (signal?.aborted) throw Object.assign(new Error("SDK operation cancelled."), { name: "AbortError" });
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("SDK operation deadline exceeded.")), timeoutMs);
        onAbort = () => reject(Object.assign(new Error("SDK operation cancelled."), { name: "AbortError" }));
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
