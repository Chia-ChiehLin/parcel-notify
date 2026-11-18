import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  schemaFilter: ['app'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/parcel_notify',
  },
});
