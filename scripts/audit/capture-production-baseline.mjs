#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--out");
const output = outputIndex === -1 ? undefined : args[outputIndex + 1];
if (output) {
  const outputPath = path.resolve(ROOT, output);
  try {
    await access(outputPath);
    throw new Error(
      `Refusing to overwrite immutable production evidence: ${path.relative(ROOT, outputPath)}`,
    );
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) {
      throw error;
    }
  }
}
const targets = [
  ["web", "https://tab-10.vercel.app/"],
  ["apiHealth", "https://one0is-ball.onrender.com/health"],
  ["proxyHealth", "https://tab-10.vercel.app/health"],
  ["openApi", "https://one0is-ball.onrender.com/api/v1/openapi.json"],
];

async function localHash(relativePath) {
  try {
    const bytes = await readFile(path.join(ROOT, relativePath));
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

async function capture(name, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65_000);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Tab10-Audit-Baseline/1.0" },
    });
    const body = await response.text();
    const result = {
      name,
      requestedUrl: url,
      finalUrl: response.url,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      contentType: response.headers.get("content-type"),
      contentLength: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    if (name === "openApi") {
      const spec = JSON.parse(body);
      result.openApiVersion = spec.openapi;
      result.apiVersion = spec.info?.version;
      result.pathCount = Object.keys(spec.paths ?? {}).length;
    }
    if (name === "web") {
      const localHtmlSha256 = await localHash("apps/web/dist/index.html");
      result.localBuild = {
        htmlSha256: localHtmlSha256,
        htmlMatches: localHtmlSha256 === result.sha256,
      };
      const assetRefs = [...body.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)]
        .map((match) => new URL(match[1], response.url).href);
      result.assets = [];
      for (const assetUrl of [...new Set(assetRefs)].sort()) {
        const assetResponse = await fetch(assetUrl, {
          method: "GET",
          signal: controller.signal,
          headers: { "user-agent": "Tab10-Audit-Baseline/1.0" },
        });
        const assetBody = await assetResponse.arrayBuffer();
        const pathname = new URL(assetResponse.url).pathname.replace(/^\/+/, "");
        const localSha256 = await localHash(path.join("apps/web/dist", pathname));
        const sha256 = createHash("sha256").update(new Uint8Array(assetBody)).digest("hex");
        result.assets.push({
          url: assetResponse.url,
          status: assetResponse.status,
          contentLength: assetBody.byteLength,
          sha256,
          localSha256,
          matchesLocalBuild: localSha256 === sha256,
        });
      }
    }
    return result;
  } catch (error) {
    return {
      name,
      requestedUrl: url,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.name : "UnknownError",
    };
  } finally {
    clearTimeout(timeout);
  }
}

const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  mutationPolicy: "read-only GET requests",
  targets: [],
};
for (const [name, url] of targets) report.targets.push(await capture(name, url));

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  const outputPath = path.resolve(ROOT, output);
  try {
    await writeFile(outputPath, serialized, { flag: "wx" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      throw new Error(
        `Refusing to overwrite immutable production evidence: ${path.relative(ROOT, outputPath)}`,
      );
    }
    throw error;
  }
}
console.log(serialized.trimEnd());
