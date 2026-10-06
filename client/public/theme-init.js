// Apply the theme before rendering, including when storage is unavailable.
(() => {
  let theme;
  try { theme = localStorage.getItem("classroom-theme"); } catch {}
  if (theme !== "light" && theme !== "dark")
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0e1726" : "#f4f8ff";
})();
