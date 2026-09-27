import { openDb, acquireAppLock } from "./db.js";
import { createApplication } from "./app.js";
import { chmodSync } from "node:fs";
const path = process.env.DATABASE_PATH || "./data/app.sqlite";
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32)
  throw Error("SESSION_SECRET phải có ít nhất 32 ký tự. Xem .env.example.");
const production = process.env.NODE_ENV === "production";
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:5173";
if (production && !origin.startsWith("https://"))
  throw Error("Production yêu cầu HTTPS");
if (production && process.env.ENABLE_SIMULATOR === "true")
  throw Error("Không bật simulator trên production");
// ponytail: one process per local database; scale only after measured need.
const release = acquireAppLock(path),
  db = openDb(path);
chmodSync(path, 0o600);
const application = createApplication(db, {
  origin,
  secret,
  production,
  simulator: process.env.ENABLE_SIMULATOR === "true",
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  maxUpload: Number(process.env.MAX_UPLOAD_BYTES || 5242880),
});
application.server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `Lớp học: http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3000}`,
    ),
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await application.close();
    db.close();
    release();
    process.exit(0);
  });
