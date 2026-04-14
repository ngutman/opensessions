import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

interface PiRuntimePayload {
  pid: number;
  ppid: number;
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  sessionName?: string;
  ts: number;
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:7391";
const HEARTBEAT_MS = 5_000;

function getServerUrl(): string {
  return (process.env.OPENSESSIONS_URL ?? DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

export default function opensessionsRuntime(pi: ExtensionAPI) {
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let current: Omit<PiRuntimePayload, "ts" | "sessionName"> | null = null;

  function buildPayload(ctx: ExtensionContext): PiRuntimePayload {
    return {
      pid: process.pid,
      ppid: process.ppid,
      sessionId: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile(),
      cwd: ctx.sessionManager.getCwd(),
      sessionName: pi.getSessionName(),
      ts: Date.now(),
    };
  }

  async function post(path: string, body: unknown): Promise<void> {
    try {
      await fetch(`${getServerUrl()}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // opensessions may not be running yet; retry on next heartbeat
    }
  }

  function clearHeartbeat(): void {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = null;
  }

  function startHeartbeat(ctx: ExtensionContext): void {
    clearHeartbeat();
    heartbeat = setInterval(() => {
      if (!current) {
        current = {
          pid: process.pid,
          ppid: process.ppid,
          sessionId: ctx.sessionManager.getSessionId(),
          sessionFile: ctx.sessionManager.getSessionFile(),
          cwd: ctx.sessionManager.getCwd(),
        };
      }
      void post("/api/runtime/pi/upsert", {
        ...current,
        sessionName: pi.getSessionName(),
        ts: Date.now(),
      } satisfies PiRuntimePayload);
    }, HEARTBEAT_MS);
  }

  pi.on("session_start", async (_event, ctx) => {
    const payload = buildPayload(ctx);
    current = {
      pid: payload.pid,
      ppid: payload.ppid,
      sessionId: payload.sessionId,
      sessionFile: payload.sessionFile,
      cwd: payload.cwd,
    };
    void post("/api/runtime/pi/upsert", payload);
    startHeartbeat(ctx);
  });

  pi.on("session_shutdown", async () => {
    clearHeartbeat();
    current = null;
    void post("/api/runtime/pi/delete", { pid: process.pid });
  });
}
