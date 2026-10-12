import {ema} from '/engine.mjs';

export function initLiveWorkspace({stream, api, time, num, now, notify}) {
  const $ = id => document.getElementById(id);
  const node = (tag, cls, text) => {const n = document.createElement(tag); if (cls) n.className = cls;
    if (text != null) n.textContent = String(text); return n;};
  const put = (id, text) => {$(id).textContent = text ?? '—';};
  const pill = (text, cls = 'neutral') => node('span', 'pill ' + cls, text);
  const empty = text => node('p', 'empty-inline', text);
  const fmt = v => Number.isFinite(v) ? v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
  const side = v => ({BUY: 'شراء', SELL: 'بيع', NEUTRAL: 'محايد', UNKNOWN: 'غير مكتمل'}[v] || 'انتظار');
  const status = {TRACKING: 'قيد المتابعة', TP2: 'بلغ الهدف المرجعي', SL: 'بلغ الوقف المرجعي', EXPIRED: 'انتهت الصلاحية'};
  const category = {GOLD: 'ذهب / دولار', BTC: 'عملات رقمية', ECON: 'اقتصاد', WORLD: 'عام'};
  let data = null, news = null, symbol = 'XAUUSD', tf = 'M1', rows = [], chartKey = '', chartRequest = 0;
  let lastServerSeen = 0, fetched = false, historyFetched = false, historyRows = [], historyStamp = '', newsStamp = '';
  let initialized = false;
  const seenSignals = new Set();
  const market = () => data?.markets?.[symbol];
  const fresh = m => Boolean(m?.quote && m.connection === 'LIVE' && now() - m.quote.time <= m.quoteTtl && Date.now() - lastServerSeen < 12000);
  const activePlan = () => {const m = market(); return fresh(m) && m.currentSignal?.expires_at > now() ? m.currentSignal : null;};
  function applyMarket(next) {
    if (data && next.serverTime < data.serverTime) return;
    data = next; lastServerSeen = Date.now();
    const m = market(), current = activePlan();
    if (current && initialized && !seenSignals.has(current.id) && $('signal-notifications').checked)
      notify(`فرصة مضاربة ${side(current.side)} · ${m.name} · ${fmt(current.entry)}`);
    for (const item of Object.values(data.markets)) if (item.currentSignal) seenSignals.add(item.currentSignal.id);
    initialized = true;
    render();
    const key = `${symbol}:${tf}:${Math.floor((m?.last_bar || 0) / ({M1:60,M5:300,M15:900}[tf]))}:${m?.history_revision}`;
    mergeChartTail();
    if (key !== chartKey) {chartKey = key; loadChart();} else drawChart();
    const stamp = Object.values(data.markets).map(m => m.recentSignals.map(p => p.id + p.status).join(':')).join('|');
    if (stamp !== historyStamp) {historyStamp = stamp; loadHistory();}
  }
  function render() {
    const m = market(), live = fresh(m), a = m?.analysis, p = activePlan();
    put('live-market-name', `${symbol} · ${m?.name || 'متابعة السوق'}`);
    put('live-connection', !m?.quote ? 'جلب السوق…' : live ? 'متابعة السوق متصلة' : 'السعر متأخر / انقطاع المصدر');
    $('live-connection').className = 'pill ' + (live ? 'good' : 'warn');
    put('live-update-age', m?.quote ? `عمر السعر ${Math.max(0, Math.floor(now() - m.quote.time))} ثانية` : 'بانتظار أول سعر');
    put('live-asset-title', (m?.name || (symbol === 'XAUUSD' ? 'الذهب' : 'بيتكوين')) + ' / دولار');
    put('live-price', fmt(m?.quote?.price));
    put('live-change', m?.change_from_last_close == null ? 'USD' : `${m.change_from_last_close >= 0 ? '+' : ''}${num(m.change_from_last_close, 3)}% عن إغلاق الدقيقة`);
    put('live-source', m?.source || 'جلب المصدر'); put('live-quote-time', m?.quote ? time(m.quote.time) + ' · غزة' : '—');
    put('live-source-note', m ? `${m.symbol === 'XAUUSD' ? 'الذهب المرجعي يُجلب كل نحو 30 ثانية؛ الشموع من عينات السعر المتاحة.' : (m.transport === 'WebSocket' ? 'بث Coinbase المباشر؛' : 'جلب Coinbase الاحتياطي كل ثانية؛') + ' سعر BTC-USD على المنصة.'} مستقل عن سعر تنفيذ بروكرك.` : 'ننتظر بيانات المصدر؛ لن نعرض أسعارًا تجريبية.');
    const states = {NO_DATA: 'انتظار المصدر', WARMING: 'تجميع الشموع', SCANNING: 'البحث عن فرصة', WATCH: 'فرصة مشروطة', READY: 'تحققت شروط السعر', GAP: 'فجوة بيانات', NEWS_BLOCK: 'توقف حول خبر', STALE: 'تحديث متأخر'};
    const state = !live && m?.quote ? 'STALE' : a?.status || 'NO_DATA';
    put('scalp-decision', p ? side(p.side) + ' · مرجعي' : states[state]);
    $('scalp-decision').className = p ? (p.side === 'BUY' ? 'buy' : 'sell') : '';
    put('scalp-status', states[state]); $('scalp-status').className = 'pill ' + (p ? 'good' : state === 'WATCH' ? 'warn' : 'neutral');
    put('scalp-reason', !live && m?.quote ? 'إصدار فرص جديدة متوقف. نحتفظ بالشارت والتحليل السابق حتى يعود مصدر حديث.' : a?.reason || 'يجري الاتصال بمصدر السوق.');
    put('scalp-score', live && a?.checks?.length ? `${a.score} / 100` : '—');
    $('scalp-score-fill').style.width = live && a?.checks?.length ? a.score + '%' : '0%';
    const checks = (a?.checks || []).map(ch => {const row = node('div', 'check'); row.append(node('span', ch.pass ? 'pass' : 'fail', ch.pass ? '✓' : '○'), node('span', '', ch.name)); return row;});
    if (m && state === 'WARMING') checks.push(empty(`${m.minute_count} دقيقة مرصودة · نحتاج نحو 110 دقائق متصلة لتأكيد اتجاه M5.`));
    if (a && !a.calendar_available) checks.push(empty('التقويم الاقتصادي غير متصل؛ عناوين RSS لا تغطي كل مواعيد البيانات.'));
    $('scalp-checks').replaceChildren(...(checks.length ? checks : [empty('تظهر شروط المضاربة بعد اكتمال الشموع.')]));
    $('live-frames').replaceChildren(...['M1', 'M5', 'M15'].map(f => {const row = node('div', 'frame'), frame = a?.frames?.[f];
      row.append(node('strong', '', {M1: 'دقيقة', M5: '5 دقائق', M15: '15 دقيقة'}[f]), node('span', 'frame-side ' + (live && frame?.direction === 'BUY' ? 'buy' : live && frame?.direction === 'SELL' ? 'sell' : ''), side(frame?.direction)));
      row.title = `${frame?.count || 0} شمعة مغلقة · ${live ? 'سياق حالي' : 'آخر سياق متاح'}`; return row;}));
    renderPlan(m, p || (live && a?.setup?.expires_at > now() ? a.setup : null), Boolean(p));
    $('scalp-recent').replaceChildren(...(m?.recentSignals?.length ? m.recentSignals.slice(0, 3).map(p => compactPlan(p)) : [empty('لم تصدر فرصة مؤكدة بعد. شروط المراقبة تظهر فوق عند توافق الاتجاه.')]));
  }
  function compactPlan(p) {
    const row = node('div', 'recent-plan'); row.append(node('strong', p.side === 'BUY' ? 'buy' : 'sell', `${side(p.side)} · ${fmt(p.entry)}`),
      node('span', 'subtle', `${time(p.issued_at)} · ${status[p.status] || 'مراقبة'}`)); return row;
  }
  function renderPlan(m, p, confirmed) {
    put('scalp-plan-status', confirmed ? 'إشارة مرجعية' : p ? 'بانتظار التأكيد' : 'مراقبة');
    if (!p) {const box = node('div', 'empty-signal'); box.append(node('span', 'empty-symbol', '⌖'), node('h3', '', m?.analysis?.status === 'WARMING' ? 'يجري بناء سجل ' + m.name : 'نبحث عن فرصة'),
      node('p', '', m?.suspendedSignal ? 'متابعة الخطة معلّقة حتى يعود سعر حديث؛ مستوياتها محفوظة في سجل الفرص.' : 'تظهر مستويات الدخول والوقف والأهداف عندما يتوافق الاتجاه وتكتمل البيانات.')); $('scalp-plan').replaceChildren(box); return;}
    const box = node('div'), heading = node('div', 'signal-heading'); heading.append(node('strong', p.side === 'BUY' ? 'buy' : 'sell', side(p.side)), pill(confirmed ? 'شروط السعر تحققت' : 'مستويات مشروطة', confirmed ? 'good' : 'warn'));
    box.append(heading, node('p', 'subtle', confirmed ? 'خطة محفوظة عند إصدار الإشارة؛ لا تتغير مع تحرك السعر.' : 'راقب إغلاق دقيقة وتوافق RSI وقرب السعر؛ مستويات المراقبة تتغير مع تكوّن الشموع.'));
    const values = node('div', 'signal-values');
    for (const [label, value] of [[confirmed ? 'دخول مرجعي ثابت' : 'مستوى المراقبة', p.entry], ['وقف الخسارة', p.sl], ['الهدف الأول · 1R', p.tp1], ['الهدف الثاني · 1.5R', p.tp2]]) {
      const cell = node('div', 'value-cell'); cell.append(node('small', '', label), node('strong', 'number', fmt(value))); values.append(cell);}
    box.append(values, node('p', 'source-caption', `${m.source} · ${m.symbol} · ${p.sampled ? 'شموع من عينات المصدر' : 'شموع المصدر'}`),
      node('p', 'subtle', confirmed ? `صدرت ${time(p.issued_at)} · متبقي ${Math.max(0, Math.ceil(p.expires_at - now()))} ثانية` : 'مراقبة فقط؛ لا تُعامل كإشارة دخول مؤكدة.'));
    $('scalp-plan').replaceChildren(box);
  }
  async function loadChart() {
    const requestedSymbol = symbol, requestedTf = tf, id = ++chartRequest;
    try {const result = await api(`/api/market/candles?symbol=${symbol}&tf=${tf}`);
      if (id !== chartRequest || symbol !== requestedSymbol || tf !== requestedTf) return;
      rows = result.candles || []; mergeChartTail(); drawChart();
      put('live-chart-title', 'شارت ' + (market()?.name || symbol));
      put('live-chart-source', `${result.source} · ${result.symbol} · ${result.candle_kind === 'SAMPLED_REFERENCE' ? 'عينات أسعار؛ ليست كامل تداولات البروكر' : 'تاريخ المنصة + متابعة السعر'} · ${tf}`);
    } catch {if (id === chartRequest) put('live-chart-source', 'تعذر تحديث الشارت؛ آخر بيانات متاحة محفوظة.');}
  }
  function mergeChartTail() {
    const tail = market()?.chart_tail?.[tf];
    if (!tail?.length) return;
    const merged = new Map(rows.map(c => [c.time, c]));
    for (const c of tail) merged.set(c.time, c);
    rows = [...merged.values()].sort((a, b) => a.time - b.time).slice(-320);
  }
  function drawChart() {
    const canvas = $('live-chart'), rect = canvas.getBoundingClientRect(); if (rect.width < 10) return;
    const dpr = window.devicePixelRatio || 1; canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); const W = rect.width, H = rect.height, left = 5, right = 82, top = 22, bottom = 30, width = W - left - right, height = H - top - bottom;
    ctx.clearRect(0, 0, W, H); $('live-chart-empty').hidden = rows.length > 0; if (!rows.length) return;
    const visible = rows.slice(-Math.min(100, Math.max(1, Math.floor(width / 6)))), p = activePlan();
    const levels = p ? [['دخول', p.entry, '#b399ff'], ['SL', p.sl, '#fa929e'], ['TP1', p.tp1, '#75dcb1'], ['TP2', p.tp2, '#75dcb1']] : [];
    const prices = [...visible.flatMap(c => [c.high, c.low]), ...levels.map(l => l[1])], lo = Math.min(...prices), hi = Math.max(...prices), pad = (hi - lo) * .1 || 1, min = lo - pad, max = hi + pad;
    const py = price => top + (max - price) / (max - min) * height, dx = width / visible.length;
    ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {const y = top + height * i / 4; ctx.strokeStyle = '#342b415f'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(W - right, y); ctx.stroke(); ctx.fillStyle = '#a89bbd'; ctx.fillText(fmt(max - (max - min) * i / 4), W - right + 7, y + 4);}
    visible.forEach((c, i) => {const x = left + dx * (i + .5); ctx.strokeStyle = ctx.fillStyle = c.close >= c.open ? '#75dcb1' : '#fa929e'; ctx.globalAlpha = i === visible.length - 1 && c.time + ({M1:60,M5:300,M15:900}[tf]) > now() ? .65 : 1;
      ctx.beginPath(); ctx.moveTo(x, py(c.high)); ctx.lineTo(x, py(c.low)); ctx.stroke(); ctx.fillRect(x - Math.min(8, Math.max(1, dx * .25)), Math.min(py(c.open), py(c.close)), Math.min(16, Math.max(2, dx * .5)), Math.max(1, Math.abs(py(c.open) - py(c.close))));}); ctx.globalAlpha = 1;
    const closes = rows.map(c => c.close), start = rows.length - visible.length; ctx.strokeStyle = '#b399ff'; ctx.beginPath(); let begun = false;
    for (let i = 0; i < visible.length; i++) {const value = ema(closes.slice(0, start + i + 1), 21); if (value != null) {const x = left + dx * (i + .5), y = py(value); if (!begun) {ctx.moveTo(x, y); begun = true;} else ctx.lineTo(x, y);}} ctx.stroke();
    for (const [label, price, color] of levels) {ctx.strokeStyle = color; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(left, py(price)); ctx.lineTo(W - right, py(price)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = color; ctx.fillText(label, W - right + 7, py(price) - 4);}
    ctx.fillStyle = '#9385a7'; ctx.textAlign = 'center';
    for (const i of [...new Set([0, Math.floor(visible.length / 2), visible.length - 1])]) ctx.fillText(time(visible[i].time), Math.min(W - right - 20, Math.max(28, left + dx * (i + .5))), H - 7);
    canvas.onpointermove = event => {const i = Math.min(visible.length - 1, Math.max(0, Math.floor((event.offsetX - left) / dx))), c = visible[i]; put('live-chart-tooltip', `${time(c.time, true)}\nO ${fmt(c.open)}  H ${fmt(c.high)}\nL ${fmt(c.low)}  C ${fmt(c.close)}`); $('live-chart-tooltip').hidden = false;};
    canvas.onpointerleave = () => {$('live-chart-tooltip').hidden = true;};
  }
  async function loadHistory() {
    if (historyFetched) return; historyFetched = true;
    try {const d = await api('/api/market/signals'); historyRows = d.signals || []; renderHistory();} catch {} finally {historyFetched = false;}
  }
  function renderHistory() {
    const selected = $('scalp-history-filter').value, list = historyRows.filter(p => selected === 'ALL' || p.symbol === selected);
    $('scalp-history-list').replaceChildren(...(list.length ? list.map(p => {const row = node('article', 'signal-row'), title = node('div'); title.append(node('small', 'signal-source', p.source + ' · مرجعي'), node('h3', p.side === 'BUY' ? 'buy' : 'sell', `${side(p.side)} · ${p.symbol}`), node('small', 'subtle', time(p.issued_at, true)));
      const levels = node('div', 'level-inline'); for (const [label, value] of [['دخول', p.entry], ['وقف', p.sl], ['هدف أول', p.tp1], ['هدف ثان', p.tp2]]) {const cell = node('div'); cell.append(node('small', '', label), node('strong', '', fmt(value))); levels.append(cell);}
      row.append(title, levels, pill(status[p.status] || p.status, p.status === 'SL' ? 'bad' : p.status === 'TP2' ? 'good' : 'neutral')); return row;}) : [empty('لا توجد إشارات مؤكدة في هذا السجل بعد. فرص المراقبة تظهر على الرئيسية.') ]));
  }
  function article(item, compact = false) {
    const card = node('article', compact ? 'headline-preview' : 'news-card'), link = node('a', 'headline-link', item.title);
    link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.dir = 'auto';
    const meta = node('div', 'event-meta'); meta.append(pill(item.source_name, 'outline'), node('small', 'subtle', time(item.published_at, true)));
    card.append(meta, link);
    if (!compact) card.append(node('p', 'subtle', `${category[item.category]} · وصل للموقع ${time(item.received_at, true)}`));
    return card;
  }
  function renderNews() {
    if (!news) return;
    const filter = $('headline-filter').value, list = news.items.filter(x => filter === 'ALL' || x.category === filter);
    put('headline-count', `${list.length} خبر · وقت غزة`); put('headline-note', news.note);
    const stamp = `${news.revision}:${filter}:${news.items.length}`;
    if (stamp !== newsStamp) {newsStamp = stamp; $('headlines-list').replaceChildren(...(list.length ? list.map(x => article(x)) : [empty('لا توجد أخبار ضمن هذا الموضوع في المصادر المتصلة.')])); $('live-news-preview').replaceChildren(...(news.items.length ? news.items.slice(0, 2).map(x => article(x, true)) : [empty('يجري جلب عناوين الأخبار من المصادر.')]));}
    $('headline-sources').replaceChildren(...news.sources.map(s => {const box = node('div', 'headline-source'), success = s.status === 'LIVE';
      box.append(node('strong', '', s.name), pill(success ? 'متصل' : s.status === 'PENDING' ? 'جلب…' : 'متأخر / تعذر الجلب', success ? 'good' : 'warn'),
        node('small', 'subtle', s.checked_at ? `آخر فحص قبل ${Math.max(0, Math.floor(now() - s.checked_at))} ثانية` : 'لم يكتمل أول فحص'),
        node('small', 'subtle', s.next_check ? `الفحص التالي بعد ${Math.max(0, Math.ceil((s.next_check - now()) / 60))} دقيقة حسب المصدر` : ''));
      return box;}));
    const checked = Math.max(0, ...news.sources.map(x => x.checked_at || 0));
    put('live-news-age', checked ? `آخر فحص قبل ${Math.max(0, Math.floor(now() - checked))} ثانية · تحديث الواجهة كل ثانية` : 'بانتظار المصادر.');
  }
  async function fetchLive() {
    if (fetched) return; fetched = true;
    await Promise.allSettled([api('/api/market').then(applyMarket), api('/api/news').then(d => {news = d; renderNews();})]); fetched = false;
  }
  $('market-symbols').querySelectorAll('button').forEach(b => b.onclick = () => {symbol = b.dataset.symbol; rows = []; chartKey = ''; chartRequest++; $('market-symbols').querySelectorAll('button').forEach(x => {x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b));}); render(); loadChart();});
  $('live-chart-tfs').querySelectorAll('button').forEach(b => b.onclick = () => {tf = b.dataset.tf; rows = []; chartKey = ''; chartRequest++; $('live-chart-tfs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); loadChart();});
  $('scalp-history-filter').onchange = renderHistory; $('headline-filter').onchange = () => {newsStamp = ''; renderNews();};
  stream.addEventListener('market', event => {try {applyMarket(JSON.parse(event.data));} catch {}});
  stream.addEventListener('news', event => {try {news = JSON.parse(event.data); newsStamp = ''; renderNews();} catch {}});
  new ResizeObserver(drawChart).observe($('live-chart'));
  document.addEventListener('visibilitychange', () => {if (!document.hidden) {fetchLive(); loadHistory();}});
  setInterval(() => {render(); renderNews(); if (activePlan()) drawChart();}, 1000);
  setInterval(() => {if (Date.now() - lastServerSeen > 4500) fetchLive();}, 5000);
  fetchLive(); loadHistory();
}
