import type { AgentEvent } from "../contracts/agent";
import type { AgentThreadOwner } from "../contracts/agent-watcher";

export type ResolveThreadOwner = (agent: string, threadId?: string) => AgentThreadOwner | null;

export function canonicalizeAgentEvent(
  event: AgentEvent,
  resolveThreadOwner?: ResolveThreadOwner,
): AgentEvent {
  if (!event.threadId || !resolveThreadOwner) return event;

  const owner = resolveThreadOwner(event.agent, event.threadId);
  if (!owner) return event;

  const nextResolution = event.agent === "pi" ? "live-owner" : event.sessionResolution;

  if (owner.session === event.session) {
    if (owner.paneId && !event.paneId) {
      return { ...event, paneId: owner.paneId, ...(nextResolution && { sessionResolution: nextResolution }) };
    }
    if (nextResolution && event.sessionResolution !== nextResolution) {
      return { ...event, sessionResolution: nextResolution };
    }
    return event;
  }

  return {
    ...event,
    session: owner.session,
    ...(owner.paneId && !event.paneId && { paneId: owner.paneId }),
    ...(nextResolution && { sessionResolution: nextResolution }),
  };
}
