import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "@opencode-ai/plugin";

const SHELL_BOUNDARIES = new Set([";", "|", "&", "(", ")"]);
const COMMAND_PREFIXES = new Set(["builtin", "command", "noglob", "nohup", "sudo", "time"]);

function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushCurrent = () => {
    if (!current) return;
    tokens.push(current);
    current = "";
  };

  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (!char) continue;

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === "\\") {
        escaped = true;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    if (SHELL_BOUNDARIES.has(char)) {
      pushCurrent();
      tokens.push(char);
      continue;
    }

    current += char;
  }

  pushCurrent();
  return tokens;
}

function splitShellSegments(tokens: string[]): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];

  for (const token of tokens) {
    if (SHELL_BOUNDARIES.has(token)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(token);
  }

  if (current.length > 0) segments.push(current);
  return segments;
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function normalizeCommandTokens(segment: string[]): string[] {
  let index = 0;

  while (index < segment.length) {
    const token = segment[index];
    if (!token) break;

    if (token === "env") {
      index += 1;
      while (index < segment.length && isEnvAssignment(segment[index] ?? "")) index += 1;
      continue;
    }

    if (isEnvAssignment(token) || COMMAND_PREFIXES.has(token)) {
      index += 1;
      continue;
    }

    break;
  }

  return segment.slice(index);
}

function expandHome(token: string): string {
  const home = process.env.HOME;
  if (!home) return token;
  if (token === "~") return home;
  if (token.startsWith("~/")) return path.join(home, token.slice(2));
  return token;
}

function resolveDirectory(baseDir: string, token: string): string {
  return path.resolve(baseDir, expandHome(token));
}

function getSearchStart(candidate: string): string {
  try {
    return statSync(candidate).isDirectory() ? candidate : path.dirname(candidate);
  } catch {
    return candidate;
  }
}

function findJjRoot(candidate: string, cache: Map<string, string | null>): string | null {
  let current = path.resolve(getSearchStart(candidate));
  const visited: string[] = [];

  while (true) {
    const cached = cache.get(current);
    if (cached !== undefined) {
      for (const dir of visited) cache.set(dir, cached);
      return cached;
    }

    visited.push(current);

    const jjDir = path.join(current, ".jj");
    if (existsSync(jjDir) && statSync(jjDir).isDirectory()) {
      for (const dir of visited) cache.set(dir, current);
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      for (const dir of visited) cache.set(dir, null);
      return null;
    }

    current = parent;
  }
}

function extractCommandContext(command: string, baseDir: string) {
  const directories = new Set<string>([path.resolve(baseDir)]);
  let usesGit = false;

  for (const segment of splitShellSegments(tokenizeShell(command))) {
    const normalized = normalizeCommandTokens(segment);
    let executable = normalized[0];
    let args = normalized.slice(1);
    if (!executable) continue;

    if (executable === "rtk" && args[0] === "git") {
      executable = "git";
      args = args.slice(1);
    }

    if (executable === "cd") {
      const target = args[0];
      if (target && target !== "-") {
        directories.add(resolveDirectory(baseDir, target));
      }
      continue;
    }

    if (executable !== "git") continue;
    usesGit = true;

    for (let index = 0; index < args.length; index++) {
      const token = args[index];
      if (!token) continue;

      if (token === "--") break;

      if (token === "-C") {
        const target = args[index + 1];
        if (target) directories.add(resolveDirectory(baseDir, target));
        index += 1;
        continue;
      }

      if (token.startsWith("-C=")) {
        directories.add(resolveDirectory(baseDir, token.slice(3)));
      }
    }
  }

  return { directories, usesGit };
}

export const JjEnforcerPlugin: Plugin = async ({ directory, worktree }) => {
  const jjRoots = new Map<string, string | null>();

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;

      const args =
        output.args && typeof output.args === "object"
          ? (output.args as Record<string, unknown>)
          : undefined;
      const command = typeof args?.command === "string" ? args.command : "";
      if (!command) return;

      const baseDir =
        typeof args?.workdir === "string" && args.workdir
          ? path.resolve(args.workdir)
          : path.resolve(directory);
      const { directories, usesGit } = extractCommandContext(command, baseDir);
      if (!usesGit) return;

      directories.add(path.resolve(directory));
      directories.add(path.resolve(worktree));

      for (const candidate of directories) {
        const jjRoot = findJjRoot(candidate, jjRoots);
        if (!jjRoot) continue;

        throw new Error(
          `Detected a Jujutsu repository at ${jjRoot}. Use jj instead of git in this workspace.`,
        );
      }
    },
  };
};

export default JjEnforcerPlugin;
