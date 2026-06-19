import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { verifyGhlSignature } from './verifyGhl.js';

// Generate a throwaway Ed25519 keypair to exercise the verifier end-to-end
// (we can't sign with HighLevel's private key, so we inject our own public key).
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function sign(body: string): string {
  return cryptoSign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64');
}

describe('verifyGhlSignature', () => {
  const body = JSON.stringify({ type: 'VoiceAiCallEnd', id: 'c1', locationId: 'loc1' });

  it('accepts a valid signature over the raw body', () => {
    expect(verifyGhlSignature(body, sign(body), pubPem)).toBe(true);
  });

  it('rejects when the body was tampered with', () => {
    const sig = sign(body);
    expect(verifyGhlSignature(body + ' ', sig, pubPem)).toBe(false);
  });

  it('rejects a missing or N/A signature', () => {
    expect(verifyGhlSignature(body, undefined, pubPem)).toBe(false);
    expect(verifyGhlSignature(body, 'N/A', pubPem)).toBe(false);
  });

  it('rejects garbage signatures without throwing', () => {
    expect(verifyGhlSignature(body, 'not-base64-!!!', pubPem)).toBe(false);
  });

  it('rejects a signature made with a different key', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    const sig = cryptoSign(null, Buffer.from(body, 'utf8'), other).toString('base64');
    expect(verifyGhlSignature(body, sig, pubPem)).toBe(false);
  });
});
