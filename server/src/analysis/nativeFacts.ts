import type { BookingStatus } from './types.js';

/**
 * Facts mapped from GHL's native `extractedData` (the agent's configured DATA_EXTRACTION
 * actions). These are ground-truth — preferred over LLM inference for identity/booking
 * facts. The keys in `extractedData` are the action *names* the operator chose
 * (e.g. "Treatment Interest", "bookingInterest"), so we match by normalized keyword rather
 * than exact key — robust to naming/casing differences across agents.
 */
export interface NativeFacts {
  callerName?: string;
  phone?: string;
  email?: string;
  problem?: string;
  treatment?: string;
  bookingStatus?: BookingStatus;
  bookedAt?: string;
  /** The agent's own "human handover" flag, if it extracted one (a fact, not our judgment). */
  humanHandover?: boolean;
  /** Raw bookingInterest value — richer than bookingStatus (e.g. "Hesitant about price"). */
  bookingInterest?: string;
  /** True if any usable native fact was present (drives the lead's `source` provenance). */
  hasAny: boolean;
}

const clean = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
};

/** First value whose normalized (lowercased/trimmed) key satisfies `match`. */
function pick(data: Record<string, unknown>, match: (k: string) => boolean): unknown {
  for (const [k, v] of Object.entries(data)) {
    if (match(k.toLowerCase().trim())) return v;
  }
  return undefined;
}

/** Map the agent's `bookingInterest` enum to our BookingStatus. */
export function mapBookingInterest(value: string | undefined): BookingStatus | undefined {
  if (!value) return undefined;
  const s = value.toLowerCase();
  if (s.includes('booked')) return 'booked'; // "Booked" / "Booked but looking for early slot"
  if (s.includes('reschedul')) return 'reschedule';
  if (s.includes('cancel')) return 'cancelled';
  // "Interested" / "Not Interested" / "Hesitant about price/availability" — intent, not a booking.
  if (s.includes('interest') || s.includes('hesitant')) return 'not_booked';
  return undefined;
}

/** Parse a loosely-formatted GHL datetime (e.g. "Jun 22 2026 11:00") to ISO; keep raw if unparseable. */
export function parseBookedAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

const truthy = (v: unknown): boolean | undefined => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(s)) return true;
    if (['false', 'no', '0'].includes(s)) return false;
  }
  return undefined;
};

/** Map GHL `extractedData` (or anything) to NativeFacts. Pure + total — tolerates junk. */
export function mapExtractedData(raw: unknown): NativeFacts {
  if (!raw || typeof raw !== 'object') return { hasAny: false };
  const d = raw as Record<string, unknown>;

  const first = clean(pick(d, (k) => k === 'name' || k === 'first name' || (k.includes('first') && k.includes('name'))));
  const last = clean(pick(d, (k) => k.includes('last') && k.includes('name')));
  const callerName = [first, last].filter(Boolean).join(' ') || undefined;

  const phone = clean(pick(d, (k) => k.includes('phone')));
  const email = clean(pick(d, (k) => k.includes('email')));
  const problem = clean(pick(d, (k) => k.includes('complaint') || k.includes('problem')));
  const treatment = clean(pick(d, (k) => k.includes('treatment')));
  // bookingInterest needs BOTH words so it doesn't swallow "Treatment Interest" or "DateTimeOfBooking".
  const bookingInterest = clean(pick(d, (k) => k.includes('booking') && k.includes('interest')));
  const bookedAt = parseBookedAt(clean(pick(d, (k) => k.includes('date') || k.includes('time'))));
  const humanHandover = truthy(pick(d, (k) => k.includes('handover') || k.includes('human')));

  const bookingStatus = mapBookingInterest(bookingInterest);
  return {
    callerName,
    phone,
    email,
    problem,
    treatment,
    bookingInterest,
    bookingStatus,
    bookedAt,
    humanHandover,
    hasAny: Boolean(
      callerName || phone || email || problem || treatment || bookingStatus || bookedAt || humanHandover != null,
    ),
  };
}
