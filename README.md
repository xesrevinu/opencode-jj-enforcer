# opencode-jj-enforcer

`opencode-jj-enforcer` is an [OpenCode](https://opencode.ai) plugin that blocks `git` usage inside Jujutsu workspaces and forces agents to use `jj` instead.

It is intended for teams that already standardized on Jujutsu and want a hard guardrail against accidental `git` commands from agents.

## What it does

- Inspects `bash` tool calls before execution
- Detects Jujutsu repositories by walking upward for a `.jj/` directory
- Blocks direct `git` commands such as `git status` and `git log`
- Blocks `git -C <dir> ...` when any targeted directory belongs to a Jujutsu repo
- Blocks `cd <dir> && git ...` patterns inside multi-step shell commands
- Recognizes wrapper-style commands such as `rtk git log` so rewrite plugins cannot bypass the policy

## Install

Use it as a packaged plugin in `opencode.jsonc`:

```jsonc
{
  "plugin": ["@xesrevinu/opencode-jj-enforcer@latest"]
}
```

Then restart OpenCode.

## Local Source Mode

If you want to iterate locally instead of using npm:

```bash
mkdir -p .opencode/plugin
cp plugin/jj-enforcer.ts .opencode/plugin/jj-enforcer.ts
```

## Behavior

The plugin checks these directory sources when deciding whether to block a command:

- The current OpenCode workspace directory
- The active `workdir` passed to the `bash` tool
- Directories referenced by `git -C ...`
- Directories referenced by `cd ...` in the same shell command

If any of those directories are inside a Jujutsu repo, the command is rejected with a clear error telling the agent to use `jj`.

## Plugin Ordering

This plugin is intentionally independent from rewrite plugins.

For example, if another plugin rewrites `git log` to `rtk git log`, `opencode-jj-enforcer` still treats that as git usage and blocks it in `.jj` workspaces. It does not require the rewrite plugin to know anything about Jujutsu.

## Local Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## Publish To npm

```bash
bun run build
npm publish --access public
```

## License

MIT
