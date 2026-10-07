import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openDb } from "../dist/server/server/db.js";
import { createApplication } from "../dist/server/server/app.js";

const db = openDb(":memory:");
const config = {
  origin: "",
  secret: randomBytes(48).toString("hex"),
  production: false,
  simulator: false,
  trustProxy: 0,
  maxUpload: 5242880,
  openRouterApiKeys: [],
};
const app = createApplication(db, config);
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
config.origin = `http://127.0.0.1:${app.server.address().port}`;

async function request(path, { method = "GET", body, cookie, csrf, origin = config.origin } = {}) {
  const headers = { Origin: origin };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  const response = await fetch(config.origin + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

try {
  const password = "ExamplePassword2026!";
  assert.equal((await request("/api/auth/register", { method: "POST", origin: "https://invalid.test", body: { email: "x@example.test", password } })).status, 403);
  assert.equal((await request("/api/auth/register", { method: "POST", body: { email: "x@example.test", password: "short" } })).status, 422);

  const first = await request("/api/auth/register", { method: "POST", body: { email: " TeacherA@Example.Test ", password } });
  assert.equal(first.status, 201);
  assert.equal(first.data.email, "teachera@example.test");
  assert.ok(first.cookie && first.data.csrf);
  assert.equal((await request("/api/auth/me", { cookie: first.cookie })).data.email, first.data.email);

  const duplicate = await request("/api/auth/register", { method: "POST", body: { email: "teachera@example.test", password } });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.code, "EMAIL_EXISTS");

  const second = await request("/api/auth/register", { method: "POST", body: { email: "teacherb@example.test", password } });
  assert.equal(second.status, 201);
  const ownClass = await request("/api/classes", { method: "POST", body: { name: "Lớp riêng A" }, cookie: first.cookie, csrf: first.data.csrf });
  assert.equal(ownClass.status, 201);
  assert.equal((await request("/api/classes", { cookie: second.cookie })).data.length, 0);
  assert.equal((await request(`/api/classes/${ownClass.data.id}`, { cookie: second.cookie })).status, 404);

  assert.equal((await request("/api/auth/login", { method: "POST", body: { email: first.data.email, password: "wrong" } })).status, 401);
  assert.equal((await request("/api/auth/login", { method: "POST", body: { email: first.data.email, password } })).status, 200);
  assert.equal((await request("/api/auth/register", { method: "POST", body: { email: "third@example.test", password: "short" } })).status, 422);
  assert.equal((await request("/api/auth/register", { method: "POST", body: { email: "third@example.test", password: "short" } })).status, 429);
  console.log("Đăng ký, đăng nhập, quyền sở hữu và giới hạn lượt thử: đạt.");
} finally {
  await app.close();
  db.close();
}
