import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from '../config.js';
import { saveTokens, getTokens, listInstalls, type InstallTokens } from './tokenStore.js';
import { getPool, closePool } from '../db/pool.js';

// Integration test — runs only when a Postgres DATABASE_URL is configured.
const run = config.databaseUrl ? describe : describe.skip;

const LOC_A = '__test_install_a__';
const LOC_B = '__test_install_b__';

function tokens(locationId: string, accessToken: string, expiresAt = Date.now() + 3_600_000): InstallTokens {
  return {
    accessToken,
    refreshToken: `refresh-${accessToken}`,
    expiresAt,
    userType: 'Location',
    locationId,
  };
}

async function clear() {
  await getPool().query('DELETE FROM oauth_tokens WHERE install_key = ANY($1)', [[LOC_A, LOC_B]]);
}

run('tokenStore (Postgres integration)', () => {
  beforeAll(async () => {
    await saveTokens(tokens(LOC_A, 'seed')); // ensures schema exists
    await clear();
  });
  afterAll(async () => {
    await clear();
    await closePool();
  });

  it('saves and reads back a token keyed by locationId', async () => {
    await saveTokens(tokens(LOC_A, 'access-1', 123456789));
    const got = await getTokens(LOC_A);
    expect(got?.accessToken).toBe('access-1');
    expect(got?.refreshToken).toBe('refresh-access-1');
    expect(got?.expiresAt).toBe(123456789); // BIGINT round-trips as a number
    expect(got?.locationId).toBe(LOC_A);
    expect(got?.companyId).toBeUndefined();
  });

  it('upserts on the same install key (no duplicate)', async () => {
    await saveTokens(tokens(LOC_A, 'access-2'));
    expect((await getTokens(LOC_A))?.accessToken).toBe('access-2');
    const installs = await listInstalls();
    expect(installs.filter((k) => k === LOC_A)).toHaveLength(1);
  });

  it('returns undefined for an unknown key', async () => {
    expect(await getTokens('__nope__')).toBeUndefined();
  });

  it('keyless getTokens returns the sole install, or undefined when ambiguous', async () => {
    await clear();
    await saveTokens(tokens(LOC_A, 'only-one'));
    // Other installs may exist in a shared dev DB, so only assert the single-row case here
    // by scoping: when exactly our two test rows are the only ambiguity, add the second.
    const sole = await getTokens();
    // If the dev DB already has other installs, keyless is ambiguous → undefined; otherwise it's LOC_A.
    if (sole) expect(sole.accessToken).toBe('only-one');

    await saveTokens(tokens(LOC_B, 'second'));
    // With ≥2 installs present, the keyless convenience lookup must not guess.
    expect(await getTokens()).toBeUndefined();
  });

  it('lists install keys', async () => {
    const installs = await listInstalls();
    expect(installs).toContain(LOC_A);
    expect(installs).toContain(LOC_B);
  });
});
