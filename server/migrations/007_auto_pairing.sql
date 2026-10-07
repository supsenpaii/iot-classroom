ALTER TABLE room_pairing ADD COLUMN auto_assign INTEGER NOT NULL DEFAULT 0 CHECK(auto_assign IN (0,1));
