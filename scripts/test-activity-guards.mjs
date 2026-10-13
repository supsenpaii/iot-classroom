import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDb } from "../dist/server/server/db.js";
import { Quiz } from "../dist/server/server/quiz.js";
import { Flashcards } from "../dist/server/server/flashcards.js";
import { Polls, Attendance } from "../dist/server/server/live.js";

const activities = [
  { kind: "flashcard", table: "flashcard_reviews", state: "RUNNING", code: "REVIEW_RUNNING" },
  { kind: "poll", table: "polls", state: "RUNNING", code: "POLL_RUNNING" },
  { kind: "attendance", table: "attendance_sessions", state: "OPEN", code: "ATTENDANCE_OPEN" },
];

function fixture(t) {
  // Every record, including legacy overlapping activities, stays in memory.
  const db = openDb(":memory:");
  t.after(() => db.close());
  const now = () => 1800000000000;
  const quiz = new Quiz(db, now), flashcards = new Flashcards(db, now);
  const polls = new Polls(db, now), attendance = new Attendance(db, now);
  const sessions = {}, decks = {};
  for (const owner of ["teacher", "other"]) {
    db.prepare("INSERT INTO teachers VALUES (?,?,?,?)").run(owner, `${owner}@example.test`, "hash", now());
    db.prepare("INSERT INTO classes VALUES (?,?,?,0)").run(owner, owner, "Class");
    db.prepare("INSERT INTO students VALUES (?,?,?,?)").run(owner, owner, "001", "Student");
    // Leave one pupil unanswered so saving an answer does not auto-finish the quiz.
    db.prepare("INSERT INTO students VALUES (?,?,?,?)").run(`${owner}-peer`, owner, "002", "Peer");
    db.prepare("INSERT INTO question_banks(id,owner_teacher_id,name) VALUES (?,?,?)").run(owner, owner, "Bank");
    db.prepare("INSERT INTO questions VALUES (?,?,?)").run(owner, owner, JSON.stringify({
      question: "Question", option_a: "A", option_b: "B", option_c: "C", option_d: "D", correct_answer: "A",
    }));
    db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,?,?)")
      .run(owner, owner, "Board", `hash-${owner}`);
    sessions[owner] = quiz.create(owner, {
      class_id: owner, bank_id: owner, name: "Quiz",
      config: { count: 1, seconds: 30, random: false, auto_next: false, allow_change: true, pass_mark: 5, leaderboard: false },
    });
    const student = db.prepare("SELECT id FROM session_students WHERE session_id=? ORDER BY student_code").get(sessions[owner]);
    quiz.bind(sessions[owner], student.id, owner, owner);
    decks[owner] = flashcards.createDeck(owner, "Deck", "");
    flashcards.addCards(decks[owner], [{ front: "Question", back: "Answer" }]);
  }
  function packet(action, owner = "teacher") {
    return { action, command_id: randomUUID(), expected_version: quiz.get(sessions[owner]).state_version };
  }
  const command = (input, owner = "teacher") => quiz.command(sessions[owner], owner, input);
  function open(activity, owner = "teacher") {
    if (activity.kind === "flashcard") return flashcards.createReview(owner, decks[owner], false);
    if (activity.kind === "poll") return polls.create(owner, { question: "Poll", options: ["A", "B"], hide_results: false });
    return attendance.create(owner, owner);
  }
  function close(activity, id, owner = "teacher") {
    if (activity.kind === "flashcard") flashcards.command(owner, id, "finish");
    else if (activity.kind === "poll") polls.command(owner, id, "close");
    else attendance.command(owner, id, { action: "close" });
  }
  function records() {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  }
  function rejected(fn, code) {
    const before = records();
    assert.throws(fn, error => error.code === code && error.status === 409);
    // Includes deadlines, bindings, answers, events and command/answer receipts.
    assert.deepEqual(records(), before);
  }
  return { db, quiz, sessions, packet, command, open, close, records, rejected };
}

for (const activity of activities) {
  test(`quiz start rejects active ${activity.kind}, then accepts the same command after closing`, t => {
    const f = fixture(t), id = f.open(activity), input = f.packet("start");
    f.rejected(() => f.command(input), activity.code);
    assert.equal(f.quiz.get(f.sessions.teacher).state, "LOBBY");
    f.close(activity, id);
    f.command(input);
    assert.equal(f.quiz.get(f.sessions.teacher).state, "RUNNING");
    const before = f.records();
    assert.equal(f.command(input).duplicate, true);
    assert.deepEqual(f.records(), before);
  });

  test(`quiz resume rejects legacy active ${activity.kind} without changing answers or timers`, t => {
    const f = fixture(t), id = f.open(activity);
    f.close(activity, id);
    f.command(f.packet("start"));
    const snapshot = f.quiz.deviceSnapshot("teacher");
    const answer = { v: 1, type: "answer.submit", request_id: randomUUID(), session_id: snapshot.id,
      question_instance_id: snapshot.question.id, binding_id: snapshot.binding_id, seq: 1, choice: "A" };
    assert.equal(f.quiz.answer("teacher", answer).accepted, true);
    f.command(f.packet("pause"));
    // Simulate coexistence left by the old version, which allowed quiz start over an activity.
    f.db.prepare(`UPDATE ${activity.table} SET state=? WHERE id=?`).run(activity.state, id);
    const input = f.packet("resume");
    f.rejected(() => f.command(input), activity.code);
    assert.equal(f.quiz.get(f.sessions.teacher).state, "PAUSED");
    f.close(activity, id);
    f.command(input);
    assert.equal(f.quiz.get(f.sessions.teacher).state, "RUNNING");
    assert.equal(f.quiz.deviceSnapshot("teacher").binding_id, snapshot.binding_id);
    assert.equal(f.quiz.answer("teacher", answer).duplicate, true);
    const before = f.records();
    assert.equal(f.command(input).duplicate, true);
    assert.deepEqual(f.records(), before);
    f.command(f.packet("finish"));
    assert.equal(f.quiz.report(f.sessions.teacher).students[0].score, 10);
  });

  for (const state of ["RUNNING", "PAUSED"]) {
    test(`${activity.kind} rejects a ${state} quiz and opens after the quiz finishes`, t => {
      const f = fixture(t);
      f.command(f.packet("start"));
      if (state === "PAUSED") f.command(f.packet("pause"));
      f.rejected(() => f.open(activity), "QUIZ_RUNNING");
      f.command(f.packet("finish"));
      assert.ok(f.open(activity));
    });
  }

  test(`${activity.kind} checks the guard inside its creation transaction`, t => {
    const f = fixture(t), prepare = f.db.prepare.bind(f.db);
    let guardChecks = 0;
    f.db.prepare = sql => {
      if (/^SELECT 1 FROM (quiz_sessions|flashcard_reviews|polls|attendance_sessions) WHERE/.test(sql)) {
        guardChecks++;
        assert.equal(f.db.inTransaction, true, "Activity guard must share the transaction that opens the activity");
      }
      return prepare(sql);
    };
    assert.ok(f.open(activity));
    assert.ok(guardChecks > 0);
  });

  test(`another teacher's ${activity.kind} keeps its existing scope`, t => {
    const f = fixture(t), id = f.open(activity, "other");
    f.command(f.packet("start"));
    f.command(f.packet("pause"));
    f.command(f.packet("resume"));
    assert.equal(f.db.prepare(`SELECT state FROM ${activity.table} WHERE id=?`).get(id).state, activity.state);
  });

  for (const next of activities) {
    test(`${next.kind} rejects active ${activity.kind} with the same conflict code`, t => {
      const f = fixture(t);
      f.open(activity);
      f.rejected(() => f.open(next), activity.code);
    });
  }
}

test("the global limit of one active quiz is preserved across teachers", t => {
  const f = fixture(t);
  f.command(f.packet("start"));
  f.rejected(() => f.command(f.packet("start", "other"), "other"), "ROOM_BUSY");
});

test("invalid state and stale version keep their existing error priority", t => {
  const f = fixture(t);
  f.open(activities[0]);
  f.rejected(() => f.command(f.packet("resume")), "INVALID_STATE");
  f.rejected(() => f.command({ ...f.packet("start"), expected_version: 0 }), "VERSION_CONFLICT");
});
