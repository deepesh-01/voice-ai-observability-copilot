import { getPool, initSchema } from '../db/pool.js';

export interface InstallTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** "Location" (sub-account) or "Company" (agency). */
  userType: string;
  locationId?: string;
  companyId?: string;
}

/**
 * Persistence for HighLevel OAuth install tokens (R1.2), keyed by locationId/companyId.
 * Backed by Postgres (`oauth_tokens`, ADR-0008) — durable and multi-tenant, replacing the
 * earlier single-process tokens.json. Same three-function surface as before, so OAuth,
 * ingestion, and the webhook handler are untouched by the swap.
 */
type TokenRow = {
  access_token: string;
  refresh_token: string;
  expires_at: string; // pg returns BIGINT as a string
  user_type: string;
  location_id: string | null;
  company_id: string | null;
};

// initSchema is idempotent + cheap; memoize so token reads/writes work even when invoked
// from a script that never booted the server (e.g. scripts/ingest.mts).
let schemaReady: Promise<void> | undefined;
function ensureSchema(): Promise<void> {
  return (schemaReady ??= initSchema());
}

function installKey(tokens: InstallTokens): string {
  return tokens.locationId ?? tokens.companyId ?? 'default';
}

function rowToTokens(row: TokenRow): InstallTokens {
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: Number(row.expires_at),
    userType: row.user_type,
    locationId: row.location_id ?? undefined,
    companyId: row.company_id ?? undefined,
  };
}

export async function saveTokens(tokens: InstallTokens): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO oauth_tokens
       (install_key, access_token, refresh_token, expires_at, user_type, location_id, company_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (install_key) DO UPDATE SET
       access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
       expires_at=EXCLUDED.expires_at, user_type=EXCLUDED.user_type,
       location_id=EXCLUDED.location_id, company_id=EXCLUDED.company_id, updated_at=now()`,
    [
      installKey(tokens),
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresAt,
      tokens.userType,
      tokens.locationId ?? null,
      tokens.companyId ?? null,
    ],
  );
}

export async function getTokens(key?: string): Promise<InstallTokens | undefined> {
  await ensureSchema();
  const pool = getPool();
  if (key) {
    const { rows } = await pool.query<TokenRow>('SELECT * FROM oauth_tokens WHERE install_key = $1', [key]);
    return rows[0] ? rowToTokens(rows[0]) : undefined;
  }
  // Setup convenience: when exactly one install exists, return it (limit 2 to detect "more than one").
  const { rows } = await pool.query<TokenRow>('SELECT * FROM oauth_tokens LIMIT 2');
  return rows.length === 1 && rows[0] ? rowToTokens(rows[0]) : undefined;
}

export async function listInstalls(): Promise<string[]> {
  await ensureSchema();
  const { rows } = await getPool().query<{ install_key: string }>(
    'SELECT install_key FROM oauth_tokens ORDER BY install_key',
  );
  return rows.map((r) => r.install_key);
}
