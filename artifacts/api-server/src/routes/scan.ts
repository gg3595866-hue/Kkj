import { Router } from "express";
import { fetch as undiciFetch, Agent } from "undici";
import { describeFetchError } from "../lib/fetch-error";

const scanRouter = Router();

// Scanning fires many probes at the same origin at once. undici's default
// pool caps at 10 connections/origin, so with a wordlist of 60+ paths most
// probes queue behind the first 10 and eventually hit the per-request
// timeout waiting for a socket — even though the target responds fine to
// each individual request. Raise the pool size so our own client isn't the
// bottleneck (concurrency is additionally throttled below).
const insecureAgent = new Agent({
  connect: { rejectUnauthorized: false },
  connections: 32,
});

// Simple bounded-concurrency runner: process `items` with at most `limit`
// in flight at a time, instead of firing everything at once.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function looksLikeData(body: string, status: number): boolean {
  if (status === 0 || status >= 500) return false;
  if (status === 404) return false;
  if (!body || body.trim().length === 0) return false;
  // Anything 2xx or 3xx that has a non-empty body counts
  if (status >= 200 && status < 400) return true;
  // 4xx with a JSON body that isn't just an error string may still be interesting
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) return true;
  } catch {
    // not json
  }
  return false;
}

// POST /api/proxy/scan
scanRouter.post("/proxy/scan", async (req, res) => {
  const {
    baseUrl,
    paths,
    queryParams,
    bearerToken,
    authHeaderName,
    headers: customHeaders = {},
    postBody,
    scanMethod,  // "AUTO" | "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS"
  } = req.body;

  if (!baseUrl || !Array.isArray(paths) || paths.length === 0) {
    res.status(400).json({ error: "baseUrl and paths[] are required" });
    return;
  }

  const base = baseUrl.replace(/\/$/, "");
  const qs = queryParams ? `?${queryParams}` : "";

  const requestHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...customHeaders,
  };
  if (bearerToken) {
    const headerName =
      authHeaderName && authHeaderName.trim()
        ? authHeaderName.trim()
        : "Authorization";
    // For the standard Authorization header, prepend "Bearer ".
    // For custom auth headers (x-auth, X-Token, etc.) the raw token is used
    // as-is — these APIs typically don't expect the "Bearer " prefix.
    const isStandardAuth = headerName.toLowerCase() === "authorization";
    requestHeaders[headerName] = isStandardAuth
      ? `Bearer ${bearerToken}`
      : bearerToken;
  }

  // Determine which HTTP methods to try for each path.
  // AUTO = GET first, then POST if GET gives nothing useful.
  // Any explicit method = only that method.
  const resolvedMethod = (scanMethod ?? "AUTO").toUpperCase();
  const methodsToTry: string[] = resolvedMethod === "AUTO"
    ? ["GET", "POST"]
    : [resolvedMethod];

  // Probe a single path against a single base URL, returning the best result.
  const probeUrl = async (targetBase: string, path: string) => {
    const url = `${targetBase.replace(/\/$/, "")}/${path}${qs}`;
    const attempts = [];

    for (const method of methodsToTry) {
      // In AUTO mode, skip POST if no body provided and GET already returned data
      if (resolvedMethod === "AUTO" && method === "POST" && !postBody && attempts.some((r: any) => r.hasData)) {
        continue;
      }

      const startTime = Date.now();
      try {
        const opts: Parameters<typeof undiciFetch>[1] = {
          method,
          headers: {
            ...requestHeaders,
            ...(method === "POST" && postBody
              ? { "Content-Type": "application/json" }
              : {}),
          },
          // @ts-expect-error undici dispatcher
          dispatcher: insecureAgent,
          signal: AbortSignal.timeout(10_000),
          redirect: "follow",
        };

        if (method === "POST" && postBody) {
          opts.body = postBody;
        }

        const response = await undiciFetch(url, opts);
        const durationMs = Date.now() - startTime;
        const body = await response.text();
        const truncated =
          body.length > 5000 ? body.slice(0, 5000) + "\n...(truncated)" : body;
        const hasData = looksLikeData(body, response.status);

        attempts.push({
          path,
          method,
          status: response.status,
          statusText: response.statusText || String(response.status),
          durationMs,
          hasData,
          body: truncated,
          error: null,
        });

        if (hasData && method === "GET" && !postBody) break;
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        let hostname: string | undefined;
        try { hostname = new URL(url).hostname; } catch { /* ignore */ }
        const errorMessage =
          err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
            ? "Timed out (10s)"
            : describeFetchError(err, hostname);
        attempts.push({
          path,
          method,
          status: 0,
          statusText: "Network Error",
          durationMs,
          hasData: false,
          body: null,
          error: errorMessage,
        });
        break;
      }
    }

    return attempts.find((r) => r.hasData) ?? attempts[attempts.length - 1];
  };

  const backendUrl: string | undefined = req.body.backendUrl?.trim();
  const isDual = !!backendUrl;

  const probeOne = async (path: string) => {
    if (!isDual) {
      return probeUrl(base, path);
    }
    // Dual-target: probe client URL and backend URL simultaneously
    const [clientResult, backendResult] = await Promise.all([
      probeUrl(base, path),
      probeUrl(backendUrl!, path),
    ]);
    const statusMismatch = clientResult.status !== backendResult.status;
    const hasDataMismatch = clientResult.hasData !== backendResult.hasData;
    return {
      path,
      isDual: true,
      // Expose top-level hasData as true if either responded with data (surface in summary)
      hasData: clientResult.hasData || backendResult.hasData,
      statusMismatch,
      hasDataMismatch,
      client: clientResult,
      backend: backendResult,
    };
  };

  const results = await mapWithConcurrency(paths, 10, probeOne);
  res.json(results);
});

export default scanRouter;
