import * as net from "node:net";
import * as tls from "node:tls";
import type { RaceResult, RaceAttempt } from "@workspace/api-zod";

// ─── Technique 4: Request racing (single-packet / last-byte-sync attack) ─────
// Classic race-condition testing technique (see PortSwigger/James Kettle,
// "Smashing the State Machine"). A naive Promise.all() of separate fetch()
// calls is NOT enough to win a race: TCP/TLS handshake jitter and Node's own
// connection pooling spread request arrival times out over tens of
// milliseconds, which is easily wider than the server's internal
// check-then-act window — so the server serializes them and only the first
// one ever lands inside the vulnerable window.
//
// Instead we:
//   1. Open N raw sockets (bypassing undici's pool entirely) and let the
//      TCP/TLS handshake complete and settle — this "warm phase" happens
//      well before the race window and is NOT time-critical.
//   2. Build the full raw HTTP/1.1 request for each connection and split it
//      into a "prefix" (everything except the last byte) and a 1-byte
//      "suffix". Write every prefix first and wait for it to drain — the
//      server can read/buffer these bytes but the request is not yet
//      complete (final CRLFCRLF, or last body byte, hasn't arrived), so it
//      cannot be dispatched to application code yet.
//   3. Release: loop over every socket and write its suffix byte with NO
//      `await` between writes (same synchronous tick / microtask), so the
//      OS hands all N segments to the network stack as close to
//      simultaneously as possible.
//   4. Read back each response with a small hand-rolled HTTP/1.1 parser
//      (status line, headers, Content-Length/chunked/close-delimited body).
//
// This bypasses undici/fetch for the write path on purpose — undici's
// connection pool and Node's own scheduler are exactly the sources of jitter
// we're trying to eliminate.

interface RaceOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null | undefined;
  connections: number;
}

export function buildRawHttp1Request(
  urlObj: URL,
  method: string,
  headers: Record<string, string>,
  body: string | null | undefined
): Buffer {
  const hasBody = !!body && !["GET", "HEAD"].includes(method.toUpperCase());
  const path = `${urlObj.pathname}${urlObj.search}` || "/";

  const finalHeaders: Record<string, string> = {
    Host: urlObj.host,
    ...headers,
    Connection: "close", // we only need one response per socket, then we're done
  };
  if (hasBody) {
    finalHeaders["Content-Length"] = String(Buffer.byteLength(body!, "utf8"));
  } else {
    delete finalHeaders["Content-Length"];
  }

  const headerLines = Object.entries(finalHeaders)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");

  const head = `${method.toUpperCase()} ${path} HTTP/1.1\r\n${headerLines}\r\n\r\n`;
  const headBuf = Buffer.from(head, "utf8");
  return hasBody ? Buffer.concat([headBuf, Buffer.from(body!, "utf8")]) : headBuf;
}

// Node throws (and crashes the whole process) if a socket emits 'error' with
// zero listeners attached at that moment. Raw sockets racing against a
// real network target WILL sometimes error asynchronously — after we've
// already settled their connect promise, mid-write, or while another
// socket in the batch is still being read — so every socket in this module
// gets one baseline listener attached for its *entire* lifetime, in
// addition to whatever short-lived `once` listeners individual phases add.
// This baseline listener never throws; it just guarantees Node always sees
// at least one 'error' listener so the event can never become "unhandled".
export function armBaselineErrorHandler(sock: net.Socket | tls.TLSSocket): void {
  sock.on("error", () => {
    // Intentionally a no-op safety net. Real handling/reporting happens in
    // the phase-specific `once("error", ...)` listeners below, which race
    // against this one and run in the same tick.
  });
}

export function connectSocket(urlObj: URL, timeoutMs: number): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const isTls = urlObj.protocol === "https:";
    const port = urlObj.port ? Number(urlObj.port) : isTls ? 443 : 80;

    let settled = false;
    let sock: net.Socket | tls.TLSSocket;

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(err);
    };
    const onTimeout = () => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new Error("Connection timed out"));
    };
    const onConnect = () => {
      if (settled) return;
      settled = true;
      resolve(sock);
    };

    if (isTls) {
      sock = tls.connect({
        host: urlObj.hostname,
        port,
        servername: urlObj.hostname,
        rejectUnauthorized: false, // matches the insecure-agent pattern used elsewhere in this tool
        timeout: timeoutMs,
      });
    } else {
      sock = net.connect({ host: urlObj.hostname, port, timeout: timeoutMs });
    }
    armBaselineErrorHandler(sock);
    sock.once(isTls ? "secureConnect" : "connect", onConnect);
    sock.once("error", onError);
    sock.once("timeout", onTimeout);
  });
}

export function writeAndDrain(sock: net.Socket, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    sock.once("error", onError);
    const ok = sock.write(chunk, (err) => {
      sock.removeListener("error", onError);
      if (err) reject(err);
    });
    if (ok) {
      sock.removeListener("error", onError);
      resolve();
    } else {
      sock.once("drain", () => {
        sock.removeListener("error", onError);
        resolve();
      });
    }
  });
}

interface ParsedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/** Minimal HTTP/1.1 response reader: status line + headers, then
 * Content-Length / chunked / read-to-close body, capped to a preview size. */
export function readResponse(sock: net.Socket, readTimeoutMs: number, bodyCapBytes = 4_000): Promise<ParsedResponse> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let headersParsed = false;
    let status = 0;
    let statusText = "";
    let headers: Record<string, string> = {};
    let headerEndIdx = -1;
    let contentLength: number | null = null;
    let chunked = false;
    let bodyChunks: Buffer[] = [];
    let bodyBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      finish();
    }, readTimeoutMs);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.removeListener("data", onData);
      sock.removeListener("end", onEnd);
      sock.removeListener("error", onErr);
      resolve({
        status,
        statusText,
        headers,
        body: Buffer.concat(bodyChunks).toString("utf8"),
      });
    };
    const onErr = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.removeListener("data", onData);
      sock.removeListener("end", onEnd);
      reject(err);
    };
    const onEnd = () => finish();

    function parseHeadersIfReady() {
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      headerEndIdx = idx;
      const headerText = buf.subarray(0, idx).toString("utf8");
      const lines = headerText.split("\r\n");
      const statusLine = lines[0] || "";
      const m = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)\s*(.*)$/);
      status = m ? Number(m[1]) : 0;
      statusText = m ? m[2] : statusLine;
      headers = {};
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        const k = line.slice(0, colon).trim().toLowerCase();
        const v = line.slice(colon + 1).trim();
        headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
      }
      headersParsed = true;
      chunked = (headers["transfer-encoding"] || "").toLowerCase().includes("chunked");
      contentLength = headers["content-length"] ? Number(headers["content-length"]) : null;

      // Anything after the header terminator is already body bytes.
      const rest = buf.subarray(idx + 4);
      buf = rest;
      consumeBody();
    }

    function consumeBody() {
      if (!headersParsed) return;
      if (chunked) {
        // Best-effort chunked decode: we only need a preview, not perfect
        // RFC compliance for the truncated tail.
        while (buf.length > 0) {
          const lineEnd = buf.indexOf("\r\n");
          if (lineEnd === -1) return; // need more data
          const sizeLine = buf.subarray(0, lineEnd).toString("utf8").split(";")[0].trim();
          const size = parseInt(sizeLine, 16);
          if (Number.isNaN(size)) {
            // Malformed/truncated — stop trying to parse further.
            finish();
            return;
          }
          if (size === 0) {
            finish();
            return;
          }
          if (buf.length < lineEnd + 2 + size + 2) return; // wait for full chunk
          const chunk = buf.subarray(lineEnd + 2, lineEnd + 2 + size);
          bodyChunks.push(chunk);
          bodyBytes += chunk.length;
          buf = buf.subarray(lineEnd + 2 + size + 2);
          if (bodyBytes >= bodyCapBytes) {
            finish();
            return;
          }
        }
      } else if (contentLength !== null) {
        const need = Math.min(contentLength, bodyCapBytes);
        if (buf.length >= need) {
          bodyChunks.push(buf.subarray(0, need));
          finish();
        }
        // else wait for more data
      } else {
        // No Content-Length, not chunked: read until socket closes
        // (bounded by bodyCapBytes / read timeout as a safety net).
        if (buf.length > 0) {
          bodyChunks.push(buf.subarray(0, Math.min(buf.length, bodyCapBytes)));
          bodyBytes += buf.length;
          buf = Buffer.alloc(0);
          if (bodyBytes >= bodyCapBytes) finish();
        }
      }
    }

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!headersParsed) {
        parseHeadersIfReady();
      } else {
        consumeBody();
      }
    };

    sock.on("data", onData);
    sock.once("end", onEnd);
    sock.once("error", onErr);
  });
}

export async function runRace(opts: RaceOptions): Promise<RaceResult> {
  const { url, method, headers, body, connections } = opts;
  const n = Math.max(2, Math.min(connections || 10, 50));
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    return {
      releaseSkewMs: 0,
      successCount: 0,
      raceLikely: false,
      error: "Invalid URL",
      attempts: [],
    };
  }

  const reqBuf = buildRawHttp1Request(urlObj, method, headers, body);
  // Split off a 1-byte suffix — the very last byte of the blank line that
  // terminates the headers (or the last body byte, if there's a body). Until
  // this byte arrives, most HTTP/1.1 servers cannot recognize the request as
  // complete and will not hand it to application code.
  const prefix = reqBuf.subarray(0, reqBuf.length - 1);
  const suffix = reqBuf.subarray(reqBuf.length - 1);

  const attempts: RaceAttempt[] = [];
  const sockets: (net.Socket | tls.TLSSocket)[] = [];
  const batchStart = Date.now();

  // ── Warm phase: connect + send prefixes (not time-critical) ──────────────
  const connectResults = await Promise.allSettled(
    Array.from({ length: n }, async (_, i) => {
      const connectStart = Date.now();
      const sock = await connectSocket(urlObj, 10_000);
      sock.setNoDelay(true); // disable Nagle's algorithm — otherwise the OS
      // may coalesce/delay our tiny synchronized suffix write, reintroducing
      // exactly the jitter we're trying to eliminate.
      const connectMs = Date.now() - connectStart;
      await writeAndDrain(sock, Buffer.from(prefix));
      sockets[i] = sock;
      return { i, connectMs };
    })
  );

  const connectedIdx: number[] = [];
  connectResults.forEach((r, i) => {
    if (r.status === "fulfilled") {
      connectedIdx.push(i);
      attempts[i] = {
        index: i,
        status: 0,
        connectMs: (r.value as { connectMs: number }).connectMs,
      };
    } else {
      attempts[i] = {
        index: i,
        status: 0,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    }
  });

  if (connectedIdx.length === 0) {
    return {
      releaseSkewMs: 0,
      successCount: 0,
      raceLikely: false,
      error: "Could not establish any connections",
      attempts,
    };
  }

  // ── Release phase: fire the suffix byte on every open socket back-to-back,
  //    with no `await` between writes, so they leave in the same tick. ──────
  const releaseStart = Date.now();
  const suffixSentAt: number[] = [];
  for (const i of connectedIdx) {
    sockets[i].write(suffix);
    suffixSentAt[i] = Date.now() - releaseStart;
  }
  const releaseEnd = Date.now();
  const releaseSkewMs = releaseEnd - releaseStart;

  // ── Read responses back on every connection in parallel ───────────────────
  await Promise.allSettled(
    connectedIdx.map(async (i) => {
      const firstByteStart = Date.now();
      try {
        const resp = await readResponse(sockets[i] as net.Socket, 10_000);
        attempts[i] = {
          ...attempts[i],
          status: resp.status,
          statusText: resp.statusText,
          responseHeaders: resp.headers,
          body: resp.body.length > 4_000 ? resp.body.slice(0, 4_000) + "\n…(truncated)" : resp.body,
          suffixSentAt: suffixSentAt[i],
          firstByteAtMs: Date.now() - firstByteStart,
        };
      } catch (err: unknown) {
        attempts[i] = {
          ...attempts[i],
          status: 0,
          error: err instanceof Error ? err.message : String(err),
          suffixSentAt: suffixSentAt[i],
        };
      } finally {
        sockets[i].destroy();
      }
    })
  );

  const successCount = attempts.filter((a) => a.status >= 200 && a.status < 300).length;

  return {
    releaseSkewMs,
    successCount,
    raceLikely: successCount > 1,
    note:
      successCount > 1
        ? `${successCount} of ${connectedIdx.length} connections received a success response — the requests landed inside the same check-then-act window. Race condition confirmed.`
        : successCount === 1
        ? `Only 1 of ${connectedIdx.length} connections succeeded — the server serialized the requests (or there is no race window on this endpoint). Try more connections or check releaseSkewMs.`
        : `No connection received a success response (all declined or errored) — see individual attempts.`,
    error: null,
    attempts: attempts.map((a, i) => attempts[i] ?? a),
  };
}
