#include <cassert>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <functional>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
#include <ArduinoJson.h>
#include "oled_power.h"

struct String : std::string {
  using std::string::string;
  using std::string::operator=;
  String() = default;
  String(const std::string& value) : std::string(value) {}
  String(char value) : std::string(1, value) {}
  String(uint32_t value, int base = 10) {
    std::ostringstream text;
    if (base == 16) text << std::hex;
    text << value; assign(text.str());
  }
  String(int value) : std::string(std::to_string(value)) {}
  bool isEmpty() const { return empty(); }
  void remove(size_t index) { erase(index); }
};
String operator+(const std::string& value, int number) { return value + std::to_string(number); }
size_t serializeJson(const JsonDocument& document, String& output) {
  return ArduinoJson::serializeJson(document, static_cast<std::string&>(output));
}
struct SerialFake {
  template <typename... Args> void printf(const char*, Args...) {}
  void println(const char*) {}
} Serial;
constexpr int WL_CONNECTED = 3, SSD1306_DISPLAYON = 0xaf, SSD1306_DISPLAYOFF = 0xae, SSD1306_WHITE = 1;
constexpr int HEX = 16;
constexpr const char* DEVICE_ID = "TEST-BOARD";
constexpr const char* DEVICE_SECRET = "fixture-secret";
constexpr const char* WS_HOST = "fixture.invalid";
constexpr int WS_PORT = 3000;
constexpr const char* WS_PATH = "/ws";
uint32_t esp_random() { return 42; }
constexpr size_t OLED_BUFFER_SIZE = 512, MAX_INPUT_LENGTH = 10;
constexpr uint32_t WIFI_CONNECTED_NOTICE_MS = 3000;
constexpr char KEY_MAP[16] = {'D', '\b', '0', '\n', 'C', '9', '8', '7', 'B', '6', '5', '4', 'A', '3', '2', '1'};
uint32_t fakeNow = 0;
uint32_t millis() { return fakeNow; }
struct PreferencesFake {
  std::map<std::string, std::string> values;
  bool ready = true, failWrite = false, failRemove = false;
  int writes = 0, removes = 0;
  bool begin(const char*, bool) { return ready; }
  bool isKey(const char* key) { return values.count(key); }
  bool remove(const char* key) {
    if (!ready || failRemove) return false;
    removes++; values.erase(key); return true;
  }
  size_t putString(const char* key, const String& value) {
    if (!ready || failWrite) return 0;
    writes++; values[key] = value; return value.length();
  }
  String getString(const char* key, const char* fallback) {
    return values.count(key) ? String(values[key]) : String(fallback);
  }
  size_t getString(const char* key, char* out, size_t size) {
    if (!ready || !values.count(key) || values[key].length() + 1 > size) return 0;
    strcpy(out, values[key].c_str()); return values[key].length();
  }
} pairingStore;
bool pairingStoreReady = true, bootRecoveryPending = true, pendingAnswerValidated = true;
String pendingRecoveryPayload;
constexpr size_t MAX_ANSWER_RECORD_BYTES = 1024;
constexpr uint32_t ACK_RETRY_MS = 1200;
struct WiFiFake {
  bool connected = true;
  int status() const { return connected ? WL_CONNECTED : 0; }
  String SSID() const { return "Classroom network with a long SSID"; }
} WiFi;
struct DisplayFake {
  int clears = 0, transfers = 0;
  std::vector<int> commands;
  std::string frame;
  uint8_t buffer[OLED_BUFFER_SIZE] = {};
  void clearDisplay() { clears++; frame.clear(); }
  void setTextColor(int value) { frame += "color:" + std::to_string(value) + ";"; }
  void setTextSize(int value) { frame += "size:" + std::to_string(value) + ";"; }
  void setTextWrap(bool value) { frame += value ? "wrap:1;" : "wrap:0;"; }
  void setCursor(int x, int y) { frame += "cursor:" + std::to_string(x) + "," + std::to_string(y) + ";"; }
  void print(const std::string& value) { frame += value; }
  void print(const char* value) { frame += value; }
  void printf(const char* format, ...) {
    char text[256]; va_list args; va_start(args, format);
    vsnprintf(text, sizeof(text), format, args); va_end(args); frame += text;
  }
  const uint8_t* getBuffer() {
    memset(buffer, 0, sizeof(buffer));
    memcpy(buffer, frame.data(), frame.size() < sizeof(buffer) ? frame.size() : sizeof(buffer));
    return buffer;
  }
  void display() { transfers++; }
  void ssd1306_command(int value) { commands.push_back(value); }
} display;
bool oledReady = true, oledFrameValid = false;
OledPower oledPower;
uint8_t lastOledFrame[OLED_BUFFER_SIZE] = {};
bool wifiWasConnected = true, webSocketConnected = true, webSocketClientStarted = false;
bool snapshotReady = true, resultReady = false, resultHasScore = false;
bool enteringRoom = true, inputConfirmed = false;
uint32_t wifiConnectedAt = 0, renameNoticeAt = 0, countdownAtSnapshot = 0, snapshotReceivedAt = 0;
uint32_t lastDisplayedSeconds = UINT32_MAX, resultCorrect = 0, resultTotal = 0;
uint32_t totalQuestions = 10, secondsPerQuestion = 15, questionOrder = 1, answerSequence = 0;
uint32_t lastHeartbeatAt = 0;
uint32_t pendingSentAt = 0;
float resultScore = 0;
int64_t snapshotVersion = -1;
bool lastWifiNoticeVisible = false, lastRenameNoticeVisible = false;
String inputText, roomCode, studentCode, joinPayload, renameNotice, answerNotice;
String sessionId, bindingId, questionId, sessionState = "WAITING", questionStatus;
String dismissedResultSession, dismissedResultBinding, pendingRequestId, pendingPayload;
char queuedChoice = '\0';
int choices = 0, joins = 0, confirms = 0, answers = 0;
enum class WebsocketsEvent { ConnectionOpened, ConnectionClosed, GotPing };
struct WebsocketsMessage { String data() const { return ""; } };
bool webSocketConfigured = false;
uint32_t lastWebSocketConnectAttempt = 0;
struct WebSocketFake {
  std::vector<std::string> sent;
  std::vector<bool> durableAtSend;
  std::vector<std::pair<std::string, std::string>> headers;
  std::function<void(WebsocketsEvent, String)> event;
  int connects = 0;
  bool connectResult = true;
  void addHeader(const char* name, const String& value) { headers.emplace_back(name, value); }
  template <typename T> void onMessage(T) {}
  void onEvent(void (*callback)(WebsocketsEvent, String)) { event = callback; }
  bool connect(const String&) {
    connects++;
    if (connectResult && event) event(WebsocketsEvent::ConnectionOpened, "");
    return connectResult;
  }
  void send(const String& payload) {
    sent.push_back(payload);
    if (payload.find("answer.submit") != std::string::npos) {
      JsonDocument record;
      deserializeJson(record, pairingStore.values["answer"]);
      durableAtSend.push_back(String(record["payload"] | "") == payload);
      answers++;
    }
    if (payload.find("button.test") != std::string::npos) choices++;
  }
} webSocket;
void joinRoom() { joins++; }
void confirmPairingInput() { confirms++; }
void connectToWiFi() {}
void renderStatus();
void updateOledDisplay();

// FIRMWARE_FUNCTIONS

void reset() {
  fakeNow = 10000; display = DisplayFake{}; oledPower = OledPower{};
  oledReady = true; oledFrameValid = false; WiFi.connected = true;
  wifiWasConnected = true; webSocketConnected = true; snapshotReady = true;
  webSocketClientStarted = false; wifiConnectedAt = 0; renameNoticeAt = 0;
  inputText = ""; roomCode = ""; studentCode = ""; joinPayload = "";
  renameNotice = ""; answerNotice = ""; sessionId = "session"; bindingId = "binding";
  questionId = ""; sessionState = "WAITING"; questionStatus = "";
  dismissedResultSession = ""; dismissedResultBinding = "";
  pendingRequestId = ""; pendingPayload = ""; queuedChoice = '\0';
  resultReady = false; resultHasScore = false; resultCorrect = 0; resultTotal = 0; resultScore = 0;
  enteringRoom = true; inputConfirmed = false; totalQuestions = 10; secondsPerQuestion = 15;
  questionOrder = 1; countdownAtSnapshot = 0; snapshotReceivedAt = fakeNow;
  snapshotVersion = -1; answerSequence = 0; lastDisplayedSeconds = UINT32_MAX;
  lastWifiNoticeVisible = false; lastRenameNoticeVisible = false;
  choices = 0; joins = 0; confirms = 0; answers = 0;
  webSocket.sent.clear();
  webSocket.durableAtSend.clear();
  webSocket.headers.clear(); webSocket.event = {}; webSocket.connects = 0; webSocket.connectResult = true;
  webSocketConfigured = false; lastWebSocketConnectAttempt = 0;
  pairingStore = PreferencesFake{}; pairingStoreReady = true;
  bootRecoveryPending = true; pendingRecoveryPayload = ""; pendingAnswerValidated = true;
  wakeOled();
}
void tick(uint32_t elapsed = 0) { fakeNow += elapsed; updateOledPower(); updateOledDisplay(); }
void packet(const char* data) { handleWebSocketMessage(String(data)); tick(); }
void finished() {
  sessionState = "FINISHED"; resultReady = true; resultHasScore = true;
  resultCorrect = 8; resultTotal = 10; resultScore = 8.0f; tick();
}
const char* resultPacket = R"({"v":1,"type":"session.snapshot","data":{"id":"session","binding_id":"binding","state":"FINISHED","state_version":1,"result":{"correct":8,"total":10,"score":8}}})";
int tests = 0;
void test(const char* name, const std::function<void()>& run) {
  reset(); run(); tests++; std::cout << "PASS: " << name << '\n';
}
int main() {
  test("idle switches off at 60 seconds even offline", [] {
    WiFi.connected = false; tick(59999); assert(!oledPower.sleeping()); tick(1);
    assert(oledPower.sleeping()); assert(display.commands.back() == SSD1306_DISPLAYOFF);
  });
  test("waiting switches off at 20 seconds", [] {
    sessionState = "LOBBY"; tick(); tick(19999); assert(!oledPower.sleeping());
    tick(1); assert(oledPower.sleeping());
  });
  test("unassigned socket and pending pairing use waiting timeout", [] {
    webSocketClientStarted = true; assert(oledState() == OledState::WAITING);
    webSocketClientStarted = false; joinPayload = "pending"; assert(oledState() == OledState::WAITING);
    tick(); tick(20000); assert(oledPower.sleeping()); assert(joinPayload == "pending");
  });
  test("sleeping ENTER preserves waiting input and does not submit", [] {
    sessionState = "LOBBY"; inputText = "001"; tick(); tick(20000); handleKey(4); tick();
    assert(!oledPower.sleeping()); assert(inputText == "001"); assert(confirms == 0);
    handleKey(4); assert(confirms == 1);
  });
  test("sleeping DELETE preserves input then retains its normal action", [] {
    inputText = "001"; tick(60000); handleKey(2); assert(inputText == "001");
    handleKey(2); assert(inputText == "00");
  });
  test("sleeping A only wakes without button test or answer", [] {
    webSocketClientStarted = true; enteringRoom = false; tick(); tick(20000);
    handleKey(13); assert(choices == 0); handleKey(13); assert(choices == 1);
  });
  test("wake does not retry pending HTTP pairing", [] {
    joinPayload = "original payload"; tick(); tick(20000); handleKey(4);
    assert(joins == 0); assert(joinPayload == "original payload"); handleKey(4); assert(joins == 1);
  });
  test("teacher starts exam and automatically wakes OLED", [] {
    sessionState = "LOBBY"; tick(); tick(20000); assert(oledPower.sleeping());
    packet(R"({"v":1,"type":"session.snapshot","data":{"id":"session","binding_id":"binding","state":"RUNNING","state_version":1,"total_questions":10,"question":{"id":"q1","status":"OPEN","question_order":1,"countdown_ms":10000}}})");
    assert(!oledPower.sleeping()); assert(display.commands.back() == SSD1306_DISPLAYON);
    assert(display.frame.find("QUIZ IN PROGRESS") != std::string::npos);
  });
  test("running stays on while offline and awaiting ACK", [] {
    sessionState = "RUNNING"; WiFi.connected = false; pendingRequestId = "retry";
    tick(); tick(3600000); assert(!oledPower.sleeping()); assert(pendingRequestId == "retry");
  });
  test("paused exam stays on and keeps countdown frozen", [] {
    sessionState = "PAUSED"; questionStatus = "OPEN"; questionId = "q"; countdownAtSnapshot = 5100;
    tick(); tick(3600000); assert(!oledPower.sleeping()); assert(remainingMs() == 5100);
    assert(display.frame.find("Q 1/10  6s") != std::string::npos);
  });
  test("finished result switches off at 30 seconds without clearing state", [] {
    finished(); tick(29999); assert(!oledPower.sleeping()); tick(1); assert(oledPower.sleeping());
    assert(resultReady && resultScore == 8.0f && sessionId == "session" && bindingId == "binding");
  });
  test("ENTER wakes result without dismissing; second ENTER keeps existing action", [] {
    finished(); tick(30000); handleKey(4); tick();
    assert(dismissedResultSession.isEmpty()); assert(resultReady);
    assert(display.frame.find("Correct: 8/10") != std::string::npos);
    assert(display.frame.find("Score: 8.00/10") != std::string::npos);
    handleKey(4); tick(); assert(dismissedResultSession == "session");
    assert(oledState() == OledState::IDLE); assert(enteringRoom);
  });
  test("waking result grants another 30 seconds", [] {
    finished(); tick(30000); handleKey(13); tick(29999); assert(!oledPower.sleeping());
    tick(1); assert(oledPower.sleeping()); assert(dismissedResultSession.isEmpty());
  });
  test("identical finished snapshots cannot keep OLED awake", [] {
    packet(resultPacket); for (int i = 0; i < 8; i++) { tick(4000); packet(resultPacket); }
    assert(oledPower.sleeping()); assert(resultReady && resultCorrect == 8);
  });
  test("late or corrected result wakes and receives full display interval", [] {
    sessionState = "FINISHED"; tick(); tick(30000); assert(oledPower.sleeping());
    packet(resultPacket); assert(!oledPower.sleeping()); tick(29999); assert(!oledPower.sleeping());
    tick(1); assert(oledPower.sleeping());
    packet(R"({"v":1,"type":"session.snapshot","data":{"id":"session","binding_id":"binding","state":"FINISHED","state_version":2,"result":{"correct":9,"total":10,"score":9}}})");
    assert(!oledPower.sleeping()); assert(display.frame.find("Score: 9.00/10") != std::string::npos);
  });
  test("new binding supersedes sleeping old result", [] {
    finished(); tick(30000);
    packet(R"({"v":1,"type":"session.snapshot","data":{"id":"new","binding_id":"new-binding","state":"LOBBY","state_version":0,"total_questions":3,"seconds_per_question":15}})");
    assert(!oledPower.sleeping()); assert(!resultReady); assert(sessionId == "new");
    assert(display.frame.find("Correct:") == std::string::npos);
    tick(20000); assert(oledPower.sleeping());
  });
  test("stale snapshot cannot wake OLED or overwrite results", [] {
    packet(resultPacket); tick(30000);
    packet(R"({"v":1,"type":"session.snapshot","data":{"id":"session","binding_id":"binding","state":"LOBBY","state_version":0}})");
    assert(oledPower.sleeping()); assert(sessionState == "FINISHED"); assert(resultCorrect == 8);
  });
  test("connection transition wakes; repeated closed events do not extend waiting", [] {
    sessionState = "LOBBY"; tick(); tick(20000);
    onWebSocketEvent(WebsocketsEvent::ConnectionClosed, ""); tick(); assert(!oledPower.sleeping());
    for (int i = 0; i < 11; i++) { tick(2000); onWebSocketEvent(WebsocketsEvent::ConnectionClosed, ""); }
    tick(); assert(oledPower.sleeping());
    onWebSocketEvent(WebsocketsEvent::ConnectionOpened, ""); tick(); assert(!oledPower.sleeping());
  });
  test("power-off never clears answer retry packet or sequence", [] {
    sessionState = "LOBBY"; pendingRequestId = "request"; pendingPayload = "original";
    answerSequence = 7; queuedChoice = 'B'; tick(); tick(20000);
    assert(oledPower.sleeping()); assert(pendingRequestId == "request" && pendingPayload == "original");
    assert(answerSequence == 7 && queuedChoice == 'B');
  });
  test("ACK redraws saved answer and preserves matching request behavior", [] {
    sessionState = "RUNNING"; pendingRequestId = "request"; pendingPayload = "original"; tick();
    packet(R"({"v":1,"type":"answer.ack","request_id":"other","accepted":true,"choice":"B"})");
    assert(pendingRequestId == "request");
    packet(R"({"v":1,"type":"answer.ack","request_id":"request","accepted":true,"choice":"A"})");
    assert(pendingRequestId.isEmpty() && pendingPayload.isEmpty());
    assert(display.frame.find("SAVED: A") != std::string::npos);
  });
  test("ACK rejection and server error are rendered without discarding retry on error", [] {
    sessionState = "RUNNING"; pendingRequestId = "r"; pendingPayload = "original";
    packet(R"({"v":1,"type":"error","code":"TEMPORARY"})");
    assert(pendingPayload == "original" && pendingRequestId == "r");
    assert(display.frame.find("SERVER ERROR") != std::string::npos);
    packet(R"({"v":1,"type":"answer.ack","request_id":"r","accepted":false})");
    assert(display.frame.find("ANSWER REJECTED") != std::string::npos);
  });
  test("answer selection redraws SENDING immediately and queued answer sends only after ACK", [] {
    sessionState = "RUNNING"; questionStatus = "OPEN"; questionId = "q"; countdownAtSnapshot = 10000;
    tick(); handleKey(13); tick(); assert(answers == 1);
    assert(display.frame.find("SENDING: A") != std::string::npos);
    const String request = pendingRequestId, payload = pendingPayload;
    handleKey(9); assert(answers == 1 && queuedChoice == 'B'); assert(pendingPayload == payload);
    const String ack = std::string("{\"v\":1,\"type\":\"answer.ack\",\"request_id\":\"") + request + "\",\"accepted\":true,\"choice\":\"A\"}";
    handleWebSocketMessage(ack); tick(); assert(answers == 2 && queuedChoice == '\0');
    assert(answerSequence == 2); assert(display.frame.find("SENDING: B") != std::string::npos);
  });
  test("static screen skips all redraws over 2000 loop iterations", [] {
    tick(); const int clears = display.clears, transfers = display.transfers;
    for (int i = 0; i < 2000; i++) tick(5);
    assert(display.clears == clears && display.transfers == transfers);
  });
  test("dirty event with unchanged frame does not transfer over I2C", [] {
    tick(); const int transfers = display.transfers; renderStatus(); tick();
    assert(display.transfers == transfers);
  });
  test("countdown only redraws when displayed second changes", [] {
    sessionState = "RUNNING"; questionStatus = "OPEN"; questionId = "q"; countdownAtSnapshot = 10000;
    tick(); const int clears = display.clears; tick(999); assert(display.clears == clears);
    tick(1); assert(display.clears == clears + 1); assert(display.frame.find("Q 1/10  9s") != std::string::npos);
    tick(9000); assert(remainingMs() == 0); assert(!canAnswer());
  });
  test("notice expires precisely without a recurring full-screen timer", [] {
    inputText = "001"; showRenameNotice("NOT ON THE LIST");
    assert(display.frame.find("PLEASE RE-ENTER") != std::string::npos);
    const int clears = display.clears; tick(4999); assert(display.clears == clears);
    tick(1); assert(display.frame.find("PLEASE RE-ENTER") == std::string::npos);
  });
  test("long SSID preserves current wrapping and expires connected notice", [] {
    wifiConnectedAt = fakeNow; renderStatus(); tick();
    assert(display.frame.find("wrap:1;") != std::string::npos);
    assert(display.frame.find("Connectedcursor:0,11;") != std::string::npos);
    const int clears = display.clears; tick(2999); assert(display.clears == clears);
    tick(1); assert(display.clears == clears + 1); assert(display.frame.find("wrap:1;") == std::string::npos);
  });
  test("sleeping display does no drawing or I2C transfer", [] {
    finished(); tick(30000); const int clears = display.clears, transfers = display.transfers;
    for (int i = 0; i < 100; i++) { renderStatus(); tick(5); }
    assert(display.clears == clears && display.transfers == transfers);
    handleKey(13); tick(); assert(display.clears == clears + 1);
  });
  test("power timers handle millis rollover", [] {
    OledPower power; const uint32_t start = UINT32_MAX - 10000;
    power.update(OledState::WAITING, start); power.update(OledState::WAITING, start + 19999U);
    assert(!power.sleeping()); power.update(OledState::WAITING, start + 20000U); assert(power.sleeping());
    power.update(OledState::EXAM, start + 20001U); assert(!power.sleeping());
  });
  test("invalid keys do not wake and unavailable OLED does not consume valid input", [] {
    tick(60000); handleKey(0); handleKey(17); assert(oledPower.sleeping());
    oledReady = false; handleKey(16); assert(inputText == "1");
  });
  test("awake exam keeps all original A/B/C/D key mappings", [] {
    sessionState = "RUNNING"; questionStatus = "OPEN"; questionId = "q"; countdownAtSnapshot = 10000; tick();
    int index = 0;
    for (int key : {1, 5, 9, 13}) {
      clearPending(); handleKey(key); JsonDocument answer;
      deserializeJson(answer, webSocket.sent.back());
      assert(std::string(answer["choice"].as<const char*>()) == std::string(1, "DCBA"[index++]));
    }
    assert(answers == 4); handleKey(4); handleKey(2); handleKey(16); assert(answers == 4);
  });
  test("cancelled session has finite display interval", [] {
    sessionState = "CANCELLED"; tick(); assert(display.frame.find("QUIZ CANCELLED") != std::string::npos);
    tick(30000); assert(oledPower.sleeping());
  });
  std::cout << tests << "/" << tests << " OLED regression scenarios PASS\n";
}
