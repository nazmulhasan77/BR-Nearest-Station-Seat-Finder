/* background.js -- MV3 service worker.
   All railway API traffic goes through here: the service worker is not subject to
   CORS, and it can add the Authorization header with the session token that the
   content script reads out of localStorage. */

importScripts('lib/api.js');

const API = self.BR.api;

const DEFAULTS = {
  concurrency: 3,
  gapMs: 220,          // polite spacing between request starts
  timeoutMs: 15000,
  maxRetries: 2
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Run `worker` over `items` with at most `limit` in flight, `gap` ms apart. */
async function pool(items, limit, gapMs, worker, onProgress) {
  let i = 0, done = 0;
  const results = new Array(items.length);
  async function runner() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await sleep(idx < limit ? 0 : gapMs);
      results[idx] = await worker(items[idx], idx);
      done++;
      if (onProgress) {
        try { onProgress(done, items.length, items[idx]); } catch (e) { /* ignore */ }
      }
    }
  }
  const runners = [];
  for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(runner());
  await Promise.all(runners);
  return results;
}

async function runSearch(payload, send) {
  const creds = payload.creds || {};
  const queries = payload.queries || [];
  const cfg = Object.assign({}, DEFAULTS, payload.options || {});
  const out = {};
  let deviceKey = creds.ssdk;
  let aborted = null;

  await pool(queries, cfg.concurrency, cfg.gapMs, async (item) => {
    if (aborted) return { ok: false, error: 'ABORTED' };
    let attempt = 0, res = null;
    while (attempt <= cfg.maxRetries) {
      res = await API.query(creds, item.q, { deviceKey, timeoutMs: cfg.timeoutMs });
      if (res && res.deviceKey) deviceKey = res.deviceKey;
      if (res.ok) break;
      if (res.error === 'TOKEN' || res.error === 'NO_TOKEN') { aborted = res; break; }
      if (res.error === 'RATE') { await sleep(1500 * (attempt + 1)); attempt++; continue; }
      if (res.error === 'NET') { await sleep(800 * (attempt + 1)); attempt++; continue; }
      break;
    }
    out[item.key] = res || { ok: false, error: 'HTTP' };
  }, (done, total) => send({ type: 'progress', done, total }));

  if (aborted) {
    send({ type: 'done', ok: false, error: aborted.error, results: out, deviceKey });
    return;
  }
  send({ type: 'done', ok: true, results: out, deviceKey });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'br-seat-finder') return;
  let cancelled = false;

  port.onMessage.addListener(async (msg) => {
    const send = (obj) => {
      if (cancelled) return;
      try { port.postMessage(obj); } catch (e) { /* tab gone */ }
    };

    if (msg.type === 'SEARCH') {
      send({ type: 'progress', done: 0, total: (msg.queries || []).length });
      await runSearch(msg, send);
    } else if (msg.type === 'PING') {
      send({ type: 'pong', ok: true });
    } else if (msg.type === 'TEST') {
      const res = await API.query(msg.creds, msg.q, { timeoutMs: 15000 });
      send({ type: 'test-result', url: API.buildUrl(API.PATHS[0], msg.q), result: res });
    }
  });

  port.onDisconnect.addListener(() => { cancelled = true; });
});

/* The popup / options page use one-shot messages. */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg && msg.type === 'BR_TEST') {
    API.query(msg.creds, msg.q, { timeoutMs: 15000 }).then((res) => {
      respond({ ok: true, url: API.buildUrl(API.PATHS[0], msg.q), result: res });
    });
    return true;
  }
  if (msg && msg.type === 'BR_GET_CREDS') {
    // ask the active railway tab for its session token
    chrome.tabs.query({ url: 'https://eticket.railway.gov.bd/*' }, (tabs) => {
      if (!tabs.length) return respond({ ok: false, error: 'NO_TAB' });
      chrome.tabs.sendMessage(tabs[0].id, { type: 'BR_READ_CREDS' }, (r) => {
        respond(r || { ok: false, error: 'NO_RESPONSE' });
      });
    });
    return true;
  }
  if (msg && msg.type === 'BR_NOTIFY') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: msg.title || 'Seat found',
      message: msg.message || '',
      priority: 2
    });
    respond({ ok: true });
    return true;
  }
  if (msg && msg.type === 'BR_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    respond({ ok: true });
    return true;
  }
  if (msg && msg.type === 'BR_OPEN_SEARCH') {
    chrome.tabs.create({ url: msg.url });
    respond({ ok: true });
  }
});
