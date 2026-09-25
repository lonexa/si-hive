/**
 * Encryption for workflow secrets stored in the shared DB (site-credential
 * passwords, connector configs).
 *
 * Uses the credential-store key (HIVE_SECRET_KEY, or $HIVE_HOME/secret.key) —
 * see packages/shared/src/server/credentials.ts. Installs that share one
 * database must share HIVE_SECRET_KEY to read each other's rows.
 */
import { encryptWithStoreKey, decryptWithStoreKey } from '../../../../packages/shared/src/server/credentials.js';

/** Format: base64(iv + tag + ciphertext). */
export function encrypt(plaintext: string): string {
  return encryptWithStoreKey(plaintext);
}

export function decrypt(encoded: string): string {
  return decryptWithStoreKey(encoded);
}

/**
 * Read a stored config blob that may be in any of three states:
 *  - encrypted with this install's key (the normal case),
 *  - plain JSON (system connectors seeded by syncBundledConnectors),
 *  - encrypted with *another* install's key.
 *
 * The third case is routine when several installs share one database but not
 * one HIVE_SECRET_KEY: a connector created on one machine is unreadable on the
 * others.
 *
 * Returns null instead of throwing so the caller can decide whether it actually
 * needs the config — an email connector's payload is inert, a webhook's is not.
 */
export function tryDecryptJson<T>(blob: string): T | null {
  try {
    return JSON.parse(decrypt(blob)) as T;
  } catch {
    try {
      return JSON.parse(blob) as T;
    } catch {
      return null;
    }
  }
}

/** Operator-facing explanation for a tryDecryptJson miss. */
export function undecryptableConfigMessage(connectorName: string): string {
  return (
    `Connector "${connectorName}" has a config this machine can't decrypt — it was encrypted ` +
    `with a different SI Hive secret key. Recreate the connector here, or set the same ` +
    `HIVE_SECRET_KEY on every SI Hive install that shares this database.`
  );
}
