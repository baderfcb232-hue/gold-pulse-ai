// Recover a silent event stream without allowing an older HTTP reply to replace it.
export function createStateConnection({readState, applyState, onError, clock = Date.now, silenceMs = 15000}) {
  let lastEventAt = null, streamFailed = true, latestServerTime = -Infinity;
  let applied = 0, pending = null;
  function accept(raw) {
    if (!raw || !Number.isFinite(raw.serverTime)) throw new Error('استجابة حالة الربط غير صالحة.');
    if (raw.serverTime < latestServerTime) return false;
    applyState(raw);
    latestServerTime = raw.serverTime; applied++;
    return true;
  }
  return {
    receive(raw) {
      try {
        if (!accept(raw)) return false;
        lastEventAt = clock(); streamFailed = false;
        return true;
      } catch {streamFailed = true; return false;}
    },
    disconnected() {streamFailed = true;},
    needsPoll() {return streamFailed || lastEventAt === null || clock() - lastEventAt >= silenceMs;},
    refresh() {
      if (pending) return pending;
      const startedAt = applied;
      pending = Promise.resolve().then(readState).then(accept).catch(error => {
        // A successful event received during this request already restored the page.
        if (applied === startedAt) onError(error);
        return false;
      }).finally(() => {pending = null;});
      return pending;
    }
  };
}
