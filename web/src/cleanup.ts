// Things a page sets up (maps, graphs, listeners) are torn down before the next page renders.
const disposers: (() => void)[] = [];

export function onDispose(fn: () => void) { disposers.push(fn); }

export function disposeAll() {
  for (const fn of disposers.splice(0)) {
    try { fn(); } catch (e) { console.warn('dispose failed', e); }
  }
}
