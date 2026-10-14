import { useSyncExternalStore } from "react";
import { en } from "./locales/en";

// Vietnamese source text is the key. Missing English falls back to Vietnamese.
// Switching language re-renders the app in place (no reload), so form input survives.
// Module-level label tables must be built with lazy() and stored state must hold Vietnamese
// keys (tk), translated when displayed; otherwise they would keep the previous language.
export type Lang = "vi" | "en";
const storageKey = "classroom-lang";

function detect(): Lang {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "vi" || value === "en") return value;
  } catch { /* Private mode: fall through to the default. */ }
  return "vi"; // Vietnamese classroom: English only when the user picks it.
}
let current: Lang = "vi";
const listeners = new Set<() => void>();
function apply(lang: Lang) {
  current = lang;
  try { document.documentElement.lang = lang; } catch { /* No DOM. */ }
  listeners.forEach((listener) => listener());
}
// Guarded as a whole: node-based UI tests import client modules with a partial fake DOM.
try {
  const lang = detect();
  document.documentElement.lang = lang;
  // Another tab changed the language: follow it so one browser never shows two languages.
  window.addEventListener("storage", (e) => {
    if (e.storageArea === localStorage && (e.key === storageKey || e.key === null) && detect() !== current)
      apply(detect());
  });
  current = lang; // Last, so a partial DOM (node UI tests) keeps Vietnamese.
} catch { /* No browser environment: Vietnamese source text is used as is. */ }

export const getLang = () => current;
export function setLang(lang: Lang) {
  try { localStorage.setItem(storageKey, lang); } catch { /* Not persisted; still applies now. */ }
  apply(lang);
}
// Subscribing a component re-renders it (and its children) when the language changes.
export function useLang(): Lang {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current, () => "vi");
}
// Locale for Date/Number formatting.
export const locale = () => (current === "vi" ? "vi-VN" : "en-US");

// English counts: "1 students" -> "1 student". Vietnamese has no plural, so this is output-side only.
const SINGULAR: Record<string, string> = { students: "student", questions: "question", responses: "response",
  cards: "card", devices: "device", rows: "row", points: "point", times: "time", rounds: "round", answers: "answer", seconds: "second" };
const oneOf = new RegExp(`(^|[^\\d.,])1 (${Object.keys(SINGULAR).join("|")})\\b`, "g");
const singularize = (text: string) => text.replace(oneOf, (_, pre: string, noun: string) => `${pre}1 ${SINGULAR[noun]}`);

export function t(vi: string, params?: Record<string, string | number>): string {
  if (current !== "en") return params ? vi.replace(/\{(\w+)\}/g, (all, key) => (key in params ? String(params[key]) : all)) : vi;
  const text = en[vi] ?? vi;
  return singularize(params ? text.replace(/\{(\w+)\}/g, (all, key) => (key in params ? String(params[key]) : all)) : text);
}
// A Vietnamese key kept as-is (state, comparisons); translate it with t() when it is shown.
export const tk = (vi: string) => vi;
// Noun after a count placed outside the key: {n} {tc(n, "câu")}.
export const tc = (n: number | string, vi: string) => {
  const noun = t(vi);
  return current === "en" && Number(n) === 1 ? (SINGULAR[noun] ?? noun) : noun;
};
// A table of translated labels that is rebuilt on every access, so it follows the current language.
export function lazy<T extends object>(factory: () => T): T {
  return new Proxy({} as T, {
    get: (_, key) => Reflect.get(factory(), key),
    has: (_, key) => Reflect.has(factory(), key),
    ownKeys: () => Reflect.ownKeys(factory()),
    getOwnPropertyDescriptor: (_, key) => {
      const d = Reflect.getOwnPropertyDescriptor(factory(), key);
      return d && { ...d, configurable: true };
    },
  });
}

// Server messages are Vietnamese text, some with {0}/{1} slots; fall back to the original on no match.
let serverPatterns: Array<[RegExp, string]> | undefined;
export function translateServer(message: string): string {
  if (current !== "en") return message;
  if (en[message]) return en[message];
  serverPatterns ??= Object.keys(en).filter((k) => /\{\d+\}/.test(k)).map((k) => [
    new RegExp("^" + k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\d+\}/g, "([\\s\\S]+?)") + "$"), en[k],
  ]);
  for (const [pattern, text] of serverPatterns) {
    const m = pattern.exec(message);
    if (m) return text.replace(/\{(\d+)\}/g, (all, n) => m[Number(n) + 1] ?? all);
  }
  return message;
}

export function LangToggle() {
  const lang = useLang();
  const next: Lang = lang === "vi" ? "en" : "vi";
  const label = next === "en" ? "Switch to English" : "Chuyển sang tiếng Việt";
  return (
    <button
      type="button"
      className="theme-toggle lang-toggle"
      title={label}
      aria-label={label}
      onClick={() => setLang(next)}
    >
      {lang === "vi" ? "VI" : "EN"}
    </button>
  );
}
