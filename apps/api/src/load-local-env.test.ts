import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalEnv } from "./load-local-env.js";

const createdDirectories: string[] = [];
const VARIABLE = "TAB10_LOAD_ENV_TEST_VALUE";

afterEach(async () => {
  delete process.env[VARIABLE];
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("loadLocalEnv", () => {
  it("ignores a missing local env file", () => {
    expect(() => loadLocalEnv(path.join(tmpdir(), "tab10-missing.env"))).not.toThrow();
  });

  it("loads values without overriding an existing process value", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tab10-env-"));
    createdDirectories.push(directory);
    const envPath = path.join(directory, ".env");
    await writeFile(envPath, `${VARIABLE}=from-file\n`);

    process.env[VARIABLE] = "from-process";
    loadLocalEnv(envPath);

    expect(process.env[VARIABLE]).toBe("from-process");
  });
});
