import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JjEnforcerPlugin } from "./jj-enforcer";

function createTempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

async function createHooks(directory: string, worktree = directory) {
  return JjEnforcerPlugin({ directory, worktree } as any);
}

describe("JjEnforcerPlugin", () => {
  test("blocks git commands when current directory is inside a jj repo", async () => {
    const root = createTempDir("jj-enforcer-root-");
    const nested = path.join(root, "packages", "app");
    mkdirSync(path.join(root, ".jj"));
    mkdirSync(nested, { recursive: true });

    try {
      const hooks = await createHooks(nested);

      await expect(
        hooks["tool.execute.before"]?.(
          {
            tool: "bash",
            sessionID: "session-1",
            callID: "call-1",
          },
          { args: { command: "git status" } },
        ),
      ).rejects.toThrow("Use jj instead of git");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows git commands when no jj repo is present", async () => {
    const directory = createTempDir("jj-enforcer-plain-");

    try {
      const hooks = await createHooks(directory);

      await expect(
        hooks["tool.execute.before"]?.(
          {
            tool: "bash",
            sessionID: "session-2",
            callID: "call-2",
          },
          { args: { command: "git status" } },
        ),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("blocks git -C when one of the target directories is a jj repo", async () => {
    const root = createTempDir("jj-enforcer-multi-");
    const workspace = path.join(root, "workspace");
    const plainRepo = path.join(root, "plain-repo");
    const jjRepo = path.join(root, "jj-repo");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(plainRepo, { recursive: true });
    mkdirSync(path.join(jjRepo, ".jj"), { recursive: true });

    try {
      const hooks = await createHooks(workspace);

      await expect(
        hooks["tool.execute.before"]?.(
          {
            tool: "bash",
            sessionID: "session-3",
            callID: "call-3",
          },
          {
            args: {
              command: `git -C "${plainRepo}" status && git -C "${jjRepo}" log`,
            },
          },
        ),
      ).rejects.toThrow(`Detected a Jujutsu repository at ${jjRepo}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("blocks git after changing into a jj repo with cd", async () => {
    const root = createTempDir("jj-enforcer-cd-");
    const workspace = path.join(root, "workspace");
    const jjRepo = path.join(root, "repo");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(path.join(jjRepo, ".jj"), { recursive: true });

    try {
      const hooks = await createHooks(workspace);

      await expect(
        hooks["tool.execute.before"]?.(
          {
            tool: "bash",
            sessionID: "session-4",
            callID: "call-4",
          },
          {
            args: {
              command: `cd "${jjRepo}" && git status`,
            },
          },
        ),
      ).rejects.toThrow(`Detected a Jujutsu repository at ${jjRepo}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not block plain text containing git", async () => {
    const directory = createTempDir("jj-enforcer-echo-");

    try {
      const hooks = await createHooks(directory);

      await expect(
        hooks["tool.execute.before"]?.(
          {
            tool: "bash",
            sessionID: "session-5",
            callID: "call-5",
          },
          {
            args: {
              command: 'echo "git status"',
            },
          },
        ),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("blocks rtk git commands inside a jj repo", async () => {
    const root = createTempDir("jj-enforcer-rtk-");
    mkdirSync(path.join(root, ".jj"));

    try {
      const hooks = await createHooks(root);

      await expect(
        hooks["tool.execute.before"]?.(
          {
            tool: "bash",
            sessionID: "session-6",
            callID: "call-6",
          },
          {
            args: {
              command: "rtk git log",
            },
          },
        ),
      ).rejects.toThrow("Use jj instead of git");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
