CREATE TABLE room_pairing (
  session_id TEXT PRIMARY KEY REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE room_pairing_commands (
  session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY(session_id, command_id)
);
CREATE TABLE room_devices (
  session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  tested_at INTEGER,
  test_choice TEXT,
  PRIMARY KEY(session_id, device_id)
);
INSERT INTO room_devices(session_id,device_id,joined_at)
  SELECT session_id,device_id,min(created_at) FROM session_devices WHERE active=1 GROUP BY session_id,device_id;
CREATE TABLE room_join_receipts (
  request_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX room_devices_device ON room_devices(device_id);
