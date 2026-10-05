-- Default device per student, kept outside `students` because existing inserts use positional VALUES.
CREATE TABLE student_devices(student_id TEXT PRIMARY KEY REFERENCES students(id),device_id TEXT NOT NULL REFERENCES devices(id));
CREATE INDEX student_devices_device ON student_devices(device_id);
CREATE TABLE polls(id TEXT PRIMARY KEY,owner_teacher_id TEXT NOT NULL REFERENCES teachers(id),question TEXT NOT NULL,options TEXT NOT NULL,hide_results INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'RUNNING',state_version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,closed_at INTEGER);
CREATE UNIQUE INDEX one_running_poll ON polls(owner_teacher_id) WHERE state='RUNNING';
-- Votes are anonymous to everyone but the de-duplication key: one vote per device, last one wins.
CREATE TABLE poll_votes(poll_id TEXT NOT NULL REFERENCES polls(id),device_id TEXT NOT NULL REFERENCES devices(id),choice TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(poll_id,device_id));
CREATE TABLE attendance_sessions(id TEXT PRIMARY KEY,owner_teacher_id TEXT NOT NULL REFERENCES teachers(id),class_id TEXT NOT NULL REFERENCES classes(id),class_name TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'OPEN',state_version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,closed_at INTEGER);
CREATE UNIQUE INDEX one_open_attendance ON attendance_sessions(owner_teacher_id) WHERE state='OPEN';
-- Roster is frozen when the check-in opens, so later class edits do not rewrite history.
CREATE TABLE attendance_marks(attendance_id TEXT NOT NULL REFERENCES attendance_sessions(id),student_id TEXT NOT NULL,student_code TEXT NOT NULL,full_name TEXT NOT NULL,device_id TEXT,status TEXT NOT NULL DEFAULT 'ABSENT',method TEXT,marked_at INTEGER,PRIMARY KEY(attendance_id,student_id));
CREATE INDEX attendance_marks_device ON attendance_marks(device_id);
