// Pure model of the ESP32 clicker (firmware/esp32-classroom/src/main.cpp) used by the /device page.
// Strings and timings mirror drawOledStatus(), handleKey(), joinRoom() and include/oled_power.h;
// keep them in sync with the firmware. No React, no DOM, so scripts/test-device-ui.mjs can import it.

export type Key = "A" | "B" | "C" | "D" | "DEL" | "ENT" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
// Physical layout (KEY_MAP in main.cpp, as seen on the keypad).
export const KEYPAD: Key[][] = [
  ["A", "3", "2", "1"],
  ["B", "6", "5", "4"],
  ["C", "9", "8", "7"],
  ["D", "DEL", "0", "ENT"],
];
export const ROOM_DIGITS = 8, MAX_STUDENT_DIGITS = 10;
export const OLED_SLEEP_MS = { input: 60000, waiting: 20000, result: 30000 };
export const NOTICE_MS = 5000, ANSWER_NOTE_MS = 3000;
export const OLED_COLUMNS = 21;

export type Mode = "IDLE" | "WAITING" | "EXAM" | "FINISHED";
// What the quiz connection currently looks like (derived from useStudentQuiz in the page).
export type Ctx = {
  joined: boolean; connected: boolean; snapshotReady: boolean;
  state: string; questionOpen: boolean; hasQuestion: boolean;
  questionOrder: number; total: number; seconds: number; remainingSec: number;
  canAnswer: boolean; resultReady: boolean;
  result: { correct: number; total: number; score: number | null } | null;
  answerText: string; // "SENDING: A" | "SAVED: A" | ""
};
export const idleCtx: Ctx = {
  joined: false, connected: false, snapshotReady: false, state: "WAITING", questionOpen: false,
  hasQuestion: false, questionOrder: 0, total: 0, seconds: 0, remainingSec: 0, canAnswer: false,
  resultReady: false, result: null, answerText: "",
};

export type Device = {
  entering: boolean; room: string; student: string; input: string; confirmed: boolean;
  pendingJoin: boolean; // a join request whose outcome is unknown: only ENT may resend it
  notice: string; noticeAt: number; answerNote: string; answerNoteAt: number;
  sleeping: boolean; lastActivity: number; mode: Mode;
};
export const newDevice = (now = 0): Device => ({
  entering: true, room: "", student: "", input: "", confirmed: false, pendingJoin: false,
  notice: "", noticeAt: 0, answerNote: "", answerNoteAt: 0, sleeping: false, lastActivity: now, mode: "IDLE",
});
export type Action =
  | { type: "join"; room: string; student: string }
  | { type: "choose"; choice: string }
  | { type: "test"; choice: string }
  | { type: "leave" };

const withNotice = (d: Device, notice: string, now: number): Device => ({ ...d, notice, noticeAt: now });
const promptFor = (d: Device) => (d.entering ? "ROOM ID + ENTER" : "STUDENT ID + ENTER");

export function modeOf(c: Ctx): Mode {
  if (c.joined && (c.state === "RUNNING" || c.state === "PAUSED")) return "EXAM";
  if (c.joined && c.state === "FINISHED") return "FINISHED";
  if (c.joined && c.state === "LOBBY") return "WAITING";
  return "IDLE";
}

// Called on every UI tick (and after key presses): mode changes wake the screen, idle timers sleep it.
export function tick(d: Device, c: Ctx, now: number): Device {
  const mode = modeOf(c);
  let n = d;
  if (mode !== d.mode) n = { ...n, mode, sleeping: false, lastActivity: now };
  if (mode === "EXAM") {
    // Running/paused keeps the display on and discards half-typed ROOM/STUDENT input.
    if (n.sleeping || n.input || n.notice || n.entering)
      n = { ...n, sleeping: false, lastActivity: now, input: "", notice: "", entering: false, confirmed: false };
    return n;
  }
  const limit = mode === "WAITING" ? OLED_SLEEP_MS.waiting : mode === "FINISHED" ? OLED_SLEEP_MS.result : OLED_SLEEP_MS.input;
  if (!n.sleeping && now - n.lastActivity >= limit) n = { ...n, sleeping: true };
  return n;
}

// The key that wakes a sleeping screen does nothing else (handleKey in main.cpp).
export function pressKey(d: Device, key: Key, c: Ctx, now: number): { device: Device; action: Action | null } {
  const woke = d.sleeping;
  d = { ...d, sleeping: false, lastActivity: now };
  if (woke) return { device: d, action: null };
  const letter = key === "A" || key === "B" || key === "C" || key === "D";
  if (c.joined && (c.state === "RUNNING" || c.state === "PAUSED")) {
    if (!letter) return { device: d, action: null };
    if (!c.connected || !c.snapshotReady) return { device: d, action: null };
    if (c.canAnswer) return { device: d, action: { type: "choose", choice: key } };
    if (c.state === "PAUSED") return { device: d, action: { type: "test", choice: key } };
    return { device: { ...d, answerNote: "ANSWERING CLOSED", answerNoteAt: now }, action: null };
  }
  if (c.joined && c.state === "FINISHED" && c.resultReady) {
    return { device: d, action: key === "ENT" ? { type: "leave" } : null };
  }
  if (d.pendingJoin) {
    return { device: d, action: key === "ENT" ? { type: "join", room: d.room, student: d.student } : null };
  }
  if (key === "DEL") {
    if (!d.entering && d.input === "")
      return { device: withNotice({ ...d, entering: true, input: d.room, room: "", student: "", confirmed: false }, "ROOM ID + ENTER", now), action: null };
    return { device: withNotice({ ...d, confirmed: false, input: d.input.slice(0, -1) }, promptFor(d), now), action: null };
  }
  if (key === "ENT") return confirm(d, now);
  if (letter) {
    if (d.entering) return { device: { ...d, notice: "" }, action: null };
    // Student step: A-D test the clicker once connected (LOBBY), otherwise nothing to send.
    if (c.joined && c.connected && c.snapshotReady && (c.state === "LOBBY" || c.state === "WAITING"))
      return { device: { ...d, notice: "" }, action: { type: "test", choice: key } };
    return { device: { ...d, notice: "" }, action: null };
  }
  const base = d.confirmed ? { ...d, input: "", confirmed: false } : d;
  if (base.input.length < (d.entering ? ROOM_DIGITS : MAX_STUDENT_DIGITS))
    return { device: withNotice({ ...base, input: base.input + key }, promptFor(d), now), action: null };
  return { device: withNotice(base, d.entering ? "ROOM NEEDS 8 DIGITS" : "MAX 10 DIGITS", now), action: null };
}

function confirm(d: Device, now: number): { device: Device; action: Action | null } {
  if (d.input === "") return { device: withNotice(d, d.entering ? "ENTER ROOM ID" : "ENTER STUDENT ID", now), action: null };
  if (d.entering) {
    if (d.input.length !== ROOM_DIGITS) return { device: withNotice(d, "ROOM NEEDS 8 DIGITS", now), action: null };
    return { device: withNotice({ ...d, room: d.input, student: "", entering: false, input: "", confirmed: false }, "STUDENT ID + ENTER", now), action: null };
  }
  const next = { ...d, student: d.input, pendingJoin: true };
  return { device: withNotice(next, "JOINING ROOM...", now), action: { type: "join", room: d.room, student: d.input } };
}

// Server code -> OLED text, same table as joinRoom() in main.cpp.
export function joinFailure(d: Device, code: string, now: number): Device {
  const clear = { ...d, pendingJoin: false, sleeping: false, lastActivity: now };
  if (code === "STUDENT_UNAVAILABLE" || code === "STUDENT_ACCESS_ENDED")
    return withNotice({ ...clear, entering: false, student: "", input: "", confirmed: false },
      code === "STUDENT_UNAVAILABLE" ? "NOT ON THE LIST" : "STUDENT NOT IN ROOM", now);
  if (code === "ROOM_UNAVAILABLE")
    return withNotice({ ...clear, entering: true, input: d.room, room: "", student: "", confirmed: false }, "ROOM INVALID/EXPIRED", now);
  const notice = code === "STUDENT_ALREADY_BOUND" || code === "DUPLICATE_LABEL" || code === "STUDENT_BUSY" ? "STUDENT IN USE"
    : code === "DEVICE_BUSY" ? "LEAVE OLD ROOM FIRST" : "JOIN REJECTED";
  return withNotice({ ...clear, input: d.student || d.input }, notice, now);
}
// Network trouble: the request id is kept so ENT resends exactly the same request.
export const joinUncertain = (d: Device, now: number): Device =>
  withNotice({ ...d, pendingJoin: true, sleeping: false, lastActivity: now }, "RETRY ENTER", now);
export const joined = (d: Device, now: number): Device =>
  withNotice({ ...d, pendingJoin: false, entering: false, input: "", confirmed: false, sleeping: false, lastActivity: now }, "JOINED / WAITING", now);
export const left = (now: number): Device => withNotice(newDevice(now), "ROOM ID + ENTER", now);

const fit = (s: string) => s.slice(0, OLED_COLUMNS);
// Three OLED rows (y = 0 / 11 / 22). Empty strings while the screen sleeps.
export function oledLines(d: Device, c: Ctx, now: number): [string, string, string] {
  if (d.sleeping) return ["", "", ""];
  const live = c.joined && c.connected && c.snapshotReady;
  let l1: string;
  if (!c.joined) l1 = "Connected WEB";
  else if (!live) l1 = "CONNECTING...";
  else if (c.state === "LOBBY") l1 = "READY / WAITING";
  else if (c.state === "PAUSED") l1 = "PAUSED";
  else if (c.state === "FINISHED") l1 = "QUIZ COMPLETE";
  else if (c.state === "CANCELLED") l1 = "QUIZ CANCELLED";
  else l1 = c.questionOpen ? "QUIZ IN PROGRESS" : "QUESTION CLOSED";
  if (c.state === "FINISHED" && c.result && live)
    return [fit(l1), fit(`Correct: ${c.result.correct}/${c.result.total}`),
      fit(c.result.score == null ? "Score: --" : `Score: ${c.result.score.toFixed(2)}/10`)];
  if (d.notice && now - d.noticeAt < NOTICE_MS)
    return [fit(l1), fit(d.notice), fit(d.notice === "NOT ON THE LIST" ? "PLEASE RE-ENTER" : d.input)];
  const q = `Q ${c.questionOrder}/${c.total}  ${c.remainingSec}s`;
  // Joined but offline: the firmware shows the entry prompt here; "RECONNECTING..." is clearer.
  let l2 = c.joined && !live ? "RECONNECTING..." : promptFor(d);
  if (live) {
    if (c.state === "RUNNING" || c.state === "PAUSED") l2 = c.hasQuestion ? q : "WAITING FOR QUESTION";
    else if (c.state === "LOBBY") l2 = `${c.total} Q / ${c.seconds} sec each`;
    else if (c.hasQuestion && c.state !== "FINISHED" && c.state !== "CANCELLED") l2 = q;
  }
  const note = d.answerNote && now - d.answerNoteAt < ANSWER_NOTE_MS ? d.answerNote : "";
  return [fit(l1), fit(l2), fit(note || c.answerText || d.input)];
}

// Adafruit GFX default 5x7 font, ASCII 0x20..0x7E, one byte per column (bit0 = top row).
const GLYPHS = "0000000000 00005F0000 0007000700 147F147F14 242A7F2A12 2313086462 3649562050 0008070300 001C224100 0041221C00 2A1C7F1C2A 08083E0808 0080703000 0808080808 0000606000 2010080402 3E5149453E 00427F4000 7249494946 2141494D33 1814127F10 2745454539 3C4A494931 4121110907 3649494936 464949291E 0000140000 0040340000 0008142241 1414141414 0041221408 0201590906 3E415D594E 7C1211127C 7F49494936 3E41414122 7F4141413E 7F49494941 7F09090901 3E41415173 7F0808087F 00417F4100 2040413F01 7F08142241 7F40404040 7F021C027F 7F0408107F 3E4141413E 7F09090906 3E4151215E 7F09192946 2649494932 03017F0103 3F4040403F 1F2040201F 3F4038403F 6314081463 0304780403 6159494D43 007F414141 02040810 20 004141417F 0402010204 4040404040 0003070800 2054547840 7F28444438 3844444428 384444287F 3854545418 00087E0902 18A4A49C78 7F08040478 00447D4000 2040403D00 7F10284400 00417F4000 7C04780478 7C08040478 3844444438 FC18242418 18242418FC 7C08040408 4854545424 04043F4424 3C4040207C 1C2040201C 3C4030403C 4428102844 4C9090907C 4464544C44 0008364100 0000770000 0041360800 0201020402".replace(/\s+/g, "");
// 0304780403 splits above would break the column count; rebuilt explicitly for Y below.
export function glyph(ch: string): number[] {
  const i = ch.charCodeAt(0) - 32;
  return FONT[i >= 0 && i < FONT.length ? i : 31];
}
const FONT: number[][] = (() => {
  const out: number[][] = [];
  for (let i = 0; i + 10 <= GLYPHS.length; i += 10) {
    const g: number[] = [];
    for (let j = 0; j < 10; j += 2) g.push(parseInt(GLYPHS.slice(i + j, i + j + 2), 16));
    out.push(g);
  }
  return out;
})();
