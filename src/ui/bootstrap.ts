// Keep startup failures visible even when the editor module cannot initialize.
// This sends diagnostics only, never source or comment contents.
function report(event: string, message: string) {
  const bridge = (window as unknown as { __electrobunHostBridge?: { postMessage(message: string): void } }).__electrobunHostBridge;
  bridge?.postMessage(JSON.stringify({ type: "message", id: "diagnostic", payload: { event, message: message.slice(0, 1000) } }));
}
window.addEventListener("error", (event) => report("webview-error", event.message || "A bundled resource did not load."), true);
window.addEventListener("securitypolicyviolation", (event) => report("webview-policy", `${event.effectiveDirective}: ${event.blockedURI}`));
window.addEventListener("unhandledrejection", (event) => report("webview-rejection", String(event.reason?.message ?? event.reason)));
report("webview-bootstrap", navigator.userAgent);
window.addEventListener("load", () => report("webview-loaded", document.readyState));
