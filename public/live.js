import {drawBrokerCandles} from './broker-chart.js';
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
  const tfLabels = {M1: 'دقيقة', M5: '5 دقائق', M15: '15 دقيقة', H1: 'ساعة', H4: '4 ساعات'};
  const tfButtons = {M1: '1د', M5: '5د', M15: '15د', H1: '1س', H4: '4س'};
  let data = null, news = null, symbol = 'XAUUSD', tf = 'M15', chartKey = '';
  let lastServerSeen = 0, lastNewsSeen = 0, fetched = false, historyFetched = false, historyRows = [], historyStamp = '', newsStamp = '';
  let initialized = false;
  let chartSourceKey = '', referenceChart = false, brokerChartData = null, brokerChartKey = '', brokerChartLoading = false;
  let lastBrokerFetch = 0, quotePolling = false, lastQuoteStamp = '';
  const seenSignals = new Set();
  const market = () => data?.markets?.[symbol];
  const fresh = m => Boolean(m?.quote && m.connection === 'LIVE' && now() - m.quote.time <= m.quoteTtl && Date.now() - lastServerSeen < 12000);
  const activePlan = () => {const m = market(); return fresh(m) && m.currentSignal?.expires_at > now() ? m.currentSignal : null;};
  function applyMarket(next) {
    if (data && next.serverTime < data.serverTime) return;
    data = next; lastServerSeen = Date.now();
    if (!data.markets[symbol]) symbol = 'XAUUSD';
    $('market-symbols').querySelectorAll('button').forEach(b => {
      b.hidden = !data.markets[b.dataset.symbol];
      b.classList.toggle('active', b.dataset.symbol === symbol);
      b.setAttribute('aria-pressed', String(b.dataset.symbol === symbol));
    });
    configureChart();
    // Each market must notify independently: a BTC recommendation must not be lost
    // just because the operator is currently browsing the gold chart.
    for (const item of Object.values(data.markets)) {
      const plan = item.currentSignal;
      if (!plan || seenSignals.has(plan.id)) continue;
      if (initialized && fresh(item) && plan.expires_at > now() && $('signal-notifications').checked)
        notify(`فرصة مضاربة ${side(plan.side)} · ${item.name} · ${fmt(plan.entry)}`);
      seenSignals.add(plan.id);
    }
    initialized = true;
    render();
    loadChart();
    const stamp = Object.values(data.markets).map(m => m.recentSignals.map(p => p.id + p.status).join(':')).join('|');
    if (stamp !== historyStamp) {historyStamp = stamp; loadHistory();}
  }
  function configureChart() {
    if (symbol === chartSourceKey) return;
    chartSourceKey = symbol; tf = 'M15'; chartKey = ''; brokerChartKey = ''; brokerChartData = null;
    $('live-chart-tfs').replaceChildren(...['M1', 'M5', 'M15', 'H1', 'H4'].map(value => {
      const b = node('button', value === tf ? 'active' : '', tfButtons[value]);
      b.dataset.tf = value; b.setAttribute('aria-pressed', String(value === tf)); return b;
    }));
  }
  // Use one-second broker snapshots for the displayed quote only.
  // Do not alter strategy status, signals, candles or execution eligibility here.
  async function refreshBrokerQuotes() {
    if (quotePolling || document.hidden) return;
    quotePolling = true;
    try {
      const response = await api('/api/market/broker-quotes');
      const q = response?.quotes?.[symbol], m = market();
      if (!m || m.candle_kind !== 'BROKER_OHLC' || !q || q.source_id !== m.source_id) return;
      const stamp = symbol + ':' + q.quote.time + ':' + q.quote.bid + ':' + q.quote.ask;
      if (stamp !== lastQuoteStamp) {
        lastQuoteStamp = stamp;
        put('live-price',fmt(q.quote.price));
        put('live-ask',fmt(q.quote.ask));put('live-bid',fmt(q.quote.bid));
        put('live-spread',Number.isFinite(q.point) && q.point > 0 ?
          num((q.quote.ask-q.quote.bid)/q.point,1)+' نقطة' : fmt(q.quote.ask-q.quote.bid)+' USD');
      }
      put('live-update-age','عمر السعر '+Math.max(0,Math.floor(response.serverTime-q.quote.time))+' ثانية');
      $('live-connection').className='pill '+(q.connection==='LIVE'?'good':'warn');
      put('live-connection',q.connection==='LIVE'?'متابعة السوق متصلة':'السعر متأخر / انقطاع المصدر');
    } catch {
      // Existing SSE and five-second fallback stay available on network errors.
    } finally {quotePolling = false;}
  }
  function render() {
    const m = market(), live = fresh(m), a = m?.analysis, p = activePlan();
    put('live-market-name', `${symbol} · ${m?.name || 'متابعة السوق'}`);
    put('live-connection', !m?.quote ? 'جلب السوق…' : live ? 'متابعة السوق متصلة' : 'السعر متأخر / انقطاع المصدر');
    $('live-connection').className = 'pill ' + (live ? 'good' : 'warn');
    put('live-update-age', m?.quote ? `عمر السعر ${Math.max(0, Math.floor(now() - m.quote.time))} ثانية` : 'بانتظار أول سعر');
    put('live-asset-title', (m?.name || (symbol === 'XAUUSD' ? 'الذهب' : 'بيتكوين')) + ' / دولار');
    put('live-price', fmt(m?.quote?.price));
    put('live-change', m?.change_from_last_close == null ? 'USD' : `${m.change_from_last_close >= 0 ? '+' : ''}${num(m.change_from_last_close, 3)}% عن آخر إغلاق`);
    put('live-source', m?.source || 'جلب المصدر'); put('live-quote-time', m?.quote ? time(m.quote.time) + ' · غزة' : '—');
    const quoteBroker = m?.candle_kind === 'BROKER_OHLC' && Number.isFinite(m?.quote?.bid) && Number.isFinite(m?.quote?.ask);
    $('broker-quote-values').hidden = !quoteBroker;
    if (quoteBroker) {
      put('live-ask', fmt(m.quote.ask)); put('live-bid', fmt(m.quote.bid));
      put('live-spread', Number.isFinite(m.point) && m.point > 0 ? num((m.quote.ask - m.quote.bid) / m.point, 1) + ' نقطة' : fmt(m.quote.ask - m.quote.bid) + ' USD');
    }
    const broker = m?.candle_kind === 'BROKER_OHLC';
    $('live-frames').style.gridTemplateColumns = broker ? 'repeat(2,minmax(0,1fr))' : 'repeat(3,minmax(0,1fr))';
    put('live-price-kind', broker ? 'سعر البروكر' : 'سعر مرجعي');
    put('live-strategy-frames', broker ? 'M5 / M15 / H1 / H4 · EMA / RSI / ATR' : 'M1 + M5 · EMA / RSI / ATR');
    put('live-source-note', broker ? `متوسط سعر الشراء والبيع لـ ${m.broker_symbol}. التحليل يستخدم شموع البروكر المغلقة؛ تاريخها يصل من الجسر دون انتظار تجميع جديد.`
      : m ? `${m.symbol === 'XAUUSD' ? 'الذهب المرجعي يُجلب كل نحو 30 ثانية؛ الشموع من عينات السعر المتاحة.' : (m.transport === 'WebSocket' ? 'بث Coinbase المباشر؛' : 'جلب Coinbase الاحتياطي كل ثانية؛') + ' سعر BTC-USD على المنصة.'} مستقل عن سعر تنفيذ بروكرك.` : 'ننتظر بيانات المصدر؛ لن نعرض أسعارًا تجريبية.');
    const states = {NO_DATA: 'انتظار المصدر', WARMING: 'تحميل الشموع', SCANNING: 'البحث عن فرصة', WATCH: 'فرصة مشروطة', READY: 'تحققت شروط السعر', GAP: 'فجوة بيانات', NEWS_BLOCK: 'فلتر الأخبار', BLOCKED: 'شروط الدخول تمنع الإشارة', STALE: 'تحديث متأخر'};
    const state = !live && m?.quote ? 'STALE' : a?.status || 'NO_DATA';
    const alignmentWait = broker && live && !p && a?.status === 'SCANNING' &&
      (a?.reason || '').startsWith('انتظار توافق الاتجاه:');
    put('scalp-decision', p ? side(p.side) + (broker ? ' · MT5' : ' · مرجعي') :
      alignmentWait ? 'انتظار توافق الفريمات' : states[state]);
    $('scalp-decision').className = p ? (p.side === 'BUY' ? 'buy' : 'sell') : '';
    put('scalp-status', p ? 'متابعة إشارة محفوظة' : alignmentWait ? 'مراقبة آمنة' : states[state]);
    $('scalp-status').className = 'pill ' + (p ? 'good' : alignmentWait || state === 'WATCH' ? 'warn' : 'neutral');
    put('scalp-reason', data.membersOnly ? 'سجّل الدخول بحساب مؤكد ومخوّل لمشاهدة التوصيات.' : !live && m?.quote ? 'إصدار فرص جديدة متوقف. نحتفظ بالشارت والتحليل السابق حتى يعود مصدر حديث.'
      : p ? `الإشارة صدرت ${time(p.issued_at)} ومستوياتها ثابتة. الشروط الحالية لفرصة جديدة: ${a?.reason || 'تجري المتابعة.'}` : a?.reason || 'يجري الاتصال بمصدر السوق.');
    const score = live && a?.checks?.length && Number.isFinite(a.score) && a.score >= 0 && a.score <= 100 ? a.score : null;
    put('scalp-score', score === null ? '— / 100' : `${score} / 100`);
    $('scalp-score').title = score === null ? 'تقييم توافق الشروط غير متاح حاليًا.' : 'توافق الشروط، وليس احتمال نجاح الصفقة.';
    $('scalp-score-fill').style.width = `${score ?? 0}%`;
    const checks = (a?.checks || []).map(ch => {const row = node('div', 'check'); row.append(node('span', ch.pass ? 'pass' : 'fail', ch.pass ? '✓' : '○'), node('span', '', ch.name)); return row;});
    if (m && state === 'WARMING') checks.push(empty(broker
      ? `ننتظر تحميل ${a.required_bars} شمعة مغلقة لكل إطار من البروكر؛ لا يلزم تجميعها من الصفر.`
      : `${m.minute_count} دقيقة مرصودة · نحتاج نحو 110 دقائق متصلة لتأكيد اتجاه M5.`));
    if (a && !a.calendar_available) checks.push(empty('التقويم الاقتصادي غير متصل؛ عناوين RSS لا تغطي كل مواعيد البيانات.'));
    $('scalp-checks').replaceChildren(...(checks.length ? checks : [empty('تظهر شروط المضاربة بعد اكتمال الشموع.')]));
    $('live-frames').replaceChildren(...(broker ? ['M5', 'M15', 'H1', 'H4'] : ['M1', 'M5', 'M15']).map(f => {const row = node('div', 'frame'), frame = a?.frames?.[f];
      row.append(node('strong', '', tfLabels[f]), node('span', 'frame-side ' + (live && frame?.direction === 'BUY' ? 'buy' : live && frame?.direction === 'SELL' ? 'sell' : ''), side(frame?.direction)));
      row.title = `${frame?.count || 0} شمعة مغلقة · ${live ? 'سياق حالي' : 'آخر سياق متاح'}`; return row;}));
    renderPlan(m, p || (live && a?.setup?.expires_at > now() ? a.setup : null), Boolean(p));
    $('scalp-recent').replaceChildren(...(m?.recentSignals?.length ? m.recentSignals.slice(0, 3).map(p => compactPlan(p)) : [empty('لم تصدر فرصة مؤكدة بعد. شروط المراقبة تظهر فوق عند توافق الاتجاه.')]));
  }
  function compactPlan(p) {
    const row = node('div', 'recent-plan'); row.append(node('strong', p.side === 'BUY' ? 'buy' : 'sell', `${side(p.side)} · ${fmt(p.entry)}`),
      node('span', 'subtle', `${time(p.issued_at)} · ${status[p.status] || 'مراقبة'}`)); return row;
  }
  function renderPlan(m, p, confirmed) {
    if (data?.membersOnly) {
      put('scalp-plan-status', 'للمشتركين');
      const box = node('div', 'empty-signal'), link = node('a', 'button primary', 'تسجيل الدخول'); link.href = '/auth';
      box.append(node('h3', '', 'التوصيات لحسابات نبض'), node('p', '', 'سجّل الدخول ببريد مؤكد لمشاهدة الخطط وسجل المتابعة.'), link);
      $('scalp-plan').replaceChildren(box); return;
    }
    put('scalp-plan-status', confirmed ? 'خطة متابعة' : p ? 'بانتظار التأكيد' : 'مراقبة');
    if (!p) {const box = node('div', 'empty-signal'); box.append(node('span', 'empty-symbol', '⌖'), node('h3', '', m?.analysis?.status === 'WARMING' ? m.candle_kind === 'BROKER_OHLC' ? 'بانتظار تحميل شموع البروكر' : 'يجري بناء سجل ' + m.name : 'نبحث عن فرصة'),
      node('p', '', m?.suspendedSignal ? 'متابعة الخطة معلّقة حتى يعود سعر حديث؛ مستوياتها محفوظة في سجل الفرص.' : 'تظهر مستويات الدخول والوقف والأهداف عندما يتوافق الاتجاه وتكتمل البيانات.')); $('scalp-plan').replaceChildren(box); return;}
    const box = node('div'), heading = node('div', 'signal-heading'); heading.append(node('strong', p.side === 'BUY' ? 'buy' : 'sell', side(p.side)), pill(confirmed ? 'شروط السعر تحققت' : 'مستويات مشروطة', confirmed ? 'good' : 'warn'));
    box.append(heading, node('p', 'subtle', confirmed ? 'خطة محفوظة عند إصدار الإشارة؛ لا تتغير مع تحرك السعر.' : 'راقب إغلاق دقيقة وتوافق RSI وقرب السعر؛ مستويات المراقبة تتغير مع تكوّن الشموع.'));
    const values = node('div', 'signal-values');
    const reward = value => num(Math.abs(value - p.entry) / p.risk_distance, 2);
    for (const [label, value] of [[confirmed ? 'دخول ثابت' : 'مستوى المراقبة', p.entry], ['وقف الخسارة', p.sl], [`الهدف الأول · ${reward(p.tp1)}R`, p.tp1], [`الهدف الثاني · ${reward(p.tp2)}R`, p.tp2]]) {
      const cell = node('div', 'value-cell'); cell.append(node('small', '', label), node('strong', 'number', fmt(value))); values.append(cell);}
    if(m.execution_mode==='DEMO_WEBSITE')box.append(node('p','control-explanation','ترتبط هذه التوصية بالتنفيذ التلقائي على Demo. يفحص MT5 السعر والمخاطرة قبل الدخول؛ التأكيد في قسم الصفقات.'));
    box.append(values, node('p', 'source-caption', `${p.source || m.source} · ${p.broker_symbol || m.symbol} · ${p.sampled ? 'شموع من عينات المصدر' : 'شموع المصدر'}`),
      node('p', 'subtle', confirmed ? `صدرت ${time(p.issued_at)} · متبقي ${Math.max(0, Math.ceil(p.expires_at - now()))} ثانية` : 'مراقبة فقط؛ لا تُعامل كإشارة دخول مؤكدة.'));
    $('scalp-plan').replaceChildren(box);
  }
  function signalLines() {
    const m = market(), p = activePlan();
    if (!p || m?.candle_kind !== 'BROKER_OHLC' || p.source_id !== m.source_id) return [];
    return [['دخول',p.entry,'#b9a0ff'],['SL',p.sl,'#ed778e'],['TP1',p.tp1,'#73d9b7'],['TP2',p.tp2,'#73d9b7']]
      .filter(([,value])=>Number.isFinite(value)).map(([name,value,color])=>({name,value,color}));
  }
  function drawBroker() {
    if (!brokerChartData || brokerChartData.symbol !== symbol || brokerChartData.tf !== tf) return;
    drawBrokerCandles($('broker-chart-canvas'),brokerChartData,signalLines());
  }
  async function loadBrokerChart() {
    if (referenceChart || brokerChartLoading) return;
    const m = market(), requestSymbol = symbol, requestTf = tf;
    const key = requestSymbol + ':' + requestTf + ':' + (m?.history_revision || 0) + ':' + (m?.received_at || 0);
    if (brokerChartKey === key && brokerChartData) {drawBroker();return;}
    // Poll no more frequently than every 3 seconds; avoid races across assets.
    if (Date.now() - lastBrokerFetch < 2800 && brokerChartData) {drawBroker();return;}
    lastBrokerFetch = Date.now(); brokerChartLoading = true;
    try {
      const payload = await api('/api/market/broker-candles?symbol=' + encodeURIComponent(requestSymbol) + '&tf=' + encodeURIComponent(requestTf));
      if (requestSymbol !== symbol || requestTf !== tf) return;
      if (!payload || payload.candle_kind !== 'BROKER_OHLC' || payload.symbol !== symbol || payload.tf !== tf) throw Error('Invalid broker chart source');
      brokerChartData = payload; brokerChartKey = key;
      $('broker-chart-empty').hidden = payload.candles?.length > 0;
      put('broker-chart-status', payload.connection === 'LIVE' ? 'شموع MT5 · متصل' : 'شموع MT5 · السعر متأخر');
      $('broker-chart-status').className = 'pill ' + (payload.connection === 'LIVE' ? 'good' : 'warn');
      put('live-chart-source', payload.source + ' · ' + payload.broker_symbol + ' · ' + tfLabels[tf]);
      put('live-chart-kind', 'شموع MT5 مغلقة · خطوط Bid/Ask وتوصيات من مصدر الوسيط نفسه. آخر شمعة قد تختلف عن آخر تيك.');
      drawBroker();
    } catch {
      if (requestSymbol !== symbol || requestTf !== tf) return;
      brokerChartKey = ''; brokerChartData = null; $('broker-chart-empty').hidden = false;
      put('broker-chart-status','بيانات MT5 غير متاحة');
      $('broker-chart-status').className = 'pill warn';
      put('live-chart-source','بانتظار شموع MT5 الحقيقية · لا استبدال ببيانات Coinbase');
    } finally {brokerChartLoading = false;}
  }
  function loadReferenceChart() {
    const key = symbol + ':' + tf;
    if (key === chartKey) return;
    chartKey = key;
    const tvSymbol = symbol === 'BTCUSD' ? 'COINBASE:BTCUSD' : 'OANDA:XAUUSD';
    const interval = {M1:'1',M5:'5',M15:'15',H1:'60',H4:'240'}[tf];
    const config = {autosize:true,symbol:tvSymbol,interval,timezone:'Etc/UTC',
      theme:'dark',backgroundColor:'rgba(12,21,29,1)',gridColor:'rgba(255,255,255,0.04)',
      style:'1',withdateranges:true,hide_side_toolbar:false,hide_top_toolbar:false,
      hide_legend:false,hide_volume:false,allow_symbol_change:false,save_image:false,
      studies:['MASimple@tv-basicstudies','RSI@tv-basicstudies','MACD@tv-basicstudies'],
      support_host:'https://www.tradingview.com',width:'100%',height:'100%'};
    const previousFrame=$('live-chart'),frame=previousFrame.cloneNode(false);
    frame.title='TradingView للمرجع فقط · '+tvSymbol;
    frame.onload=()=>{$('live-chart-empty').hidden=true;};
    frame.onerror=()=>{$('live-chart-empty').hidden=false;};
    frame.src='https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=ar#'+encodeURIComponent(JSON.stringify(config));
    previousFrame.replaceWith(frame);
    $('live-chart-full').href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent(tvSymbol)+'&interval='+interval;
  }
  function loadChart() {
    put('live-chart-title', 'شارت ' + (symbol === 'BTCUSD' ? 'بيتكوين' : 'الذهب'));
    $('broker-chart-wrap').hidden = referenceChart;
    $('reference-chart-wrap').hidden = !referenceChart;
    $('live-chart-full').hidden = !referenceChart;
    $('chart-reference-toggle').textContent = referenceChart ? 'العودة إلى شارت MT5' : 'عرض TradingView للمقارنة';
    $('chart-reference-toggle').setAttribute('aria-pressed',String(referenceChart));
    if (referenceChart) {
      loadReferenceChart();
      put('live-chart-source', 'TradingView · مرجع خارجي لا يُستخدم في توصيات MT5');
      put('live-chart-kind', 'سعر Coinbase / OANDA للمقارنة فقط وقد يختلف عن سعر JustMarkets.');
    } else loadBrokerChart();
  }
  async function loadHistory() {
    if (historyFetched) return; historyFetched = true;
    try {const d = await api('/api/market/signals'); historyRows = d.signals || []; renderHistory();} catch {} finally {historyFetched = false;}
  }
  function renderHistory() {
    const selected = $('scalp-history-filter').value, list = historyRows.filter(p => selected === 'ALL' || p.symbol === selected);
    $('scalp-history-list').replaceChildren(...(list.length ? list.map(p => {const row = node('article', 'signal-row'), title = node('div'); title.append(node('small', 'signal-source', p.source + ' · متابعة افتراضية'), node('h3', p.side === 'BUY' ? 'buy' : 'sell', `${side(p.side)} · ${p.broker_symbol || p.symbol}`), node('small', 'subtle', time(p.issued_at, true)));
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
  function applyNews(next) {
    if (!next || !Number.isFinite(next.serverTime) || !Array.isArray(next.items) || !Array.isArray(next.sources)) return;
    if (news && next.serverTime < news.serverTime) return;
    news = next; lastNewsSeen = Date.now(); newsStamp = ''; renderNews();
  }
  async function fetchLive() {
    if (fetched) return; fetched = true;
    await Promise.allSettled([api('/api/market').then(applyMarket), api('/api/news').then(applyNews)]); fetched = false;
  }
  $('market-symbols').querySelectorAll('button').forEach(b => b.onclick = () => {symbol = b.dataset.symbol; configureChart(); $('market-symbols').querySelectorAll('button').forEach(x => {x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b));}); render(); loadChart();});
  $('chart-reference-toggle').onclick = () => {referenceChart = !referenceChart; chartKey=''; brokerChartKey=''; loadChart();};
  $('live-chart-tfs').onclick = event => {
    const b = event.target.closest('button[data-tf]'); if (!b || !$('live-chart-tfs').contains(b)) return;
    tf = b.dataset.tf; brokerChartKey=''; lastBrokerFetch=0;
    $('live-chart-tfs').querySelectorAll('button').forEach(x => {x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b));}); loadChart();
  };
  $('scalp-history-filter').onchange = renderHistory; $('headline-filter').onchange = () => {newsStamp = ''; renderNews();};
  stream.addEventListener('market', event => {try {applyMarket(JSON.parse(event.data));} catch {}});
  stream.addEventListener('news', event => {try {applyNews(JSON.parse(event.data));} catch {}});
  document.addEventListener('visibilitychange', () => {if (!document.hidden) {fetchLive(); loadHistory(); refreshBrokerQuotes();}});
  setInterval(() => {render(); renderNews(); refreshBrokerQuotes();}, 1000);
  setInterval(() => {if (Date.now() - lastServerSeen > 4500 || !news || Date.now() - lastNewsSeen > 75000) fetchLive();}, 5000);
  configureChart(); loadChart(); fetchLive(); loadHistory();
}
