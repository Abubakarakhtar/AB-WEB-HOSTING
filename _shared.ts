// Shared helpers for EXZ Host Pages Functions.
// Runs on the Cloudflare Workers runtime — Web APIs only, no node imports.

// Minimal ambient declarations for Cloudflare Workers runtime globals
// (the real objects are provided by the runtime; these exist only for tsc).
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
    options?: { expirationTtl?: number }
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface R2Object {
  key: string;
}

interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

interface R2ObjectBody {
  readonly body: ReadableStream;
  text(): Promise<string>;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: Record<string, string> }
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<R2Objects>;
}

export interface Env {
  SITES_KV: KVNamespace;
  SITES_R2: R2Bucket;
  ASSETS: Fetcher;
}

export interface Ctx {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}

export interface SiteMeta {
  slug: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  updateKeyHash: string;
  sitePasswordHash?: string;
  custom404?: string;
  launchDate?: string;
  construction: boolean;
  watermark: boolean;
  files: { path: string; size: number; type: string }[];
}

export interface ValidatedFile {
  path: string;
  type: string;
  bytes: Uint8Array;
}

/** Lowercase, replace [^a-z0-9-] with '-', collapse dashes, trim, max 50 chars. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** JSON response helper. */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** SHA-256 hex digest using crypto.subtle. */
export async function sha256hex(str: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32-char alphanumeric random string. */
export function randomKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  let out = "";
  for (const b of arr) out += chars[b % chars.length];
  return out;
}

/** Random deploy id like dep_Ab3x... */
export function newDeployId(): string {
  return "dep_" + randomKey().slice(0, 16);
}

/** Max 10 deploys/hour per IP. Returns true if allowed (and counts this attempt). */
export async function checkRateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rl:${ip}`;
  const raw = await env.SITES_KV.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= 10) return false;
  await env.SITES_KV.put(key, String(count + 1), { expirationTtl: 3600 });
  return true;
}

const RISKY_EXTS = new Set([
  "exe", "apk", "php", "py", "sh", "bat", "cmd", "ps1",
  "jar", "msi", "scr", "dll", "com", "vbs", "asp", "aspx", "jsp",
]);

/** True for executable / server-side extensions that must never be hosted. */
export function isRisky(path: string): boolean {
  const name = path.split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return RISKY_EXTS.has(name.slice(dot + 1).toLowerCase());
}

/** Constant-time comparison of sha256hex(provided) against storedHash. */
export async function verifyUpdateKey(provided: string, storedHash: string): Promise<boolean> {
  if (!provided || !storedHash) return false;
  const h = await sha256hex(provided);
  if (h.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}

/** Normalize an upload path. Returns null if invalid or traversal is attempted. */
export function cleanPath(p: string): string | null {
  const s = p.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = s.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") return null;
    out.push(part);
  }
  const joined = out.join("/");
  if (!joined || joined.length > 200) return null;
  return joined;
}

/** Decode a base64 string to bytes. Throws on invalid input. */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  map: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
};

/** Content-Type for a file path based on extension. */
export function contentTypeFor(path: string): string {
  const name = path.split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

/** Parse a Cookie header into a name->value map. */
export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

/** Escape a string for safe HTML interpolation. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}

/** Delete every R2 object under a key prefix (handles pagination). */
export async function deleteR2Prefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined = undefined;
  do {
    const page = await env.SITES_R2.list({ prefix, cursor });
    for (const obj of page.objects) {
      await env.SITES_R2.delete(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** Public URL for a site from the incoming request origin. */
export function siteUrl(request: Request, slug: string): string {
  return new URL(request.url).origin + "/" + slug;
}

/**
 * Validate a multi-file upload payload.
 * Rules: 1-100 files, 20MB total decoded, must include index.html
 * (case-insensitive basename), no risky extensions, no path traversal.
 */
export function validateUploadFiles(
  files: unknown
): { ok: true; files: ValidatedFile[] } | { ok: false; error: string } {
  if (!Array.isArray(files) || files.length === 0 || files.length > 100) {
    return { ok: false, error: "Provide between 1 and 100 files." };
  }
  let total = 0;
  let hasIndex = false;
  const out: ValidatedFile[] = [];
  for (const f of files) {
    const item = f as { path?: unknown; type?: unknown; content?: unknown };
    const rawPath = String(item?.path || "");
    const clean = cleanPath(rawPath);
    if (!clean) return { ok: false, error: `Invalid file path: ${rawPath || "(empty)"}` };
    if (isRisky(clean)) return { ok: false, error: `Blocked file type: ${rawPath}` };
    let bytes: Uint8Array;
    try {
      bytes = b64ToBytes(String(item?.content || ""));
    } catch {
      return { ok: false, error: `Invalid base64 content: ${rawPath}` };
    }
    total += bytes.length;
    if (total > 20 * 1024 * 1024) {
      return { ok: false, error: "Total upload size exceeds 20MB." };
    }
    const base = (clean.split("/").pop() || "").toLowerCase();
    if (base === "index.html") hasIndex = true;
    out.push({
      path: clean,
      type: String(item?.type || "") || contentTypeFor(clean),
      bytes,
    });
  }
  if (!hasIndex) return { ok: false, error: "An index.html file is required." };
  return { ok: true, files: out };
}
