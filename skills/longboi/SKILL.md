---
name: longboi
description: >-
  Longboi — the dachshund living in the Claude Code status line. Use when the
  user asks about their dog/pet ("how is the dog", "покажи собаку"), wants to
  feed it, rename it, see its stats/bones/level, or install/remove the
  Longboi status line.
---

# Longboi

A dachshund in the status line, driven by one script: `dog/longboi.js`
(Node, no dependencies).

## Locate the script

`$CLAUDE_PLUGIN_ROOT/dog/longboi.js` when installed as a plugin; otherwise
resolve `../../dog/longboi.js` relative to this skill file.

## What to run

| User intent | Command |
| --- | --- |
| How's the dog / show the dog | `node "$L" --status` |
| Give a treat | `node "$L" --feed` |
| Rename (e.g. Rex) | `node "$L" --name Rex` |
| Put him in the status line | `node "$L" --install` |
| Remove the status line | `node "$L" --uninstall` |
| Raw facts | `node "$L" --json` |

## Behavior notes

- Show `--status` output as-is (it is a formatted card with the dog portrait)
  and add one affectionate sentence about his current mood.
- He is fed by real work: git commits and test runs made through Claude Code
  (tracked by hooks, active automatically when installed as a plugin).
  `--feed` is an extra treat, limited to one per 4 hours — if he refuses,
  relay that gently.
- `--install` replaces the current status line (a backup of the old one is
  written next to settings.json). If the user has Token HUD, mention that
  Longboi's collar tag shows the daily budget, so nothing is lost.
- Everything is local (`~/.claude/longboi/`); nothing is uploaded.
