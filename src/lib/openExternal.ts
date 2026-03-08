/**
 * Opens a URL externally — in Capacitor Browser plugin if available,
 * otherwise falls back to window.open.
 */
export async function openExternal(url: string) {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
