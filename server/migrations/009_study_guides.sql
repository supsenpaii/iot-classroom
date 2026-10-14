-- Saved AI study guides: one per student per session, so reopening never calls the AI again.
-- Rows disappear with their session/student and when a question is voided (the report changed).
CREATE TABLE study_guides(
  session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES session_students(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'vi',
  created_at INTEGER NOT NULL,
  PRIMARY KEY(session_id,student_id)
);
