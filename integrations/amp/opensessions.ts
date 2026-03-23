/**
 * opensessions plugin for Amp
 *
 * Reports agent status to the opensessions server.
 *
 * Install:
 *   Copy this file to ~/.config/amp/plugins/opensessions.ts
 *
 * Events mapped:
 *   session.start → idle
 *   agent.start   → running
 *   agent.end     → done/error/interrupted (based on event.status)
 *   tool.call     → running
 *   tool.result   → error (only on tool failure)
 */

// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now
import type { PluginAPI } from "@ampcode/plugin";
import { appendFileSync } from "fs";

const SERVER_URL = process.env.OPENSESSIONS_URL ?? "http://127.0.0.1:7391/event";
const EVENTS_FILE = process.env.OPENSESSIONS_EVENTS_FILE ?? "/tmp/opensessions-events.jsonl";

async function getTmuxSession($: PluginAPI["$"]): Promise<string> {
  try {
    const result = await $`tmux display-message -p '#S'`;
    return result.stdout.trim();
  } catch {
    return "unknown";
  }
}

async function writeEvent(agent: string, session: string, status: string): Promise<void> {
  const payload = JSON.stringify({ agent, session, status, ts: Date.now() });
  try {
    await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  } catch {
    try { appendFileSync(EVENTS_FILE, payload + "\n"); } catch {}
  }
}

export default function (amp: PluginAPI) {
  let sessionName: string | null = null;

  getTmuxSession(amp.$).then((name) => {
    sessionName = name;
  });

  amp.on("session.start", async (_event, ctx) => {
    if (!sessionName) sessionName = await getTmuxSession(ctx.$);
    await writeEvent("amp", sessionName, "idle");
  });

  amp.on("agent.start", async (_event, ctx) => {
    if (!sessionName) sessionName = await getTmuxSession(ctx.$);
    await writeEvent("amp", sessionName, "running");
    return {};
  });

  amp.on("agent.end", async (event, ctx) => {
    if (!sessionName) sessionName = await getTmuxSession(ctx.$);
    await writeEvent("amp", sessionName, event.status);
    return undefined;
  });

  amp.on("tool.call", async (_event, _ctx) => {
    if (sessionName) await writeEvent("amp", sessionName, "running");
    return { action: "allow" };
  });

  amp.on("tool.result", async (event, _ctx) => {
    if (!sessionName) return;
    if (event.status === "error") {
      await writeEvent("amp", sessionName, "error");
    } else if (event.status === "cancelled") {
      await writeEvent("amp", sessionName, "interrupted");
    }
  });
}
