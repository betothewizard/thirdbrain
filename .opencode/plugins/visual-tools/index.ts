// visual-tools — ported from pi. write_/edit_/render_ for mermaid and svg: the maker agents' authoring loop.
// Source lives in a per-session temp file; render returns the PNG so the agent can LOOK at it; `save_as` publishes
// it to <project>/viz/viz-<slug>-<timestamp>.png.
import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const PROJECT = fileURLToPath(new URL("../../../", import.meta.url)) // plugin cwd is ~, so anchor to this file
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find(existsSync)
const PATH = ["/opt/local/bin", "/usr/local/bin", "/opt/homebrew/bin", process.env.PATH ?? ""].join(":")

const run = (cmd: string, args: string[], cwd: string, timeoutMs = 120_000) =>
  new Promise<{ code: number | null; out: string; timedOut: boolean }>((resolve) => {
    const c = spawn(cmd, args, { cwd, env: { ...process.env, PATH, PUPPETEER_SKIP_DOWNLOAD: "1" } })
    let out = "", timedOut = false
    const t = setTimeout(() => ((timedOut = true), c.kill("SIGKILL")), timeoutMs)
    c.stdout.on("data", (d) => (out += d))
    c.stderr.on("data", (d) => (out += d))
    c.on("error", (e) => (clearTimeout(t), resolve({ code: null, out: out + e, timedOut })))
    c.on("close", (code) => (clearTimeout(t), resolve({ code, out, timedOut })))
  })

const MARKS = { mermaid: "diagram.mmd", svg: "drawing.svg" } as const
const dirFor = (kind: string, sessionID: string) => join(tmpdir(), "opencode-visual-tools", `${kind}-${sessionID}`)

async function renderPng(kind: "mermaid" | "svg", body: string, dir: string, out: string) {
  if (kind === "svg") {
    const r = await run("rsvg-convert", ["-z", "2", body, "-o", out], dir)
    return { ...r, tool: "rsvg-convert" }
  }
  const cfg = join(dir, "puppeteer.json")
  writeFileSync(cfg, JSON.stringify({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] }))
  const r = await run("npx", ["-y", "@mermaid-js/mermaid-cli@11", "-i", body, "-o", out, "-p", cfg, "-s", "2", "-b", "white"], dir)
  return { ...r, tool: "mmdc" }
}

/** Exact single replacement, same contract as pi's edit: old_text must match exactly once. */
function applyEdit(cur: string, oldText: string, newText: string) {
  if (!oldText) throw new Error("`old_text` must be non-empty.")
  if (oldText === newText) throw new Error("`old_text` and `new_text` are identical.")
  const first = cur.indexOf(oldText)
  if (first < 0) throw new Error("`old_text` not found in the current source — match it exactly.")
  const n = cur.split(oldText).length - 1
  if (n > 1) throw new Error(`\`old_text\` appears ${n} times — add surrounding context to make it unique.`)
  return { updated: cur.slice(0, first) + newText + cur.slice(first + oldText.length), index: first }
}

function snippetAround(content: string, index: number, ctxLines = 3) {
  const hit = content.slice(0, index).split("\n").length - 1
  const lines = content.split("\n")
  const start = Math.max(0, hit - ctxLines), end = Math.min(lines.length - 1, hit + ctxLines)
  const w = String(end + 1).length
  return lines.slice(start, end + 1).map((l, i) => `${String(start + i + 1).padStart(w)}  ${l}`).join("\n")
}

function publish(png: string, slug: string) {
  const dir = join(PROJECT, "viz")
  mkdirSync(dir, { recursive: true })
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "viz"
  const filename = `viz-${clean}-${Date.now()}.png`
  copyFileSync(png, join(dir, filename))
  return { filename, path: join(dir, filename) }
}

const text = (t: string) => ({ type: "text" as const, text: t })

export default Plugin.define({
  id: "visual-tools",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      for (const kind of ["mermaid", "svg"] as const) {
        const K = kind === "mermaid" ? "Mermaid" : "SVG"
        const bodyOf = (sessionID: string) => join(dirFor(kind, sessionID), MARKS[kind])

        editor.add({
          name: `write_${kind}`,
          description:
            `Write the FULL ${K} source to this session's managed file (your first draft or a complete rewrite). You do NOT name the file — edit_${kind} and render_${kind} act on the same one.\n\n` +
            (kind === "mermaid"
              ? "`source` is a complete Mermaid diagram, e.g. a `graph TD` / `graph LR` flow, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `classDiagram`, `mindmap`, or `timeline`. "
              : "`source` is a complete `<svg>…</svg>` with explicit width/height or a viewBox. ") +
            `Writing does NOT render — call render_${kind} when ready. For a small fix, prefer edit_${kind} over rewriting.`,
          input: {
            type: "object",
            properties: { source: { type: "string", description: `The complete ${K} source.` } },
            required: ["source"],
            additionalProperties: false,
          },
          execute: async ({ source }: any, c: any) => {
            const src = String(source ?? "").trim()
            if (!src) throw new Error(`\`write_${kind}\` requires a non-empty \`source\`.`)
            mkdirSync(dirFor(kind, c.sessionID), { recursive: true })
            writeFileSync(bodyOf(c.sessionID), src)
            return { content: `Wrote ${src.split("\n").length}-line ${K} source.\nCall render_${kind} to render it, or edit_${kind} to tweak it.` }
          },
        })

        editor.add({
          name: `edit_${kind}`,
          description:
            `Make a single exact-match replacement in this session's ${K} source, locked to the one managed file. \`old_text\` must appear EXACTLY ONCE (include surrounding context for uniqueness); on 0 or >1 matches the call fails and nothing changes. Call write_${kind} first. Editing does NOT render.`,
          input: {
            type: "object",
            properties: {
              old_text: { type: "string", description: "Exact substring of the current source to replace (must match once)." },
              new_text: { type: "string", description: "Replacement text for `old_text`." },
            },
            required: ["old_text", "new_text"],
            additionalProperties: false,
          },
          execute: async ({ old_text, new_text }: any, c: any) => {
            const f = bodyOf(c.sessionID)
            if (!existsSync(f)) throw new Error(`edit_${kind}: no source yet — call write_${kind} first.`)
            const { updated, index } = applyEdit(readFileSync(f, "utf8"), String(old_text ?? ""), String(new_text ?? ""))
            writeFileSync(f, updated)
            return { content: "Applied edit. Updated region:\n```\n" + snippetAround(updated, index) + `\n\`\`\`\nCall render_${kind} to see it.` }
          },
        })

        editor.add({
          name: `render_${kind}`,
          description:
            `Render the CURRENT session ${K} source to a PNG and return it inline so you can SEE it and iterate. You do NOT pass the source here — it comes from the managed file; call write_${kind} first.\n\n` +
            "Iterate freely with no `save_as` (preview only). When correct and clean, call once more with `save_as` set to a short kebab-case topic slug: that publishes the PNG into <project>/viz with a unique filename and returns the filename to embed. On a render error this returns the error text instead of an image — fix with " +
            `edit_${kind} and re-render.`,
          input: {
            type: "object",
            properties: {
              save_as: {
                type: "string",
                description: "Short kebab-case topic slug (e.g. 'internet-packets'). When set, the PNG is published to <project>/viz as viz-<slug>-<timestamp>.png and the filename is returned. Omit for a preview-only render.",
              },
            },
            additionalProperties: false,
          },
          execute: async ({ save_as }: any, c: any) => {
            const f = bodyOf(c.sessionID)
            if (!existsSync(f)) throw new Error(`render_${kind}: no source yet — call write_${kind} first.`)
            const dir = dirFor(kind, c.sessionID)
            const out = join(dir, `render-${Date.now()}.png`)
            const r = await renderPng(kind, f, dir, out)
            if (r.code !== 0 || !existsSync(out)) {
              const detail = r.out.split("\n").slice(-30).join("\n")
              return { content: `${r.timedOut ? `${r.tool} timed out.\n\n` : ""}${K} render FAILED — no image produced. Fix the source with edit_${kind} and call render_${kind} again.\n\nError:\n${detail}` }
            }
            const file = { type: "file" as const, uri: `file://${out}`, mime: "image/png", name: "render.png" }
            if (save_as) {
              const { filename, path } = publish(out, String(save_as))
              return { content: [text(`Published to viz/.\nfilename: ${filename}\npath: ${path}\n\nLOOK at the image below to confirm it is correct before returning it.`), file] }
            }
            return { content: [text("Preview render (not yet saved). LOOK: is everything correct, labels right, nothing cramped? Fix with edit_" + kind + ", or re-render with `save_as` to publish."), file] }
          },
        })
      }
    })
  },
})
