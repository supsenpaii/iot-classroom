import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, type Row, all, one, owned, must, AppError } from "./db.js";
import { flashcardRateSchema } from "../shared/protocol.js";
import { assertIdle, busyInQuiz } from "./live.js";
type Card = { id: string; front: string; back: string };
type Counts = { KNOWN: number; AGAIN: number };
// No l/o/0/1 so students can type the link from the projector without guessing.
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export const shareTokenPattern = /^[a-km-np-z2-9]{10}$/;
export const shareToken = () =>
  Array.from(
    { length: 10 },
    () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)],
  ).join("");
function shuffled<T>(items: T[]) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export const reviewCommandSchema = z.object({
  action: z.enum(["flip", "next", "prev", "repeat", "finish"]),
});
export class Flashcards {
  constructor(
    public db: DB,
    public now = () => Date.now(),
  ) {}
  cards(deckId: string) {
    return all(
      this.db,
      "SELECT id,front,back FROM flashcards WHERE deck_id=? ORDER BY position,rowid",
      deckId,
    ) as Card[];
  }
  addCards(deckId: string, cards: { front: string; back: string }[]) {
    const start = Number(
      one(
        this.db,
        "SELECT coalesce(max(position),0) p FROM flashcards WHERE deck_id=?",
        deckId,
      )!.p,
    );
    const insert = this.db.prepare("INSERT INTO flashcards VALUES (?,?,?,?,?)");
    cards.forEach((c, i) =>
      insert.run(randomUUID(), deckId, start + i + 1, c.front, c.back),
    );
  }
  createDeck(owner: string, name: string, subject: string) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO flashcard_decks(id,owner_teacher_id,name,subject,created_at) VALUES (?,?,?,?,?)",
      )
      .run(id, owner, name, subject, this.now());
    return id;
  }
  // Front = question, back = correct option plus the explanation, so a bank becomes a deck in one click.
  fromBank(owner: string, bankId: string) {
    const bank = owned(this.db, "question_banks", bankId, owner);
    const questions = all(
      this.db,
      "SELECT data FROM questions WHERE bank_id=? ORDER BY rowid",
      bank.id,
    ).map((q) => JSON.parse(q.data));
    if (!questions.length)
      throw new AppError("EMPTY_BANK", "Bộ đề chưa có câu hỏi để tạo thẻ");
    return this.db.transaction(() => {
      const id = this.createDeck(owner, bank.name, bank.subject);
      this.addCards(
        id,
        questions.map((q) => ({
          front: q.question,
          back:
            `${q.correct_answer}. ${q[`option_${String(q.correct_answer).toLowerCase()}`]}` +
            (q.explanation ? `\n\n${q.explanation}` : ""),
        })),
      );
      return id;
    })();
  }
  deleteDeck(owner: string, id: string) {
    const deck = owned(this.db, "flashcard_decks", id, owner);
    if (
      one(
        this.db,
        "SELECT 1 FROM flashcard_reviews WHERE deck_id=? AND state='RUNNING'",
        deck.id,
      )
    )
      throw new AppError(
        "REVIEW_RUNNING",
        "Bộ thẻ đang được ôn tập. Kết thúc buổi ôn tập trước khi xóa.",
        409,
      );
    this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM flashcard_ratings WHERE review_id IN (SELECT id FROM flashcard_reviews WHERE deck_id=?)",
        )
        .run(deck.id);
      this.db.prepare("DELETE FROM flashcard_reviews WHERE deck_id=?").run(deck.id);
      this.db.prepare("DELETE FROM flashcards WHERE deck_id=?").run(deck.id);
      this.db.prepare("DELETE FROM flashcard_decks WHERE id=?").run(deck.id);
    })();
  }
  publicDeck(token: string) {
    const deck = must(
      one(
        this.db,
        "SELECT id,name,subject FROM flashcard_decks WHERE share_token=?",
        token,
      ),
      "Link tự học không còn hiệu lực. Hỏi lại giáo viên link mới.",
    );
    return { name: deck.name, subject: deck.subject, cards: this.cards(deck.id) };
  }
  createReview(owner: string, deckId: string, shuffle: boolean) {
    const deck = owned(this.db, "flashcard_decks", deckId, owner);
    const cards = this.cards(deck.id);
    if (!cards.length)
      throw new AppError("EMPTY_DECK", "Bộ thẻ chưa có thẻ nào để ôn tập");
    assertIdle(this.db, owner);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO flashcard_reviews(id,owner_teacher_id,deck_id,deck_name,cards,queue,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        id,
        owner,
        deck.id,
        deck.name,
        JSON.stringify(cards),
        JSON.stringify((shuffle ? shuffled(cards) : cards).map((c) => c.id)),
        this.now(),
      );
    return id;
  }
  get(id: string) {
    return must(one(this.db, "SELECT * FROM flashcard_reviews WHERE id=?", id));
  }
  command(owner: string, id: string, action: string) {
    this.db.transaction(() => {
      const r = owned(this.db, "flashcard_reviews", id, owner);
      if (r.state !== "RUNNING")
        throw new AppError("REVIEW_FINISHED", "Buổi ôn tập đã kết thúc", 409);
      const queue: string[] = JSON.parse(r.queue);
      let { current_index: index, side, round, state } = r,
        finished: number | null = null;
      if (action === "flip") side = side === "front" ? "back" : "front";
      else if (action === "next") {
        if (index >= queue.length - 1)
          throw new AppError("LAST_CARD", "Đây là thẻ cuối của vòng này");
        index++;
        side = "front";
      } else if (action === "prev") {
        if (index <= 0)
          throw new AppError("FIRST_CARD", "Đây là thẻ đầu tiên của vòng này");
        index--;
        side = "front";
      } else if (action === "repeat") {
        const again = new Set(
          all(
            this.db,
            "SELECT DISTINCT card_id FROM flashcard_ratings WHERE review_id=? AND round=? AND rating='AGAIN'",
            id,
            round,
          ).map((x) => x.card_id),
        );
        const next = queue.filter((c) => again.has(c));
        if (!next.length)
          throw new AppError(
            "NOTHING_TO_REPEAT",
            "Vòng này chưa có thẻ nào bị bấm Chưa nhớ",
          );
        r.queue = JSON.stringify(shuffled(next));
        round++;
        index = 0;
        side = "front";
      } else {
        state = "FINISHED";
        finished = this.now();
      }
      this.db
        .prepare(
          "UPDATE flashcard_reviews SET queue=?,round=?,current_index=?,side=?,state=?,finished_at=?,state_version=state_version+1 WHERE id=?",
        )
        .run(r.queue, round, index, side, state, finished, id);
    })();
  }
  private busy(device: string) {
    return busyInQuiz(this.db, device);
  }
  private ratings(reviewId: string) {
    const out = new Map<string, Map<number, Counts>>();
    for (const row of all(
      this.db,
      "SELECT card_id,round,rating,count(*) n FROM flashcard_ratings WHERE review_id=? GROUP BY card_id,round,rating",
      reviewId,
    )) {
      const rounds = out.get(row.card_id) ?? new Map<number, Counts>();
      const counts = rounds.get(row.round) ?? { KNOWN: 0, AGAIN: 0 };
      counts[row.rating as keyof Counts] = row.n;
      rounds.set(row.round, counts);
      out.set(row.card_id, rounds);
    }
    return out;
  }
  snapshot(id: string, online: (device: string) => boolean) {
    const r = this.get(id),
      cards: Card[] = JSON.parse(r.cards),
      byId = new Map(cards.map((c) => [c.id, c])),
      queue: string[] = JSON.parse(r.queue),
      ratings = this.ratings(r.id),
      empty = { KNOWN: 0, AGAIN: 0 },
      card = byId.get(queue[r.current_index])!;
    const devices = all(
      this.db,
      "SELECT id FROM devices WHERE owner_teacher_id=? AND revoked=0",
      r.owner_teacher_id,
    ).filter((d) => online(d.id) && !this.busy(d.id));
    return {
      mode: "flashcard",
      id: r.id,
      deck_id: r.deck_id,
      deck_name: r.deck_name,
      state: r.state,
      state_version: r.state_version,
      server_time: this.now(),
      round: r.round,
      index: r.current_index,
      total: queue.length,
      side: r.side,
      card,
      counts: ratings.get(card.id)?.get(r.round) ?? empty,
      devices_online: devices.length,
      round_stats: queue.map((cardId, i) => ({
        id: cardId,
        position: i + 1,
        front: byId.get(cardId)!.front,
        ...(ratings.get(cardId)?.get(r.round) ?? empty),
      })),
      summary:
        r.state === "FINISHED"
          ? cards.map((c) => {
              const rounds = [...(ratings.get(c.id)?.entries() ?? [])].sort(
                (a, b) => a[0] - b[0],
              );
              return {
                id: c.id,
                front: c.front,
                back: c.back,
                rounds: rounds.length,
                first: rounds[0]?.[1] ?? empty,
                last: rounds.at(-1)?.[1] ?? empty,
              };
            })
          : null,
    };
  }
  deviceSnapshot(device: string) {
    const d = one(
      this.db,
      "SELECT owner_teacher_id FROM devices WHERE id=? AND revoked=0",
      device,
    );
    if (!d || this.busy(device)) return null;
    const r = one(
      this.db,
      "SELECT * FROM flashcard_reviews WHERE owner_teacher_id=? AND state='RUNNING'",
      d.owner_teacher_id,
    );
    if (!r) return null;
    const queue: string[] = JSON.parse(r.queue),
      cardId = queue[r.current_index];
    const own = one(
      this.db,
      "SELECT rating FROM flashcard_ratings WHERE review_id=? AND round=? AND card_id=? AND device_id=?",
      r.id,
      r.round,
      cardId,
      device,
    );
    return {
      mode: "flashcard",
      id: r.id,
      state: "RUNNING",
      state_version: r.state_version,
      server_time: this.now(),
      card: {
        id: cardId,
        index: r.current_index + 1,
        total: queue.length,
        side: r.side,
      },
      current_rating: own?.rating ?? null,
    };
  }
  // Last rating wins; resending the same packet is naturally idempotent, so no receipt table is needed.
  rate(device: string, input: unknown) {
    const p = flashcardRateSchema.parse(input);
    const reject = (code: string) => ({
      v: 1,
      type: "flashcard.ack",
      request_id: p.request_id,
      accepted: false,
      code,
    });
    return this.db.transaction((): Row => {
      const d = one(
        this.db,
        "SELECT owner_teacher_id FROM devices WHERE id=? AND revoked=0",
        device,
      );
      if (!d) return reject("DEVICE_NOT_ASSIGNED");
      if (this.busy(device)) return reject("DEVICE_BUSY");
      const r = one(
        this.db,
        "SELECT * FROM flashcard_reviews WHERE id=? AND owner_teacher_id=?",
        p.review_id,
        d.owner_teacher_id,
      );
      if (!r || r.state !== "RUNNING") return reject("REVIEW_CLOSED");
      if (JSON.parse(r.queue)[r.current_index] !== p.card_id)
        return reject("CARD_CHANGED");
      this.db
        .prepare(
          "INSERT INTO flashcard_ratings VALUES (?,?,?,?,?,?) ON CONFLICT(review_id,round,card_id,device_id) DO UPDATE SET rating=excluded.rating,updated_at=excluded.updated_at",
        )
        .run(r.id, r.round, p.card_id, device, p.rating, this.now());
      return {
        v: 1,
        type: "flashcard.ack",
        request_id: p.request_id,
        accepted: true,
        card_id: p.card_id,
        rating: p.rating,
      };
    })();
  }
}
