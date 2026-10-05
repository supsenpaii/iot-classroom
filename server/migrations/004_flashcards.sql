CREATE TABLE flashcard_decks(id TEXT PRIMARY KEY,owner_teacher_id TEXT NOT NULL REFERENCES teachers(id),name TEXT NOT NULL,subject TEXT NOT NULL DEFAULT '',share_token TEXT UNIQUE,created_at INTEGER NOT NULL);
CREATE TABLE flashcards(id TEXT PRIMARY KEY,deck_id TEXT NOT NULL REFERENCES flashcard_decks(id),position INTEGER NOT NULL,front TEXT NOT NULL,back TEXT NOT NULL);
CREATE INDEX flashcards_deck ON flashcards(deck_id,position);
-- A class review keeps its own copy of the cards so editing the deck never changes a review in progress.
CREATE TABLE flashcard_reviews(id TEXT PRIMARY KEY,owner_teacher_id TEXT NOT NULL REFERENCES teachers(id),deck_id TEXT NOT NULL REFERENCES flashcard_decks(id),deck_name TEXT NOT NULL,cards TEXT NOT NULL,queue TEXT NOT NULL,round INTEGER NOT NULL DEFAULT 1,current_index INTEGER NOT NULL DEFAULT 0,side TEXT NOT NULL DEFAULT 'front',state TEXT NOT NULL DEFAULT 'RUNNING',state_version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,finished_at INTEGER);
CREATE UNIQUE INDEX one_running_review ON flashcard_reviews(owner_teacher_id) WHERE state='RUNNING';
CREATE INDEX flashcard_reviews_deck ON flashcard_reviews(deck_id);
CREATE TABLE flashcard_ratings(review_id TEXT NOT NULL REFERENCES flashcard_reviews(id),round INTEGER NOT NULL,card_id TEXT NOT NULL,device_id TEXT NOT NULL REFERENCES devices(id),rating TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(review_id,round,card_id,device_id));
