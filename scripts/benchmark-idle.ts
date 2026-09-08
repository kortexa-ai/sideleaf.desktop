// Run with the packaged Cottontail executable. This diagnostic deliberately
// imports no application or runtime capability modules.
type RuntimeHost = {
  runtimeDiagnostics(): { eventLoop: unknown };
  jscMemoryUsage?: () => Record<string, unknown>;
};
const runtime = globalThis as typeof globalThis & {
  cottontail?: RuntimeHost;
};
if (!runtime.cottontail) {
  throw new Error("Run this probe with the packaged Cottontail runtime.");
}
const host = runtime.cottontail;
const start = performance.now();
function sample(phase: string) {
  const heap = host.jscMemoryUsage?.() ?? {};
  console.log(JSON.stringify({
    phase,
    elapsedMs: performance.now() - start,
    eventLoop: host.runtimeDiagnostics().eventLoop,
    heap: Object.fromEntries(Object.entries(heap).filter(([, value]) => typeof value === "number")),
  }));
}
setTimeout(() => sample("settled"), 5_000);
setTimeout(() => sample("finished"), 20_000);
