import { Router } from "express";
import { fetch as undiciFetch, Agent, request as undiciRequest } from "undici";
import type { IncomingHttpHeaders } from "undici/types/header";

const probeRouter = Router();

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

function buildHeaders(
  custom: Record<string, string> = {},
  bearerToken?: string | null,
  authHeaderName?: string | null
): Record<string, string> {
  const h: Record<string, string> = { ...BROWSER_HEADERS, ...custom };
  if (bearerToken) {
    const name =
      authHeaderName && authHeaderName.trim()
        ? authHeaderName.trim()
        : "Authorization";
    h[name] = `Bearer ${bearerToken}`;
  }
  return h;
}

function headersToObject(h: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

// ─── Technique 1: Timing ─────────────────────────────────────────────────────
// Send N identical full requests and record timing + response body for each.
// Reveals whether the server returns varying content (state changes, different
// values) across repeated calls with the same payload.
async function runTiming(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null | undefined,
  rounds: number
) {
  const results = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = Date.now();
    try {
      const opts: Parameters<typeof undiciFetch>[1] = {
        method,
        headers,
        // @ts-expect-error undici dispatcher
        dispatcher: insecureAgent,
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      };
      if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
        opts.body = body;
      }
      const resp = await undiciFetch(url, opts);
      const durationMs = Date.now() - t0;
      const respBody = await resp.text();
      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { responseHeaders[k] = v; });
      results.push({
        durationMs,
        status: resp.status,
        statusText: resp.statusText || String(resp.status),
        responseHeaders,
        body: respBody.length > 8_000 ? respBody.slice(0, 8_000) + "\n…(truncated)" : respBody,
        error: null,
        note: `Round ${i + 1} of ${rounds}`,
      });
    } catch (err: unknown) {
      results.push({
        durationMs: Date.now() - t0,
        status: 0,
        statusText: "Error",
        responseHeaders: {},
        body: null,
        error: err instanceof Error ? err.message : String(err),
        note: `Round ${i + 1} of ${rounds} — network error`,
      });
    }
  }
  return results;
}

// ─── Technique 2: Partial / connection abort ──────────────────────────────────
// Send the full request (headers + body) but abort the response stream
// immediately after reading the status line and response headers — before
// consuming the body. The server has already received and (depending on its
// architecture) may have processed the request, but we cut the TCP read early.
// Returns the status + headers without waiting for the full body stream.
async function runPartial(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null | undefined
) {
  const t0 = Date.now();
  try {
    const { statusCode, headers: respHeaders, body: bodyStream } =
      await undiciRequest(url, {
        method: method as Parameters<typeof undiciRequest>[1]["method"],
        headers: {
          ...headers,
          // undici's raw `request()` API (unlike `fetch()`) never decompresses
          // the response body for us, and since we only read the first 512
          // bytes and destroy the stream, we can't decode a truncated
          // gzip/br/deflate stream anyway. Ask the server for an uncompressed
          // body so the bytes we do read are legible.
          "Accept-Encoding": "identity",
          ...(body && !["GET", "HEAD"].includes(method.toUpperCase())
            ? { "Content-Type": headers["content-type"] ?? headers["Content-Type"] ?? "application/json" }
            : {}),
        },
        // @ts-expect-error undici dispatcher
        dispatcher: insecureAgent,
        signal: AbortSignal.timeout(15_000),
        body:
          body && !["GET", "HEAD"].includes(method.toUpperCase())
            ? body
            : undefined,
      });

    // Read first chunk only, then destroy the stream
    const reader = bodyStream;
    let firstChunk = "";
    try {
      for await (const chunk of reader) {
        firstChunk +=
          typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        if (firstChunk.length >= 512) break; // read max 512 bytes then bail
      }
      // Destroy remaining stream
      reader.destroy();
    } catch {
      // ignore destroy errors
    }

    return {
      durationMs: Date.now() - t0,
      status: statusCode,
      statusText: String(statusCode),
      responseHeaders: headersToObject(respHeaders),
      body: firstChunk || null,
      error: null,
      note: "Connection aborted after reading status + headers + first 512 bytes of body",
    };
  } catch (err: unknown) {
    return {
      durationMs: Date.now() - t0,
      status: 0,
      statusText: "Error",
      responseHeaders: {},
      body: null,
      error: err instanceof Error ? err.message : String(err),
      note: "Partial request failed at network level",
    };
  }
}

// ─── Technique 3: Expect: 100-continue ────────────────────────────────────────
// Send request headers with "Expect: 100-continue" and withhold the body.
// RFC 7231 says the server MUST send 100 Continue before the client sends the
// body, or it can immediately reject with 417. Some servers skip validation
// entirely and fire back the full response before receiving the body — in that
// case we get the server's answer without ever sending the payload.
async function runExpect100(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null | undefined
) {
  const t0 = Date.now();
  try {
    // We piggyback on undici's native Expect: 100-continue handling.
    // undici will send headers, wait for 100 Continue, then send body.
    // We use a custom body stream that we never resolve — so undici sends
    // the headers and the Expect:100-continue, waits for the interim response,
    // and we abort before the body bytes are written.
    const abortCtrl = new AbortController();

    // Build a body stream that stalls indefinitely
    const { readable, writable } = new TransformStream<string, string>();
    const writer = writable.getWriter();

    const fetchPromise = undiciFetch(url, {
      method: method || "POST",
      headers: {
        ...headers,
        Expect: "100-continue",
        "Content-Type":
          headers["content-type"] ??
          headers["Content-Type"] ??
          "application/json",
        // If we know the body length, set it so the server can validate early
        ...(body ? { "Content-Length": String(Buffer.byteLength(body, "utf8")) } : {}),
      },
      body: readable,
      // @ts-expect-error undici dispatcher
      dispatcher: insecureAgent,
      signal: abortCtrl.signal,
      duplex: "half",
    } as RequestInit & { duplex: string });

    // Race: either server responds before we send body (5 s window), or timeout
    const timeoutId = setTimeout(() => {
      abortCtrl.abort();
      writer.close().catch(() => {});
    }, 5_000);

    let result: {
      durationMs: number;
      status: number;
      statusText: string;
      responseHeaders: Record<string, string>;
      body: string | null;
      error: string | null;
      note: string;
    };

    try {
      const resp = await fetchPromise;
      clearTimeout(timeoutId);
      const durationMs = Date.now() - t0;
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });
      const respBody = await resp.text();
      result = {
        durationMs,
        status: resp.status,
        statusText: resp.statusText,
        responseHeaders: respHeaders,
        body: respBody.length > 8_000 ? respBody.slice(0, 8_000) + "\n…(truncated)" : respBody,
        error: null,
        note:
          resp.status === 417
            ? "Server rejected Expect:100-continue (417 Expectation Failed) — body never sent"
            : resp.status === 100
            ? "Server sent 100 Continue — body required before final response"
            : "Server responded before body was sent",
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("abort"));
      result = {
        durationMs: Date.now() - t0,
        status: 0,
        statusText: aborted ? "Timed out waiting for server" : "Error",
        responseHeaders: {},
        body: null,
        error: aborted
          ? "Server did not respond within 5 s before body was sent (sent 100-continue headers, withheld body)"
          : err instanceof Error
          ? err.message
          : String(err),
        note: aborted
          ? "Server requires body before responding (standard behaviour)"
          : "Network error during Expect:100-continue probe",
      };
    }

    return result;
  } catch (err: unknown) {
    return {
      durationMs: Date.now() - t0,
      status: 0,
      statusText: "Error",
      responseHeaders: {},
      body: null,
      error: err instanceof Error ? err.message : String(err),
      note: "Expect-100 setup failed",
    };
  }
}

// POST /api/proxy/probe
probeRouter.post("/proxy/probe", async (req, res) => {
  const {
    url,
    method = "POST",
    headers: customHeaders = {},
    bearerToken,
    authHeaderName,
    body,
    techniques = [],
    timingRounds = 5,
  } = req.body;

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }
  if (!Array.isArray(techniques) || techniques.length === 0) {
    res.status(400).json({ error: "techniques[] is required (timing | partial | expect100)" });
    return;
  }

  const headers = buildHeaders(customHeaders, bearerToken, authHeaderName);
  if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    headers["Content-Type"] =
      customHeaders["content-type"] ??
      customHeaders["Content-Type"] ??
      "application/json";
  }

  const output: Record<string, unknown> = {};

  await Promise.all(
    techniques.map(async (technique: string) => {
      switch (technique) {
        case "timing":
          output.timing = await runTiming(url, method, headers, body, Math.min(timingRounds, 20));
          break;
        case "partial":
          output.partial = await runPartial(url, method, headers, body);
          break;
        case "expect100":
          output.expect100 = await runExpect100(url, method, headers, body);
          break;
      }
    })
  );

  res.json(output);
});

export default probeRouter;
