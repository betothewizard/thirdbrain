// md-log: mirror user text, assistant text and `question` tool Q&A into a markdown file (view in Obsidian).
// /md-log <file> links a file (kept in .opencode/md-log.path); /md-unlog stops.
// The plugin loads in several opencode processes (TUI + background service) that each see the event
// stream, so every append is deduped by event id with an atomic lock file (first writer wins).
import { Plugin } from "@opencode/plugin"
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const STATE = fileURLToPath(new URL("../../md-log.path", import.meta.url)) // plugin cwd is ~, so anchor to this file
const file = () => (existsSync(STATE) ? readFileSync(STATE, "utf8").trim() : "")
const log = (text: string) => file() && appendFileSync(file(), text + "\n\n")

// Atomic cross-process claim: openSync with "wx" fails if the id was already seen by another process.
const SEEN = join(tmpdir(), "opencode-md-log-seen") // ponytail: lock files accrue here; temp dir is cleared on reboot
const firstToSee = (id: string): boolean => {
  if (!id) return true
  try {
    mkdirSync(SEEN, { recursive: true })
    closeSync(openSync(join(SEEN, id.replace(/[^\w.-]/g, "_")), "wx"))
    return true
  } catch {
    return false
  }
}

export default Plugin.define({
  id: "md-log",
  async setup(ctx) {
    const c = new AbortController()
    void (async () => {
      for await (const e of ctx.event.subscribe({ signal: c.signal })) {
        if (!file() || !firstToSee(e.id)) continue
        const d: any = e.data
        if (e.type === "session.inbox.enqueued" && d.item?.type === "user") log(`> **You:** ${d.item.payload.text}`)
        else if (e.type === "session.text.ended" && d.text?.trim()) log(d.text)
        else if (e.type === "session.tool.called" && Array.isArray(d.input?.questions))
          log(d.input.questions.map((q: any) => `**${q.question}**\n` + (q.options ?? []).map((o: any) => `- ${o.label}`).join("\n")).join("\n\n"))
        else if (e.type === "session.tool.success" && Array.isArray(d.metadata?.answers))
          log(`**Answer:** ${d.metadata.answers.map((a: string[]) => (a?.length ? a.join(", ") : "—")).join(" | ")}`)
      }
    })()

    await ctx.command.transform((editor) => {
      editor.add({
        name: "md-log",
        description: "Mirror this session to a markdown file: /md-log <file>",
        execute: async ({ prompt }: any) => writeFileSync(STATE, resolve(String(prompt?.text ?? "").trim())),
      })
      editor.add({
        name: "md-unlog",
        description: "Stop mirroring to markdown",
        execute: async () => existsSync(STATE) && unlinkSync(STATE),
      })
    })
    return () => c.abort()
  },
})
