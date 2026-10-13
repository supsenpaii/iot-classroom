String answerPayload(uint32_t sequence = 1, const char* choice = "A", const char* request = "original-request") {
  JsonDocument packet;
  packet["v"] = 1; packet["type"] = "answer.submit"; packet["request_id"] = request;
  packet["session_id"] = "session"; packet["binding_id"] = "binding";
  packet["question_instance_id"] = "q"; packet["seq"] = sequence; packet["choice"] = choice;
  String payload; serializeJson(packet, payload); return payload;
}
void storedAnswer(const String& payload, const char* device = DEVICE_ID) {
  JsonDocument record; record["v"] = 1; record["device_id"] = device; record["payload"] = payload;
  String saved; serializeJson(record, saved); pairingStore.values["answer"] = saved;
}
void reboot() {
  const auto nvs = pairingStore.values;
  reset(); pairingStore.values = nvs;
  snapshotReady = false; webSocketConnected = false; pendingAnswerValidated = false;
  sessionId = ""; bindingId = ""; questionId = ""; answerSequence = 0;
  loadRecoveryState();
}
void serverSnapshot(const char* state = "RUNNING", const char* session = "session", const char* binding = "binding",
    const char* question = "q", uint32_t sequence = 0, const char* choice = "A", const char* mode = "quiz") {
  JsonDocument doc; doc["v"] = 1; doc["type"] = "session.snapshot";
  auto data = doc["data"].to<JsonObject>();
  data["id"] = session; data["binding_id"] = binding; data["state"] = state; data["state_version"] = 1;
  data["mode"] = mode; data["total_questions"] = 10; data["seconds_per_question"] = 15; data["server_time"] = 100000;
  if (strlen(question)) {
    auto q = data["question"].to<JsonObject>();
    q["id"] = question; q["status"] = strcmp(state, "FINISHED") == 0 ? "CLOSED" : "OPEN";
    q["question_order"] = 1; q["deadline_at"] = 110000; q["remaining_ms"] = 10000;
  }
  if (sequence) { data["current_answer"]["seq"] = sequence; data["current_answer"]["choice"] = choice; }
  if (strcmp(state, "FINISHED") == 0) {
    data["result"]["correct"] = 8; data["result"]["total"] = 10; data["result"]["score"] = 8;
  }
  String payload; serializeJson(doc, payload); handleWebSocketMessage(payload); tick();
}
void activeExam() {
  sessionState = "RUNNING"; questionId = "q"; questionStatus = "OPEN";
  countdownAtSnapshot = 10000; snapshotReceivedAt = fakeNow; tick();
}
int main() {
  test("boot with no MSSV or pending join must connect to recover the server binding", [] {
    studentCode = ""; joinPayload = ""; webSocketClientStarted = false;
    assert(shouldKeepNetworkAlive());
  });
  test("boot authenticates with existing credentials and no HTTP join", [] {
    reboot(); assert(shouldKeepNetworkAlive()); assert(!canAnswer()); connectToWebsite();
    assert(webSocketClientStarted && webSocket.connects == 1 && !snapshotReady);
    assert(webSocket.headers.size() == 3 && joins == 0);
    assert(webSocket.headers[0] == std::make_pair(std::string("Authorization"), std::string("Bearer fixture-secret")));
    assert(webSocket.headers[1] == std::make_pair(std::string("X-Device-Id"), std::string(DEVICE_ID)));
  });
  for (const char* state : {"LOBBY", "WAITING", "RUNNING", "PAUSED", "FINISHED"}) {
    test(state, [state] {
      reboot(); connectToWebsite();
      const bool bound = strcmp(state, "WAITING") != 0;
      serverSnapshot(state, bound ? "session" : "", bound ? "binding" : "",
          (strcmp(state, "LOBBY") == 0 || !bound) ? "" : "q");
      assert(sessionState == state && snapshotReady && !bootRecoveryPending && joins == 0);
      assert(bound ? !enteringRoom : enteringRoom);
      assert(canAnswer() == (strcmp(state, "RUNNING") == 0));
      if (strcmp(state, "FINISHED") == 0) assert(resultReady && resultScore == 8.0f);
    });
  }
  test("a pending join remains exact and boot does not submit it automatically", [] {
    const std::string pending = R"({"room_code":"12345678","student_code":"001","request_id":"join-once"})";
    pairingStore.values["pending"] = pending; reboot(); connectToWebsite();
    assert(joinPayload == pending && studentCode == "001" && joins == 0);
    serverSnapshot("LOBBY", "session", "binding", ""); assert(joins == 0);
    assert(pairingStore.values["pending"] == pending);
  });
  test("NVS candidate grants no binding or answer permission before server snapshot", [] {
    storedAnswer(answerPayload()); reboot();
    assert(!pendingRecoveryPayload.isEmpty() && pendingRequestId.isEmpty() && pendingPayload.isEmpty());
    assert(sessionId.isEmpty() && bindingId.isEmpty() && !canAnswer());
    connectToWebsite(); fakeNow += 5000; retryPendingAnswer(); assert(webSocket.sent.empty());
  });
  test("answer is persisted before its first transmission", [] {
    activeExam(); handleKey(13); assert(answers == 1 && pairingStore.writes == 1);
    assert(webSocket.durableAtSend[0]);
    JsonDocument record; deserializeJson(record, pairingStore.values["answer"]);
    assert(std::string(record["device_id"].as<const char*>()) == DEVICE_ID);
    assert(std::string(record["payload"].as<const char*>()) == pendingPayload);
    assert(pendingPayload == webSocket.sent.back() && pendingAnswerValidated);
  });
  test("reboot restores matching pending packet and retries the same request/sequence/bytes", [] {
    const String original = answerPayload(7); storedAnswer(original); reboot(); connectToWebsite();
    serverSnapshot(); assert(pendingAnswerValidated && pendingRequestId == "original-request" && answerSequence == 7);
    assert(answers == 0); fakeNow += ACK_RETRY_MS; retryPendingAnswer();
    assert(answers == 1 && webSocket.sent.back() == original && pendingPayload == original);
    const int writes = pairingStore.writes; fakeNow += ACK_RETRY_MS; retryPendingAnswer();
    assert(answers == 2 && webSocket.sent.back() == original && pairingStore.writes == writes);
  });
  test("ACK removes only answer record and next boot cannot retry it", [] {
    pairingStore.values["sentinel"] = "preserve"; storedAnswer(answerPayload()); reboot(); connectToWebsite(); serverSnapshot();
    packet(R"({"v":1,"type":"answer.ack","request_id":"original-request","accepted":true,"choice":"A"})");
    assert(!pairingStore.isKey("answer") && pendingPayload.isEmpty() && !pendingAnswerValidated);
    assert(pairingStore.values["sentinel"] == "preserve"); reboot(); assert(pendingRecoveryPayload.isEmpty());
  });
  test("rejected ACK also resolves pending record without changing binding", [] {
    storedAnswer(answerPayload()); reboot(); connectToWebsite(); serverSnapshot();
    packet(R"({"v":1,"type":"answer.ack","request_id":"original-request","accepted":false,"code":"QUESTION_CLOSED"})");
    assert(!pairingStore.isKey("answer") && pendingPayload.isEmpty() && bindingId == "binding");
  });
  test("early ACK cannot discard candidate before server verification", [] {
    storedAnswer(answerPayload()); reboot(); connectToWebsite();
    packet(R"({"v":1,"type":"answer.ack","request_id":"original-request","accepted":true,"choice":"A"})");
    assert(!pendingRecoveryPayload.isEmpty() && pairingStore.isKey("answer"));
    serverSnapshot(); assert(pendingAnswerValidated);
  });
  for (const char* mismatch : {"session", "binding", "question", "unassigned", "mode", "cancelled"}) {
    test(mismatch, [mismatch] {
      storedAnswer(answerPayload()); reboot(); connectToWebsite();
      const std::string field(mismatch);
      serverSnapshot(field == "cancelled" ? "CANCELLED" : "RUNNING",
        field == "session" ? "new-session" : "session", field == "binding" ? "new-binding" : field == "unassigned" ? "" : "binding",
        field == "question" ? "new-q" : "q", 0, "A", field == "mode" ? "flashcard" : "quiz");
      fakeNow += ACK_RETRY_MS; retryPendingAnswer();
      assert(answers == 0 && pendingPayload.isEmpty() && pendingRecoveryPayload.isEmpty());
      assert(!pairingStore.isKey("answer"));
    });
  }
  test("newer authoritative sequence supersedes recovered old packet", [] {
    storedAnswer(answerPayload(2)); reboot(); connectToWebsite(); serverSnapshot("RUNNING", "session", "binding", "q", 3, "B");
    assert(pendingPayload.isEmpty() && answerSequence == 3 && answerNotice == "SAVED: B");
    handleKey(1); JsonDocument sent; deserializeJson(sent, webSocket.sent.back()); assert(sent["seq"].as<int>() == 4);
  });
  test("same sequence with different authoritative choice invalidates the candidate", [] {
    storedAnswer(answerPayload()); reboot(); connectToWebsite(); serverSnapshot("RUNNING", "session", "binding", "q", 1, "B");
    assert(pendingPayload.isEmpty() && answerNotice == "SAVED: B");
  });
  test("matching accepted answer keeps the exact request to recover a lost ACK", [] {
    storedAnswer(answerPayload(4)); reboot(); connectToWebsite(); serverSnapshot("RUNNING", "session", "binding", "q", 4);
    fakeNow += ACK_RETRY_MS; retryPendingAnswer(); assert(answers == 1 && answerSequence == 4);
    packet(R"({"v":1,"type":"answer.ack","request_id":"original-request","accepted":true,"duplicate":true,"choice":"A"})");
    assert(pendingPayload.isEmpty() && answerSequence == 4);
  });
  test("server restart/PAUSED holds pending safely until RUNNING resumes", [] {
    storedAnswer(answerPayload(2)); reboot(); connectToWebsite(); serverSnapshot("PAUSED");
    fakeNow += 60000; retryPendingAnswer(); assert(answers == 0 && pendingAnswerValidated && pairingStore.isKey("answer"));
    serverSnapshot(); retryPendingAnswer(); assert(answers == 1 && webSocket.sent.back() == answerPayload(2));
  });
  test("FINISHED can recover the exact lost-ACK request without entering a new session", [] {
    storedAnswer(answerPayload()); reboot(); connectToWebsite(); serverSnapshot("FINISHED");
    fakeNow += ACK_RETRY_MS; retryPendingAnswer(); assert(answers == 1 && resultReady && resultScore == 8.0f);
    assert(sessionId == "session" && joins == 0);
  });
  test("disconnect invalidates retry permission until a fresh snapshot", [] {
    activeExam(); handleKey(13); const String sent = pendingPayload;
    onWebSocketEvent(WebsocketsEvent::ConnectionClosed, "");
    assert(!snapshotReady && !pendingAnswerValidated && pendingPayload == sent);
    onWebSocketEvent(WebsocketsEvent::ConnectionOpened, ""); fakeNow += ACK_RETRY_MS; retryPendingAnswer(); assert(answers == 1);
    serverSnapshot(); retryPendingAnswer(); assert(answers == 2 && webSocket.sent.back() == sent);
  });
  test("Wi-Fi disconnect cannot use cached snapshot to retry", [] {
    activeExam(); handleKey(13); WiFi.connected = false; invalidateServerSnapshot(); fakeNow += ACK_RETRY_MS;
    retryPendingAnswer(); assert(answers == 1 && !canAnswer()); WiFi.connected = true;
    retryPendingAnswer(); assert(answers == 1); serverSnapshot(); retryPendingAnswer(); assert(answers == 2);
  });
  test("revoked binding snapshot disables pending and cannot regain answer rights", [] {
    storedAnswer(answerPayload()); reboot(); connectToWebsite(); serverSnapshot("WAITING", "", "", "");
    assert(!canAnswer() && pendingPayload.isEmpty()); handleKey(13); assert(answers == 0);
  });
  test("NVS write failure stops unsaved answer transmission", [] {
    activeExam(); pairingStore.failWrite = true; handleKey(13);
    assert(answers == 0 && pendingPayload.isEmpty() && answerNotice == "SERVER ERROR");
    pairingStore.failWrite = false; handleKey(13); assert(answers == 1 && pairingStore.isKey("answer"));
  });
  test("NVS begin failure still probes server but prevents unsaved answers", [] {
    pairingStore.ready = false; loadRecoveryState(); assert(!pairingStoreReady && shouldKeepNetworkAlive());
    activeExam(); handleKey(13); assert(answers == 0 && answerNotice == "SERVER ERROR");
  });
  test("NVS erase failure cannot cause repeated retries in the current boot", [] {
    storedAnswer(answerPayload()); reboot(); connectToWebsite(); serverSnapshot(); pairingStore.failRemove = true;
    packet(R"({"v":1,"type":"answer.ack","request_id":"original-request","accepted":true,"choice":"A"})");
    fakeNow += ACK_RETRY_MS; retryPendingAnswer(); assert(answers == 0 && pendingPayload.isEmpty());
    assert(pairingStore.isKey("answer"));
  });
  for (const char* bad : {"not-json", "{}", "null", R"({"v":2,"device_id":"TEST-BOARD","payload":"{}"})"}) {
    test("invalid NVS envelope grants no permissions", [bad] {
      pairingStore.values["answer"] = bad; reboot();
      assert(pendingRecoveryPayload.isEmpty() && !pairingStore.isKey("answer") && !canAnswer());
    });
  }
  test("oversized NVS value is bounded and discarded without touching other keys", [] {
    pairingStore.values["answer"] = std::string(MAX_ANSWER_RECORD_BYTES + 10, 'X'); pairingStore.values["other"] = "safe";
    reboot(); assert(pendingRecoveryPayload.isEmpty() && pairingStore.values["other"] == "safe");
  });
  test("NVS payload from a different device is not replayed", [] {
    storedAnswer(answerPayload(), "different-device"); reboot(); assert(pendingRecoveryPayload.isEmpty());
  });
  for (const String& invalid : {answerPayload(0), answerPayload(2147483648U), answerPayload(1, "E"), answerPayload(1, "AB"), answerPayload(1, "A", "")}) {
    test("invalid stored answer schema is rejected", [invalid] {
      storedAnswer(invalid); reboot(); assert(pendingRecoveryPayload.isEmpty() && !pairingStore.isKey("answer"));
    });
  }
  test("sequence limit and corrupt extra fields cannot be coerced into valid packets", [] {
    JsonDocument packet; deserializeJson(packet, answerPayload()); packet["seq"] = "1";
    String payload; serializeJson(packet, payload); storedAnswer(payload); reboot(); assert(pendingRecoveryPayload.isEmpty());
    deserializeJson(packet, answerPayload()); packet["extra"] = "no"; payload = "";
    serializeJson(packet, payload); storedAnswer(payload); reboot(); assert(pendingRecoveryPayload.isEmpty());
  });
  test("recovered maximum sequence never generates an out-of-range new packet", [] {
    storedAnswer(answerPayload(2147483647U)); reboot(); connectToWebsite(); serverSnapshot();
    assert(answerSequence == 2147483647U && pendingAnswerValidated);
    packet(R"({"v":1,"type":"answer.ack","request_id":"original-request","accepted":true,"choice":"A"})");
    handleKey(13); assert(answers == 0 && answerNotice == "ANSWER REJECTED");
  });
  std::cout << tests << "/" << tests << " firmware reboot recovery scenarios PASS\n";
}
