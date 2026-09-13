import { defineConfig } from "drizzle-kit";
import { loadLocalEnv } from "./src/load-local-env.ts";

loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for drizzle-kit commands");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
