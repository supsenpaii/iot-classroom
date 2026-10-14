import assert from "node:assert/strict";
import { test } from "node:test";
import { createStudyGuide } from "../dist/server/server/study-guide.js";

// Fake global fetch: Gemini first, OpenRouter as fallback. No network, no real keys.
const GEMINI_KEY = "AIza-test-secret-key", OR_KEY = "sk-or-test-secret";
const input = { missed: [{ no: 1, topic: "Cộng", question: "1 + 1 bằng mấy?",
  options: { A: "2", B: "3", C: "4", D: "5" }, chosen: "B", chosen_text: "3", correct: "A", correct_text: "2", teacher_note: "" }] };
const guide = { explanations: [{ no: 1, correct: "A", explanation: "Cộng hai số được 2. Mẹo: đếm trên ngón tay." }],
  practice: [{ topic: "Cộng", question: "2 + 2 bằng mấy?", option_a: "3", option_b: "4", option_c: "5", option_d: "6", correct_answer: "B", explanation: "2 + 2 = 4." }] };
const geminiOk = text => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }], modelVersion: "gemini-test" } });
const openRouterOk = { status: 200, body: { model: "or-model", choices: [{ message: { content: JSON.stringify(guide) } }] } };
const providers = { geminiApiKey: GEMINI_KEY, geminiModel: "gemini-test", openRouterApiKeys: [OR_KEY] };

function fakeFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const kind = String(url).includes("generativelanguage") ? "gemini" : "openrouter";
    calls.push({ kind, url: String(url), headers: init.headers, body: init.body });
    const queue = handlers[kind], next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return calls;
}
const realLog = console.log;
test.beforeEach(() => { console.log = () => {}; });
test.afterEach(() => { console.log = realLog; });

test("Gemini ok: key in header, JSON schema enforced, no student identity sent", async () => {
  const calls = fakeFetch({ gemini: [geminiOk(JSON.stringify(guide))], openrouter: [] });
  const out = await createStudyGuide(input, providers);
  assert.equal(out.explanations[0].no, 1);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes(GEMINI_KEY), "key must not be in the URL");
  assert.match(calls[0].url, /models\/gemini-test:generateContent$/);
  assert.equal(calls[0].headers["x-goog-api-key"], GEMINI_KEY);
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.generationConfig.responseMimeType, "application/json");
  assert.ok(sent.generationConfig.responseSchema.properties.explanations);
  assert.ok(!/Học sinh|student_code|full_name/.test(calls[0].body));
});

test("Gemini bad JSON is retried once, then succeeds", async () => {
  const calls = fakeFetch({ gemini: [geminiOk("not json"), geminiOk(JSON.stringify(guide))], openrouter: [] });
  await createStudyGuide(input, providers);
  assert.deepEqual(calls.map(c => c.kind), ["gemini", "gemini"]);
});

test("Gemini 5xx falls back to OpenRouter", async () => {
  const calls = fakeFetch({ gemini: [{ status: 503, body: { error: { message: "overloaded" } } }], openrouter: [openRouterOk] });
  const out = await createStudyGuide(input, providers);
  assert.equal(out.practice.length, 1);
  assert.deepEqual(calls.map(c => c.kind), ["gemini", "gemini", "openrouter"], "503 is retried once first");
});

test("Gemini 500 falls back immediately", async () => {
  const calls = fakeFetch({ gemini: [{ status: 500, body: { error: { message: "boom" } } }], openrouter: [openRouterOk] });
  await createStudyGuide(input, providers);
  assert.deepEqual(calls.map(c => c.kind), ["gemini", "openrouter"]);
});

test("Gemini network error falls back to OpenRouter", async () => {
  const calls = fakeFetch({ gemini: [new TypeError("fetch failed")], openrouter: [openRouterOk] });
  await createStudyGuide(input, providers);
  assert.deepEqual(calls.map(c => c.kind), ["gemini", "openrouter"]);
});

test("Gemini 429 stops: OpenRouter is not called and the key never leaks", async () => {
  const calls = fakeFetch({ gemini: [{ status: 429, body: { error: { message: `quota for key ${GEMINI_KEY}` } } }], openrouter: [openRouterOk] });
  await assert.rejects(createStudyGuide(input, providers), e => {
    assert.equal(e.code, "GEMINI_RATE_LIMIT");
    assert.equal(e.status, 429);
    assert.ok(!e.message.includes(GEMINI_KEY));
    return true;
  });
  assert.deepEqual(calls.map(c => c.kind), ["gemini"]);
});

test("OpenRouter-only and Gemini-only configurations", async () => {
  let calls = fakeFetch({ gemini: [], openrouter: [openRouterOk] });
  await createStudyGuide(input, { openRouterApiKeys: [OR_KEY] });
  assert.deepEqual(calls.map(c => c.kind), ["openrouter"]);
  calls = fakeFetch({ gemini: [{ status: 500, body: { error: { message: "boom" } } }], openrouter: [] });
  await assert.rejects(createStudyGuide(input, { geminiApiKey: GEMINI_KEY }), e => e.code === "GEMINI_REQUEST_FAILED");
});

test("no key configured", async () => {
  const calls = fakeFetch({ gemini: [], openrouter: [] });
  await assert.rejects(createStudyGuide(input, {}), e => e.code === "AI_NOT_CONFIGURED" && e.status === 503);
  assert.equal(calls.length, 0);
});

test("explanation that contradicts the data is rejected, then falls back", async () => {
  const wrong = { ...guide, explanations: [{ no: 1, correct: "A", explanation: "Đáp án đúng là C vì..." }] };
  const calls = fakeFetch({ gemini: [geminiOk(JSON.stringify(wrong))], openrouter: [openRouterOk] });
  await createStudyGuide(input, providers);
  assert.deepEqual(calls.map(c => c.kind), ["gemini", "gemini", "openrouter"]);
});

test("comma-separated Gemini models are tried in order before OpenRouter", async () => {
  const calls = fakeFetch({ gemini: [{ status: 500, body: { error: { message: "x" } } }, geminiOk(JSON.stringify(guide))], openrouter: [] });
  await createStudyGuide(input, { geminiApiKey: GEMINI_KEY, geminiModel: "model-a, model-b" });
  assert.deepEqual(calls.map(c => c.url.match(/models\/([^:]+):/)[1]), ["model-a", "model-b"]);
});
