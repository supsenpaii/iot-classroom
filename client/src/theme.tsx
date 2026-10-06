import { useEffect, useRef, useState } from "react";
import { Icon } from "./components";

type Theme = "light" | "dark";
const storageKey = "classroom-theme";
const systemTheme = (): Theme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const preference = useRef<Theme | null>(savedTheme());
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content", theme === "dark" ? "#0e1726" : "#f4f8ff",
    );
  }, [theme]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => {
      if (!preference.current) setTheme(systemTheme());
    };
    const syncStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (event.key === storageKey || event.key === null) {
        preference.current = savedTheme();
        setTheme(preference.current ?? systemTheme());
      }
    };
    media.addEventListener("change", syncSystem);
    window.addEventListener("storage", syncStorage);
    return () => {
      media.removeEventListener("change", syncSystem);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);
  const label = theme === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối";
  return (
    <button
      type="button"
      className={`theme-toggle${floating ? " theme-toggle-floating" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={theme === "dark"}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        preference.current = next;
        try { localStorage.setItem(storageKey, next); } catch { /* Theme still works without storage. */ }
        setTheme(next);
      }}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
