// Each strategy agent owns an ed25519 key. Its NEAR implicit account id is the hex of the public key,
// which is also its account in NEAR Intents. The private key is kept in the browser's localStorage
// so the agent can sign its own stop-loss exit.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => ALPHABET[d]).join("");
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface AgentKey {
  /** 64 hex chars = implicit account id = Tidepool intents account */
  accountId: string;
  /** `ed25519:` + base58 */
  publicKey: string;
  /** base64 PKCS#8 private key */
  pkcs8: string;
}

export async function newAgentKey(): Promise<AgentKey> {
  const kp = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  return { accountId: toHex(pub), publicKey: `ed25519:${base58(pub)}`, pkcs8: toB64(pkcs8) };
}

/** Signs the UTF-8 bytes of `message`; returns `ed25519:` + base58(signature). */
export async function signMessage(key: AgentKey, message: string): Promise<string> {
  const priv = await crypto.subtle.importKey("pkcs8", fromB64(key.pkcs8), "Ed25519", false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", priv, new TextEncoder().encode(message)));
  return `ed25519:${base58(sig)}`;
}

export function randomNonce(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(32)));
}

// --- A Helm wallet that is the same every time for the same NEAR account ---------------------------
// The user signs one fixed message with their NEAR wallet. Ed25519 signatures are deterministic, so the
// same account (same key) always produces the same signature, and its hash is the seed of the Helm wallet
// key. Any device, any visit: same account in, same Helm wallet out. Nothing is stored on a server.

const PKCS8_ED25519_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const fromB64url = (s: string) => fromB64(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));

export const walletMessage = (accountId: string) =>
  `Helm: unlock the Helm wallet of ${accountId}. This signature only creates your Helm wallet key. It does not move any funds.`;

/** 32-byte seed from the account and its signature of walletMessage(account). */
export async function walletSeed(accountId: string, signature: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`helm-wallet-v1|${accountId}|${signature}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/** The ed25519 key for a 32-byte seed (same seed, same key, same account id). */
export async function agentKeyFromSeed(seed: Uint8Array): Promise<AgentKey> {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  const pkcs8 = new Uint8Array(48);
  pkcs8.set(PKCS8_ED25519_PREFIX);
  pkcs8.set(seed, 16);
  const priv = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  const pub = fromB64url(jwk.x!);
  return { accountId: toHex(pub), publicKey: `ed25519:${base58(pub)}`, pkcs8: toB64(pkcs8) };
}
/** base58 decode (block hashes, keys). */
export function unbase58(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(v);
  }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch === "1") out.unshift(0); else break; }
  return Uint8Array.from(out);
}

/** Signs raw bytes (a NEAR transaction hash); returns the 64-byte signature. */
export async function signBytes(key: AgentKey, bytes: Uint8Array): Promise<Uint8Array> {
  const priv = await crypto.subtle.importKey("pkcs8", fromB64(key.pkcs8), "Ed25519", false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("Ed25519", priv, bytes as BufferSource));
}

/** The same key in NEAR's own format (ed25519:<base58 seed+public>), used to cross-check with near-js. */
export function nearSecretKey(key: AgentKey): string {
  const seed = fromB64(key.pkcs8).slice(16, 48);
  const pub = unbase58(key.publicKey.slice(8));
  const both = new Uint8Array(64);
  both.set(seed); both.set(pub, 32);
  return `ed25519:${base58(both)}`;
}