import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the real TSX without a browser, database, server or network request.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (specifier.startsWith(".")) {
        for (const extension of [".ts", ".tsx"])
          try { return nextResolve(specifier + extension, context); } catch {}
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (!/\.tsx?$/.test(url)) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText };
  },
});
const oldWindow = globalThis.window;
const NativeBroadcastChannel = globalThis.BroadcastChannel;
const channels = [];
globalThis.BroadcastChannel = class extends NativeBroadcastChannel {
  constructor(name) { super(name); channels.push(this); }
};
globalThis.window = { location: { origin: "http://classroom.test" } };
try {
  const { RoomPairing } = await import("../client/src/pages/room-pairing.tsx");
  const session = { id: "s", state: "LOBBY", state_version: 0, pairing: { status: "CLOSED" },
    students: [
      { id: "free", student_code: "001", full_name: "Free", device_id: null },
      { id: "taken", student_code: "002", full_name: "Taken", device_id: "other" },
      { id: "absent", student_code: "003", full_name: "Absent", absent: true },
    ], room_devices: [{ id: "board", label: "SIM-ROOM-01", session_student_id: null }] };
  const render = s => renderToStaticMarkup(createElement(RoomPairing, {
    session: s, offset: 0, connected: true, reload() {},
  }));
  const html = render(session);
  const select = html.match(/<select[^>]*aria-label="Ghép học sinh cho SIM-ROOM-01"[^>]*>(.*?)<\/select>/s)?.[1];
  assert.ok(select);
  assert.match(select, /value="free"/);
  assert.doesNotMatch(select, /value="taken"|value="absent"/);
  assert.match(html, /không ghép theo thứ tự kết nối/);
  const assigned = render({ ...session, state: "PAUSED",
    students: session.students.map(st => st.id === "taken" ? { ...st, device_id: "board" } : st),
    room_devices: [{ ...session.room_devices[0], session_student_id: "taken" }],
  });
  assert.match(assigned, /<option value="taken" selected="">/);
  assert.doesNotMatch(render({ ...session, state: "RUNNING" }), /<select/);
  assert.doesNotMatch(render({ ...session, room_devices: [{ ...session.room_devices[0], revoked: true }] }), /<select/);
  console.log("PASS: arbitrary simulator/device labels allow valid manual MSSV selection; occupied/absent students excluded; current binding retained; running/revoked editing blocked.");
} finally {
  hooks.deregister();
  for (const channel of channels) channel.close();
  globalThis.BroadcastChannel = NativeBroadcastChannel;
  if (oldWindow === undefined) delete globalThis.window;
  else globalThis.window = oldWindow;
}
