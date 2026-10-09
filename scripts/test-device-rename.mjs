import WebSocket from "ws";
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
  geminiApiKey: "",
  geminiModel: "",
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

const sockets = [];
try {
  const teacher = await request("/api/auth/register", { method: "POST", body: {email:"rename@example.test", password:"ExamplePassword2026!"} });
  const create = async label => (await request("/api/devices", {method:"POST", body:{label}, cookie:teacher.cookie, csrf:teacher.data.csrf})).data;
  const a = await create("Board A"), b = await create("12345");
  db.prepare("INSERT INTO classes VALUES (?,?,?,0)").run("rename-class", teacher.data.id, "Rename test");
  for (const code of ["001234", "12345"])
    db.prepare("INSERT INTO students VALUES (?,?,?,?)").run(code, "rename-class", code, code);
  const ws = new WebSocket(config.origin.replace("http", "ws") + "/ws", {headers:{Authorization:`Bearer ${a.secret}`, "X-Device-Id":a.id}});
  sockets.push(ws);
  await new Promise((resolve,reject) => {ws.once("open",resolve);ws.once("error",reject);});
  let seq = 0;
  async function rename(label, extra = {}) {
    const request_id = `rename-${++seq}`;
    const response = new Promise((resolve,reject) => {
      const timer=setTimeout(()=>{ws.off("message",listen);reject(Error("ACK timeout"));},3000);
      function listen(raw) {const msg=JSON.parse(raw);if(msg.request_id===request_id){clearTimeout(timer);ws.off("message",listen);resolve(msg);}}
      ws.on("message",listen);
    });
    ws.send(JSON.stringify({v:1,type:"device.rename",request_id,label,...extra}));
    return response;
  }
  const before=db.prepare("SELECT secret_hash FROM devices WHERE id=?").get(a.id);
  assert.equal((await rename("001234", {device_id:b.id})).accepted,true);
  assert.equal(db.prepare("SELECT label FROM devices WHERE id=?").get(a.id).label,"001234");
  assert.equal(db.prepare("SELECT label FROM devices WHERE id=?").get(b.id).label,"12345");
  assert.deepEqual(db.prepare("SELECT secret_hash FROM devices WHERE id=?").get(a.id),before);
  assert.equal((await rename("001234")).accepted,true);
  assert.equal((await rename("99999")).code,"STUDENT_UNAVAILABLE");
  assert.equal((await rename("1234")).code,"STUDENT_UNAVAILABLE");
  assert.equal(db.prepare("SELECT label FROM devices WHERE id=?").get(a.id).label,"001234");
  assert.equal((await rename("12345")).code,"DUPLICATE_LABEL");
  for (const invalid of ["", "ABC", "12345678901", 123]) assert.equal((await rename(invalid)).code,"INVALID_LABEL");
  const list=await request("/api/devices",{cookie:teacher.cookie});
  assert.equal(list.data.find(d=>d.id===a.id).label,"001234");
  console.log("Device rename: ACK, persistence, own-device scope, unchanged secret, duplicate and invalid labels passed.");
} finally {
  for(const ws of sockets) ws.terminate();
  await app.close();
  db.close();
}
