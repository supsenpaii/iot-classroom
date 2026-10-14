import { en } from "./locales/en";

// Vietnamese source text is the key. Missing English falls back to Vietnamese.
// The language is fixed per page load: switching reloads, so module-level labels need no special handling.
export type Lang = "vi" | "en";
const storageKey = "classroom-lang";

function detect(): Lang {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "vi" || value === "en") return value;
  } catch { /* Private mode: fall through to the browser language. */ }
  return "vi"; // Vietnamese classroom: English only when the user picks it.
}
let current: Lang = "vi";
// Guarded as a whole: node-based UI tests import client modules with a partial fake DOM.
try {
  const lang = detect();
  document.documentElement.lang = lang;
  // Another tab changed the language: follow it so one browser never shows two languages.
  window.addEventListener("storage", (e) => {
    if (e.storageArea === localStorage && (e.key === storageKey || e.key === null) && detect() !== current)
      window.location.reload();
  });
  current = lang; // Last, so a partial DOM (node UI tests) keeps Vietnamese.
} catch { /* No browser environment: Vietnamese source text is used as is. */ }

export const getLang = () => current;
// Locale for Date/Number formatting.
export const locale = () => (current === "vi" ? "vi-VN" : "en-US");
export function t(vi: string, params?: Record<string, string | number>): string {
  const text = current === "en" ? (en[vi] ?? vi) : vi;
  return params ? text.replace(/\{(\w+)\}/g, (all, key) => (key in params ? String(params[key]) : all)) : text;
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
  const next: Lang = current === "vi" ? "en" : "vi";
  const label = next === "en" ? "Switch to English" : "Chuyển sang tiếng Việt";
  return (
    <button
      type="button"
      className="theme-toggle lang-toggle"
      title={label}
      aria-label={label}
      onClick={() => {
        try { localStorage.setItem(storageKey, next); } catch { /* Without storage the choice cannot persist. */ }
        window.location.reload();
      }}
    >
      {current === "vi" ? "VI" : "EN"}
    </button>
  );
}
