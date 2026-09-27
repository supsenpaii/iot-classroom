import session from "express-session";
import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { type DB, one } from "./db.js";
function scrypt(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) =>
    rawScrypt(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
declare module "express-session" {
  interface SessionData {
    teacherId: string;
    csrf: string;
  }
}
export const token = () => randomBytes(32).toString("hex");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function passwordHash(password: string) {
  const salt = token();
  const key = (await scrypt(password, salt)) as Buffer;
  return `scrypt:16384:8:1:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, n, r, p, salt, key] = stored.split(":");
  if (algorithm !== "scrypt" || n !== "16384" || r !== "8" || p !== "1")
    return false;
  if (!salt || !key) return false;
  const actual = (await scrypt(password, salt)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export class SqliteStore extends session.Store {
  constructor(private db: DB) {
    super();
  }
  get(sid: string, cb: (e: unknown, s?: session.SessionData | null) => void) {
    try {
      const row = one(
        this.db,
        "SELECT data FROM auth_sessions WHERE sid=? AND expires>?",
        sid,
        Date.now(),
      );
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (e) {
      cb(e);
    }
  }
  set(sid: string, value: session.SessionData, cb?: (e?: unknown) => void) {
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO auth_sessions VALUES (?,?,?)")
        .run(
          sid,
          JSON.stringify(value),
          value.cookie.expires
            ? new Date(value.cookie.expires).getTime()
            : Date.now() + 86400000,
        );
      cb?.();
    } catch (e) {
      cb?.(e);
    }
  }
  destroy(sid: string, cb?: (e?: unknown) => void) {
    try {
      this.db.prepare("DELETE FROM auth_sessions WHERE sid=?").run(sid);
      cb?.();
    } catch (e) {
      cb?.(e);
    }
  }
  touch(sid: string, value: session.SessionData, cb?: (e?: unknown) => void) {
    try {
      this.db
        .prepare("UPDATE auth_sessions SET expires=? WHERE sid=?")
        .run(
          value.cookie.expires
            ? new Date(value.cookie.expires).getTime()
            : Date.now() + 86400000,
          sid,
        );
      cb?.();
    } catch (error) {
      cb?.(error);
    }
  }
}
export function revokeTeacher(db: DB, id: string) {
  db.prepare(
    "DELETE FROM auth_sessions WHERE json_extract(data,'$.teacherId')=?",
  ).run(id);
  db.prepare("DELETE FROM access_tokens WHERE owner_teacher_id=?").run(id);
}
