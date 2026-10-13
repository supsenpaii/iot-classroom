import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const firmware = join(root, "firmware/esp32-classroom");
const source = readFileSync(join(firmware, "src/main.cpp"), "utf8");
function fn(name) {
  const match = source.match(new RegExp(`^[^\\n]*\\b${name}\\([^;\\n]*\\) \\{`, "m"));
  assert.ok(match, `Missing firmware function: ${name}`);
  let depth = 0;
  for (let i = match.index + match[0].length - 1; i < source.length; i++) {
    depth += (source[i] === "{") - (source[i] === "}");
    if (!depth) return source.slice(match.index, i + 1);
  }
  throw Error(`Unclosed function: ${name}`);
}
const digest = value => createHash("sha256").update(value).digest("hex");
// Golden baseline: every draw command, text, font, cursor and wrapping rule.
const draw = fn("drawOledStatus");
assert.equal(digest(draw.slice(draw.indexOf("  display.clearDisplay();"))),
  "6ffae5f99ed234c9c5d92c7f9ea01252ac8e26348586be477081d892f560207a");
// Reboot recovery deliberately changes persistence/send/retry. Those paths now have
// direct behavior tests in test-firmware-recovery; protect the untouched network paths here.
const networkFunctions = ["sendJson", "sendButtonTest", "handleChoice", "joinRoom",
  "confirmPairingInput", "remainingMs", "canAnswer", "readKeypad", "updateKeypad", "connectToWebsite"];
const network = networkFunctions.map(name => fn(name).replace(/^[ \t]*renderStatus\(\);\n/gm, ""));
const loop = fn("loop");
network.push(loop.slice(0, loop.indexOf("    retryPendingAnswer();")));
assert.equal(digest(network.join("\n")), "64839d078047ae0cb230b3c585540f113b28581e8488823ab9bfd5ca288df156");

// Compile the actual firmware display/key/snapshot handlers with host I/O fakes.
// ArduinoJson is the existing PlatformIO dependency; no dependency is installed.
const functions = ["wakeOled", "presentOledFrame", "oledState", "updateOledPower", "remainingMs",
  "canAnswer", "invalidateServerSnapshot", "forgetStoredAnswer", "clearPending", "validAnswerPayload", "savePendingAnswer", "loadRecoveryState", "reconcilePendingAnswer", "retryPendingAnswer",
  "sendJson", "sendButtonTest", "sendAnswer", "handleChoice", "renderStatus", "drawOledStatus", "updateOledDisplay", "showInput",
  "showRenameNotice", "handleKey", "handleWebSocketMessage", "onWebSocketEvent"].map(fn).join("\n\n");
const dir = mkdtempSync(join(tmpdir(), "smartclass-oled-test-"));
try {
  const cpp = readFileSync(new URL("./fixtures/oled-display.cpp", import.meta.url), "utf8");
  writeFileSync(join(dir, "test.cpp"), cpp.replace("// FIRMWARE_FUNCTIONS", functions));
  const compiled = spawnSync(process.env.CXX || "g++", ["-std=c++17", "-O1", "-Wall", "-Wextra",
    "-I", join(firmware, "include"), "-I", join(firmware, ".pio/libdeps/esp32-c3-devkitm-1/ArduinoJson/src"),
    join(dir, "test.cpp"), "-o", join(dir, "test")], { encoding: "utf8", timeout: 60000 });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
  const tested = spawnSync(join(dir, "test"), [], { encoding: "utf8", timeout: 10000 });
  process.stdout.write(tested.stdout || "");
  assert.equal(tested.status, 0, tested.stderr || tested.error?.message);
  console.log("PASS: original OLED text/layout and untouched network/countdown paths preserved; recovery tested separately.");
} finally { rmSync(dir, { recursive: true, force: true }); }
