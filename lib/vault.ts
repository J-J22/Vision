// API keys entered on the AI parts page, encrypted at rest (AES-256-GCM).
// - Keys are stored in data/keys.enc.json; the master secret is VISION_SECRET, or a random one
//   kept in data/.vault-secret (readable only by this user). data/ is never committed.
// - Keys never go back to the browser: pages only see the provider, where the key came from and its last 4 characters.
// - A key in .env.local still works; a key saved on the page takes priority.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA = join(process.cwd(), "data");
const STORE = join(DATA, "keys.enc.json");
const SECRET_FILE = join(DATA, ".vault-secret");

type Sealed = { iv: string; tag: string; data: string; last4: string; savedAt: string };

function masterKey(): Buffer {
  if (process.env.VISION_SECRET) return createHash("sha256").update(process.env.VISION_SECRET).digest();
  mkdirSync(DATA, { recursive: true });
  if (!existsSync(SECRET_FILE)) {
    writeFileSync(SECRET_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  try {
    chmodSync(SECRET_FILE, 0o600);
  } catch {}
  return createHash("sha256").update(readFileSync(SECRET_FILE, "utf8").trim()).digest();
}

function readStore(): Record<string, Sealed> {
  if (!existsSync(STORE)) return {};
  try {
    return JSON.parse(readFileSync(STORE, "utf8"));
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, Sealed>) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(STORE, JSON.stringify(store, null, 1), { mode: 0o600 });
}

function seal(plain: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"), last4: plain.slice(-4), savedAt: new Date().toISOString() };
}

function open(s: Sealed): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(s.iv, "base64"));
    decipher.setAuthTag(Buffer.from(s.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(s.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong master secret or a damaged file: treat the key as missing
    return null;
  }
}

export function saveKey(provider: string, key: string) {
  const store = readStore();
  store[provider] = seal(key.trim());
  writeStore(store);
}

export function removeKey(provider: string) {
  const store = readStore();
  delete store[provider];
  writeStore(store);
}

// The key to use for a provider: the dashboard's first, then .env.local
export function getKey(provider: string, envName: string): string {
  const sealed = readStore()[provider];
  const fromVault = sealed ? open(sealed) : null;
  return fromVault || process.env[envName] || "";
}

export function keyStatus(provider: string, envName: string): { source: "dashboard" | "env" | "none"; last4?: string; savedAt?: string } {
  const sealed = readStore()[provider];
  if (sealed && open(sealed)) return { source: "dashboard", last4: sealed.last4, savedAt: sealed.savedAt };
  const env = process.env[envName];
  if (env) return { source: "env", last4: env.slice(-4) };
  return { source: "none" };
}
