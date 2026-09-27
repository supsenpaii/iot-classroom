import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  chmodSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import Database from "better-sqlite3";
import { openDb, one, acquireAppLock } from "../server/db.js";
import { passwordHash, revokeTeacher } from "../server/auth.js";
const action = process.argv[2],
  path = process.env.DATABASE_PATH || "./data/app.sqlite";
if (action === "restore") {
  const source = process.argv[3];
  if (!source || !process.argv.includes("--confirm-replace"))
    throw Error(
      "Dừng app rồi chạy: npm run db:restore -- /path/backup.sqlite --confirm-replace",
    );
  if (resolve(source) === resolve(path))
    throw Error("Backup và database đích phải khác nhau");
  const release = acquireAppLock(path);
  const backup = new Database(resolve(source), { readonly: true });
  if (backup.pragma("integrity_check", { simple: true }) !== "ok")
    throw Error("Backup không toàn vẹn");
  if (
    !backup.prepare("SELECT 1 FROM sqlite_master WHERE name='migrations'").get()
  )
    throw Error("Backup không phải database của app");
  backup.close();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const old = new Database(path);
    await old.backup(`${path}.before-restore-${Date.now()}`);
    old.close();
  }
  for (const suffix of ["-wal", "-shm"])
    if (existsSync(path + suffix)) unlinkSync(path + suffix);
  copyFileSync(resolve(source), path);
  chmodSync(path, 0o600);
  release();
  console.log("Đã restore. Database cũ được giữ cạnh file đích.");
} else {
  const release = action === "migrate" ? acquireAppLock(path) : null;
  const db = openDb(path);
  try {
    if (action === "migrate")
      console.log(
        "Migration hoàn tất. Schema:",
        one(db, "SELECT count(*) n FROM migrations")?.n,
      );
    else if (action === "backup") {
      const dir = process.env.BACKUP_DIR || "./backups";
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = resolve(
        dir,
        `classroom-v1-schema${one(db, "SELECT count(*) n FROM migrations")?.n}-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
      );
      await db.backup(file);
      chmodSync(file, 0o600);
      console.log(file);
    } else if (action === "create" || action === "reset") {
      let muted = false;
      const output = new Writable({
          write(chunk, _encoding, callback) {
            if (!muted) process.stdout.write(chunk);
            callback();
          },
        }),
        rl = createInterface({ input: process.stdin, output, terminal: true });
      const email = (await rl.question("Email giáo viên: "))
        .trim()
        .toLowerCase();
      process.stdout.write("Mật khẩu (ít nhất 12 ký tự, ẩn): ");
      muted = true;
      const password = await rl.question("");
      muted = false;
      process.stdout.write("\n");
      rl.close();
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        password.length < 12 ||
        password.length > 200
      )
        throw Error("Email hoặc mật khẩu không hợp lệ");
      const encoded = await passwordHash(password);
      if (action === "create")
        db.prepare("INSERT INTO teachers VALUES (?,?,?,?)").run(
          randomUUID(),
          email,
          encoded,
          Date.now(),
        );
      else {
        const teacher = one(db, "SELECT id FROM teachers WHERE email=?", email);
        if (!teacher) throw Error("Không tìm thấy giáo viên");
        db.transaction(() => {
          db.prepare("UPDATE teachers SET password_hash=? WHERE id=?").run(
            encoded,
            teacher.id,
          );
          revokeTeacher(db, teacher.id);
        })();
      }
      console.log("Đã lưu tài khoản. Phiên cũ bị thu hồi khi reset mật khẩu.");
    } else throw Error("Lệnh không hợp lệ");
  } finally {
    db.close();
    release?.();
  }
}
