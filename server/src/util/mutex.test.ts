import { describe, it, expect } from 'vitest';
import { createMutex } from './mutex.js';

describe('createMutex', () => {
  it('runs queued sections one at a time, in order, never overlapping', async () => {
    const mutex = createMutex();
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;

    const section = (name: string) =>
      mutex.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        events.push(`start:${name}`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`end:${name}`);
        active -= 1;
        return name;
      });

    // Fire all three "concurrently" — the mutex must serialize them.
    const results = await Promise.all([section('a'), section('b'), section('c')]);

    expect(maxActive).toBe(1); // never two at once
    expect(results).toEqual(['a', 'b', 'c']);
    expect(events).toEqual([
      'start:a',
      'end:a',
      'start:b',
      'end:b',
      'start:c',
      'end:c',
    ]);
  });

  it('keeps serializing after a section throws (one failure does not break the queue)', async () => {
    const mutex = createMutex();
    const order: string[] = [];

    const ok = () => mutex.run(async () => void order.push('ok'));
    const boom = () =>
      mutex.run(async () => {
        order.push('boom');
        throw new Error('kaboom');
      });

    const failing = boom();
    const following = ok();

    await expect(failing).rejects.toThrow('kaboom');
    await following;
    expect(order).toEqual(['boom', 'ok']);
  });

  it('reports isLocked while a section is in flight and false once drained', async () => {
    const mutex = createMutex();
    expect(mutex.isLocked()).toBe(false);
    const running = mutex.run(() => new Promise((r) => setTimeout(r, 5)));
    expect(mutex.isLocked()).toBe(true);
    await running;
    expect(mutex.isLocked()).toBe(false);
  });
});
