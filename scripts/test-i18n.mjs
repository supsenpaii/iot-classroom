import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

// Static check of the VI/EN dictionary: every t("...") has an English entry with the same {slots},
// and no Vietnamese literal is left outside t() in the client (render-time text).
const root = fileURLToPath(new URL("../client/src/", import.meta.url));
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.tsx?$/.test(entry.name) && !path.includes("/locales/")) files.push(path);
  }
})(root);

const VI = /[À-ÖØ-öø-ỹ]/; // Latin-1 letters through Vietnamese, without × and ÷
const used = new Map(), leftovers = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    // t("key", params), tk("key") and tc(count, "key") all name a dictionary key.
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ["t", "tk", "tc"].includes(n.expression.text)) {
      const name = n.expression.text, arg = n.arguments[name === "tc" ? 1 : 0];
      if (arg && ts.isStringLiteralLike(arg)) used.set(arg.text, file);
      // The key itself is Vietnamese by design; other arguments are still checked.
      n.arguments.forEach((a, i) => { if (i !== (name === "tc" ? 1 : 0) && !(name !== "tc" && i === 0)) visit(a); });
      return;
    }
    const isLiteral = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n);
    // Vietnamese words that carry no diacritic slip past VI, so a few known ones are listed.
    if (isLiteral && (VI.test(n.text) || /(^|[^\w])(sai|ghi tay)(\s|$)/.test(n.text)) && !file.endsWith("i18n.tsx")) {
      let inType = false;
      for (let p = n.parent; p; p = p.parent) if (ts.isTypeNode(p)) inType = true;
      if (!inType) leftovers.push(`${file.replace(root, "")}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.text.trim().slice(0, 50)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const source = readFileSync(join(root, "locales/en.ts"), "utf8");
const en = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const dict = {};
new Function("exports", en)(dict);
const slots = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every t() key has an English entry", () => {
  const missing = [...used.keys()].filter((k) => !(k in dict.en));
  assert.deepEqual(missing, [], `missing English for ${missing.length} keys`);
});
test("English entries keep the {slots} of the source", () => {
  const bad = Object.entries(dict.en).filter(([vi, e]) => slots(vi) !== slots(e)).map(([vi]) => vi);
  assert.deepEqual(bad, []);
});
test("no empty or untranslated-looking entries", () => {
  const bad = Object.entries(dict.en).filter(([vi, e]) => !e.trim() && vi.trim()).map(([vi]) => vi);
  assert.deepEqual(bad, []);
  const stillVietnamese = Object.entries(dict.en).filter(([, e]) => VI.test(e)).map(([vi]) => vi);
  assert.deepEqual(stillVietnamese, []);
});
test("no Vietnamese text left outside t()", () => {
  assert.deepEqual(leftovers, []);
});
test("report unused entries (informational)", () => {
  const unused = Object.keys(dict.en).filter((k) => !used.has(k));
  console.log(`# ${used.size} keys in use, ${unused.length} entries not referenced by a literal t() (server messages and shared constants are expected)`);
});

// Runtime behaviour of the helpers: plurals, lazy tables, server patterns, language switch.
function loadI18n() {
  const code = ts.transpileModule(readFileSync(join(root, "i18n.tsx"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  const fakeRequire = (name) => name === "react" ? { useSyncExternalStore: () => "vi" }
    : name === "./locales/en" ? dict
    : name === "react/jsx-runtime" ? { jsx: () => null, jsxs: () => null } : (() => { throw Error(name); })();
  new Function("require", "exports", code)(fakeRequire, exports);
  return exports;
}
test("language switch, plurals, lazy labels and server patterns", () => {
  const i = loadI18n();
  assert.equal(i.getLang(), "vi");
  assert.equal(i.t("{count} ý kiến", { count: 1 }), "1 ý kiến");
  const label = i.lazy(() => ({ a: i.t("Phòng chờ") }));
  assert.equal(label.a, "Phòng chờ");
  i.setLang("en");
  assert.equal(i.getLang(), "en");
  assert.equal(label.a, "Lobby", "a lazy table follows the language without being rebuilt by hand");
  assert.equal(i.t("{count} ý kiến", { count: 1 }), "1 response");
  assert.equal(i.t("{count} ý kiến", { count: 11 }), "11 responses");
  assert.equal(i.t("{count} ý kiến", { count: 21 }), "21 responses");
  assert.equal(i.tc(1, "câu"), "question");
  assert.equal(i.tc(3, "câu"), "questions");
  assert.equal(i.translateServer("Thiết bị L1 đã gán cho Nam trong lớp này"), "Device L1 is already assigned to Nam in this class");
  i.setLang("vi");
  assert.equal(label.a, "Phòng chờ");
});
