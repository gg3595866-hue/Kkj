import { Router } from "express";
import { db } from "@workspace/db";
import { savedRequestsTable, requestHistoryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { request as undiciRequest, Agent } from "undici";
import * as zlib from "node:zlib";

const proxyRouter = Router();

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB — no silent truncation beyond this
const MAX_REDIRECTS = 15;

const agent = new Agent({
  connect: { rejectUnauthorized: false },
});

// Must match the Probe tab's BROWSER_HEADERS (see routes/probe.ts) so a
// request behaves identically whether it's sent from Builder or Probe.
// A User-Agent claiming a real Chrome browser without the Accept-Encoding /
// Cache-Control / Pragma headers a real browser always sends is a classic
// bot-fingerprint mismatch — anti-bot/WAF layers (common on gambling sites)
// key on exactly this and return 401 even with a valid auth token.
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

type TransportOutcome =
  | "http_response"
  | "network_error"
  | "tls_error"
  | "timeout"
  | "dns_error"
  | "too_many_redirects";

interface Hop {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string | string[]>;
  durationMs: number;
}

interface ErrorDetails {
  outcome: TransportOutcome;
  errorCode: string | null;
  errorMessage: string;
  syscall: string | null;
  causeChain: Array<{ message: string; code?: string; syscall?: string }>;
}

const STATUS_TEXT: Record<number, string> = {
  100: "Continue", 101: "Switching Protocols",
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 206: "Partial Content",
  301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified",
  307: "Temporary Redirect", 308: "Permanent Redirect",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
  405: "Method Not Allowed", 408: "Request Timeout", 409: "Conflict", 410: "Gone",
  422: "Unprocessable Entity", 429: "Too Many Requests",
  500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
  503: "Service Unavailable", 504: "Gateway Timeout",
};

function classifyError(err: unknown): ErrorDetails {
  const chain: Array<{ message: string; code?: string; syscall?: string }> = [];

  if (!(err instanceof Error)) {
    return { outcome: "network_error", errorCode: null, errorMessage: String(err), syscall: null, causeChain: [] };
  }

  if (err.name === "TimeoutError" || err.name === "AbortError") {
    return {
      outcome: "timeout",
      errorCode: "TIMEOUT",
      errorMessage: err.message,
      syscall: null,
      causeChain: [{ message: err.message }],
    };
  }

  let outcome: TransportOutcome = "network_error";
  let topCode: string | null = null;
  let topSyscall: string | null = null;
  let cursor: unknown = err;

  while (cursor instanceof Error) {
    const code = (cursor as any).code as string | undefined;
    const syscall = (cursor as any).syscall as string | undefined;
    chain.push({ message: cursor.message, ...(code && { code }), ...(syscall && { syscall }) });

    if (code && !topCode) {
      topCode = code;
      topSyscall = syscall ?? null;
    }

    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NODATA") {
      outcome = "dns_error";
    } else if (
      code === "CERT_HAS_EXPIRED" ||
      code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      code === "SELF_SIGNED_CERT_IN_CHAIN" ||
      code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
      code?.startsWith("ERR_TLS") ||
      code?.startsWith("CERT_")
    ) {
      outcome = "tls_error";
    } else if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
      outcome = "timeout";
    }

    cursor = (cursor as any).cause;
  }

  return { outcome, errorCode: topCode, errorMessage: err.message, syscall: topSyscall, causeChain: chain };
}

function headersToFlat(raw: Record<string, string | string[]>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    flat[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return flat;
}

function decodeBody(buf: Buffer, contentType?: string | string[]): string {
  const ct = Array.isArray(contentType) ? contentType[0] : (contentType ?? "");
  const m = ct.match(/charset=([^\s;,]+)/i);
  const charset = m ? m[1].toLowerCase().replace(/^"(.+)"$/, "$1") : "utf-8";
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString("utf-8");
  }
}

async function drainStream(stream: AsyncIterable<Buffer | Uint8Array>): Promise<void> {
  for await (const _ of stream) { /* discard */ }
}

async function readBodyStream(
  stream: AsyncIterable<Buffer | Uint8Array>,
  limitBytes: number,
): Promise<{ buffer: Buffer; truncated: boolean; totalBytes: number }> {
  const chunks: Buffer[] = [];
  let collected = 0;
  let totalBytes = 0;
  let truncated = false;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.byteLength;
    if (!truncated) {
      if (collected + buf.byteLength <= limitBytes) {
        chunks.push(buf);
        collected += buf.byteLength;
      } else {
        const remaining = limitBytes - collected;
        if (remaining > 0) chunks.push(buf.slice(0, remaining));
        truncated = true;
      }
    }
  }

  return { buffer: Buffer.concat(chunks), truncated, totalBytes };
}

// We now send Accept-Encoding: gzip, deflate, br (to match a real browser's
// fingerprint — see DEFAULT_HEADERS comment above). undici's low-level
// `request()` API, unlike `fetch()`, never decompresses the response body
// for us, so we have to do it ourselves based on whatever Content-Encoding
// the server actually sent back.
function decompressBody(buf: Buffer, contentEncoding?: string | string[]): Buffer {
  const enc = (Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding ?? "").toLowerCase();
  try {
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf);
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("deflate")) return zlib.inflateSync(buf);
  } catch {
    // Truncated/partial compressed stream (e.g. body was capped by
    // MAX_BODY_BYTES) — fall back to the raw bytes rather than throwing.
  }
  return buf;
}

// POST /api/proxy/send
proxyRouter.post("/proxy/send", async (req, res) => {
  const {
    url,
    method,
    headers: customHeaders = {},
    bearerToken,
    authHeaderName,
    body,
    contentType,
  } = req.body;

  if (!url || !method) {
    res.status(400).json({ error: "url and method are required" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: `Invalid URL: "${url}" — must start with https:// or http://` });
    return;
  }

  const requestHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...customHeaders,
  };

  if (bearerToken) {
    const headerName = authHeaderName?.trim() || "Authorization";
    const isStandardAuth = headerName.toLowerCase() === "authorization";
    requestHeaders[headerName] = isStandardAuth ? `Bearer ${bearerToken}` : bearerToken;
  }
  if (contentType) {
    requestHeaders["Content-Type"] = contentType;
  } else if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    try {
      JSON.parse(body);
      requestHeaders["Content-Type"] = "application/json";
    } catch {
      // not JSON
    }
  }

  const globalStart = Date.now();
  const hops: Hop[] = [];
  let currentUrl = parsedUrl;
  let currentMethod = method.toUpperCase() as string;
  let transportOutcome: TransportOutcome = "http_response";
  let errorDetails: ErrorDetails | null = null;

  let finalStatus = 0;
  let finalStatusText = "";
  let finalHeaders: Record<string, string | string[]> = {};
  let finalBody = "";
  let finalBodySizeBytes = 0;
  let finalBodyTruncated = false;

  try {
    for (let hopIndex = 0; hopIndex <= MAX_REDIRECTS; hopIndex++) {
      if (hopIndex === MAX_REDIRECTS) {
        transportOutcome = "too_many_redirects";
        break;
      }

      const hopStart = Date.now();

      // Only send body on the first request, or on 307/308 redirects (method-preserving)
      const sendBody = body && !["GET", "HEAD"].includes(currentMethod) ? body : undefined;

      const response = await undiciRequest(currentUrl.toString(), {
        method: currentMethod,
        headers: requestHeaders,
        // @ts-expect-error undici dispatcher type
        dispatcher: agent,
        signal: AbortSignal.timeout(30_000),
        maxRedirections: 0,
        body: sendBody,
        reset: true,
      });

      const rawHeaders = response.headers as Record<string, string | string[]>;
      const statusCode = response.statusCode;
      const statusText = STATUS_TEXT[statusCode] ?? String(statusCode);
      const hopDurationMs = Date.now() - hopStart;

      const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);

      if (isRedirect) {
        // Capture this redirect hop but don't read its body
        hops.push({ url: currentUrl.toString(), status: statusCode, statusText, headers: rawHeaders, durationMs: hopDurationMs });
        await drainStream(response.body as AsyncIterable<Buffer | Uint8Array>);

        const locationRaw = rawHeaders["location"];
        const location = Array.isArray(locationRaw) ? locationRaw[0] : locationRaw;
        if (!location) break;

        currentUrl = new URL(location, currentUrl);

        // 301, 302, 303 → switch to GET (per browser behaviour)
        if ([301, 302, 303].includes(statusCode) && currentMethod !== "GET") {
          currentMethod = "GET";
        }
        continue;
      }

      // Final response — capture everything raw
      const { buffer, truncated, totalBytes } = await readBodyStream(
        response.body as AsyncIterable<Buffer | Uint8Array>,
        MAX_BODY_BYTES,
      );

      finalStatus = statusCode;
      finalStatusText = statusText;
      finalHeaders = rawHeaders;
      const decompressed = decompressBody(buffer, rawHeaders["content-encoding"]);
      finalBody = decodeBody(decompressed, rawHeaders["content-type"]);
      finalBodySizeBytes = totalBytes;
      finalBodyTruncated = truncated;

      hops.push({ url: currentUrl.toString(), status: statusCode, statusText, headers: rawHeaders, durationMs: hopDurationMs });

      transportOutcome = "http_response";
      break;
    }
  } catch (err: unknown) {
    errorDetails = classifyError(err);
    transportOutcome = errorDetails.outcome;
  }

  const durationMs = Date.now() - globalStart;

  let historyId: number | null = null;
  try {
    const [historyEntry] = await db
      .insert(requestHistoryTable)
      .values({
        url,
        method: method.toUpperCase(),
        status: finalStatus,
        statusText: finalStatusText || transportOutcome,
        requestHeaders,
        responseHeaders: headersToFlat(finalHeaders),
        responseBody: finalBody,
        durationMs,
        transportOutcome,
        hops,
        bodySizeBytes: finalBodySizeBytes,
        bodyTruncated: finalBodyTruncated,
        errorDetails,
      })
      .returning();
    historyId = historyEntry.id;
  } catch {
    // DB failure must not hide the actual captured response
  }

  res.json({
    transportOutcome,
    status: finalStatus,
    statusText: finalStatusText,
    headers: finalHeaders,
    body: finalBody,
    bodySizeBytes: finalBodySizeBytes,
    bodyTruncated: finalBodyTruncated,
    durationMs,
    hops,
    errorDetails,
    historyId,
  });
});

// GET /api/proxy/requests
proxyRouter.get("/proxy/requests", async (_req, res) => {
  const saved = await db
    .select()
    .from(savedRequestsTable)
    .orderBy(desc(savedRequestsTable.createdAt));
  res.json(saved);
});

// POST /api/proxy/requests
proxyRouter.post("/proxy/requests", async (req, res) => {
  const { name, url, method, headers, bearerToken, body, contentType } = req.body;

  if (!name || !url || !method) {
    res.status(400).json({ error: "name, url, and method are required" });
    return;
  }

  const [created] = await db
    .insert(savedRequestsTable)
    .values({
      name,
      url,
      method: method.toUpperCase(),
      headers: headers ?? {},
      bearerToken: bearerToken ?? null,
      body: body ?? null,
      contentType: contentType ?? null,
    })
    .returning();

  res.status(201).json(created);
});

// PUT /api/proxy/requests/:id
proxyRouter.put("/proxy/requests/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name, url, method, headers, bearerToken, body, contentType } = req.body;

  const [updated] = await db
    .update(savedRequestsTable)
    .set({
      name,
      url,
      method: method?.toUpperCase(),
      headers: headers ?? {},
      bearerToken: bearerToken ?? null,
      body: body ?? null,
      contentType: contentType ?? null,
    })
    .where(eq(savedRequestsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// DELETE /api/proxy/requests/:id
proxyRouter.delete("/proxy/requests/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(savedRequestsTable).where(eq(savedRequestsTable.id, id));
  res.status(204).send();
});

// GET /api/proxy/history
proxyRouter.get("/proxy/history", async (req, res) => {
  const limit = parseInt(String(req.query.limit ?? "50"), 10);
  const history = await db
    .select()
    .from(requestHistoryTable)
    .orderBy(desc(requestHistoryTable.createdAt))
    .limit(isNaN(limit) ? 50 : limit);
  res.json(history);
});

// DELETE /api/proxy/history
proxyRouter.delete("/proxy/history", async (_req, res) => {
  await db.delete(requestHistoryTable);
  res.status(204).send();
});

export default proxyRouter;
