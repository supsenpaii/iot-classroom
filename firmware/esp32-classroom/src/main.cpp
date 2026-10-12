#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoWebsockets.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>

#include "device_config.h"

using namespace websockets;

constexpr unsigned long CONNECT_TIMEOUT_MS = 20000;
constexpr unsigned long RECONNECT_INTERVAL_MS = 10000;
constexpr unsigned long WIFI_CONNECTED_NOTICE_MS = 3000;
constexpr unsigned long BUTTON_DEBOUNCE_MS = 40;
constexpr unsigned long OLED_IDLE_TIMEOUT_MS = 60000;
constexpr size_t OLED_BUFFER_SIZE = 128 * 32 / 8;

// Theo thu tu chan tren ESP32-C3 trong anh:
// R4 -> GPIO21, R3 -> GPIO20, R2 -> GPIO10, R1 -> GPIO9
// C1 -> GPIO8,  C2 -> GPIO7,  C3 -> GPIO6,  C4 -> GPIO5
constexpr uint8_t ROW_PINS[4] = {9, 10, 20, 21};
constexpr uint8_t COLUMN_PINS[4] = {8, 7, 6, 5};

// Thu tu quet GPIO khac so S tren mach; mapping theo ket qua bam thuc te.
// '\b' = DELETE, '\n' = ENTER.
constexpr char KEY_MAP[16] = {
    'D', '\b', '0', '\n',  // S4, S8, S12, S16
    'C', '9', '8', '7',    // S3, S7, S11, S15
    'B', '6', '5', '4',    // S2, S6, S10, S14
    'A', '3', '2', '1'     // S1, S5, S9, S13
};

constexpr uint8_t OLED_SDA = 0;
constexpr uint8_t OLED_SCL = 1;
constexpr size_t MAX_INPUT_LENGTH = 10;
Adafruit_SSD1306 display(128, 32, &Wire, -1);
bool oledReady = false;
bool oledSleeping = false;
unsigned long lastOledActivityAt = 0;
uint8_t lastOledFrame[OLED_BUFFER_SIZE] = {};
bool oledFrameValid = false;
bool wifiConnecting = false;
bool wifiWasConnected = false;
unsigned long wifiConnectedAt = 0;
String inputText;
String roomCode;
String studentCode;
bool enteringRoom = true;
Preferences pairingStore;
String joinPayload;
unsigned long lastJoinAttempt = 0;
void connectToWebsite();
void connectToWiFi();
bool inputConfirmed = false;
String renameNotice;
unsigned long renameNoticeAt = 0;
void renderStatus();

void wakeOled() {
  lastOledActivityAt = millis();
  if (oledReady && oledSleeping) {
    display.ssd1306_command(SSD1306_DISPLAYON);
    oledSleeping = false;
  }
}

// Chi truyen frame moi qua I2C khi noi dung man hinh thay doi.
void presentOledFrame() {
  const uint8_t* frame = display.getBuffer();
  if (!oledFrameValid || memcmp(frame, lastOledFrame, OLED_BUFFER_SIZE) != 0) {
    display.display();
    memcpy(lastOledFrame, frame, OLED_BUFFER_SIZE);
    oledFrameValid = true;
  }
}

void updateWiFiStatus() {
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wifiWasConnected) {
    wifiConnectedAt = millis();
    Serial.printf("\nDa ket noi toi Wi-Fi: %s\n", WiFi.SSID().c_str());
    Serial.print("Dia chi IP: ");
    Serial.println(WiFi.localIP());
    Serial.printf("Cuong do song (RSSI): %d dBm\n", WiFi.RSSI());
  } else if (!connected && wifiWasConnected) {
    Serial.println("Mat ket noi Wi-Fi; dang tu ket noi lai...");
  }
  if (connected != wifiWasConnected) {
    wifiWasConnected = connected;
    wakeOled();
    renderStatus();
  }
}

void showInput(const char* status) {
  (void)status;
  renderStatus();
}

void setupOled() {
  Wire.begin(OLED_SDA, OLED_SCL);
  uint8_t address = 0;
  for (uint8_t candidate : {0x3C, 0x3D}) {
    Wire.beginTransmission(candidate);
    if (Wire.endTransmission() == 0) {
      address = candidate;
      break;
    }
  }
  // Wire da khoi tao voi dung chan; khong cho thu vien khoi tao lai.
  oledReady = address != 0 &&
      display.begin(SSD1306_SWITCHCAPVCC, address, true, false);
  if (!oledReady) {
    Serial.println("Khong khoi tao duoc OLED; kiem tra day va loai man hinh.");
    return;
  }
  wakeOled();
  showInput("READY");
}

unsigned long lastReconnectAttempt = 0;
uint8_t lastRawButton = 0;
uint8_t stableButton = 0;
unsigned long buttonChangedAt = 0;

WebsocketsClient webSocket;
bool webSocketConnected = false;
bool webSocketClientStarted = false;
bool webSocketConfigured = false;
unsigned long lastWebSocketConnectAttempt = 0;

String sessionId;
String questionId;
String bindingId;
String sessionState = "WAITING";
String questionStatus;
uint32_t answerSequence = 0;

String pendingRequestId;
String pendingPayload;
unsigned long pendingSentAt = 0;
char queuedChoice = '\0';
unsigned long lastHeartbeatAt = 0;

constexpr unsigned long ACK_RETRY_MS = 1200;
constexpr unsigned long APP_HEARTBEAT_MS = 4000;

bool snapshotReady = false;
bool resultReady = false, resultHasScore = false;
uint32_t resultCorrect = 0, resultTotal = 0;
float resultScore = 0;
String dismissedResultSession;
String dismissedResultBinding;
uint32_t totalQuestions = 0, secondsPerQuestion = 0, questionOrder = 0;
uint32_t countdownAtSnapshot = 0, snapshotReceivedAt = 0;
int64_t snapshotVersion = -1;
String answerNotice;
unsigned long lastDisplayAt = 0;

void updateOledPower() {
  if (!oledReady) return;
  // Giu man hinh sang khi mat Wi-Fi, dang thi hoac cho ACK dap an.
  if (WiFi.status() != WL_CONNECTED || sessionState == "RUNNING" ||
      !pendingRequestId.isEmpty()) {
    wakeOled();
  } else if (!oledSleeping && millis() - lastOledActivityAt >= OLED_IDLE_TIMEOUT_MS) {
    display.ssd1306_command(SSD1306_DISPLAYOFF);
    oledSleeping = true;
  }
}

uint32_t remainingMs() {
  if (questionStatus != "OPEN") return 0;
  if (sessionState == "PAUSED") return countdownAtSnapshot;
  if (sessionState != "RUNNING") return 0;
  const uint32_t elapsed = uint32_t(millis() - snapshotReceivedAt);
  return elapsed >= countdownAtSnapshot ? 0 : countdownAtSnapshot - elapsed;
}

bool canAnswer() {
  return WiFi.status() == WL_CONNECTED && webSocketConnected && snapshotReady &&
      sessionState == "RUNNING" && questionStatus == "OPEN" && remainingMs() > 0 &&
      !sessionId.isEmpty() && !questionId.isEmpty() && !bindingId.isEmpty();
}

void clearPending() {
  pendingRequestId = "";
  pendingPayload = "";
  queuedChoice = '\0';
}

void renderStatus() {
  if (!oledReady || oledSleeping) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setTextWrap(false);
  display.setCursor(0, 0);
  if (WiFi.status() == WL_CONNECTED && wifiWasConnected &&
      millis() - wifiConnectedAt < WIFI_CONNECTED_NOTICE_MS) {
    display.print("Connected");
    display.setCursor(0, 11);
    // Cho ten Wi-Fi dai xuong dong tren OLED 128x32.
    display.setTextWrap(true);
    display.print(WiFi.SSID());
    presentOledFrame();
    return;
  }
  if (WiFi.status() != WL_CONNECTED) display.print("CONNECTING WI-FI...");
  else if (!webSocketConnected || !snapshotReady || sessionState == "WAITING") {
    display.print("Connected ");
    display.print(WiFi.SSID());
  }
  else if (sessionState == "LOBBY") display.print("READY / WAITING");
  else if (sessionState == "PAUSED") display.print("PAUSED");
  else if (sessionState == "FINISHED") display.print("QUIZ COMPLETE");
  else if (sessionState == "CANCELLED") display.print("QUIZ CANCELLED");
  else display.print(questionStatus == "OPEN" ? "QUIZ IN PROGRESS" : "QUESTION CLOSED");
  const bool resultDismissed = sessionId == dismissedResultSession && bindingId == dismissedResultBinding;
  if (sessionState == "FINISHED" && resultReady && !resultDismissed && webSocketConnected && snapshotReady) {
    display.setCursor(0, 11);
    display.printf("Correct: %lu/%lu", (unsigned long)resultCorrect, (unsigned long)resultTotal);
    display.setCursor(0, 22);
    if (resultHasScore) display.printf("Score: %.2f/10", resultScore);
    else display.print("Score: --");
    presentOledFrame();
    return;
  }
  if (!renameNotice.isEmpty() && uint32_t(millis() - renameNoticeAt) < 5000) {
    display.setCursor(0, 11);
    display.print(renameNotice);
    display.setCursor(0, 22);
    display.print(renameNotice == "NOT ON THE LIST" ? "PLEASE RE-ENTER" : inputText);
    presentOledFrame();
    return;
  }
  display.setCursor(0, 11);
  if (snapshotReady && webSocketConnected) {
    if (sessionState == "RUNNING" || sessionState == "PAUSED") {
      if (!questionId.isEmpty()) display.printf("Q %lu/%lu  %lus", (unsigned long)questionOrder, (unsigned long)totalQuestions, (unsigned long)((remainingMs() + 999) / 1000));
      else display.print("WAITING FOR QUESTION");
    }
    else if (sessionState == "LOBBY") display.printf("%lu Q / %lu sec each", (unsigned long)totalQuestions, (unsigned long)secondsPerQuestion);
    else if (sessionState == "FINISHED" && resultDismissed) display.print(enteringRoom ? "ROOM ID + ENTER" : "STUDENT ID + ENTER");
    else if (!questionId.isEmpty()) display.printf("Q %lu/%lu  %lus", (unsigned long)questionOrder, (unsigned long)totalQuestions, (unsigned long)((remainingMs() + 999) / 1000));
    else display.print(enteringRoom ? "ROOM ID + ENTER" : "STUDENT ID + ENTER");
  } else {
    display.print(enteringRoom ? "ROOM ID + ENTER" : "STUDENT ID + ENTER");
  }
  display.setCursor(0, 22);
  display.print(answerNotice.isEmpty() ? inputText : answerNotice);
  presentOledFrame();
}

bool deviceConfigurationIsReady() {
  return String(DEVICE_ID) != "DIEN_DEVICE_ID_VAO_DAY" &&
         String(DEVICE_SECRET) != "DIEN_DEVICE_SECRET_VAO_DAY";
}

bool shouldKeepNetworkAlive() {
  return deviceConfigurationIsReady() &&
         (!joinPayload.isEmpty() || !studentCode.isEmpty() || webSocketClientStarted);
}

void sendJson(const JsonDocument& document) {
  String payload;
  serializeJson(document, payload);
  webSocket.send(payload);
}

void sendButtonTest(char choice) {
  JsonDocument document;
  document["v"] = 1;
  document["type"] = "button.test";
  document["choice"] = String(choice);
  sendJson(document);
  Serial.printf("Da gui thu nut %c len website.\n", choice);
}

void sendAnswer(char choice) {
  if (!canAnswer()) return;
  answerSequence++;
  answerNotice = "SENDING: " + String(choice);
  pendingRequestId = String(DEVICE_ID) + "-" + String((uint32_t)esp_random(), HEX) + "-" + String(millis()) + "-" +
                     String(answerSequence);

  JsonDocument document;
  document["v"] = 1;
  document["type"] = "answer.submit";
  document["request_id"] = pendingRequestId;
  document["session_id"] = sessionId;
  document["question_instance_id"] = questionId;
  document["binding_id"] = bindingId;
  document["seq"] = answerSequence;
  document["choice"] = String(choice);

  pendingPayload = "";
  serializeJson(document, pendingPayload);
  webSocket.send(pendingPayload);
  pendingSentAt = millis();
  Serial.printf("Da gui dap an %c, dang cho website xac nhan...\n", choice);
}

void handleChoice(char choice) {
  if (!webSocketConnected || !snapshotReady || WiFi.status() != WL_CONNECTED) {
    Serial.println("Website chua ket noi; chi hien nut tren Serial.");
    return;
  }

  if (canAnswer()) {
    if (!pendingRequestId.isEmpty()) {
      queuedChoice = choice;
      Serial.printf("Dang cho ACK; da ghi nho lua chon moi nhat: %c.\n", choice);
    } else {
      sendAnswer(choice);
    }
  } else if (sessionState == "LOBBY" || sessionState == "PAUSED" || sessionState == "WAITING") {
    sendButtonTest(choice);
  } else {
    answerNotice = "ANSWERING CLOSED";
  }
}

void showRenameNotice(const char* notice) {
  renameNotice = notice;
  renameNoticeAt = millis();
  wakeOled();
  renderStatus();
}

void requestStudentAgain() {
  enteringRoom = false;
  studentCode = "";
  inputText = "";
  inputConfirmed = false;
  showRenameNotice("NOT ON THE LIST");
}

// Persist the exact request before HTTP so retries survive a lost response/reboot.
void joinRoom() {
  if (WiFi.status() != WL_CONNECTED) { showRenameNotice("WI-FI OFFLINE"); return; }
  if (!deviceConfigurationIsReady()) { showRenameNotice("CONFIG DEVICE FIRST"); return; }
  if (lastJoinAttempt && millis() - lastJoinAttempt < 60000) {
    showRenameNotice("WAIT 60s THEN ENTER"); return;
  }
  if (joinPayload.isEmpty()) {
    if (roomCode.length() != 8) { showRenameNotice("ROOM NEEDS 8 DIGITS"); return; }
    if (studentCode.isEmpty()) { showRenameNotice("ENTER STUDENT ID"); return; }
    JsonDocument packet;
    packet["v"] = 1;
    packet["room_code"] = roomCode;
    packet["student_code"] = studentCode;
    packet["device_name"] = studentCode;
    packet["device_id"] = DEVICE_ID;
    packet["device_secret"] = DEVICE_SECRET;
    packet["request_id"] = String(DEVICE_ID) + "-" + String(esp_random(), HEX) + String(esp_random(), HEX);
    serializeJson(packet, joinPayload);
    if (pairingStore.putString("pending", joinPayload) != joinPayload.length()) {
      joinPayload = "";
      showRenameNotice("STORAGE ERROR"); return;
    }
  }
  showRenameNotice("JOINING ROOM...");
  lastJoinAttempt = millis();
  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(5000);
  http.begin(String("http://") + WS_HOST + ":" + String(WS_PORT) + "/api/device-pairing/join");
  http.addHeader("Content-Type", "application/json");
  const int status = http.POST(joinPayload);
  JsonDocument response;
  const auto error = deserializeJson(response, http.getString());
  http.end();
  if ((status == 200 || status == 201) && !error &&
      String(response["device_id"] | "") == String(DEVICE_ID)) {
    pairingStore.remove("pending");
    joinPayload = "";
    enteringRoom = false;
    inputText = "";
    inputConfirmed = false;
    lastJoinAttempt = 0;
    snapshotVersion = -1;
    snapshotReady = false;
    webSocket.close();
    webSocketClientStarted = false;
    showRenameNotice("JOINED / WAITING");
  } else if (status >= 400 && status < 500 && status != 408 && status != 429) {
    pairingStore.remove("pending");
    joinPayload = "";
    lastJoinAttempt = 0;
    const String code = response["code"] | "JOIN REJECTED";
    if (code == "STUDENT_UNAVAILABLE") { requestStudentAgain(); return; }
    if (code == "ROOM_UNAVAILABLE") {
      enteringRoom = true;
      inputText = roomCode;
      roomCode = "";
      studentCode = "";
      inputConfirmed = false;
    }
    const char* notice = (code == "STUDENT_ALREADY_BOUND" || code == "DUPLICATE_LABEL") ? "STUDENT IN USE" :
        code == "ROOM_UNAVAILABLE" ? "ROOM INVALID/EXPIRED" :
        code == "DEVICE_OWNER_MISMATCH" ? "WRONG TEACHER" :
        code == "DEVICE_BUSY" ? "LEAVE OLD ROOM FIRST" :
        code == "DEVICE_REVOKED" ? "CHECK DEVICE CONFIG" : "JOIN REJECTED";
    showRenameNotice(notice);
  } else {
    showRenameNotice("RETRY ENTER IN 60s");
  }
}

void confirmPairingInput() {
  if (inputText.isEmpty()) {
    showRenameNotice(enteringRoom ? "ENTER ROOM ID" : "ENTER STUDENT ID");
    return;
  }
  for (size_t i = 0; i < inputText.length(); i++) {
    if (inputText[i] < '0' || inputText[i] > '9') {
      showRenameNotice("DIGITS ONLY"); return;
    }
  }
  if (enteringRoom) {
    if (inputText.length() != 8) { showRenameNotice("ROOM NEEDS 8 DIGITS"); return; }
    roomCode = inputText;
    studentCode = "";
    enteringRoom = false;
    inputText = "";
    inputConfirmed = false;
    showRenameNotice("STUDENT ID + ENTER");
    return;
  }
  if (WiFi.status() != WL_CONNECTED) connectToWiFi();
  studentCode = inputText;
  joinRoom();
}

void handleKey(uint8_t button) {
  if (button == 0 || button > 16) return;
  wakeOled();
  const char key = KEY_MAP[button - 1];
  Serial.printf("S%u -> %s\n", button,
                key == '\b' ? "DELETE" : key == '\n' ? "ENTER" : String(key).c_str());
  if (sessionState == "RUNNING" || sessionState == "PAUSED") {
    if (key >= 'A' && key <= 'D') handleChoice(key);
    return;
  }
  if (sessionState == "FINISHED" && resultReady &&
      (sessionId != dismissedResultSession || bindingId != dismissedResultBinding)) {
    if (key == '\n') {
      dismissedResultSession = sessionId;
      dismissedResultBinding = bindingId;
      inputText = "";
      inputConfirmed = false;
      answerNotice = "";
      enteringRoom = true;
      roomCode = "";
      studentCode = "";
      showRenameNotice("ROOM ID + ENTER");
    }
    return;
  }
  if (!joinPayload.isEmpty()) {
    if (key == '\n') joinRoom();
    return;
  }
  if (key == '\b') {
    if (!enteringRoom && inputText.isEmpty()) {
      enteringRoom = true;
      inputText = roomCode;
      roomCode = "";
      studentCode = "";
      inputConfirmed = false;
      showRenameNotice("ROOM ID + ENTER");
      return;
    }
    inputConfirmed = false;
    if (!inputText.isEmpty()) inputText.remove(inputText.length() - 1);
    showRenameNotice(enteringRoom ? "ROOM ID + ENTER" : "STUDENT ID + ENTER");
  } else if (key == '\n') {
    confirmPairingInput();
  } else if (key >= 'A' && key <= 'D') {
    renameNotice = "";
    if (enteringRoom) return;
    showInput("SELECTED");
    handleChoice(key);
  } else {
    if (inputConfirmed) inputText = "";
    inputConfirmed = false;
    if (inputText.length() < (enteringRoom ? 8 : MAX_INPUT_LENGTH)) {
      inputText += key;
      showRenameNotice(enteringRoom ? "ROOM ID + ENTER" : "STUDENT ID + ENTER");
    } else {
      showRenameNotice(enteringRoom ? "ROOM NEEDS 8 DIGITS" : "MAX 10 DIGITS");
    }
  }
}

void handleWebSocketMessage(const String& payload) {
  JsonDocument document;
  const DeserializationError error = deserializeJson(document, payload);
  if (error) {
    Serial.println("Nhan du lieu website khong hop le.");
    return;
  }

  const char* type = document["type"] | "";

  if ((document["v"] | 0) != 1) return;
  if (strcmp(type, "device.connected") == 0) {
    Serial.println("May chu xac nhan: da ket noi ESP32.");
    renderStatus();
  } else if (strcmp(type, "session.snapshot") == 0) {
    if (!document["data"].is<JsonObject>()) return;
    JsonObject data = document["data"];
    const String nextSession = String(data["id"] | "");
    const String nextBinding = String(data["binding_id"] | "");
    const String nextQuestion = String(data["question"]["id"] | "");
    const int64_t version = data["state_version"] | int64_t(-1);
    if (snapshotReady && nextSession == sessionId && nextBinding == bindingId && version < snapshotVersion) return;
    const bool changed = nextSession != sessionId || nextBinding != bindingId || nextQuestion != questionId;
    const String nextState = String(data["state"] | "WAITING");
    const String nextQuestionStatus = String(data["question"]["status"] | "");
    if (changed || nextState != sessionState || nextQuestionStatus != questionStatus) wakeOled();
    if (changed) {
      clearPending();
      answerSequence = 0;
      answerNotice = "";
      inputText = "";
    }
    sessionId = nextSession;
    bindingId = nextBinding;
    questionId = nextQuestion;
    snapshotVersion = version;
    sessionState = nextState;
    if (sessionState == "RUNNING" || sessionState == "PAUSED") {
      enteringRoom = false;
      inputText = "";
      inputConfirmed = false;
      renameNotice = "";
    }
    questionStatus = nextQuestionStatus;
    resultReady = sessionState == "FINISHED" && data["result"].is<JsonObject>();
    resultCorrect = data["result"]["correct"] | 0U;
    resultTotal = data["result"]["total"] | 0U;
    resultHasScore = resultReady && !data["result"]["score"].isNull();
    resultScore = data["result"]["score"] | 0.0f;
    totalQuestions = data["total_questions"] | 0U;
    secondsPerQuestion = data["seconds_per_question"] | 0U;
    questionOrder = data["question"]["question_order"] | 0U;
    int64_t remaining = 0;
    if (questionStatus == "OPEN") {
      if (!data["question"]["countdown_ms"].isNull()) remaining = data["question"]["countdown_ms"].as<int64_t>();
      else if (sessionState == "PAUSED") remaining = data["question"]["remaining_ms"] | int64_t(0);
      else if (sessionState == "RUNNING") remaining = (data["question"]["deadline_at"] | int64_t(0)) - (data["server_time"] | int64_t(0));
    }
    countdownAtSnapshot = uint32_t(remaining < 0 ? 0 : remaining > 300000 ? 300000 : remaining);
    snapshotReceivedAt = millis();
    const uint32_t serverSequence = data["current_answer"]["seq"] | 0U;
    if (serverSequence > answerSequence) answerSequence = serverSequence;
    if (sessionState != "FINISHED" && pendingRequestId.isEmpty() && data["current_answer"].is<JsonObject>())
      answerNotice = "SAVED: " + String(data["current_answer"]["choice"] | "");
    snapshotReady = true;
    if (!canAnswer()) queuedChoice = '\0';
    Serial.printf("%s: %lu cau, %lu s/cau, cau %lu, con %lu ms\n", sessionState.c_str(), (unsigned long)totalQuestions, (unsigned long)secondsPerQuestion, (unsigned long)questionOrder, (unsigned long)remainingMs());
    renderStatus();
  } else if (strcmp(type, "answer.ack") == 0) {
    const String requestId = String(document["request_id"] | "");
    if (requestId == pendingRequestId) {
      const bool accepted = document["accepted"] | false;
      Serial.printf("Website da ACK dap an: %s.\n",
                    accepted ? "thanh cong" : "khong chap nhan");
      answerNotice = accepted ? "SAVED: " + String(document["choice"] | "") : "ANSWER REJECTED";
      pendingRequestId = "";
      pendingPayload = "";

      if (queuedChoice != '\0') {
        const char choice = queuedChoice;
        queuedChoice = '\0';
        if (canAnswer()) sendAnswer(choice);
      }
      renderStatus();
    }
  } else if (strcmp(type, "button.ack") == 0) {
    const bool assigned = document["assigned"] | false;
    Serial.printf("Website da nhan nut thu; thiet bi %s duoc ghep hoc sinh.\n",
                  assigned ? "da" : "chua");
  } else if (strcmp(type, "error") == 0) {
    Serial.printf("Website bao loi: %s\n", document["code"] | "UNKNOWN");
    // Keep the original packet for retry after transient server errors.
    answerNotice = "SERVER ERROR";
  }
}

void onWebSocketEvent(WebsocketsEvent event, String data) {
  switch (event) {
    case WebsocketsEvent::ConnectionOpened:
      webSocketConnected = true;
      snapshotReady = false;
      wakeOled();
      renderStatus();
      lastHeartbeatAt = millis();
      Serial.println("Da ket noi WebSocket voi website.");
      break;
    case WebsocketsEvent::ConnectionClosed:
      webSocketConnected = false;
      snapshotReady = false;
      queuedChoice = '\0';
      wakeOled();
      renderStatus();
      Serial.printf("Mat ket noi WebSocket%s%s; dang tu ket noi lai...\n",
                    data.isEmpty() ? "" : " (", data.isEmpty() ? "" : data.c_str());
      break;
    default:
      break;
  }
}

void connectToWebsite() {
  if (!deviceConfigurationIsReady()) {
    Serial.println("Chua dien DEVICE_ID va DEVICE_SECRET trong device_config.h.");
    return;
  }

  // addHeader appends; configuring again duplicates Origin/auth after a room join.
  if (!webSocketConfigured) {
    webSocket.addHeader("Authorization", String("Bearer ") + DEVICE_SECRET);
    webSocket.addHeader("X-Device-Id", DEVICE_ID);
    // ArduinoWebsockets tu them Origin cua GitHub. Ghi de bang dung origin cua
    // website de backend khong tu choi WebSocket handshake.
    webSocket.addHeader(
        "Origin", String("http://") + WS_HOST + ":" + String(WS_PORT));
    webSocket.onMessage([](WebsocketsMessage message) {
      handleWebSocketMessage(message.data());
    });
    webSocket.onEvent(onWebSocketEvent);
    webSocketConfigured = true;
  }
  webSocketClientStarted = true;
  lastWebSocketConnectAttempt = millis();
  const String url = String("ws://") + WS_HOST + ":" + WS_PORT + WS_PATH;
  const bool connected = webSocket.connect(url);
  Serial.printf("WebSocket %s: ws://%s:%u%s\n",
                connected ? "OK" : "FAILED", WS_HOST, WS_PORT, WS_PATH);
}

uint8_t readKeypad() {
  for (uint8_t row = 0; row < 4; row++) {
    // Chi keo mot hang xuong LOW tai mot thoi diem.
    for (uint8_t i = 0; i < 4; i++) {
      digitalWrite(ROW_PINS[i], HIGH);
    }
    digitalWrite(ROW_PINS[row], LOW);
    delayMicroseconds(5);

    for (uint8_t column = 0; column < 4; column++) {
      if (digitalRead(COLUMN_PINS[column]) == LOW) {
        // C1: 1-4, C2: 5-8, C3: 9-12, C4: 13-16.
        return column * 4 + row + 1;
      }
    }
  }

  return 0;
}

void updateKeypad() {
  const uint8_t rawButton = readKeypad();

  if (rawButton != lastRawButton) {
    lastRawButton = rawButton;
    buttonChangedAt = millis();
  }

  if (millis() - buttonChangedAt >= BUTTON_DEBOUNCE_MS &&
      rawButton != stableButton) {
    stableButton = rawButton;

    if (stableButton != 0) {
      handleKey(stableButton);
    }
  }
}

void connectToWiFi() {
  if (wifiConnecting || WiFi.status() == WL_CONNECTED) return;
  wifiConnecting = true;
  Serial.printf("\nDang ket noi toi Wi-Fi: %s\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  // MIN_MODEM: tiet kiem dien giua cac lan truyen, van giu ket noi Wi-Fi.
  WiFi.setSleep(true);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - startedAt < CONNECT_TIMEOUT_MS) {
    const unsigned long waitStartedAt = millis();
    while (millis() - waitStartedAt < 500) {
      updateKeypad();
      delay(5);
    }
    Serial.print('.');
  }

  wifiConnecting = false;
  lastReconnectAttempt = millis();
  updateWiFiStatus();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nKet noi that bai. Se tu thu lai sau 10 giay.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  if (!pairingStore.begin("room-pairing", false)) {
    Serial.println("Khong mo duoc NVS de luu yeu cau ghep phong.");
  } else if (pairingStore.isKey("pending")) {
    joinPayload = pairingStore.getString("pending", "");
  }
  if (!joinPayload.isEmpty()) {
    JsonDocument packet;
    if (!deserializeJson(packet, joinPayload)) {
      enteringRoom = false;
      roomCode = String(packet["room_code"] | "");
      studentCode = String(packet["student_code"] | "");
      inputText = studentCode;
    }
  }
  setupOled();

  for (uint8_t row = 0; row < 4; row++) {
    pinMode(ROW_PINS[row], OUTPUT);
    digitalWrite(ROW_PINS[row], HIGH);
  }

  for (uint8_t column = 0; column < 4; column++) {
    pinMode(COLUMN_PINS[column], INPUT_PULLUP);
  }

  connectToWiFi();
  Serial.println("San sang. Hay nhan mot nut tu 1 den 16.");
}

void loop() {
  updateWiFiStatus();
  if (WiFi.status() != WL_CONNECTED &&
      millis() - lastReconnectAttempt >= RECONNECT_INTERVAL_MS) {
    lastReconnectAttempt = millis();
    Serial.println("Mat ket noi Wi-Fi, dang thu ket noi lai...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  if (shouldKeepNetworkAlive() && deviceConfigurationIsReady() && WiFi.status() == WL_CONNECTED &&
      !webSocketClientStarted) {
    connectToWebsite();
  }

  if (webSocketClientStarted) {
    webSocket.poll();

    if (!webSocketConnected && WiFi.status() == WL_CONNECTED &&
        millis() - lastWebSocketConnectAttempt >= 2000) {
      lastWebSocketConnectAttempt = millis();
      const String url = String("ws://") + WS_HOST + ":" + WS_PORT + WS_PATH;
      const bool connected = webSocket.connect(url);
      Serial.printf("WebSocket reconnect: %s\n", connected ? "OK" : "FAILED");
    }

    if (webSocketConnected &&
        millis() - lastHeartbeatAt >= APP_HEARTBEAT_MS) {
      JsonDocument heartbeat;
      heartbeat["v"] = 1;
      heartbeat["type"] = "heartbeat";
      sendJson(heartbeat);
      lastHeartbeatAt = millis();
    }

    if (!pendingRequestId.isEmpty() && webSocketConnected && snapshotReady &&
        millis() - pendingSentAt >= ACK_RETRY_MS) {
      webSocket.send(pendingPayload);
      pendingSentAt = millis();
      Serial.println("Chua co ACK; dang gui lai cung mot goi...");
    }
  }

  updateKeypad();
  updateOledPower();
  if (millis() - lastDisplayAt >= 100) {
    lastDisplayAt = millis();
    renderStatus();
  }

  delay(5);
}
