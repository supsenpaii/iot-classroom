import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openDb } from "../dist/server/server/db.js";
import { createApplication } from "../dist/server/server/app.js";

// A forwarded request without TRUST_PROXY must produce one clear warning, then stay quiet.
const db = openDb(":memory:");
const warnings = [];
const realWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(" "));
const app = createApplication(db, { origin: "", secret: randomBytes(48).toString("hex"), production: false,
  simulator: false, trustProxy: 0, maxUpload: 5242880, openRouterApiKeys: [] });
await new Promise(r => app.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.server.address().port}`;
try {
  await fetch(base + "/health/live");
  assert.equal(warnings.length, 0, "no header, no warning");
  await fetch(base + "/health/live", { headers: { "X-Forwarded-For": "203.0.113.9" } });
  await fetch(base + "/health/live", { headers: { "X-Forwarded-For": "203.0.113.10" } });
  assert.equal(warnings.length, 1, "exactly one warning");
  assert.match(warnings[0], /TRUST_PROXY=1/);
  console.log("PASS: forwarded header without TRUST_PROXY warns once");
} finally { console.warn = realWarn; await app.close(); db.close(); }
