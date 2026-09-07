import { spawnSync } from "node:child_process";
import { constants as osConstants } from "node:os";
import path from "node:path";

const REPOSITORY_COMMANDS = new Set(["ci", "doctor"]);

export function dispatchPnpmArguments(arguments_) {
  const args = [...arguments_];
  if (REPOSITORY_COMMANDS.has(args[0])) {
    return ["pnpm", "run", ...args];
  }
  return ["pnpm", ...args];
}

export function resolveCorepackExecutable({
  execPath = process.execPath,
  platform = process.platform,
} = {}) {
  return path.join(
    path.dirname(execPath),
    platform === "win32" ? "corepack.cmd" : "corepack",
  );
}

export function runPnpmDispatcher(arguments_, options = {}) {
  const executable = resolveCorepackExecutable(options);
  const args = dispatchPnpmArguments(arguments_);
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) {
    const signalNumber = osConstants.signals[result.signal];
    return typeof signalNumber === "number" ? 128 + signalNumber : 1;
  }
  return result.status ?? 1;
}
