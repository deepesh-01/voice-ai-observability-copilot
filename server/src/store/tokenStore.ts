import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// tokens.json is gitignored — it holds live OAuth tokens.
const STORE_PATH = resolve(here, '../../tokens.json');

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
 * Minimal persistence for the setup milestone: a JSON file keyed by locationId/companyId.
 * NOTE (functional-vs-mocked): this is real token storage, but single-process and
 * file-based — to be replaced by MongoDB (ADR-0002) before multi-tenant use.
 */
type StoreShape = Record<string, InstallTokens>;

async function readStore(): Promise<StoreShape> {
  try {
    return JSON.parse(await readFile(STORE_PATH, 'utf8')) as StoreShape;
  } catch {
    return {};
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export async function saveTokens(tokens: InstallTokens): Promise<void> {
  const key = tokens.locationId ?? tokens.companyId ?? 'default';
  const store = await readStore();
  store[key] = tokens;
  await writeStore(store);
}

export async function getTokens(key?: string): Promise<InstallTokens | undefined> {
  const store = await readStore();
  if (key) return store[key];
  // Setup convenience: when only one install exists, return it.
  const values = Object.values(store);
  return values.length === 1 ? values[0] : undefined;
}

export async function listInstalls(): Promise<string[]> {
  return Object.keys(await readStore());
}
