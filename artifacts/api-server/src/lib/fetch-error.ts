// undici's fetch() wraps the real network failure in a generic
// `TypeError: fetch failed` and puts the actual errno/reason in `err.cause`
// (sometimes nested a level deeper). Reading only `err.message` therefore
// surfaces an uninformative "fetch failed" to the UI. This walks the cause
// chain to find the real reason (ENOTFOUND, ECONNREFUSED, certificate
// errors, etc.) and turns it into a human-readable message.
export function describeFetchError(err: unknown, hostname?: string): string {
  if (!(err instanceof Error)) return "Unknown error";

  if (err.name === "TimeoutError" || err.name === "AbortError") {
    return hostname
      ? `Request timed out (${hostname})`
      : "Request timed out";
  }

  // Walk the cause chain — undici typically sets `cause` to a Node
  // system error (has `.code`) or another Error with more detail.
  let cause: unknown = (err as any).cause;
  let depth = 0;
  while (cause && depth < 5) {
    const code = (cause as any).code as string | undefined;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);

    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return `DNS lookup failed — host not found${hostname ? `: ${hostname}` : ""}`;
    }
    if (code === "ECONNREFUSED") {
      return `Connection refused${hostname ? ` by ${hostname}` : ""}`;
    }
    if (code === "ECONNRESET") {
      return `Connection reset${hostname ? ` by ${hostname}` : ""}`;
    }
    if (code === "ETIMEDOUT") {
      return `Connection timed out${hostname ? ` (${hostname})` : ""}`;
    }
    if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code?.startsWith("ERR_TLS")) {
      return `TLS/certificate error${hostname ? ` for ${hostname}` : ""}: ${causeMessage}`;
    }
    if (code) {
      return `${code}${hostname ? ` (${hostname})` : ""}: ${causeMessage}`;
    }

    const nextCause = (cause as any).cause;
    if (!nextCause) {
      // No further cause and no code — use whatever message we have.
      return causeMessage || err.message;
    }
    cause = nextCause;
    depth++;
  }

  if (err.message.includes("ENOTFOUND") || err.message.includes("getaddrinfo")) {
    return `DNS lookup failed — host not found${hostname ? `: ${hostname}` : ""}`;
  }
  if (err.message.includes("ECONNREFUSED")) {
    return `Connection refused${hostname ? ` by ${hostname}` : ""}`;
  }
  if (err.message.includes("ECONNRESET")) {
    return `Connection reset${hostname ? ` by ${hostname}` : ""}`;
  }

  return err.message;
}
