#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import { disposableDatabaseUrl } from "./lib.mjs";

if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV) {
  throw new Error("This helper may only write the GitHub Actions job environment");
}

const url = disposableDatabaseUrl({
  username: "tab10_test",
  password: "",
  database: "tab10_test",
  port: 5432,
});
await appendFile(process.env.GITHUB_ENV, `TEST_DATABASE_URL=${url}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log("Disposable loopback TEST_DATABASE_URL configured without logging it");
