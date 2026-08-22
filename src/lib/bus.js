// tiny in-process pub/sub — SSE clients subscribe, pipeline/taskrunner publish
const subs = new Set()

export function subscribe(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

export function publish(event) {
  for (const fn of subs) {
    try { fn(event) } catch { /* a dead client never breaks the emitter */ }
  }
}
