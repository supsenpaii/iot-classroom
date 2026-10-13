-- A display survives flips/reconnects, but never a next/prev/repeat command.
ALTER TABLE flashcard_reviews ADD COLUMN display_id TEXT NOT NULL DEFAULT '';
UPDATE flashcard_reviews SET display_id=lower(hex(randomblob(16)));

-- Keep receipts separate from ratings: later choices must not erase earlier ACKs.
-- Request identities are scoped to the device, including across review sessions.
CREATE TABLE flashcard_receipts(
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES flashcard_reviews(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  ack TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(device_id,request_id)
);
CREATE INDEX flashcard_receipts_review ON flashcard_receipts(review_id);
