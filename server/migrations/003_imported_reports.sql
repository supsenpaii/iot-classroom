ALTER TABLE quiz_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'LIVE';

CREATE TABLE answers_new(
  session_question_id TEXT NOT NULL REFERENCES session_questions(id),
  session_student_id TEXT NOT NULL REFERENCES session_students(id),
  binding_id TEXT REFERENCES session_devices(id),
  choice TEXT NOT NULL,
  seq INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  response_ms INTEGER NOT NULL,
  PRIMARY KEY(session_question_id,session_student_id)
);
INSERT INTO answers_new SELECT * FROM answers;
DROP TABLE answers;
ALTER TABLE answers_new RENAME TO answers;
