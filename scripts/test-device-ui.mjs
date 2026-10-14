import assert from "node:assert/strict";
import { test } from "node:test";
import { KEYPAD, OLED_SLEEP_MS, glyph, idleCtx, joinFailure, joinUncertain, joined, newDevice, oledLines, pressKey, tick }
  from "../dist/server/shared/device-screen.js";

// Pure model of the virtual ESP32: strings and timings must match firmware/esp32-classroom main.cpp.
const press = (d, key, c = idleCtx, t = 1000) => pressKey(d, key, c, t);
const type = (d, text, c = idleCtx, t = 1000) => [...text].reduce((x, k) => press(x, k, c, t).device, d);
const live = (over = {}) => ({ ...idleCtx, joined: true, connected: true, snapshotReady: true, ...over });

test("keypad matches KEY_MAP and glyph table is complete", () => {
  assert.deepEqual(KEYPAD.map(r => r.join(" ")), ["A 3 2 1", "B 6 5 4", "C 9 8 7", "D DEL 0 ENT"]);
  assert.equal(glyph("A").length, 5);
  assert.deepEqual(glyph("0"), [0x3e, 0x51, 0x49, 0x45, 0x3e]);
});

test("entry prompts, room then student, DEL goes back", () => {
  let d = newDevice(0);
  assert.deepEqual(oledLines(d, idleCtx, 0).slice(1, 2), ["ROOM ID + ENTER"]);
  d = type(d, "1234567");
  assert.equal(press(d, "ENT").device.notice, "ROOM NEEDS 8 DIGITS");
  d = type(d, "89");
  assert.equal(d.input, "12345678", "ninth digit is refused");
  assert.equal(d.notice, "ROOM NEEDS 8 DIGITS");
  d = press(d, "ENT").device;
  assert.equal(d.entering, false);
  assert.equal(d.room, "12345678");
  assert.equal(oledLines({ ...d, notice: "" }, idleCtx, 1).at(1), "STUDENT ID + ENTER");
  d = type(d, "00123");
  assert.equal(d.input, "00123", "leading zeros are kept");
});

test("DEL on empty student returns to the room id", () => {
  let d = press(type(newDevice(0), "12345678"), "ENT").device;
  d = press(d, "DEL").device;
  assert.equal(d.entering, true);
  assert.equal(d.input, "12345678");
  assert.equal(d.room, "");
});

test("ENT on student step requests a join; failures use firmware strings", () => {
  let d = press(type(newDevice(0), "12345678"), "ENT").device;
  d = type(d, "77");
  const r = press(d, "ENT");
  assert.deepEqual(r.action, { type: "join", room: "12345678", student: "77" });
  assert.equal(r.device.pendingJoin, true);
  assert.equal(press(r.device, "5").device.input, "77", "other keys ignored while join is pending");
  assert.deepEqual(press(r.device, "ENT").action, { type: "join", room: "12345678", student: "77" });
  const cases = [["ROOM_UNAVAILABLE", "ROOM INVALID/EXPIRED"], ["STUDENT_UNAVAILABLE", "NOT ON THE LIST"],
    ["STUDENT_ACCESS_ENDED", "STUDENT NOT IN ROOM"], ["STUDENT_ALREADY_BOUND", "STUDENT IN USE"]];
  for (const [code, text] of cases) {
    const f = joinFailure(r.device, code, 2000);
    assert.equal(f.pendingJoin, false);
    assert.equal(oledLines(f, idleCtx, 2000)[1], text);
  }
  assert.equal(oledLines(joinFailure(r.device, "STUDENT_UNAVAILABLE", 2000), idleCtx, 2000)[2], "PLEASE RE-ENTER");
  assert.equal(joinFailure(r.device, "ROOM_UNAVAILABLE", 2).entering, true);
  assert.equal(joinUncertain(r.device, 3).pendingJoin, true);
});

test("first key after sleep only wakes the screen", () => {
  let d = newDevice(0);
  d = tick(d, idleCtx, OLED_SLEEP_MS.input - 1);
  assert.equal(d.sleeping, false);
  d = tick(d, idleCtx, OLED_SLEEP_MS.input);
  assert.equal(d.sleeping, true);
  assert.deepEqual(oledLines(d, idleCtx, 70000), ["", "", ""]);
  const r = press(d, "5", idleCtx, 70000);
  assert.equal(r.device.sleeping, false);
  assert.equal(r.device.input, "");
  assert.equal(press(r.device, "5", idleCtx, 70001).device.input, "5");
});

test("sleep timers per mode; exam never sleeps", () => {
  const waiting = live({ state: "LOBBY", total: 10, seconds: 15 });
  let d = joined(newDevice(0), 0);
  d = tick(d, waiting, 0);
  assert.equal(tick(d, waiting, OLED_SLEEP_MS.waiting - 1).sleeping, false);
  assert.equal(tick(d, waiting, OLED_SLEEP_MS.waiting).sleeping, true);
  const done = live({ state: "FINISHED", resultReady: true, result: { correct: 8, total: 10, score: 8 } });
  d = tick(d, done, 100);
  assert.equal(tick(d, done, 100 + OLED_SLEEP_MS.result).sleeping, true);
  const run = live({ state: "RUNNING", questionOpen: true, hasQuestion: true, questionOrder: 2, total: 10, remainingSec: 7 });
  d = tick(d, run, 200);
  assert.equal(tick(d, run, 10 * 60 * 1000).sleeping, false);
});

test("OLED text for every quiz state", () => {
  const d = { ...joined(newDevice(0), 0), notice: "" };
  const L = (c, dev = d) => oledLines(dev, c, 99999);
  assert.deepEqual(L(live({ state: "LOBBY", total: 10, seconds: 15 })), ["READY / WAITING", "10 Q / 15 sec each", ""]);
  const run = live({ state: "RUNNING", questionOpen: true, hasQuestion: true, questionOrder: 3, total: 10, remainingSec: 12 });
  assert.deepEqual(L(run), ["QUIZ IN PROGRESS", "Q 3/10  12s", ""]);
  assert.equal(L({ ...run, answerText: "SENDING: A" })[2], "SENDING: A");
  assert.equal(L({ ...run, answerText: "SAVED: B" })[2], "SAVED: B");
  assert.equal(L({ ...run, state: "PAUSED" })[0], "PAUSED");
  assert.equal(L({ ...run, questionOpen: false })[0], "QUESTION CLOSED");
  assert.deepEqual(L(live({ state: "FINISHED", resultReady: true, result: { correct: 8, total: 10, score: 8 } })),
    ["QUIZ COMPLETE", "Correct: 8/10", "Score: 8.00/10"]);
  assert.equal(L(live({ state: "FINISHED", resultReady: true, result: { correct: 0, total: 3, score: null } }))[2], "Score: --");
  assert.equal(L({ ...run, connected: false })[0], "CONNECTING...");
  assert.equal(L({ ...run, connected: false })[1], "RECONNECTING...", "joined but offline must not ask for the student ID again");
  for (const line of L(run)) assert.ok(line.length <= 21);
});

test("answering keys: choose, test while paused/lobby, closed note, result dismiss", () => {
  const d = { ...joined(newDevice(0), 0), notice: "" };
  const run = live({ state: "RUNNING", questionOpen: true, hasQuestion: true, canAnswer: true });
  assert.deepEqual(press(d, "C", run).action, { type: "choose", choice: "C" });
  assert.equal(press(d, "C", { ...run, canAnswer: false }, 5).device.answerNote, "ANSWERING CLOSED");
  assert.deepEqual(press(d, "D", { ...run, state: "PAUSED", canAnswer: false }).action, { type: "test", choice: "D" });
  assert.deepEqual(press(d, "B", live({ state: "LOBBY" })).action, { type: "test", choice: "B" });
  const done = live({ state: "FINISHED", resultReady: true, result: { correct: 1, total: 1, score: 10 } });
  assert.equal(press(d, "5", done).action, null);
  assert.deepEqual(press(d, "ENT", done).action, { type: "leave" });
});

test("notices expire after 5 s", () => {
  const d = type(newDevice(0), "1", idleCtx, 100);
  assert.equal(oledLines(d, idleCtx, 4999)[1], "ROOM ID + ENTER");
  const sp = press(type(newDevice(0), "1234"), "ENT", idleCtx, 100).device;
  assert.equal(oledLines(sp, idleCtx, 5000)[1], "ROOM NEEDS 8 DIGITS");
  assert.equal(oledLines(sp, idleCtx, 5200)[1], "ROOM ID + ENTER");
});
