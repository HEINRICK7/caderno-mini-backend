import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './apps/api/src/infrastructure/database/schema.ts',
  out: './apps/api/src/infrastructure/database/migrations',
  dbCredentials: { url: process.env.DATABASE_FILE ?? './data/caderno-mini.sqlite' },
});
