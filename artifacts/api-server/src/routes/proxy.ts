import { Router } from "express";
import { db } from "@workspace/db";
import { savedRequestsTable, requestHistoryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const proxyRouter = Router();

// POST /api/proxy/send
proxyRouter.post("/proxy/send", async (req, res) => {
  const { url, method, headers: customHeaders = {}, bearerToken, body, contentType } = req.body;

  if (!url || !method) {
    res.status(400).json({ error: "url and method are required" });
    return;
  }

  const requestHeaders: Record<string, string> = { ...customHeaders };
  if (bearerToken) {
    requestHeaders["Authorization"] = `Bearer ${bearerToken}`;
  }
  if (contentType) {
    requestHeaders["Content-Type"] = contentType;
  }

  const startTime = Date.now();

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);
    const durationMs = Date.now() - startTime;

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseBody = await response.text();

    // Save to history
    const [historyEntry] = await db.insert(requestHistoryTable).values({
      url,
      method: method.toUpperCase(),
      status: response.status,
      statusText: response.statusText,
      requestHeaders,
      responseHeaders,
      responseBody: responseBody.length > 100000 ? responseBody.slice(0, 100000) + "\n... (truncated)" : responseBody,
      durationMs,
    }).returning();

    res.json({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody.length > 100000 ? responseBody.slice(0, 100000) + "\n... (truncated)" : responseBody,
      durationMs,
      historyId: historyEntry.id,
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    // Save failed request to history
    const [historyEntry] = await db.insert(requestHistoryTable).values({
      url,
      method: method.toUpperCase(),
      status: 0,
      statusText: "Network Error",
      requestHeaders,
      responseHeaders: {},
      responseBody: errorMessage,
      durationMs,
    }).returning();

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
proxyRouter.get("/proxy/requests", async (req, res) => {
  const saved = await db.select().from(savedRequestsTable).orderBy(desc(savedRequestsTable.createdAt));
  res.json(saved);
});

// POST /api/proxy/requests
proxyRouter.post("/proxy/requests", async (req, res) => {
  const { name, url, method, headers, bearerToken, body, contentType } = req.body;

  if (!name || !url || !method) {
    res.status(400).json({ error: "name, url, and method are required" });
    return;
  }

  const [created] = await db.insert(savedRequestsTable).values({
    name,
    url,
    method: method.toUpperCase(),
    headers: headers ?? {},
    bearerToken: bearerToken ?? null,
    body: body ?? null,
    contentType: contentType ?? null,
  }).returning();

  res.status(201).json(created);
});

// PUT /api/proxy/requests/:id
proxyRouter.put("/proxy/requests/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { name, url, method, headers, bearerToken, body, contentType } = req.body;

  const [updated] = await db.update(savedRequestsTable)
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
  const history = await db.select()
    .from(requestHistoryTable)
    .orderBy(desc(requestHistoryTable.createdAt))
    .limit(isNaN(limit) ? 50 : limit);
  res.json(history);
});

// DELETE /api/proxy/history
proxyRouter.delete("/proxy/history", async (req, res) => {
  await db.delete(requestHistoryTable);
  res.status(204).send();
});

export default proxyRouter;
