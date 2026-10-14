import { t } from "./i18n";
export async function copyText(text: string): Promise<void> {
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Try the LAN-compatible fallback when clipboard permissions are denied.
    }
  }

  const focused = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange(),
      )
    : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.left = "-9999px";
  document.body.appendChild(field);

  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    // The async Clipboard API is unavailable over HTTP on a LAN address.
    if (!document.execCommand("copy")) throw new Error("Copy failed");
  } catch {
    throw new Error(t("Không thể sao chép tự động. Hãy chọn mã hoặc đường dẫn rồi sao chép thủ công."));
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }
}
