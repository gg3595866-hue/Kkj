import { pgTable, serial, text, timestamp, jsonb, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const requestHistoryTable = pgTable("request_history", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  method: text("method").notNull(),
  status: integer("status").notNull(),
  statusText: text("status_text").notNull(),
  requestHeaders: jsonb("request_headers").$type<Record<string, string>>(),
  responseHeaders: jsonb("response_headers").$type<Record<string, string>>(),
  responseBody: text("response_body"),
  durationMs: integer("duration_ms").notNull(),
  transportOutcome: text("transport_outcome"),
  hops: jsonb("hops").$type<Array<{
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string | string[]>;
    durationMs: number;
  }>>(),
  bodySizeBytes: integer("body_size_bytes"),
  bodyTruncated: boolean("body_truncated").default(false),
  errorDetails: jsonb("error_details").$type<{
    outcome: string;
    errorCode: string | null;
    errorMessage: string;
    syscall: string | null;
    causeChain: Array<{ message: string; code?: string; syscall?: string }>;
  } | null>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRequestHistorySchema = createInsertSchema(requestHistoryTable).omit({ id: true, createdAt: true });
export type InsertRequestHistory = z.infer<typeof insertRequestHistorySchema>;
export type RequestHistory = typeof requestHistoryTable.$inferSelect;
