/**
 * One-off: configure the demo Voice AI agent via the HighLevel API (PATCH /voice-ai/agents/:id).
 *
 * Agent mutation needs `voice-ai-agents.write`. The marketplace app now carries that scope
 * (S-012), so after a reinstall the stored OAuth token works directly. Falls back to an
 * out-of-band GHL_WRITE_TOKEN (e.g. a Private Integration Token) if you'd rather not reinstall.
 *
 *   cd server && npx tsx scripts/configure-agent.mts [agentId]
 *   cd server && GHL_WRITE_TOKEN=pit-xxxx npx tsx scripts/configure-agent.mts [agentId]
 *
 * - agentId: optional; defaults to the only agent in the location.
 *
 * Voice AI endpoints use the newer named API version — we send `Version: v3` (S-012).
 */
import axios from 'axios';
import { GHL } from '../src/config.js';
import { getValidAccessToken } from '../src/ghl/oauth.js';
import { listInstalls } from '../src/store/tokenStore.js';

const AGENT_CONFIG = {
  agentName: 'BrightSmile Dental — Booking',
  businessName: 'BrightSmile Dental',
  welcomeMessage:
    "Thanks for calling BrightSmile Dental! This is Jessica. Are you looking to book an appointment, or is there something else I can help with?",
  agentPrompt: `AGENT ROLE & OBJECTIVE:
You are Jessica, the front-desk booking assistant for "BrightSmile Dental".
Your single goal is to book a dental appointment by collecting the required
details and confirming them back to the caller. Stay warm, concise, and on-task.

BOOKING FLOW (follow in order — do not skip steps):
1. Greet and confirm the caller wants to book an appointment.
2. Ask for the caller's full name.
3. Ask the reason for the visit (e.g. check-up & cleaning, tooth pain, whitening).
4. Ask for their preferred day and time. Offer two concrete options if they are
   unsure (e.g. "We have Tuesday at 10am or Thursday at 2pm").
5. Confirm the best phone number to reach them, and ask for an email for the
   confirmation.
6. Read ALL collected details back to the caller and ask them to confirm.
7. Once confirmed, tell them the appointment is booked and they'll get a
   confirmation by text/email. Close politely.

RULES:
- Collect: full name, reason for visit, preferred date/time, phone, email.
- Ask ONE question at a time. Never ask for information already given.
- If the caller raises an objection (price, time, hesitation), acknowledge it
  once, briefly reassure, then steer back to booking. Do not argue or oversell.
- If the caller asks something you can't answer (clinical advice, insurance
  specifics), say a team member will follow up — do NOT guess or invent details.
- If the caller declines to book, capture their name + number for a callback and
  close warmly.
- Never mention you are an AI unless directly asked.`,
} as const;

async function main() {
  const locationId = (await listInstalls())[0];
  // Prefer an explicit write token; otherwise use the stored OAuth token (carries write after
  // the post-S-012 reinstall).
  const token = process.env.GHL_WRITE_TOKEN ?? (await getValidAccessToken(locationId));
  console.log(`Token source: ${process.env.GHL_WRITE_TOKEN ? 'GHL_WRITE_TOKEN' : 'stored OAuth token'}`);
  const headers = { Authorization: `Bearer ${token}`, Version: 'v3' };

  // Resolve agent id from the location if not given.
  let agentId = process.argv[2];
  if (!agentId) {
    const { data } = await axios.get(`${GHL.apiBase}/voice-ai/agents`, {
      headers,
      params: { locationId },
    });
    agentId = data?.agents?.[0]?.id ?? data?.agents?.[0]?._id;
    if (!agentId) throw new Error('No agent found in the location.');
  }
  console.log(`PATCHing agent ${agentId} in location ${locationId} …`);

  const { data } = await axios.patch(
    `${GHL.apiBase}/voice-ai/agents/${agentId}`,
    AGENT_CONFIG,
    { headers, params: { locationId } },
  );
  console.log('Updated. Response keys:', Object.keys(data ?? {}));
  console.log('agentName:', data?.agentName ?? data?.agent?.agentName);
  console.log('\nNow place a richer Web Call test, then run capture-call-shape.mts.');
}

main().catch((err) => {
  const status = err?.response?.status;
  const body = err?.response?.data;
  console.error('Configure failed:', status ?? '', body ? JSON.stringify(body) : err?.message ?? err);
  if (status === 401 || status === 403) {
    console.error('→ Token likely missing voice-ai-agents.write scope.');
  }
  if (status === 400 || status === 422) {
    console.error('→ Possibly an API version or body-shape issue. Check the PATCH schema.');
  }
  process.exit(1);
});
