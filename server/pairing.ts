import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { hash } from "./auth.js";
import { one, owned, AppError, type DB } from "./db.js";
import { Quiz } from "./quiz.js";

export const pairingCommandSchema = z.object({
  command_id: z.string().min(1).max(100),
  expected_version: z.number().int().nonnegative(),
  auto_assign: z.boolean().optional(),
});
export const joinSchema = z.object({
  v: z.literal(1),
  room_code: z.string().transform((s) => s.replace(/\s/g, "")).pipe(z.string().regex(/^\d{8}$/)),
  request_id: z.string().min(1).max(100),
  device_name: z.string().trim().min(1).max(80),
  device_secret: z.string().regex(/^[a-f0-9]{64}$/),
  device_id: z.string().uuid().optional(),
});

export function pairingSnapshot(db: DB, session: string, now = Date.now()) {
  const p = one(db, "SELECT * FROM room_pairing WHERE session_id=?", session);
  const state = one(db, "SELECT state FROM quiz_sessions WHERE id=?", session)?.state;
  const open = !!p && p.closed_at == null && p.expires_at > now && ["LOBBY", "PAUSED"].includes(state);
  return {
    status: open ? "OPEN" : p && p.closed_at == null && p.expires_at <= now ? "EXPIRED" : "CLOSED",
    room_code: open ? p!.room_code : null,
    expires_at: p?.expires_at ?? null,
    auto_assign: !!p?.auto_assign,
  };
}

export class Pairing {
  constructor(private db: DB, private now = Date.now) {}
  recover() {
    this.db.prepare("UPDATE room_pairing SET closed_at=? WHERE closed_at IS NULL").run(this.now());
  }
  command(session: string, owner: string, action: "open" | "close", input: z.infer<typeof pairingCommandSchema>) {
    return this.db.transaction(() => {
      const s = owned(this.db, "quiz_sessions", session, owner);
      const digest = hash(JSON.stringify({ action, ...input }));
      const receipt = one(this.db, "SELECT * FROM room_pairing_commands WHERE session_id=? AND command_id=?", session, input.command_id);
      if (receipt) {
        if (receipt.payload_hash !== digest)
          throw new AppError("COMMAND_REUSED", "Mã lệnh đã dùng với nội dung khác", 409);
        return { ...JSON.parse(receipt.result), duplicate: true };
      }
      if (s.state_version !== input.expected_version)
        throw new AppError("VERSION_CONFLICT", "Trạng thái đã thay đổi; đồng bộ rồi thử lại", 409);
      if (!["LOBBY", "PAUSED"].includes(s.state))
        throw new AppError("INVALID_STATE", "Chỉ mở nhận thiết bị trong phòng chờ hoặc khi tạm dừng", 409);
      if (action === "open") {
        let code: string;
        do { code = String(randomInt(100000000)).padStart(8, "0"); }
        while (one(this.db, "SELECT 1 FROM room_pairing WHERE room_code=?", code));
        this.db.prepare("INSERT INTO room_pairing(session_id,room_code,expires_at,closed_at,auto_assign) VALUES (?,?,?,NULL,?) ON CONFLICT(session_id) DO UPDATE SET room_code=excluded.room_code,expires_at=excluded.expires_at,closed_at=NULL,auto_assign=excluded.auto_assign")
          .run(session, code, this.now() + 5 * 60000, +(input.auto_assign ?? false));
      } else {
        this.db.prepare("UPDATE room_pairing SET closed_at=? WHERE session_id=?").run(this.now(), session);
      }
      this.bump(session);
      const result = { ...pairingSnapshot(this.db, session, this.now()), state_version: s.state_version + 1 };
      this.db.prepare("INSERT INTO room_pairing_commands VALUES (?,?,?,?)").run(session, input.command_id, digest, JSON.stringify(result));
      return result;
    })();
  }
  join(input: z.infer<typeof joinSchema>, allowedOwner?: string) {
    return this.db.transaction(() => {
      const digest = hash(JSON.stringify(input));
      const secretHash = hash(input.device_secret);
      const receipt = one(this.db, "SELECT * FROM room_join_receipts WHERE request_id=?", input.request_id);
      if (receipt) {
        if (receipt.payload_hash !== digest)
          throw new AppError("REQUEST_REUSED", "Mã gửi lại không khớp nội dung", 409);
        const d = one(this.db, "SELECT * FROM devices WHERE id=? AND secret_hash=? AND revoked=0", receipt.device_id, secretHash);
        if (!d) throw new AppError("DEVICE_REVOKED", "Thiết bị đã bị thu hồi hoặc đổi thông tin xác thực", 403);
        if (allowedOwner && d.owner_teacher_id !== allowedOwner)
          throw new AppError("ROOM_UNAVAILABLE", "Mã phòng không khả dụng", 400);
        if (!one(this.db, "SELECT 1 FROM room_devices WHERE session_id=? AND device_id=?", receipt.session_id, d.id))
          throw new AppError("DEVICE_REMOVED", "Thiết bị đã được gỡ khỏi phòng; dùng yêu cầu ghép mới", 409);
        return { device_id: d.id, session_id: receipt.session_id, label: d.label, duplicate: true };
      }
      const room = one(this.db, "SELECT p.*,s.owner_teacher_id,s.state FROM room_pairing p JOIN quiz_sessions s ON s.id=p.session_id WHERE p.room_code=? AND p.closed_at IS NULL AND p.expires_at>? AND s.state IN ('LOBBY','PAUSED')", input.room_code, this.now());
      if (!room || (allowedOwner && room.owner_teacher_id !== allowedOwner))
        throw new AppError("ROOM_UNAVAILABLE", "Mã phòng sai, hết hạn hoặc đã đóng nhận thiết bị", 400);
      let d = input.device_id
        ? one(this.db, "SELECT * FROM devices WHERE id=? AND secret_hash=?", input.device_id, secretHash)
        : one(this.db, "SELECT * FROM devices WHERE secret_hash=?", secretHash);
      if (input.device_id && !d)
        throw new AppError("DEVICE_REVOKED", "Thông tin xác thực thiết bị không còn hợp lệ", 403);
      if (d?.revoked) throw new AppError("DEVICE_REVOKED", "Thiết bị đã bị thu hồi", 403);
      if (d && d.owner_teacher_id !== room.owner_teacher_id)
        throw new AppError("DEVICE_OWNER_MISMATCH", "Thiết bị thuộc giáo viên khác; cần đặt lại cấu hình để đăng ký mới", 409);
      if (d && one(this.db, "SELECT 1 FROM room_devices m JOIN quiz_sessions s ON s.id=m.session_id WHERE m.device_id=? AND m.session_id<>? AND s.state IN ('LOBBY','RUNNING','PAUSED') UNION SELECT 1 FROM session_devices WHERE device_id=? AND session_id<>? AND active=1", d.id, room.session_id, d.id, room.session_id))
        throw new AppError("DEVICE_BUSY", "Thiết bị đang ở phòng khác; gỡ khỏi phòng cũ trước", 409);
      const member = d && one(this.db, "SELECT 1 FROM room_devices WHERE session_id=? AND device_id=?", room.session_id, d.id);
      const count = one(this.db, "SELECT count(*) n FROM (SELECT device_id FROM room_devices WHERE session_id=? UNION SELECT device_id FROM session_devices WHERE session_id=? AND active=1) m JOIN devices d ON d.id=m.device_id WHERE d.revoked=0", room.session_id, room.session_id)!.n;
      const bound = d && one(this.db, "SELECT 1 FROM session_devices WHERE session_id=? AND device_id=? AND active=1", room.session_id, d.id);
      if (!member && !bound && count >= 50)
        throw new AppError("ROOM_FULL", "Phòng đã đủ 50 thiết bị", 409);
      if (!d) {
        const id = randomUUID();
        let label = input.device_name;
        if (one(this.db, "SELECT 1 FROM devices WHERE owner_teacher_id=? AND revoked=0 AND lower(label)=lower(?)", room.owner_teacher_id, label))
          label = `${label} · ${id}`;
        this.db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,?,?)").run(id, room.owner_teacher_id, label, secretHash);
        d = { id, label };
      }
      this.db.prepare("INSERT OR IGNORE INTO room_devices(session_id,device_id,joined_at) VALUES (?,?,?)").run(room.session_id, d.id, this.now());
      this.db.prepare("INSERT INTO room_join_receipts VALUES (?,?,?,?,?)").run(input.request_id, digest, d.id, room.session_id, this.now());
      if (room.auto_assign && !bound) {
        const student = one(this.db, "SELECT s.id FROM session_students s WHERE s.session_id=? AND s.absent=0 AND NOT EXISTS(SELECT 1 FROM session_devices b WHERE b.session_student_id=s.id AND b.active=1) ORDER BY s.student_code,s.id LIMIT 1", room.session_id);
        if (student) new Quiz(this.db, this.now).bind(room.session_id, student.id, d.id, room.owner_teacher_id);
      }
      this.bump(room.session_id);
      return { device_id: d.id, session_id: room.session_id, label: d.label, duplicate: false };
    })();
  }
  remove(session: string, device: string, owner: string) {
    this.db.transaction(() => {
      const s = owned(this.db, "quiz_sessions", session, owner);
      owned(this.db, "devices", device, owner);
      if (!["LOBBY", "PAUSED"].includes(s.state))
        throw new AppError("INVALID_STATE", "Tạm dừng bài trước khi gỡ thiết bị", 409);
      this.db.prepare("UPDATE session_devices SET active=0 WHERE session_id=? AND device_id=?").run(session, device);
      this.db.prepare("DELETE FROM room_devices WHERE session_id=? AND device_id=?").run(session, device);
      // A retry of an old join must not restore a membership explicitly removed by the teacher.
      this.bump(session);
    })();
  }
  private bump(session: string) {
    this.db.prepare("UPDATE quiz_sessions SET state_version=state_version+1 WHERE id=?").run(session);
  }
}
