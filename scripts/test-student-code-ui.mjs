import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { build } from "vite";

// Real React + Chromium, controlled HTTP promises. No database or external API calls.
// Set SMARTCLASS_TEST_CHROME if Chrome is not installed in a standard location.
const root = fileURLToPath(new URL("../", import.meta.url));
let dir, server, browser, cdp, session, origin;
const commands = new Map();
let sequence = 0;
const request = (method, params = {}, target) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { commands.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10000);
  commands.set(id, { resolve, reject, timer });
  cdp.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
});
async function evaluate(expression) {
  const result = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function wait(fn) {
  const end = Date.now() + 5000;
  while (!await fn()) {
    if (Date.now() >= end) throw Error("Browser fixture timeout");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function chromePath() {
  const candidates = [process.env.SMARTCLASS_TEST_CHROME, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe")];
  const cache = join(homedir(), ".cache/ms-playwright");
  if (existsSync(cache)) for (const name of readdirSync(cache).filter(n => n.startsWith("chromium")).sort().reverse())
    for (const executable of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux64/chrome", "chrome-win/chrome.exe"])
      candidates.push(join(cache, name, executable));
  const path = candidates.find(p => p && existsSync(p));
  if (!path) throw Error("Install Chrome/Chromium or set SMARTCLASS_TEST_CHROME; no npm dependency is required.");
  return path;
}

before(async () => {
  const chrome = chromePath();
  dir = mkdtempSync(join(tmpdir(), "smartclass-mssv-browser-"));
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "junction");
  writeFileSync(join(dir, "index.html"), '<div id="root"></div><script type="module" src="/test.tsx"></script>');
  writeFileSync(join(dir, "test.tsx"), `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { StudentPage } from ${JSON.stringify(join(root, "client/src/pages/student.tsx"))};
import { Classes, Importer } from ${JSON.stringify(join(root, "client/src/pages/manage.tsx"))};
import { Context } from ${JSON.stringify(join(root, "client/src/components.tsx"))};
const state = { writes: [], errors: [] };
addEventListener("error", e => state.errors.push(e.message));
addEventListener("unhandledrejection", e => state.errors.push(String(e.reason)));
window.fetch = async (url, options = {}) => {
  const method = options.method || "GET";
  if (method !== "GET") state.writes.push({ path: String(url), method, body: typeof options.body === "string" ? JSON.parse(options.body) : null });
  let data, status = 200;
  if (url === "/api/student/session") data = { csrf: "fixture-csrf", student: null, pending: null };
  else if (url === "/api/student/join") { data = { code: "ROOM_UNAVAILABLE", message: "Fixture room unavailable" }; status = 400; }
  else if (url === "/api/classes/c") data = { id: "c", name: "Fixture", students: [], sessions: [] };
  else if (url === "/api/devices") data = [];
  else if (url === "/api/imports/students/preview") data = { rows: [{ student_code: "001", full_name: "Test Student" }], errors: [], warnings: [] };
  else if (url === "/api/classes/c/students/import") data = { count: 1 };
  else throw Error("Unexpected request: " + url);
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
};
function Harness() {
  const [error, setError] = useState("");
  async function run(fn) { setError(""); try { await fn(); } catch (e) { setError(e.message); } }
  const mode = new URLSearchParams(location.search).get("mode");
  return <Context.Provider value={{ user: {}, run }}><div id="error">{error}</div>{mode === "manage" ? <Classes id="c" /> : mode === "import" ? <Importer kind="students" onCommit={rows => fetch("/api/classes/c/students/import", { method: "POST", body: JSON.stringify({ rows }) })} /> : <StudentPage />}</Context.Provider>;
}
window.mssvTest = {
  state,
  async flush() { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); },
  upload() { const input = document.querySelector('input[type="file"]'); const transfer = new DataTransfer(); transfer.items.add(new File(["student_code,full_name\\n001,Test Student"], "students.csv", { type: "text/csv" })); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true })); },
  snapshot() { return { writes: state.writes, errors: state.errors, text: document.body.textContent,
    value: document.querySelector('input[name="student_code"]')?.value,
    previewValue: document.querySelector('input[aria-label="Dòng 2 student_code"]')?.value,
    commitDisabled: document.querySelector(".importer .actions .primary")?.disabled }; },
};
createRoot(document.querySelector("#root")).render(<Harness />);
`);
  await build({ configFile: false, root: dir, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  server = createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const path = pathname.startsWith("/assets/") ? resolve(dir, "dist", "." + pathname) : join(dir, "dist/index.html");
    const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" };
    try { res.setHeader("Content-Type", types[extname(path)] || "application/octet-stream"); res.end(readFileSync(path)); }
    catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(chrome, ["--headless", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${join(dir, "profile")}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("Chrome debugger startup timeout: " + output.slice(-1000))), 10000);
    browser.on("error", e => { clearTimeout(timer); reject(e); });
    browser.on("exit", code => { clearTimeout(timer); reject(Error(`Chrome exited: ${code}: ${output.slice(-1000)}`)); });
    browser.stderr.on("data", data => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  cdp = new WebSocket(endpoint);
  cdp.on("message", data => {
    const message = JSON.parse(data), pending = commands.get(message.id);
    if (!pending) return;
    commands.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(Error(JSON.stringify(message.error)));
    else pending.resolve(message.result);
  });
  await new Promise((resolve, reject) => { cdp.once("open", resolve); cdp.once("error", reject); });
  const { targetId } = await request("Target.createTarget", { url: "about:blank" });
  ({ sessionId: session } = await request("Target.attachToTarget", { targetId, flatten: true }));
  await request("Page.enable", {}, session);
  await request("Runtime.enable", {}, session);
});

after(async () => {
  cdp?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolve => browser.once("exit", resolve));
    browser.kill(); await exited;
  }
  if (server) await new Promise(resolve => server.close(resolve));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

let fixtureId = 0;
async function fixture(mode = "student") {
  await request("Page.navigate", { url: `${origin}/?mode=${mode}&fixture=${fixtureId++}` }, session);
  const selector = mode === "import" ? 'input[type="file"]' : 'input[name="student_code"]';
  await wait(() => evaluate(`!!window.mssvTest && !!document.querySelector(${JSON.stringify(selector)})`));
  if (mode === "student") await wait(() => evaluate('!document.querySelector(".student-entry button.primary").disabled'));
  return {
    async act(code) { await evaluate(`(async () => { ${code}; await mssvTest.flush(); })()`); },
    async type(selector, value) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await request("Input.insertText", { text: value }, session);
      await evaluate("mssvTest.flush()");
    },
    snapshot: () => evaluate("mssvTest.snapshot()"),
  };
}
for (const code of ["HS001", "DEMO01", "SV-001", "123ABC", "12 34", "12345678901"]) {
  test(`Student Web preserves invalid input ${code}, shows a code error and never joins`, async () => {
    const f = await fixture();
    await f.type('input[name="room_code"]', "12345678");
    await f.type('input[name="student_code"]', code);
    assert.equal((await f.snapshot()).value, code, "Input must never silently remove or truncate characters");
    await f.act('document.querySelector(".student-entry form").requestSubmit()');
    const s = await f.snapshot();
    assert.match(s.text, /MSSV.*1.*10.*chữ số/);
    assert.equal(s.writes.length, 0); assert.deepEqual(s.errors, []);
  });
}
for (const code of ["001", "1", " 001 ", " 2313401234 "]) {
  test(`Student Web submits trimmed string ${JSON.stringify(code)} without losing digits`, async () => {
    const f = await fixture();
    await f.type('input[name="room_code"]', "12345678");
    await f.type('input[name="student_code"]', code);
    assert.equal((await f.snapshot()).value, code);
    await f.act('document.querySelector(".student-entry form").requestSubmit()');
    const s = await f.snapshot();
    assert.equal(s.writes.length, 1); assert.equal(s.writes[0].body.student_code, code.trim());
    assert.equal(typeof s.writes[0].body.student_code, "string"); assert.deepEqual(s.errors, []);
  });
}
for (const code of ["HS001", "12345678901", "12 34"]) {
  test(`management rejects ${code} before the create API and preserves typed content`, async () => {
    const f = await fixture("manage");
    await f.type('input[name="student_code"]', code);
    await f.type('.class-student-form input[name="full_name"]', "Test Student");
    await f.act('document.querySelector(".class-student-form").requestSubmit()');
    const s = await f.snapshot();
    assert.equal(s.value, code); assert.equal(s.writes.length, 0);
    assert.match(s.text, /MSSV.*1.*10.*chữ số/); assert.deepEqual(s.errors, []);
  });
}
test("management sends a trimmed zero-prefixed string", async () => {
  const f = await fixture("manage");
  await f.type('input[name="student_code"]', " 001 ");
  await f.type('.class-student-form input[name="full_name"]', "Test Student");
  await f.act('document.querySelector(".class-student-form").requestSubmit()');
  const s = await f.snapshot();
  assert.equal(s.writes.length, 1); assert.equal(s.writes[0].body.rows[0].student_code, "001");
});
for (const code of ["HS001", "12345678901", "12 34"]) {
  test(`editing an import preview to ${code} disables commit and shows an error`, async () => {
    const f = await fixture("import"); await f.act('mssvTest.upload()');
    await wait(() => evaluate('!!document.querySelector(".preview-table")'));
    await f.act('const input = document.querySelector(\'input[aria-label="Dòng 2 student_code"]\'); input.focus(); input.select()');
    await request("Input.insertText", { text: code }, session); await evaluate("mssvTest.flush()");
    const s = await f.snapshot();
    assert.equal(s.previewValue, code); assert.equal(s.commitDisabled, true);
    assert.match(s.text, /MSSV.*1.*10.*chữ số/); assert.deepEqual(s.errors, []);
  });
}
test("editing an import preview to a padded valid code commits its trimmed string", async () => {
  const f = await fixture("import"); await f.act('mssvTest.upload()');
  await wait(() => evaluate('!!document.querySelector(".preview-table")'));
  await f.act('const input = document.querySelector(\'input[aria-label="Dòng 2 student_code"]\'); input.focus(); input.select()');
  await request("Input.insertText", { text: " 000123 " }, session); await evaluate("mssvTest.flush()");
  assert.equal((await f.snapshot()).commitDisabled, false);
  await f.act('document.querySelector(".importer .actions .primary").click()');
  const s = await f.snapshot(), committed = s.writes.find(r => r.path.endsWith("/students/import"));
  assert.equal(committed.body.rows[0].student_code, "000123"); assert.deepEqual(s.errors, []);
});
