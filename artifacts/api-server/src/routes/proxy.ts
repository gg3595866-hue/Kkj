import { Router } from "express";
import { db } from "@workspace/db";
import { savedRequestsTable, requestHistoryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { fetch as undiciFetch, Agent } from "undici";

const proxyRouter = Router();

// Reusable agent that bypasses SSL cert errors (needed for private/internal APIs)
const insecureAgent = new Agent({
  connect: { rejectUnauthorized: false },
});

// Default browser-like headers so APIs don't reject server-side requests
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

// POST /api/proxy/send
proxyRouter.post("/proxy/send", async (req, res) => {
  const {
    url,
    method,
    headers: customHeaders = {},
    bearerToken,
    body,
    contentType,
  } = req.body;

  if (!url || !method) {
    res.status(400).json({ error: "url and method are required" });
    return;
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: `Invalid URL: "${url}" — must start with https:// or http://` });
    return;
  }

  // Build headers: defaults first, then custom, then auth on top
  const requestHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...customHeaders,
  };

  if (bearerToken) {
    requestHeaders["Authorization"] = `Bearer ${bearerToken}`;
  }
  if (contentType) {
    requestHeaders["Content-Type"] = contentType;
  } else if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    // Auto-detect JSON
    try {
      JSON.parse(body);
      requestHeaders["Content-Type"] = "application/json";
    } catch {
      // not JSON — leave content-type unset
    }
  }

  const startTime = Date.now();

  try {
    const fetchOptions: Parameters<typeof undiciFetch>[1] = {
      method,
      headers: requestHeaders,
      // @ts-expect-error undici dispatcher type
      dispatcher: insecureAgent,
      // 30-second timeout
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    };

    if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
      fetchOptions.body = body;
    }

    const response = await undiciFetch(parsedUrl.toString(), fetchOptions);
    const durationMs = Date.now() - startTime;

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      responseHeaders[key] = value;
    });

    const responseBody = await response.text();
    const truncated =
      responseBody.length > 200_000
        ? responseBody.slice(0, 200_000) + "\n\n... (truncated at 200 KB)"
        : responseBody;

    const [historyEntry] = await db
      .insert(requestHistoryTable)
      .values({
        url,
        method: method.toUpperCase(),
        status: response.status,
        statusText: response.statusText || String(response.status),
        requestHeaders,
        responseHeaders,
        responseBody: truncated,
        durationMs,
      })
      .returning();

    res.json({
      status: response.status,
      statusText: response.statusText || String(response.status),
      headers: responseHeaders,
      body: truncated,
      durationMs,
      historyId: historyEntry.id,
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;

    let errorMessage = "Unknown error";
    if (err instanceof Error) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        errorMessage = `Request timed out after 30 seconds (${url})`;
      } else if (
        err.message.includes("ENOTFOUND") ||
        err.message.includes("getaddrinfo")
      ) {
        errorMessage = `DNS lookup failed — host not found: ${parsedUrl.hostname}`;
      } else if (err.message.includes("ECONNREFUSED")) {
        errorMessage = `Connection refused by ${parsedUrl.hostname}:${parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80")}`;
      } else if (err.message.includes("ECONNRESET")) {
        errorMessage = `Connection reset by server at ${parsedUrl.hostname}`;
      } else {
        errorMessage = err.message;
      }
    }

    const [historyEntry] = await db
      .insert(requestHistoryTable)
      .values({
        url,
        method: method.toUpperCase(),
        status: 0,
        statusText: "Network Error",
        requestHeaders,
        responseHeaders: {},
        responseBody: errorMessage,
        durationMs,
      })
      .returning();

    res.status(200).json({
      status: 0,
      statusText: "Network Error",
      headers: {},
      body: errorMessage,
      durationMs,
      historyId: historyEntry.id,
    });
  }
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
  const { name, url, method, headers, bearerToken, body, contentType } =
    req.body;

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
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { name, url, method, headers, bearerToken, body, contentType } =
    req.body;

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

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(updated);
});

// DELETE /api/proxy/requests/:id
proxyRouter.delete("/proxy/requests/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

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
