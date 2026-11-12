import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceDocuments = sqliteTable("workspace_documents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
