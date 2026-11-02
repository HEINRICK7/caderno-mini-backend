import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';

export function migrateDatabase(sqlite: Database.Database, migrationsFolder: string): void {
  migrate(drizzle(sqlite), { migrationsFolder });
}
