import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import WebSocket from "ws";
import { openDb } from "../dist/server/server/db.js";
import { Flashcards } from "../dist/server/server/flashcards.js";
import { hash } from "../dist/server/server/auth.js";
import { createApplication } from "../dist/server/server/app.js";

function fixture(t, count = 1) {
  const db = openDb(":memory:");
  t.after(() => db.close());
  let clock = 1800000000000;
  const flashcards = new Flashcards(db, () => clock);
  db.prepare("INSERT INTO teachers VALUES (?,?,?,?)").run("teacher", "flashcard@example.test", "hash", clock);
  db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,?,?)")
    .run("device", "teacher", "Board", hash("flashcard-test-secret"));
  const deck = flashcards.createDeck("teacher", "Deck", "");
  flashcards.addCards(deck, Array.from({ length: count }, (_, i) => ({ front: `Card ${i}`, back: `Answer ${i}` })));
  const review = flashcards.createReview("teacher", deck, false);
  const packet = (rating = "AGAIN", extra = {}) => {
    const s = flashcards.deviceSnapshot("device");
    // The baseline has no display identity: this also reproduces its real legacy packets.
    return { v: 1, type: "flashcard.rate", request_id: randomUUID(), review_id: s.id,
      card_id: s.card.id, ...(s.display_id ? { round: s.round, display_id: s.display_id } : {}), rating, ...extra };
  };
  const rows = () => db.prepare("SELECT * FROM flashcard_ratings ORDER BY review_id,round,card_id,device_id").all();
  const stats = () => flashcards.snapshot(review, () => true);
  const rate = p => flashcards.rate("device", p);
  const command = action => flashcards.command("teacher", review, action);
  return { db, flashcards, deck, review, packet, rows, stats, rate, command, advance: () => clock++ };
}

test("a current-round rating is accepted and counted once", t => {
  const f = fixture(t), p = f.packet("KNOWN");
  assert.equal(f.rate(p).accepted, true);
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0].round, 1);
  assert.deepEqual(f.stats().counts, { KNOWN: 1, AGAIN: 0 });
});

test("replaying a processed packet into the next round preserves both rounds and their counts", t => {
  const f = fixture(t), old = f.packet();
  const ack = f.rate(old);
  assert.equal(ack.accepted, true);
  f.command("repeat");
  f.advance();
  assert.equal(f.rate(f.packet("KNOWN")).accepted, true);
  const before = f.rows(), counts = f.stats().counts;
  f.advance();
  const replay = f.rate(old);
  assert.deepEqual(f.rows(), before, "Old packets must not write into the new round");
  assert.deepEqual(f.stats().counts, counts);
  assert.deepEqual(replay, { ...ack, duplicate: true });
});

test("an unprocessed old packet is rejected when the same card returns in the next round", t => {
  const f = fixture(t), delayed = f.packet("KNOWN");
  assert.equal(f.rate(f.packet()).accepted, true);
  f.command("repeat");
  const before = f.rows();
  const ack = f.rate(delayed);
  assert.equal(ack.accepted, false, "A delayed packet must not inherit the server's new round");
  assert.equal(ack.code, "ROUND_CHANGED");
  assert.deepEqual(f.rows(), before);
  assert.deepEqual(f.stats().counts, { KNOWN: 0, AGAIN: 0 });
});

test("retrying an earlier request does not overwrite a newer rating in the same display", t => {
  const f = fixture(t), first = f.packet("KNOWN");
  const ack = f.rate(first);
  f.advance();
  assert.equal(f.rate(f.packet("AGAIN")).accepted, true);
  const before = f.rows();
  f.advance();
  const replay = f.rate(first);
  assert.deepEqual(f.rows(), before, "A duplicate must not overwrite the latest choice or timestamp");
  assert.deepEqual(replay, { ...ack, duplicate: true });
  assert.deepEqual(f.stats().counts, { KNOWN: 0, AGAIN: 1 });
});

test("a duplicate returns the original ACK without changing timestamps or receipts", t => {
  const f = fixture(t), p = f.packet("KNOWN");
  const ack = f.rate(p), before = f.rows();
  assert.equal(ack.duplicate, false);
  assert.equal(ack.review_id, p.review_id);
  assert.equal(ack.card_id, p.card_id);
  assert.equal(ack.round, p.round);
  assert.equal(ack.display_id, p.display_id);
  f.advance();
  assert.deepEqual(f.rate(p), { ...ack, duplicate: true });
  assert.deepEqual(f.rows(), before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM flashcard_receipts").get().n, 1);
});

test("snapshots identify the round and display, including each revisit to the same card", t => {
  const f = fixture(t, 2), s = f.flashcards.deviceSnapshot("device");
  assert.equal(s.round, 1);
  assert.ok(s.display_id);
  assert.equal(f.stats().display_id, s.display_id);
  f.command("next");
  const next = f.flashcards.deviceSnapshot("device");
  assert.notEqual(next.display_id, s.display_id);
  f.command("prev");
  const back = f.flashcards.deviceSnapshot("device");
  assert.equal(back.card.id, s.card.id);
  assert.equal(back.round, s.round);
  assert.notEqual(back.display_id, s.display_id);
  assert.notEqual(back.display_id, next.display_id);
  assert.equal(f.rate(f.packet()).accepted, true);
  f.command("repeat");
  assert.equal(f.stats().round, 2);
  assert.notEqual(f.stats().display_id, back.display_id);
});

test("an unprocessed packet cannot rate a later display of the same card in the same round", t => {
  const f = fixture(t, 2), delayed = f.packet("KNOWN");
  f.command("next");
  f.command("prev");
  const ack = f.rate(delayed);
  assert.equal(ack.accepted, false);
  assert.equal(ack.code, "DISPLAY_CHANGED");
  assert.deepEqual(f.rows(), []);
  assert.deepEqual(f.stats().counts, { KNOWN: 0, AGAIN: 0 });
});

test("flipping the same card preserves its display and permits an in-flight rating", t => {
  const f = fixture(t), p = f.packet("KNOWN"), version = f.stats().state_version;
  f.command("flip");
  assert.equal(f.stats().display_id, p.display_id);
  assert.equal(f.stats().state_version, version + 1);
  assert.equal(f.rate(p).accepted, true);
  f.command("flip");
  assert.equal(f.stats().display_id, p.display_id);
  assert.equal(f.rate(p).duplicate, true);
});

test("failed navigation preserves the current display and its valid pending packet", t => {
  const f = fixture(t), p = f.packet("KNOWN"), before = f.flashcards.get(f.review);
  for (const [action, code] of [["next", "LAST_CARD"], ["prev", "FIRST_CARD"], ["repeat", "NOTHING_TO_REPEAT"]]) {
    assert.throws(() => f.command(action), e => e.code === code);
    assert.deepEqual(f.flashcards.get(f.review), before);
  }
  assert.equal(f.rate(p).accepted, true);
});

for (const [field, value] of [["rating", "KNOWN"], ["card_id", "other-card"], ["round", 2], ["display_id", "other-display"]]) {
  test(`reusing a processed request_id with a different ${field} is rejected`, t => {
    const f = fixture(t), p = f.packet();
    assert.equal(f.rate(p).accepted, true);
    const before = f.rows();
    const ack = f.rate({ ...p, [field]: value });
    assert.equal(ack.accepted, false);
    assert.equal(ack.code, "REQUEST_REUSED");
    assert.deepEqual(f.rows(), before);
    assert.equal(f.db.prepare("SELECT count(*) n FROM flashcard_receipts").get().n, 1);
  });
}

for (const [extra, code] of [[{ card_id: "wrong-card" }, "CARD_CHANGED"], [{ round: 2 }, "ROUND_CHANGED"], [{ display_id: "wrong-display" }, "DISPLAY_CHANGED"]]) {
  test(`a fresh request for the wrong identity returns ${code} consistently`, t => {
    const f = fixture(t), p = f.packet("KNOWN", extra);
    const ack = f.rate(p);
    assert.equal(ack.accepted, false);
    assert.equal(ack.code, code);
    assert.equal(ack.request_id, p.request_id);
    assert.equal(ack.review_id, p.review_id);
    assert.equal(ack.round, p.round);
    assert.equal(ack.display_id, p.display_id);
    assert.deepEqual(f.rate(p), { ...ack, duplicate: true });
    assert.deepEqual(f.rows(), []);
  });
}

test("a rejected request stays rejected when its card becomes current later", t => {
  const f = fixture(t, 2), p = f.packet("KNOWN");
  f.command("next");
  const ack = f.rate(p);
  assert.equal(ack.code, "CARD_CHANGED");
  f.command("prev");
  assert.deepEqual(f.rate(p), { ...ack, duplicate: true });
  assert.deepEqual(f.rows(), []);
  assert.equal(f.rate(f.packet("KNOWN")).accepted, true);
});

test("finished reviews return old receipts and reject unprocessed packets without changing history", t => {
  const f = fixture(t), processed = f.packet(), delayed = f.packet("KNOWN");
  const ack = f.rate(processed);
  f.command("repeat");
  assert.equal(f.rate(f.packet("KNOWN")).accepted, true);
  f.command("finish");
  const before = f.rows(), summary = f.stats().summary;
  assert.deepEqual(f.rate(processed), { ...ack, duplicate: true });
  assert.equal(f.rate(delayed).code, "REVIEW_CLOSED");
  assert.deepEqual(f.rows(), before);
  assert.deepEqual(f.stats().summary, summary);
  assert.deepEqual(summary[0].first, { KNOWN: 0, AGAIN: 1 });
  assert.deepEqual(summary[0].last, { KNOWN: 1, AGAIN: 0 });
});

test("request identities are scoped per device and cannot be reused across review sessions", t => {
  const f = fixture(t), p = f.packet("KNOWN");
  const ack = f.rate(p);
  f.db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,?,?)")
    .run("peer", "teacher", "Peer", "peer-hash");
  assert.equal(f.flashcards.rate("peer", p).accepted, true);
  assert.deepEqual(f.stats().counts, { KNOWN: 2, AGAIN: 0 });
  f.command("finish");
  const next = f.flashcards.createReview("teacher", f.deck, false);
  const nextPacket = f.packet("AGAIN", { request_id: p.request_id });
  const before = f.rows();
  assert.equal(f.rate(nextPacket).code, "REQUEST_REUSED");
  assert.deepEqual(f.rate(p), { ...ack, duplicate: true });
  assert.deepEqual(f.rows(), before);
  assert.deepEqual(f.flashcards.snapshot(next, () => true).counts, { KNOWN: 0, AGAIN: 0 });
});

test("missing display/round identity and invalid payloads receive a correlated rejection", t => {
  const f = fixture(t), p = f.packet("KNOWN");
  const invalid = [{ ...p, round: undefined }, { ...p, display_id: undefined },
    { ...p, round: undefined, display_id: undefined }, { ...p, round: 0 },
    { ...p, round: 1.5 }, { ...p, display_id: "" }, { ...p, rating: "bad" }, { ...p, extra: true }];
  for (const packet of invalid) {
    assert.deepEqual(f.rate(packet), {
      v: 1, type: "flashcard.ack", request_id: p.request_id,
      accepted: false, code: "INVALID_PAYLOAD", duplicate: false,
    });
  }
  assert.throws(() => f.rate({ ...p, request_id: undefined }));
  assert.deepEqual(f.rows(), []);
  assert.equal(f.db.prepare("SELECT count(*) n FROM flashcard_receipts").get().n, 0);
});

test("foreign sessions and revoked devices cannot write or retrieve a successful receipt", t => {
  const f = fixture(t), p = f.packet("KNOWN");
  assert.equal(f.rate({ ...p, review_id: "missing-review" }).code, "REVIEW_CLOSED");
  f.db.prepare("INSERT INTO teachers VALUES (?,?,?,?)").run("other", "other@example.test", "hash", 0);
  f.db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,?,?)")
    .run("other-device", "other", "Other", "hash-other");
  assert.equal(f.flashcards.rate("other-device", p).code, "REVIEW_CLOSED");
  assert.equal(f.rate(p).accepted, true);
  const before = f.rows();
  f.db.prepare("UPDATE devices SET revoked=1 WHERE id='device'").run();
  assert.equal(f.rate(p).code, "DEVICE_NOT_ASSIGNED");
  assert.equal(f.flashcards.rate("missing-device", p).code, "DEVICE_NOT_ASSIGNED");
  assert.deepEqual(f.rows(), before);
});

for (const state of ["RUNNING", "PAUSED"]) {
  test(`a device in a legacy overlapping ${state} quiz cannot create a flashcard rating`, t => {
    const f = fixture(t), processed = f.packet("KNOWN");
    const ack = f.rate(processed), pending = f.packet();
    // BUG 01 prevents new overlaps; old databases may still contain one.
    f.db.exec("INSERT INTO classes VALUES ('class','teacher','Class',0); INSERT INTO question_banks(id,owner_teacher_id,name) VALUES ('bank','teacher','Bank')");
    f.db.prepare("INSERT INTO quiz_sessions(id,owner_teacher_id,class_id,bank_id,class_name,name,room_code,config,state,created_at) VALUES ('quiz','teacher','class','bank','Class','Quiz','123','{}',?,0)").run(state);
    f.db.exec("INSERT INTO session_students(id,session_id,student_id,student_code,full_name) VALUES ('student','quiz','student','001','Student'); INSERT INTO session_devices VALUES ('binding','quiz','student','device',1,0)");
    const before = f.rows();
    assert.equal(f.flashcards.deviceSnapshot("device"), null);
    assert.equal(f.rate(pending).code, "DEVICE_BUSY");
    assert.deepEqual(f.rate(processed), { ...ack, duplicate: true });
    assert.deepEqual(f.rows(), before);
  });
}

test("receipt failure rolls back an insert or update and the original request remains retryable", t => {
  const f = fixture(t);
  for (const rating of ["AGAIN", "KNOWN"]) {
    const p = f.packet(rating), before = f.rows();
    f.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON flashcard_receipts BEGIN SELECT RAISE(ABORT,'flashcard test storage failure'); END");
    assert.throws(() => f.rate(p), /flashcard test storage failure/);
    assert.deepEqual(f.rows(), before);
    assert.equal(f.db.prepare("SELECT 1 FROM flashcard_receipts WHERE request_id=?").get(p.request_id), undefined);
    f.db.exec("DROP TRIGGER fail_receipt");
    assert.equal(f.rate(p).accepted, true);
    assert.equal(f.rows()[0].rating, rating);
  }
});

test("deleting a finished deck removes its receipts without disturbing another deck", t => {
  const f = fixture(t);
  assert.equal(f.rate(f.packet()).accepted, true);
  f.command("finish");
  const other = f.flashcards.createDeck("teacher", "Other", "");
  f.flashcards.addCards(other, [{ front: "Other", back: "Answer" }]);
  const review = f.flashcards.createReview("teacher", other, false);
  assert.equal(f.rate(f.packet("KNOWN")).accepted, true);
  f.flashcards.deleteDeck("teacher", f.deck);
  assert.equal(f.db.prepare("SELECT count(*) n FROM flashcard_receipts WHERE review_id=?").get(f.review).n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM flashcard_receipts WHERE review_id=?").get(review).n, 1);
  assert.equal(f.rows().length, 1);
  assert.deepEqual(f.db.pragma("foreign_key_check"), []);
});

test("migration and database reopen preserve historical ratings, summaries and durable receipts", () => {
  const dir = mkdtempSync(join(tmpdir(), "smartclass-flashcard-db-")), path = join(dir, "test.sqlite");
  let db = new Database(path);
  try {
    // Apply the original seven migrations to a test-only database, never the application's data.
    const migrations = new URL("../server/migrations/", import.meta.url);
    db.exec("CREATE TABLE migrations(name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    for (const name of readdirSync(migrations).filter(n => n.endsWith(".sql") && n < "008_").sort()) {
      db.exec(readFileSync(new URL(name, migrations), "utf8"));
      db.prepare("INSERT INTO migrations VALUES (?,0)").run(name);
    }
    db.exec("INSERT INTO teachers VALUES ('teacher','migration@example.test','hash',0); INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES ('device','teacher','Board','hash')");
    const before = new Flashcards(db, () => 0), deck = before.createDeck("teacher", "Deck", "");
    before.addCards(deck, [{ front: "Question", back: "Answer" }]);
    const cards = before.cards(deck), review = "legacy-running", finished = "legacy-finished";
    for (const [id, state] of [[review, "RUNNING"], [finished, "FINISHED"]]) {
      db.prepare("INSERT INTO flashcard_reviews(id,owner_teacher_id,deck_id,deck_name,cards,queue,state,created_at) VALUES (?,?,?,?,?,?,?,0)")
        .run(id, "teacher", deck, "Deck", JSON.stringify(cards), JSON.stringify(cards.map(c => c.id)), state);
      db.prepare("INSERT INTO flashcard_ratings VALUES (?,1,?,'device','AGAIN',123)").run(id, cards[0].id);
    }
    const oldRows = db.prepare("SELECT * FROM flashcard_ratings ORDER BY review_id").all();
    const oldSummary = before.snapshot(finished, () => true).summary;
    db.close();
    db = openDb(path);
    let service = new Flashcards(db, () => 1000);
    assert.deepEqual(db.prepare("SELECT * FROM flashcard_ratings ORDER BY review_id").all(), oldRows);
    assert.deepEqual(service.snapshot(finished, () => true).summary, oldSummary);
    const s = service.deviceSnapshot("device");
    assert.ok(s.display_id);
    const p = { v: 1, type: "flashcard.rate", request_id: "durable", review_id: review, card_id: cards[0].id, round: s.round, display_id: s.display_id, rating: "AGAIN" };
    const ack = service.rate("device", p);
    service.command("teacher", review, "repeat");
    const current = service.deviceSnapshot("device");
    service.rate("device", { ...p, request_id: "current", round: current.round, display_id: current.display_id, rating: "KNOWN" });
    const rows = db.prepare("SELECT * FROM flashcard_ratings ORDER BY review_id,round").all();
    const newDisplay = current.display_id;
    db.close();
    db = openDb(path);
    service = new Flashcards(db, () => 2000);
    assert.equal(service.deviceSnapshot("device").display_id, newDisplay);
    assert.deepEqual(service.rate("device", p), { ...ack, duplicate: true });
    assert.deepEqual(db.prepare("SELECT * FROM flashcard_ratings ORDER BY review_id,round").all(), rows);
    assert.deepEqual(service.snapshot(finished, () => true).summary, oldSummary);
    assert.equal(db.prepare("SELECT count(*) n FROM migrations WHERE name='008_flashcard_replay.sql'").get().n, 1);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function connect(origin) {
  const ws = new WebSocket(origin.replace(/^http/, "ws") + "/ws", {
    headers: { Authorization: "Bearer flashcard-test-secret", "X-Device-Id": "device" },
  });
  const messages = [];
  ws.on("message", bytes => messages.push(JSON.parse(bytes)));
  await once(ws, "open");
  return {
    ws, send: packet => ws.send(JSON.stringify(packet)),
    async wait(type, predicate = () => true) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const index = messages.findIndex(m => m.type === type && predicate(m));
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw Error(`Timed out waiting for ${type}: ${JSON.stringify(messages)}`);
    },
  };
}

test("real WebSocket reconnect retries the original request across a round change and finish", async t => {
  const f = fixture(t), config = { origin: "", secret: randomBytes(48).toString("hex"), production: false,
    simulator: true, trustProxy: 0, maxUpload: 5242880, openRouterApiKeys: [] };
  const app = createApplication(f.db, config);
  const sockets = [];
  try {
    await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
    config.origin = `http://127.0.0.1:${app.server.address().port}`;
    let c = await connect(config.origin); sockets.push(c.ws);
    const initial = (await c.wait("session.snapshot")).data;
    assert.equal(initial.display_id, f.stats().display_id);
    assert.equal(initial.round, 1);
    const p = f.packet();
    c.send(p);
    const lostAck = await c.wait("flashcard.ack");
    assert.equal(lostAck.accepted, true);
    // The sender has no usable ACK: close the transport and resend the exact pending packet.
    c.ws.terminate();
    await once(c.ws, "close");
    c = await connect(config.origin); sockets.push(c.ws);
    const resumed = (await c.wait("session.snapshot")).data;
    assert.equal(resumed.display_id, initial.display_id);
    assert.equal(resumed.current_rating, "AGAIN");
    const before = f.rows();
    c.send(p);
    assert.deepEqual(await c.wait("flashcard.ack"), { ...lostAck, duplicate: true });
    assert.deepEqual(f.rows(), before);
    f.command("repeat"); app.realtime.schedule();
    const current = (await c.wait("session.snapshot", m => m.data.round === 2)).data;
    assert.notEqual(current.display_id, initial.display_id);
    assert.equal(current.current_rating, null);
    c.send(p);
    assert.deepEqual(await c.wait("flashcard.ack"), { ...lostAck, duplicate: true });
    assert.deepEqual(f.rows(), before);
    c.send({ ...p, request_id: randomUUID() });
    const stale = await c.wait("flashcard.ack");
    assert.equal(stale.accepted, false); assert.equal(stale.code, "ROUND_CHANGED");
    const legacy = { ...p, request_id: randomUUID() }; delete legacy.round; delete legacy.display_id;
    c.send(legacy);
    assert.deepEqual(await c.wait("flashcard.ack"), {
      v: 1, type: "flashcard.ack", request_id: legacy.request_id,
      accepted: false, code: "INVALID_PAYLOAD", duplicate: false,
    });
    c.send({ ...p, request_id: undefined });
    assert.equal((await c.wait("error")).code, "INVALID_PAYLOAD");
    const currentPacket = f.packet("KNOWN");
    f.db.exec("CREATE TRIGGER fail_ws_receipt BEFORE INSERT ON flashcard_receipts BEGIN SELECT RAISE(ABORT,'flashcard storage error'); END");
    c.send(currentPacket);
    assert.equal((await c.wait("error")).code, "STORAGE_ERROR");
    assert.deepEqual(f.rows(), before);
    f.db.exec("DROP TRIGGER fail_ws_receipt");
    c.send(currentPacket);
    assert.equal((await c.wait("flashcard.ack")).accepted, true);
    f.command("finish"); app.realtime.schedule();
    await c.wait("session.snapshot", m => m.data.mode !== "flashcard");
    const finished = f.rows(), summary = f.stats().summary;
    c.send(p);
    assert.deepEqual(await c.wait("flashcard.ack"), { ...lostAck, duplicate: true });
    c.send({ ...currentPacket, request_id: randomUUID() });
    assert.equal((await c.wait("flashcard.ack")).code, "REVIEW_CLOSED");
    assert.deepEqual(f.rows(), finished);
    assert.deepEqual(f.stats().summary, summary);
  } finally {
    for (const ws of sockets) ws.terminate();
    await app.close();
  }
});
