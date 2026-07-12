import { Router } from "express";
import { fetch as undiciFetch, Agent, request as undiciRequest } from "undici";
import type { IncomingHttpHeaders } from "undici/types/header";
import * as zlib from "node:zlib";
import * as net from "node:net";
import { runRace, buildRawHttp1Request, connectSocket, writeAndDrain, readResponse } from "./probe-race.js";

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
  const RAW_BYTE_CAP = 64 * 1024; // hard cap on raw bytes read off the wire
  const DECODED_BYTE_TARGET = 512; // how much decoded text we want to show
  let intentionalAbort = false;
  try {
    const { statusCode, headers: respHeaders, body: bodyStream } =
      await undiciRequest(url, {
        method: method as Parameters<typeof undiciRequest>[1]["method"],
        headers: {
          ...headers,
          // undici's raw `request()` API (unlike `fetch()`) never decompresses
          // the response body for us. Requesting an uncompressed body is the
          // first line of defense so the bytes we read are legible — but some
          // servers/CDNs ignore Accept-Encoding and compress anyway, so we
          // also decompress on our end below as a fallback.
          "Accept-Encoding": "identity",
          ...(body && !["GET", "HEAD"].includes(method.toUpperCase())
            ? { "Content-Type": headers["content-type"] ?? headers["Content-Type"] ?? "application/json" }
            : {}),
        },
        // @ts-expect-error undici dispatcher
        dispatcher: insecureAgent,
        signal: AbortSignal.timeout(15_000),
        // Note: undici's low-level `request()` (unlike `fetch()`) does not
        // follow redirects on its own — it would need a redirect interceptor
        // composed onto the dispatcher. Out of scope here; this technique
        // intentionally inspects the first hop's raw response.
        body:
          body && !["GET", "HEAD"].includes(method.toUpperCase())
            ? body
            : undefined,
      });

    const respHeadersObj = headersToObject(respHeaders);
    const contentEncoding = (respHeadersObj["content-encoding"] || "").toLowerCase();

    // Pick a decompressor based on what the server actually sent, regardless
    // of the Accept-Encoding we asked for — some origins compress unasked.
    let decompress: zlib.Gunzip | zlib.BrotliDecompress | zlib.Inflate | null = null;
    if (contentEncoding.includes("br")) {
      decompress = zlib.createBrotliDecompress();
    } else if (contentEncoding.includes("gzip")) {
      decompress = zlib.createGunzip();
    } else if (contentEncoding.includes("deflate")) {
      decompress = zlib.createInflate();
    }

    let decodedText = "";
    let rawBytesRead = 0;
    let truncatedCompressed = false;
    const decoder = new TextDecoder("utf-8", { fatal: false });

    if (decompress) {
      decompress.on("data", (chunk: Buffer) => {
        decodedText += decoder.decode(chunk, { stream: true });
      });
      decompress.on("error", () => {
        // A truncated compressed stream (expected, since we cut it short)
        // will often throw here — that's fine, we keep whatever decoded
        // successfully before the error.
        truncatedCompressed = true;
      });
    }

    try {
      for await (const chunk of bodyStream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        rawBytesRead += buf.length;
        if (decompress) {
          decompress.write(buf);
        } else {
          decodedText += decoder.decode(buf, { stream: true });
        }
        const enoughDecoded = decodedText.length >= DECODED_BYTE_TARGET;
        const hitRawCap = rawBytesRead >= RAW_BYTE_CAP;
        if (enoughDecoded || hitRawCap) break;
      }
    } catch (streamErr: unknown) {
      // Reading errors here are expected once we intentionally destroy the
      // stream below; only unexpected ones (e.g. TLS reset mid-read) matter,
      // and we still return whatever we managed to decode.
      void streamErr;
    } finally {
      intentionalAbort = true;
      // Always tear down both the source stream and the decompressor so we
      // never leak sockets/handles, even on the early-break paths above.
      bodyStream.destroy();
      if (decompress) {
        try {
          decompress.end();
        } catch {
          // ignore — stream already errored/destroyed
        }
        decompress.destroy();
      }
    }
    decodedText += decoder.decode(); // flush any pending multi-byte tail

    const displayBody = decodedText.length > DECODED_BYTE_TARGET
      ? decodedText.slice(0, DECODED_BYTE_TARGET)
      : decodedText;

    return {
      durationMs: Date.now() - t0,
      status: statusCode,
      statusText: String(statusCode),
      responseHeaders: respHeadersObj,
      body: displayBody || null,
      error: null,
      note: decompress
        ? `Connection aborted after reading status + headers + first ~${DECODED_BYTE_TARGET} decoded bytes of body (server sent ${contentEncoding}-compressed body; decompressed on our end${truncatedCompressed ? ", stream was truncated mid-frame so trailing bytes may be missing" : ""})`
        : `Connection aborted after reading status + headers + first ${DECODED_BYTE_TARGET} bytes of body`,
    };
  } catch (err: unknown) {
    if (intentionalAbort) {
      // Should not normally reach here (errors after this point are caught
      // above), but guard against a stray rethrow from stream teardown.
      return {
        durationMs: Date.now() - t0,
        status: 0,
        statusText: "Error",
        responseHeaders: {},
        body: null,
        error: null,
        note: "Partial probe completed (stream teardown, no error)",
      };
    }
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

// ─── Technique 5: Method capability probe ────────────────────────────────────
// Sends OPTIONS, HEAD, and GET to the same URL with the same auth headers.
// None of these methods carry a body and none should trigger a game action.
// Useful for:
//   - OPTIONS: reveals what methods the server allows (Allow header), CORS policy
//   - HEAD:    confirms the endpoint exists and shows response headers without body
//   - GET:     may return state data or a different error code than POST (405 vs 401 etc.)
async function runMethodProbe(
  url: string,
  headers: Record<string, string>
): Promise<unknown[]> {
  const methods = ["OPTIONS", "HEAD", "GET"] as const;
  const results = [];

  for (const httpMethod of methods) {
    const t0 = Date.now();
    try {
      const opts: Parameters<typeof undiciFetch>[1] = {
        method: httpMethod,
        headers: { ...headers, "Content-Length": "0" },
        // @ts-expect-error undici dispatcher
        dispatcher: insecureAgent,
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      };
      const resp = await undiciFetch(url, opts);
      const durationMs = Date.now() - t0;
      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { responseHeaders[k] = v; });
      // HEAD has no body by definition
      const respBody = httpMethod === "HEAD" ? null : await resp.text().catch(() => null);
      results.push({
        httpMethod,
        durationMs,
        status: resp.status,
        statusText: resp.statusText || String(resp.status),
        responseHeaders,
        allowHeader: responseHeaders["allow"] ?? null,
        body: respBody && respBody.length > 4_000 ? respBody.slice(0, 4_000) + "\n…(truncated)" : respBody,
        error: null,
        note: `${httpMethod} ${url}`,
      });
    } catch (err: unknown) {
      results.push({
        httpMethod,
        durationMs: Date.now() - t0,
        status: 0,
        statusText: "Error",
        responseHeaders: {},
        allowHeader: null,
        body: null,
        error: err instanceof Error ? err.message : String(err),
        note: `${httpMethod} ${url} — network error`,
      });
    }
  }

  return results;
}

// ─── Technique 6: Validation probe ───────────────────────────────────────────
// Sends the base request body N times with one field patched each time.
// The intent is to trigger server-side validation errors *before* the action
// is committed — so we observe error responses and response shapes without
// registering a real game move.
//
// Each patch is a JSON string (e.g. '{"AN":-1}') that is merged over the
// base body before serialisation. Patches that cause a 2xx are flagged as
// likely committed and should be treated with caution.
async function runValidationProbe(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null | undefined,
  patches: string[]
): Promise<unknown[]> {
  let baseObj: Record<string, unknown> = {};
  try {
    if (body) baseObj = JSON.parse(body);
  } catch {
    // body is not JSON; patches will still be applied as JSON merges
  }

  const results = [];

  for (const patchStr of patches) {
    const t0 = Date.now();
    let patchObj: Record<string, unknown> = {};
    try { patchObj = JSON.parse(patchStr); } catch { /* keep empty */ }
    const patchedBody = JSON.stringify({ ...baseObj, ...patchObj });

    try {
      const opts: Parameters<typeof undiciFetch>[1] = {
        method,
        headers: { ...headers, "Content-Type": "application/json" },
        body: patchedBody,
        // @ts-expect-error undici dispatcher
        dispatcher: insecureAgent,
        signal: AbortSignal.timeout(12_000),
        redirect: "follow",
      };
      const resp = await undiciFetch(url, opts);
      const durationMs = Date.now() - t0;
      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { responseHeaders[k] = v; });
      const respBody = await resp.text().catch(() => null);
      const committed = resp.status >= 200 && resp.status < 300;
      results.push({
        patch: patchStr,
        committed,
        durationMs,
        status: resp.status,
        statusText: resp.statusText || String(resp.status),
        responseHeaders,
        body: respBody && respBody.length > 4_000 ? respBody.slice(0, 4_000) + "\n…(truncated)" : respBody,
        error: null,
        note: committed
          ? `⚠ 2xx — server may have committed this action. Patch: ${patchStr}`
          : `Rejected (${resp.status}) — likely pre-commit validation. Patch: ${patchStr}`,
      });
    } catch (err: unknown) {
      results.push({
        patch: patchStr,
        committed: false,
        durationMs: Date.now() - t0,
        status: 0,
        statusText: "Error",
        responseHeaders: {},
        body: null,
        error: err instanceof Error ? err.message : String(err),
        note: `Network error. Patch: ${patchStr}`,
      });
    }
  }

  return results;
}

// ─── Technique 5: Cross-site probe (raw socket) ──────────────────────────────
// Alternates rounds between two mirror sites using fully swapped identities:
//
//   Even rounds → Site A URL  +  Site B token  +  Site B body (Site B's UI)
//   Odd  rounds → Site B URL  +  Site A token  +  Site A body (Site A's UI)
//
// CRITICAL: the body must travel WITH the token, not with the URL.
// The game server authenticates via both the JWT sub claim AND the UI field
// in the JSON body — they must agree. Sending Site B's JWT with Site A's
// body (UI mismatch) is still processed against a real session.
// By sending Site B's full identity (token + body with B's UI) to Site A's
// endpoint, the server sees a foreign user with no active session on that
// site and returns game data without registering a real action on either account.
//
// Uses raw TCP/TLS sockets (same primitives as the race technique) instead of
// undici/fetch so the request bypasses Node's connection pool, avoids any
// HTTP keep-alive reuse that could cause a fetch to silently fail on a
// cross-origin connection, and gives us full control over the wire bytes.
async function runCross(opts: {
  urlA: string;
  methodA: string;
  headersA: Record<string, string>;
  bodyA: string | null | undefined;
  urlB: string;
  methodB: string;
  headersB: Record<string, string>;
  bodyB: string | null | undefined;
  rounds: number;
}) {
  const { urlA, methodA, headersA, bodyA, urlB, methodB, headersB, bodyB, rounds } = opts;

  // ── Swap auth headers ──────────────────────────────────────────────────────
  // crossA = Site A URL  +  Site B's auth value  (B's headers, keep A's non-auth)
  // crossB = Site B URL  +  Site A's auth value  (A's headers, keep B's non-auth)
  const crossA: Record<string, string> = { ...headersA };
  const crossB: Record<string, string> = { ...headersB };

  const isAuthKey = (k: string) =>
    k.toLowerCase() === "x-auth" || k.toLowerCase() === "authorization";

  const authKeyA = Object.keys(headersA).find(isAuthKey);
  const authKeyB = Object.keys(headersB).find(isAuthKey);

  if (authKeyB) {
    if (authKeyA && authKeyA !== authKeyB) delete crossA[authKeyA];
    crossA[authKeyB] = headersB[authKeyB]; // Site A URL now carries Site B's token
  }
  if (authKeyA) {
    if (authKeyB && authKeyB !== authKeyA) delete crossB[authKeyB];
    crossB[authKeyA] = headersA[authKeyA]; // Site B URL now carries Site A's token
  }

  const results = [];

  for (let i = 0; i < rounds; i++) {
    const useA       = i % 2 === 0;
    const targetUrl  = useA ? urlA  : urlB;
    const method     = useA ? methodA  : methodB;
    const headers    = useA ? crossA   : crossB;
    // Body follows the TOKEN, not the URL — JWT sub and body UI must agree.
    // Even rounds hit Site A's URL but carry Site B's identity (token + body).
    // Odd rounds hit Site B's URL but carry Site A's identity (token + body).
    const body       = useA ? bodyB    : bodyA;
    const targetSite = useA ? "A" : "B" as "A" | "B";
    const authSite   = useA ? "B" : "A" as "A" | "B";

    const t0 = Date.now();
    let sock: net.Socket | null = null;

    try {
      const urlObj = new URL(targetUrl);

      // ── Build raw HTTP/1.1 request ─────────────────────────────────────────
      const reqBuf = buildRawHttp1Request(urlObj, method, headers, body ?? null);

      // ── Open a fresh socket per round — no pooling, no reuse ───────────────
      sock = await connectSocket(urlObj, 15_000) as net.Socket;
      sock.setNoDelay(true);

      await writeAndDrain(sock, reqBuf);
      const resp = await readResponse(sock, 15_000, 8_000);
      const durationMs = Date.now() - t0;

      let bodyText = resp.body;
      if (bodyText.length > 8_000) bodyText = bodyText.slice(0, 8_000) + "\n…(truncated)";

      results.push({
        durationMs,
        status:          resp.status,
        statusText:      resp.statusText || String(resp.status),
        responseHeaders: resp.headers,
        body:            bodyText,
        error:           null,
        note:  `Round ${i + 1} — Site ${targetSite} URL · Site ${authSite} token`,
        site:       targetSite,
        targetUrl,
        authSite,
      });
    } catch (err: unknown) {
      results.push({
        durationMs:      Date.now() - t0,
        status:          0,
        statusText:      "Error",
        responseHeaders: {},
        body:            null,
        error:  err instanceof Error ? err.message : String(err),
        note:  `Round ${i + 1} — Site ${targetSite} URL · Site ${authSite} token — socket error`,
        site:       targetSite,
        targetUrl,
        authSite,
      });
    } finally {
      sock?.destroy();
    }
  }

  return results;
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
    raceConnections = 10,
    crossRounds = 6,
    siteBUrl,
    siteBMethod,
    siteBHeaders: siteBCustomHeaders = {},
    siteBBearerToken,
    siteBAuthHeaderName,
    siteBBody,
  } = req.body;

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }
  if (!Array.isArray(techniques) || techniques.length === 0) {
    res.status(400).json({ error: "techniques[] is required (timing | partial | expect100 | race | cross)" });
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
        case "race":
          output.race = await runRace({ url, method, headers, body, connections: raceConnections });
          break;
        case "methodprobe":
          output.methodprobe = await runMethodProbe(url, headers);
          break;
        case "validationprobe": {
          const validationPatches: string[] = Array.isArray(req.body.validationPatches)
            ? req.body.validationPatches.slice(0, 20)
            : [];
          if (validationPatches.length === 0) {
            output.validationprobe = { error: "validationPatches[] is required for the validationprobe technique" };
          } else {
            output.validationprobe = await runValidationProbe(url, method, headers, body, validationPatches);
          }
          break;
        }
        case "cross": {
          if (!siteBUrl) {
            output.cross = { error: "siteBUrl is required for the cross technique" };
            break;
          }
          const siteBHeaders = buildHeaders(
            siteBCustomHeaders,
            siteBBearerToken,
            siteBAuthHeaderName
          );
          if (siteBBody && !["GET", "HEAD"].includes((siteBMethod ?? method).toUpperCase())) {
            siteBHeaders["Content-Type"] =
              siteBCustomHeaders["content-type"] ??
              siteBCustomHeaders["Content-Type"] ??
              "application/json";
          }
          output.cross = await runCross({
            urlA:    url,
            methodA: method,
            headersA: headers,
            bodyA:   body,
            urlB:    siteBUrl,
            methodB: siteBMethod ?? method,
            headersB: siteBHeaders,
            bodyB:   siteBBody,
            rounds:  Math.min(crossRounds, 20),
          });
          break;
        }
      }
    })
  );

  res.json(output);
});

export default probeRouter;
