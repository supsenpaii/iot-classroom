import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import ts from "typescript";
import { build } from "vite";
import { createStudyRequests } from "../client/src/pages/study-plan-requests.ts";

// Real React + Chromium, controlled HTTP promises. No database or OpenRouter calls.
// Set SMARTCLASS_TEST_CHROME if Chrome is not installed in a standard location.
const root = fileURLToPath(new URL("../", import.meta.url));
let dir, server, browser, cdp, session, origin, runFactory;
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
  dir = mkdtempSync(join(tmpdir(), "smartclass-study-browser-"));
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "junction");
  // Exercise the application's actual notice/error runner, including its default behavior.
  const source = ts.createSourceFile("main.tsx", readFileSync(join(root, "client/src/main.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "App");
  const run = app.body.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "run").getText(source);
  const runJs = ts.transpileModule(run, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  runFactory = new Function("setBusy", "setMessage", "setError", "noticeOwners", `${runJs}; return run;`);
  writeFileSync(join(dir, "index.html"), '<div id="root"></div><script type="module" src="/test.tsx"></script>');
  writeFileSync(join(dir, "test.tsx"), `
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { StudyPlan } from ${JSON.stringify(join(root, "client/src/pages/study-plan.tsx"))};
import { Context } from ${JSON.stringify(join(root, "client/src/components.tsx"))};
const state = { requests: [], copies: [], errors: [], host: null };
addEventListener("error", event => state.errors.push(event.message));
addEventListener("unhandledrejection", event => state.errors.push(String(event.reason)));
window.fetch = (url, options) => new Promise((resolve, reject) => {
  if (!String(url).match(/^\\/api\\/sessions\\/[^/]+\\/(study-guide|review-deck)$/)) {
    reject(Error("Unexpected network request: " + url)); return;
  }
  state.requests.push({ path: url, body: JSON.parse(options.body), resolve, reject });
});
Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
  writeText: text => new Promise(resolve => state.copies.push({ text, resolve })),
}});
const report = {
  N: 1, questions: [{ id: "q", status: "CLOSED", voided: false, question_order: 1, correct_rate: 0, counts: { A: 0, B: 2, C: 0, D: 0 },
    data: { question: "Question", option_a: "Right", option_b: "Wrong", option_c: "C", option_d: "D", correct_answer: "A", explanation: "", topic: "Topic" } }],
  students: ["A", "B"].map(id => ({ id, full_name: "Student " + id, score: 0, C: 0, absent: false,
    details: [{ question_id: "q", scored: true, choice: "B", correct_answer: "A" }] })),
};
function Harness() {
  const [id, setId] = useState("session-1"), [shown, setShown] = useState(true),
    [busy, setBusy] = useState(0), [message, setMessage] = useState(""), [error, setError] = useState("");
  const noticeOwners = useRef({});
  ${run}
  useLayoutEffect(() => { state.host = { setId, setShown, run }; });
  return <Context.Provider value={{ user: { ai: true }, run }}>
    <div id="notice">{error || message || (busy ? "Đang xử lý…" : "")}</div>
    <div id="error">{error}</div><div id="busy">{busy}</div>
    {shown && <StudyPlan id={id} d={report} />}
  </Context.Provider>;
}
window.studyTest = {
  state,
  select(value) { const select = document.querySelector('select[aria-label="Gợi ý cho"]'); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); },
  start(kind) { const buttons = [...document.querySelectorAll(".sp-actions button")]; const button = buttons.find(b => kind === "deck" ? b.classList.contains("primary") : !b.classList.contains("primary")); if (!button || button.disabled) throw Error("Request button is disabled: " + kind); button.click(); },
  resolve(index, label) { const r = state.requests[index]; const data = r.path.endsWith("review-deck")
    ? { id: "deck-" + label, share_token: "token-" + label, cards: 1 }
    : { explanations: [{ no: 1, explanation: "explain-" + label }], practice: [{ question: "practice-" + label, option_a: "A", option_b: "B", option_c: "C", option_d: "D", correct_answer: "A", explanation: "answer-" + label, topic: "" }] };
    r.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })); },
  reject(index, label) { state.requests[index].resolve(new Response(JSON.stringify({ message: "error-" + label }), { status: 500, headers: { "Content-Type": "application/json" } })); },
  async flush() { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); },
  session(id) { flushSync(() => state.host.setId(id)); },
  unmount() { flushSync(() => state.host.setShown(false)); },
  snapshot() { return { requests: state.requests.map(r => ({ path: r.path, body: r.body })), error: document.querySelector("#error").textContent,
    notice: document.querySelector("#notice").textContent, busy: Number(document.querySelector("#busy").textContent),
    content: document.querySelector(".study-plan")?.textContent || "", selected: document.querySelector("select")?.value,
    buttons: [...document.querySelectorAll(".sp-actions button")].map(b => ({ text: b.textContent, disabled: b.disabled })), errors: state.errors }; },
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
  browser = spawn(chrome, ["--headless", "--disable-gpu", ...(process.env.SMARTCLASS_TEST_CHROME_ARGS?.split(" ").filter(Boolean) ?? []), "--remote-debugging-port=0", `--user-data-dir=${join(dir, "profile")}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
  // These assertions read Vietnamese text; headless Chrome reports en-US, which the app would follow.
  await request("Page.addScriptToEvaluateOnNewDocument", { source: 'localStorage.setItem("classroom-lang", "vi")' }, session);
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

async function fixture() {
  await request("Page.navigate", { url: `${origin}/?fixture=${randomId++}` }, session);
  await wait(() => evaluate("!!window.studyTest?.state.host"));
  await evaluate('studyTest.select("A"); studyTest.flush()');
  return {
    async act(code) { await evaluate(`(async () => { ${code}; await studyTest.flush(); })()`); },
    snapshot: () => evaluate("studyTest.snapshot()"),
  };
}
let randomId = 0;

for (const kind of ["ai", "deck"]) {
  test(`${kind}: the current student's response is shown with the unchanged API payload`, async () => {
    const f = await fixture();
    await f.act(`studyTest.start("${kind}")`);
    assert.deepEqual((await f.snapshot()).requests, [{ path: `/api/sessions/session-1/${kind === "ai" ? "study-guide" : "review-deck"}`, body: { student_id: "A" } }]);
    await f.act('studyTest.resolve(0, "A-current")');
    const s = await f.snapshot();
    assert.match(s.content, kind === "ai" ? /practice-A-current/ : /token-A-current/);
    assert.equal(s.busy, 0); assert.equal(s.error, ""); assert.deepEqual(s.errors, []);
  });

  test(`${kind}: selecting B invalidates A's late response`, async () => {
    const f = await fixture();
    await f.act(`studyTest.start("${kind}"); studyTest.select("B")`);
    await f.act('studyTest.resolve(0, "A-stale")');
    const s = await f.snapshot();
    assert.equal(s.selected, "B");
    assert.doesNotMatch(s.content, /A-stale/);
    assert.equal(s.notice, ""); assert.equal(s.busy, 0); assert.deepEqual(s.errors, []);
  });

  test(`${kind}: selecting B suppresses A's late error`, async () => {
    const f = await fixture();
    await f.act(`studyTest.start("${kind}"); studyTest.select("B")`);
    await f.act('studyTest.reject(0, "A-stale")');
    const s = await f.snapshot();
    assert.equal(s.error, ""); assert.equal(s.notice, ""); assert.equal(s.busy, 0);
  });

  test(`${kind}: A → B → A does not revive A's first response`, async () => {
    const f = await fixture();
    await f.act(`studyTest.start("${kind}")`);
    await f.act('studyTest.select("B")'); await f.act('studyTest.select("A")');
    await f.act('studyTest.resolve(0, "A-first-selection")');
    assert.doesNotMatch((await f.snapshot()).content, /A-first-selection/);
  });

  test(`${kind}: unmount suppresses response/error and releases loading immediately`, async () => {
    const f = await fixture();
    await f.act(`studyTest.start("${kind}"); studyTest.unmount()`);
    assert.equal((await f.snapshot()).busy, 0);
    await f.act('studyTest.reject(0, "unmounted")');
    const s = await f.snapshot();
    assert.equal(s.error, ""); assert.equal(s.notice, ""); assert.equal(s.content, ""); assert.deepEqual(s.errors, []);
  });

  test(`${kind}: changing session invalidates the old response and resets the selection`, async () => {
    const f = await fixture();
    await f.act(`studyTest.start("${kind}"); studyTest.session("session-2")`);
    await f.act('studyTest.resolve(0, "old-session")');
    const s = await f.snapshot();
    assert.equal(s.selected, "class"); assert.doesNotMatch(s.content, /old-session/);
    assert.equal(s.notice, ""); assert.equal(s.busy, 0);
  });
}

test("loading and results of AI and Review Deck are independent", async () => {
  const f = await fixture();
  await f.act('studyTest.start("ai")');
  assert.equal((await f.snapshot()).buttons[0].disabled, false, "AI must not block Review Deck");
  await f.act('studyTest.start("deck")');
  await f.act('studyTest.resolve(1, "A-deck")');
  let s = await f.snapshot();
  assert.match(s.content, /token-A-deck/); assert.match(s.buttons[1].text, /AI đang viết/); assert.equal(s.busy, 1);
  await f.act('studyTest.resolve(0, "A-guide")');
  s = await f.snapshot();
  assert.match(s.content, /token-A-deck/); assert.match(s.content, /practice-A-guide/); assert.equal(s.busy, 0);
});

test("A's stale error cannot overwrite B's current error", async () => {
  const f = await fixture();
  await f.act('studyTest.start("ai"); studyTest.select("B")');
  assert.equal((await f.snapshot()).buttons[1].disabled, false);
  await f.act('studyTest.start("ai"); studyTest.reject(1, "B-current")');
  assert.equal((await f.snapshot()).error, "error-B-current");
  await f.act('studyTest.reject(0, "A-stale")');
  assert.equal((await f.snapshot()).error, "error-B-current");
});

test("a stale completion cannot clear B's current loading or overwrite B's result", async () => {
  const f = await fixture();
  await f.act('studyTest.start("deck"); studyTest.select("B")');
  assert.equal((await f.snapshot()).buttons[0].disabled, false);
  await f.act('studyTest.start("deck"); studyTest.resolve(0, "A-old")');
  const pending = await f.snapshot();
  assert.match(pending.buttons[0].text, /Đang tạo/); assert.equal(pending.busy, 1);
  assert.doesNotMatch(pending.content, /A-old/);
  await f.act('studyTest.resolve(1, "B-current")');
  assert.match((await f.snapshot()).content, /token-B-current/);
});

for (const kind of ["ai", "deck"]) {
  test(`${kind}: an error already shown for A is cleared when B is selected`, async () => {
    const f = await fixture();
    await f.act(`studyTest.start("${kind}"); studyTest.reject(0, "A-current")`);
    assert.equal((await f.snapshot()).error, "error-A-current");
    await f.act('studyTest.select("B")');
    assert.equal((await f.snapshot()).error, "");
  });

  test(`${kind}: a successful response after unmount cannot show a notice`, async () => {
    const f = await fixture();
    await f.act(`studyTest.start("${kind}"); studyTest.unmount(); studyTest.resolve(0, "unmounted")`);
    const s = await f.snapshot();
    assert.equal(s.content, ""); assert.equal(s.notice, ""); assert.equal(s.busy, 0); assert.deepEqual(s.errors, []);
  });
}

test("the class Review Deck still sends student_id:null and shows its share link", async () => {
  const f = await fixture();
  await f.act('studyTest.select("class"); studyTest.start("deck")');
  assert.deepEqual((await f.snapshot()).requests[0].body, { student_id: null });
  await f.act('studyTest.resolve(0, "class-current")');
  assert.match((await f.snapshot()).content, /token-class-current/);
});

test("a clipboard completion for A cannot mark B's new link as copied", async () => {
  const f = await fixture();
  await f.act('studyTest.start("deck"); studyTest.resolve(0, "A-copy")');
  await f.act('document.querySelector(".sp-deck button").click()');
  assert.equal(await evaluate("studyTest.state.copies.length"), 1);
  await f.act('studyTest.select("B"); studyTest.start("deck"); studyTest.resolve(1, "B-copy")');
  await f.act('studyTest.state.copies[0].resolve()');
  const s = await f.snapshot();
  assert.match(s.content, /token-B-copy/); assert.doesNotMatch(s.content, /Đã chép/); assert.equal(s.busy, 0);
});

test("clipboard fallback still copies the current share link when navigator.clipboard is absent", async () => {
  const f = await fixture();
  await f.act('studyTest.start("deck"); studyTest.resolve(0, "LAN-copy")');
  await f.act(`Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = command => { studyTest.state.copiedText = document.querySelector("textarea").value; return command === "copy"; };
    document.querySelector(".sp-deck button").click()`);
  assert.equal(await evaluate("studyTest.state.copiedText"), `${origin}/study/token-LAN-copy`);
  assert.equal(await evaluate('document.querySelector("textarea") === null'), true);
  assert.match((await f.snapshot()).content, /Đã chép/);
});

function runner() {
  const state = { busy: 0, message: "", error: "" };
  const setter = key => value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const run = runFactory(setter("busy"), setter("message"), setter("error"), { current: {} });
  return { run, state };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const kind of ["ai", "deck"]) {
  for (const outcome of ["response", "error"]) {
    test(`${kind}: two requests for the same student keep the newest ${outcome}, generation and loading`, async () => {
      const requests = createStudyRequests("session-1", "A"); requests.mount();
      const r = runner(), first = deferred(), second = deferred();
      let value = null;
      const older = requests.begin(kind);
      const p1 = r.run(async () => { const result = await first.promise; if (older.isCurrent()) value = result; }, "first", older);
      const newer = requests.begin(kind);
      const p2 = r.run(async () => { const result = await second.promise; if (newer.isCurrent()) value = result; }, "second", newer);
      assert.equal(newer.studentId, "A"); assert.equal(newer.sessionId, "session-1");
      assert.ok(newer.generation > older.generation);
      await p1;
      assert.equal(r.state.busy, 1); assert.equal(older.isCurrent(), false); assert.equal(newer.isCurrent(), true);
      if (outcome === "response") second.resolve("newest");
      else second.reject(Error("newest-error"));
      await p2;
      const before = { ...r.state };
      if (outcome === "response") first.resolve("stale");
      else first.reject(Error("stale-error"));
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(r.state, before);
      assert.equal(value, outcome === "response" ? "newest" : null);
      assert.equal(r.state.error, outcome === "error" ? "newest-error" : "");
      assert.equal(r.state.busy, 0);
      requests.unmount();
    });
  }
}

test("replacing an AI request preserves the current Deck and copy requests", async () => {
  const requests = createStudyRequests("session-1", "A"); requests.mount();
  const ai = requests.begin("ai"), deck = requests.begin("deck"), copy = requests.begin("copy");
  const next = requests.begin("ai");
  await ai.cancelled;
  assert.equal(ai.isCurrent(), false); assert.equal(next.isCurrent(), true);
  assert.equal(deck.isCurrent(), true); assert.equal(copy.isCurrent(), true);
  ai.cancel();
  assert.equal(next.isCurrent(), true, "Old cleanup must not cancel its replacement");
  requests.unmount();
});

test("mount cleanup/remount cannot revive an old request", async () => {
  const requests = createStudyRequests("session-1", "A"); requests.mount();
  const old = requests.begin("ai");
  requests.unmount(); await old.cancelled; requests.mount();
  assert.equal(old.isCurrent(), false);
  const current = requests.begin("ai");
  assert.equal(current.isCurrent(), true); assert.ok(current.generation > old.generation);
  requests.unmount();
});

test("unscoped actions retain success/error handling and exact loading counts", async () => {
  const r = runner(), a = deferred(), b = deferred();
  const p1 = r.run(() => a.promise, "saved"), p2 = r.run(() => b.promise);
  assert.equal(r.state.busy, 2);
  a.resolve(); await p1;
  assert.equal(r.state.message, "saved"); assert.equal(r.state.busy, 1);
  b.reject(Error("normal-error")); await p2;
  assert.equal(r.state.error, "normal-error"); assert.equal(r.state.busy, 0);
  await r.run(async () => {}, "next");
  assert.equal(r.state.error, ""); assert.equal(r.state.message, "next"); assert.equal(r.state.busy, 0);
});

test("an invalidated scope neither invokes its action nor clears another action's notice", async () => {
  const requests = createStudyRequests("session-1", "A"); requests.mount();
  const old = requests.begin("ai"); requests.select("session-1", "B");
  const r = runner(); await r.run(async () => {}, "other-action");
  let called = false;
  await r.run(async () => { called = true; }, "stale-action", old);
  assert.equal(called, false); assert.equal(r.state.message, "other-action"); assert.equal(r.state.busy, 0);
  requests.unmount();
});
