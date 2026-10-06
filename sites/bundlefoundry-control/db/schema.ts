import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const automationState = sqliteTable('automation_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
