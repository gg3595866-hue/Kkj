import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const savedRequestsTable = pgTable("saved_requests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  method: text("method").notNull(),
  headers: jsonb("headers").$type<Record<string, string>>(),
  bearerToken: text("bearer_token"),
  body: text("body"),
  contentType: text("content_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSavedRequestSchema = createInsertSchema(savedRequestsTable).omit({ id: true, createdAt: true });
export type InsertSavedRequest = z.infer<typeof insertSavedRequestSchema>;
export type SavedRequest = typeof savedRequestsTable.$inferSelect;
