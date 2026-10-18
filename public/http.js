// Keep the deadline active through JSON parsing, including on older browsers.
export async function requestJson(path, options = {}, timeoutMs = 10000) {
  const controller = new AbortController(), callerSignal = options.signal;
  let timedOut = false;
  const cancel = () => controller.abort();
  if (callerSignal?.aborted) cancel();
  else callerSignal?.addEventListener('abort', cancel, {once: true});
  const timer = setTimeout(() => {timedOut = true; cancel();}, timeoutMs);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal
    });
    let body;
    try {body = await response.json();}
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error('استجابة الخادم غير صالحة.');
    }
    if (!response.ok) throw Object.assign(new Error(body?.error || 'تعذر إكمال الطلب.'), {status: response.status});
    return body;
  } catch (error) {
    if (timedOut) throw Object.assign(new Error('انتهت مهلة الاتصال بالخادم؛ حاول مرة أخرى.'), {name: 'TimeoutError'});
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', cancel);
  }
}
