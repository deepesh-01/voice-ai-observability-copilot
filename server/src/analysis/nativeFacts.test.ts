import { describe, it, expect } from 'vitest';
import { mapExtractedData, mapBookingInterest, parseBookedAt } from './nativeFacts.js';

describe('mapExtractedData (GHL extractedData → NativeFacts)', () => {
  // The exact shape captured from a real configured-agent call.
  const real = {
    name: 'Dipesh',
    'Last Name': 'Rathur',
    email: null,
    Phone: '+17987215728',
    'Chief Complaint': null,
    'Treatment Interest': 'Teeth cleaning',
    DateTimeOfBooking: 'Jun 22 2026 11:00',
    bookingInterest: 'Booked',
    IsHuamnHandover: null,
  };

  it('maps the real call shape by keyword, not exact key', () => {
    const f = mapExtractedData(real);
    expect(f.callerName).toBe('Dipesh Rathur'); // name + Last Name joined
    expect(f.phone).toBe('+17987215728'); // clean E.164
    expect(f.email).toBeUndefined(); // null → undefined
    expect(f.treatment).toBe('Teeth cleaning');
    expect(f.problem).toBeUndefined(); // Chief Complaint was null
    expect(f.bookingInterest).toBe('Booked');
    expect(f.bookingStatus).toBe('booked');
    expect(f.bookedAt).toMatch(/^2026-06-22T/); // parsed to ISO
    expect(f.hasAny).toBe(true);
  });

  it('does not let "Treatment Interest" or "DateTimeOfBooking" leak into bookingInterest', () => {
    // bookingInterest requires BOTH "booking" and "interest" in the key.
    const f = mapExtractedData({ 'Treatment Interest': 'whitening', DateTimeOfBooking: 'Jun 1 2026 09:00' });
    expect(f.treatment).toBe('whitening');
    expect(f.bookingInterest).toBeUndefined();
    expect(f.bookingStatus).toBeUndefined();
    expect(f.bookedAt).toMatch(/^2026-06-01T/);
  });

  it('reads a truthy human-handover flag', () => {
    expect(mapExtractedData({ IsHumanHandover: 'true' }).humanHandover).toBe(true);
    expect(mapExtractedData({ IsHumanHandover: 'no' }).humanHandover).toBe(false);
  });

  it('returns hasAny=false for empty / junk', () => {
    expect(mapExtractedData({}).hasAny).toBe(false);
    expect(mapExtractedData(null).hasAny).toBe(false);
    expect(mapExtractedData('nope').hasAny).toBe(false);
  });
});

describe('mapBookingInterest', () => {
  it('maps the agent enum to BookingStatus', () => {
    expect(mapBookingInterest('Booked')).toBe('booked');
    expect(mapBookingInterest('Booked but looking for early slot')).toBe('booked');
    expect(mapBookingInterest('Interested')).toBe('not_booked');
    expect(mapBookingInterest('Not Interested')).toBe('not_booked');
    expect(mapBookingInterest('Hesitant about price/availability')).toBe('not_booked');
    expect(mapBookingInterest('')).toBeUndefined();
    expect(mapBookingInterest(undefined)).toBeUndefined();
  });
});

describe('parseBookedAt', () => {
  it('parses loose GHL datetimes to ISO, keeps unparseable strings', () => {
    expect(parseBookedAt('Jun 22 2026 11:00')).toMatch(/^2026-06-22T/);
    expect(parseBookedAt('whenever')).toBe('whenever');
    expect(parseBookedAt(undefined)).toBeUndefined();
  });
});
