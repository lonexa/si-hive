/**
 * Encrypted local credential store (~/.hive/credentials.json).
 *
 * Every secret Hive holds — integration tokens, auth-provider client secrets,
 * shared-DB passwords, LLM API keys, connector tokens — lives here, never in
 * config.json. Values are AES-256-GCM encrypted with a key taken from
 * `HIVE_SECRET_KEY` (any string; stretched with scrypt) or, when unset, a
 * random key generated once into ~/.hive/secret.key.
 *
 * Secrets are addressed by a stable `ref` string, conventionally
 * `<area>:<id>:<field>` (e.g. `integration:gh-main:token`). The API layer only
 * ever returns masked values to the browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hiveHome } from './paths.js';

const DATA_DIR = hiveHome();
const STORE_PATH = path.join(DATA_DIR, 'credentials.json');
const KEY_PATH = path.join(DATA_DIR, 'secret.key');

interface EncryptedEntry {
  iv: string;
  tag: string;
  data: string;
  updatedAt: string;
}

interface StoreFile {
  version: 1;
  entries: Record<string, EncryptedEntry>;
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.HIVE_SECRET_KEY;
  if (envKey) {
    cachedKey = crypto.scryptSync(envKey, 'hive-credential-store', 32);
    return cachedKey;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(KEY_PATH)) {
    fs.writeFileSync(KEY_PATH, crypto.randomBytes(32).toString('base64'), { encoding: 'utf-8', mode: 0o600 });
  }
  cachedKey = Buffer.from(fs.readFileSync(KEY_PATH, 'utf-8').trim(), 'base64');
  if (cachedKey.length !== 32) throw new Error(`Invalid credential key in ${KEY_PATH}`);
  return cachedKey;
}

function readStore(): StoreFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as StoreFile;
    if (parsed && parsed.version === 1 && parsed.entries) return parsed;
  } catch { /* missing or corrupt — start empty */ }
  return { version: 1, entries: {} };
}

function writeStore(store: StoreFile): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, STORE_PATH);
}

export function setSecret(ref: string, value: string): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
  const store = readStore();
  store.entries[ref] = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
}

export function getSecret(ref: string): string | undefined {
  const entry = readStore().entries[ref];
  if (!entry) return undefined;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()]).toString('utf-8');
  } catch {
    console.error(`[credentials] Could not decrypt "${ref}" — was the key changed?`);
    return undefined;
  }
}

/**
 * Encrypt a value with the credential-store key, for secrets that must live
 * outside the store (e.g. an encrypted column in the shared DB). Returns
 * base64(iv + tag + ciphertext).
 */
export function encryptWithStoreKey(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/** Inverse of encryptWithStoreKey. Throws if the value was encrypted with another key. */
export function decryptWithStoreKey(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf-8');
}

export function hasSecret(ref: string): boolean {
  return ref in readStore().entries;
}

export function deleteSecret(ref: string): void {
  const store = readStore();
  if (!(ref in store.entries)) return;
  delete store.entries[ref];
  writeStore(store);
}

/** Delete every secret whose ref starts with `prefix` (e.g. when removing a connection). */
export function deleteSecretsWithPrefix(prefix: string): void {
  const store = readStore();
  let changed = false;
  for (const ref of Object.keys(store.entries)) {
    if (ref.startsWith(prefix)) {
      delete store.entries[ref];
      changed = true;
    }
  }
  if (changed) writeStore(store);
}

export function listSecretRefs(prefix = ''): string[] {
  return Object.keys(readStore().entries).filter((r) => r.startsWith(prefix));
}

/** Safe-to-display form of a secret: `••••abcd`, or '' when unset. */
export function maskSecret(value: string | undefined): string {
  if (!value) return '';
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}
