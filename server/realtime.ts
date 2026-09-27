import { Server, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { RequestHandler, Request, Response } from "express";
import { type DB, type Row, one, all, owned } from "./db.js";
import { hash } from "./auth.js";
import type { Quiz } from "./quiz.js";
import type { AppConfig } from "./app.js";
export function attachRealtime(
  server: Server,
  db: DB,
  quiz: Quiz,
  auth: RequestHandler,
  config: AppConfig,
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  type Peer = {
    role: "teacher" | "device" | "projection" | "pending";
    owner?: string;
    sid?: string;
    device?: string;
    resource?: string;
    grant?: string;
    expires?: number;
    alive: number;
    rate: number;
    window: number;
    started: number;
  };
  const peers = new Map<WebSocket, Peer>(),
    devices = new Map<string, WebSocket>();
  let scheduled: NodeJS.Timeout | undefined;
  let stopping = false;
  const send = (ws: WebSocket, value: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 256000) ws.close(1013, "Client too slow");
      else ws.send(JSON.stringify(value));
    }
  };
  const teacherSnapshot = (id: string) => {
    const s = quiz.get(id);
    return {
      ...quiz.snapshot(id),
      bank_id: s.bank_id,
      students: all(
        db,
        "SELECT s.*,b.id binding_id,b.device_id,d.label,d.last_seen FROM session_students s LEFT JOIN session_devices b ON b.session_student_id=s.id AND b.active=1 LEFT JOIN devices d ON d.id=b.device_id WHERE s.session_id=? ORDER BY s.student_code",
        id,
      ).map((st) => ({ ...st, online: devices.has(st.device_id) })),
      events: all(
        db,
        "SELECT * FROM session_events WHERE session_id=? ORDER BY id DESC LIMIT 20",
        id,
      ),
    };
  };
  const valid = (p: Peer) => {
    if (p.role === "pending") return Date.now() - p.started < 5000;
    if (p.expires && p.expires < Date.now()) return false;
    if (
      p.sid &&
      !one(
        db,
        "SELECT 1 FROM auth_sessions WHERE sid=? AND expires>?",
        p.sid,
        Date.now(),
      )
    )
      return false;
    if (
      p.device &&
      !one(db, "SELECT 1 FROM devices WHERE id=? AND revoked=0", p.device)
    )
      return false;
    if (
      p.grant &&
      !one(
        db,
        "SELECT 1 FROM access_tokens WHERE hash=? AND expires>?",
        p.grant,
        Date.now(),
      )
    )
      return false;
    return true;
  };
  const snapshot = (ws: WebSocket, p: Peer) => {
    if (!valid(p)) {
      if (
        p.role === "projection" &&
        p.resource &&
        ["FINISHED", "CANCELLED"].includes(quiz.get(p.resource).state)
      )
        send(ws, {
          v: 1,
          type: "session.snapshot",
          data: quiz.snapshot(p.resource),
        });
      ws.close(4001, "Access expired");
      return;
    }
    if (p.role === "device" && p.device)
      send(ws, {
        v: 1,
        type: "session.snapshot",
        data: quiz.deviceSnapshot(p.device),
      });
    else if (p.resource)
      send(ws, {
        v: 1,
        type: "session.snapshot",
        data:
          p.role === "teacher"
            ? teacherSnapshot(p.resource)
            : quiz.snapshot(p.resource),
      });
  };
  const broadcast = () => {
    for (const [ws, p] of peers) snapshot(ws, p);
  };
  const schedule = () => {
    if (stopping) return;
    if (!scheduled)
      scheduled = setTimeout(() => {
        scheduled = undefined;
        broadcast();
      }, 40);
  };
  const activate = (ws: WebSocket, p: Peer, device: string) => {
    devices.get(device)?.close(4002, "Replaced connection");
    devices.set(device, ws);
    p.role = "device";
    p.device = device;
    db.prepare("UPDATE devices SET last_seen=? WHERE id=?").run(
      Date.now(),
      device,
    );
    const b = one(
      db,
      "SELECT session_id FROM session_devices WHERE device_id=? AND active=1",
      device,
    );
    if (b) quiz.event(b.session_id, "device.connected", { device_id: device });
    schedule();
  };
  server.on("upgrade", (request, socket, head) => {
    if (
      request.url !== "/ws" ||
      (request.headers.origin && request.headers.origin !== config.origin)
    ) {
      socket.destroy();
      return;
    }
    if (peers.size >= 160) {
      socket.destroy();
      return;
    }
    const raw = request.headers.authorization;
    const device = request.headers["x-device-id"];
    if (raw && typeof device === "string") {
      const d = one(
        db,
        "SELECT * FROM devices WHERE id=? AND secret_hash=? AND revoked=0",
        device,
        hash(raw.replace(/^Bearer /, "")),
      );
      if (!d) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) =>
        connect(ws, {
          role: "device",
          owner: d.owner_teacher_id,
          device: d.id,
          alive: Date.now(),
          rate: 0,
          window: Date.now(),
          started: Date.now(),
        }),
      );
    } else {
      if (request.headers.origin !== config.origin) {
        socket.destroy();
        return;
      }
      auth(
        request as Request,
        new ServerResponse(request) as unknown as Response,
        () => {
          const req = request as Request;
          wss.handleUpgrade(request, socket, head, (ws) =>
            connect(ws, {
              role: req.session?.teacherId ? "teacher" : "pending",
              owner: req.session?.teacherId,
              sid: req.session?.teacherId ? req.sessionID : undefined,
              alive: Date.now(),
              rate: 0,
              window: Date.now(),
              started: Date.now(),
            }),
          );
        },
      );
    }
  });
  function connect(ws: WebSocket, p: Peer) {
    peers.set(ws, p);
    if (p.device) activate(ws, p, p.device);
    ws.on("pong", () => {
      if (stopping) return;
      p.alive = Date.now();
      if (p.device)
        db.prepare("UPDATE devices SET last_seen=? WHERE id=?").run(
          Date.now(),
          p.device,
        );
    });
    ws.on("error", () => {});
    ws.on("message", (raw) => {
      if (stopping) return;
      try {
        if (!valid(p)) {
          ws.close(4001, "Access expired");
          return;
        }
        const now = Date.now();
        if (now - p.window > 1000) {
          p.rate = 0;
          p.window = now;
        }
        if (++p.rate > 30) {
          ws.close(1008, "Rate limit");
          return;
        }
        const msg = JSON.parse(raw.toString());
        if (msg.v !== 1) throw Error("version");
        if (msg.type === "hello") {
          if (p.role === "device" || p.role === "projection")
            throw Error("already authenticated");
          if (msg.ticket) {
            const value = String(msg.ticket);
            if (value.length !== 64) throw Error("ticket");
            const t = one(
              db,
              "SELECT * FROM access_tokens WHERE hash=? AND expires>?",
              hash(value),
              Date.now(),
            );
            if (
              !t ||
              !one(
                db,
                "SELECT 1 FROM auth_sessions WHERE sid=? AND expires>?",
                t.auth_sid,
                Date.now(),
              )
            )
              throw Error("ticket");
            if (
              t.kind === "simulator" &&
              config.simulator &&
              !t.used &&
              p.owner === t.owner_teacher_id &&
              p.sid === t.auth_sid
            ) {
              db.prepare("UPDATE access_tokens SET used=1 WHERE hash=?").run(
                t.hash,
              );
              p.grant = t.hash;
              /* Ticket is one-use; the authenticated socket follows the login lifetime. */ p.expires =
                Date.now() + 86400000;
              activate(ws, p, t.resource_id);
              p.grant = undefined;
            } else if (t.kind === "projection") {
              p.role = "projection";
              p.owner = undefined;
              p.sid = t.auth_sid;
              p.resource = t.resource_id;
              p.grant = t.hash;
              p.expires = t.expires;
            } else throw Error("ticket");
          } else if (p.role === "teacher" && p.owner) {
            owned(db, "quiz_sessions", String(msg.session_id), p.owner);
            p.resource = String(msg.session_id);
          } else throw Error("auth");
          snapshot(ws, p);
        } else if (
          msg.type === "answer.submit" &&
          p.role === "device" &&
          p.device
        ) {
          const ack = quiz.answer(p.device, msg);
          send(ws, ack);
          schedule();
        } else if (
          msg.type === "button.test" &&
          p.role === "device" &&
          p.device
        ) {
          const b = one(
            db,
            "SELECT session_id FROM session_devices WHERE device_id=? AND active=1",
            p.device,
          );
          if (b) {
            quiz.event(b.session_id, "device.test", {
              device_id: p.device,
              choice: ["A", "B", "C", "D"].includes(msg.choice)
                ? msg.choice
                : "A",
            });
            schedule();
          }
          send(ws, { v: 1, type: "button.ack", assigned: !!b });
        } else if (msg.type === "snapshot.request") snapshot(ws, p);
        else if (msg.type === "heartbeat") {
          p.alive = Date.now();
          send(ws, { v: 1, type: "heartbeat", server_time: Date.now() });
        } else throw Error("invalid");
      } catch (e) {
        const code = (e as Row).code;
        send(ws, {
          v: 1,
          type: "error",
          code: code?.startsWith("SQLITE")
            ? "STORAGE_ERROR"
            : "INVALID_PAYLOAD",
        });
      }
    });
    ws.on("close", () => {
      peers.delete(ws);
      if (stopping) return;
      if (p.device && devices.get(p.device) === ws) {
        devices.delete(p.device);
        const b = one(
          db,
          "SELECT session_id FROM session_devices WHERE device_id=? AND active=1",
          p.device,
        );
        if (b)
          quiz.event(b.session_id, "device.disconnected", {
            device_id: p.device,
          });
        schedule();
      }
    });
    if (p.role === "device") snapshot(ws, p);
  }
  const timer = setInterval(() => {
    try {
      if (quiz.tick()) broadcast();
    } catch {
      console.error(JSON.stringify({ code: "TIMER_STORAGE_ERROR" }));
    }
  }, 100);
  timer.unref();
  const heart = setInterval(() => {
    for (const [ws, p] of peers) {
      if (!valid(p) || Date.now() - p.alive > 15000) ws.terminate();
      else ws.ping();
    }
    schedule();
  }, 5000);
  heart.unref();
  return {
    teacherSnapshot,
    schedule,
    online: (id: string) => devices.has(id),
    disconnectDevice: (id: string) => {
      devices.get(id)?.close(4001, "Credentials revoked");
    },
    revalidate: () => {
      for (const [ws, p] of peers)
        if (!valid(p)) ws.close(4001, "Access expired");
    },
    close: () => {
      stopping = true;
      clearInterval(timer);
      clearInterval(heart);
      if (scheduled) clearTimeout(scheduled);
      for (const ws of peers.keys()) ws.terminate();
      wss.close();
    },
  };
}
