# thirdbrain

The pi learning setup (`.pi/`, from amosblomqvist/learn) ported to opencode v2. Same tools, skills, agents.

| pi | here |
|---|---|
| `skills/teach`, `skills/visualize` | `.opencode/skills/` (verbatim, `subagent(...)` call adapted) |
| `agents/researcher, svg-maker, mermaid-maker` | `.opencode/agents/` (v2 `permissions`; model inherits the session's) |
| `extensions/quiz`, `extensions/ask-user-question` | folded into the `teach` skill — it drives the built-in `question` tool directly |
| `extensions/visual-tools` | `.opencode/plugins/visual-tools/` — `write/edit/render_mermaid`, `write/edit/render_svg` |
| `extensions/md-log` | `.opencode/plugins/md-log/` |

## Quiz / ask_user_question → the `question` tool

Not ported as a plugin. A plugin that registers tools pushes the built-in `question` tool out of the
model's direct-tool set (opencode routes the overflow into Code Mode, which can't reach `question`, so no
popup). Instead the `teach` skill tells the model to call `question` directly: for a graded check it shuffles
the options, adds an "I don't know" choice, holds the correct answer, and grades with ✓/✗ + explanation after
the user answers. Open questions (preferences) use the same tool, ungraded. Difference from pi: grading is
model-driven, not code-enforced.

## Needs

`rsvg-convert` (`brew install librsvg`) for SVG; Chrome + `npx` for Mermaid; `cd .opencode && npm i` once.

## md-log

`/md-log <file>` links a markdown file, `/md-unlog` stops (or `echo /abs/log.md > .opencode/md-log.path`).
Logging of user/assistant text is verified; the slash commands and the logged answer line are not.
