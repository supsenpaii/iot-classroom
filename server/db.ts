import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
export function openDb(path: string) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const dir = fileURLToPath(new URL("./migrations/", import.meta.url));
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort())
    if (!db.prepare("SELECT 1 FROM migrations WHERE name=?").get(name))
      db.transaction(() => {
        db.exec(readFileSync(`${dir}/${name}`, "utf8"));
        db.prepare("INSERT INTO migrations VALUES (?,?)").run(name, Date.now());
      })();
  return db;
}
export type DB = ReturnType<typeof openDb>;
// SQLite rows are runtime validated at the HTTP boundary, JSON columns have feature schemas.
export type Row = Record<string, any>;
export const one = (db: DB, sql: string, ...params: unknown[]) =>
  db.prepare(sql).get(...params) as Row | undefined;
export const all = (db: DB, sql: string, ...params: unknown[]) =>
  db.prepare(sql).all(...params) as Row[];
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function must<T>(
  value: T | null | undefined,
  message = "Không tìm thấy dữ liệu",
): T {
  if (value == null) throw new AppError("NOT_FOUND", message, 404);
  return value;
}
export function owned(db: DB, table: string, id: string, owner: string) {
  return must(
    one(
      db,
      `SELECT * FROM ${table} WHERE id=? AND owner_teacher_id=?`,
      id,
      owner,
    ),
  );
}

// An OS-held SQLite lock survives container PID namespaces and releases automatically on crash.
export function acquireAppLock(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = new Database(`${path}.lock.sqlite`);
  lock.pragma("busy_timeout = 0");
  try {
    lock.exec("BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw new Error(
      "Database đang được app sử dụng; dừng app trước khi tiếp tục",
    );
  }
  return () => {
    lock.exec("ROLLBACK");
    lock.close();
  };
}
