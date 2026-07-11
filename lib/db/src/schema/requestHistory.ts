import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRequestHistorySchema = createInsertSchema(requestHistoryTable).omit({ id: true, createdAt: true });
export type InsertRequestHistory = z.infer<typeof insertRequestHistorySchema>;
export type RequestHistory = typeof requestHistoryTable.$inferSelect;
