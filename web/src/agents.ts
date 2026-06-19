import { reactive } from 'vue';
import { fetchAgents, agentLabel, UNASSIGNED_AGENT } from './api';

/**
 * Reactive agent-name cache, keyed by location. The dashboard shows human names
 * (e.g. "BrightSmile Dental — Booking") instead of opaque agent ids. Resolution is
 * sync (`displayName`) and reactive — once `ensureAgents` populates the cache, every
 * view that read a name re-renders. Falls back to a short id when a name isn't known
 * (e.g. a deleted agent that still has stored calls).
 */
const namesByLocation = reactive<Record<string, Record<string, string>>>({});
const inflight: Record<string, Promise<void>> = {};

/** Fetch + cache an account's agent names once (idempotent; failures degrade to ids). */
export async function ensureAgents(locationId: string): Promise<void> {
  if (!locationId || namesByLocation[locationId]) return;
  inflight[locationId] ??= fetchAgents(locationId)
    .then((list) => {
      namesByLocation[locationId] = Object.fromEntries(list.map((a) => [a.id, a.name]));
    })
    .catch(() => {
      namesByLocation[locationId] = {}; // cache the miss so we don't refetch in a loop
    });
  await inflight[locationId];
}

/** The name to show for an agent — resolved name, or a readable fallback. */
export function displayName(locationId: string, agentId: string): string {
  if (agentId === UNASSIGNED_AGENT) return 'Unassigned';
  return namesByLocation[locationId]?.[agentId] ?? agentLabel(agentId);
}
