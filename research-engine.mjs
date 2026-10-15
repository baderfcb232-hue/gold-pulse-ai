// Pure, shared browser/Node research code. No optimizer, credentials or order API.
export const MODEL_VERSION = 'NABD-D1-RESEARCH-1';
export const models = Object.freeze([
  {id: 'EMA15_150', name: 'تقاطع EMA 15 / 150', warmup: 150,
    rules: 'شراء بعد تقاطع EMA15 فوق EMA150، وخروج بعد التقاطع المعاكس. وقف ثابت 2×ATR20. شراء فقط. القرار عند الإغلاق والتنفيذ الافتراضي عند الافتتاح التالي.',
    difference: 'مستوحى من مثال Seykota التعليمي. الوقف والتكاليف ووحدات R تعديلات نبض؛ لا يكرر سجل المثال أو نظامه الحالي.'},
  {id: 'DONCHIAN55_20', name: 'اختراق Donchian 55 / 20', warmup: 55,
    rules: 'شراء عند إغلاق أعلى من قمم 55 شمعة سابقة، وبيع عند إغلاق أدنى من قيعانها. خروج عند كسر إغلاق قناة 20 بالاتجاه المعاكس. وقف ثابت 2×ATR20. مركز واحد دون تعزيز.',
    difference: 'تبسيط لفرع 55 يومًا في Turtle Rules. الأصل يستخدم اختراقًا أثناء اليوم ووحدات وتعزيزًا؛ هنا تأكيد إغلاق وتنفيذ في اليوم التالي.'}
]);

function fail(message) {throw new Error(message);}
const finite = v => typeof v === 'number' && Number.isFinite(v);

export function parseDailyCSV(raw) {
  if (typeof raw !== 'string' || raw.length > 2_000_000) fail('حجم CSV يتجاوز الحد المسموح.');
  const lines = raw.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const delimiter = lines[0]?.includes('\t') ? '\t' : lines[0]?.includes(';') ? ';' : ',';
  const cells = line => line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
  const header = cells(lines[0] || '').map(s => s.replace(/[<>]/g, '').toLowerCase());
  const fields = ['date', 'open', 'high', 'low', 'close'];
  if (!fields.every(k => header.includes(k))) fail('CSV يحتاج أعمدة DATE, OPEN, HIGH, LOW, CLOSE من تصدير D1.');
  return lines.slice(1).filter(s => s.trim()).map(line => {
    const values = cells(line), get = k => values[header.indexOf(k)];
    const date = get('date')?.replaceAll('.', '-'), time = header.includes('time') ? get('time') : '00:00:00';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}(:\d{2})?$/.test(time || '')) fail('صيغة تاريخ أو وقت CSV غير صالحة.');
    const stamp = Date.parse(`${date}T${time.length === 5 ? time + ':00' : time}Z`);
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) fail('تاريخ CSV غير صالح.');
    const bar = {time: stamp / 1000};
    for (const key of fields.slice(1)) {
      if (!get(key)?.trim()) fail('CSV يحتوي سعرًا مفقودًا.');
      bar[key] = Number(get(key));
    }
    return bar;
  });
}

export function validateDataset(data, now = Date.now() / 1000) {
  if (!data || data.timeframe !== 'D1') fail('المختبر يقبل D1 فقط؛ نتائج الدراسات اليومية لا تثبت صلاحية فريم الدقيقة.');
  for (const key of ['symbol', 'source']) if (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 160)
    fail('أدخل رمز السوق واسم مصدر البيانات.');
  if (!Array.isArray(data.bars) || data.bars.length < 800 || data.bars.length > 5000)
    fail('يلزم 800 إلى 5000 شمعة يومية مغلقة، مرتبة من الأقدم للأحدث.');
  const costs = data.costs;
  for (const key of ['spreadBps', 'slippageBps', 'commissionBps', 'carryBpsPerDay'])
    if (!costs || !finite(costs[key]) || costs[key] < 0 || costs[key] > 1000)
      fail('كل التكاليف الأربع مطلوبة، بأرقام من 0 إلى 1000 نقطة أساس؛ لا نفترض تكلفة مفقودة تساوي صفرًا.');
  if (!costs.acknowledged) fail('أكد مراجعة التكاليف؛ إدخال صفر افتراض يجب التصريح به.');
  let previous = null, missingDays = 0;
  for (const b of data.bars) {
    if (!b || !Number.isSafeInteger(b.time) || b.time <= 0 || b.time + 86400 > now ||
      !['open', 'high', 'low', 'close'].every(k => finite(b[k]) && b[k] > 0) ||
      b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) || b.low > b.high)
      fail('شموع غير صالحة، غير مغلقة أو مؤرخة في المستقبل. الوقت المطلوب Unix بالثواني.');
    if (previous) {
      const days = (b.time - previous.time) / 86400;
      if (!Number.isInteger(days) || days < 1 || days > 7)
        fail('التواريخ مكررة أو غير مرتبة، أو فاصل D1 غير منتظم، أو فجوة تتجاوز 7 أيام.');
      missingDays += days - 1;
    }
    previous = b;
  }
  return {missingDays, zeroCostAssumption: Object.values(costs).filter(finite).every(x => x === 0)};
}

export function wilson(wins, count) {
  if (!count) return null;
  const z = 1.95996398454, p = wins / count, d = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / d;
  const width = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / d;
  return [Math.max(0, center - width), Math.min(1, center + width)];
}

export function summarize(trades) {
  let totalR = 0, peak = 0, maxDrawdownR = 0, gain = 0, loss = 0, wins = 0;
  for (const t of trades) {
    totalR += t.r; peak = Math.max(peak, totalR); maxDrawdownR = Math.max(maxDrawdownR, peak - totalR);
    if (t.r > 0) {gain += t.r; wins++;} else loss -= t.r;
  }
  return {trades: trades.length, wins, losses: trades.filter(t => t.r < 0).length,
    flat: trades.filter(t => t.r === 0).length, boundaryExits: trades.filter(t => t.reason === 'WINDOW_END').length,
    totalR, expectancyR: trades.length ? totalR / trades.length : null,
    profitFactor: loss > 0 ? gain / loss : null, noLossesObserved: loss === 0 && trades.length > 0,
    maxDrawdownR, winRate: trades.length ? wins / trades.length : null, wilson95: wilson(wins, trades.length)};
}

function indicators(bars) {
  const e15 = [], e150 = [], atr = [];
  let fast, slow, n, trueRangeSum = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], prior = bars[i - 1]?.close ?? b.open;
    fast = i ? fast + (b.close - fast) * 2 / 16 : b.close;
    slow = i ? slow + (b.close - slow) * 2 / 151 : b.close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - prior), Math.abs(b.low - prior));
    if (i < 20) {trueRangeSum += tr; if (i === 19) n = trueRangeSum / 20;}
    else n = (19 * n + tr) / 20;
    e15.push(fast); e150.push(slow); atr.push(n ?? null);
  }
  return {e15, e150, atr};
}

export function analyzeDailyContext(data, now = Date.now() / 1000) {
  if (!data || data.timeframe !== 'D1' || !Array.isArray(data.bars) || data.bars.length < 152 || data.bars.length > 5000)
    fail('Insufficient closed daily history');
  let previous = null;
  for (const b of data.bars) {
    if (!Number.isSafeInteger(b.time) || b.time <= 0 || b.time + 86400 > now ||
      !['open', 'high', 'low', 'close'].every(k => finite(b[k]) && b[k] > 0) ||
      b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close)) fail('Invalid daily history');
    const gap = previous ? (b.time - previous.time) / 86400 : 1;
    if (!Number.isInteger(gap) || gap < 1 || gap > 7) fail('Invalid daily gap');
    previous = b;
  }
  const bars = data.bars, i = bars.length - 1, {e15, e150, atr} = indicators(bars);
  const context = {version: MODEL_VERSION, source: data.source, symbol: data.symbol, timeframe: 'D1',
    lastClosedAt: bars[i].time + 86400, status: 'CONTEXT_ONLY', publicationAllowed: false,
    emaTrend: e15[i] > e150[i] ? 'UP' : e15[i] < e150[i] ? 'DOWN' : 'FLAT',
    emaCross: e15[i] > e150[i] && e15[i - 1] <= e150[i - 1] ? 'UP'
      : e15[i] < e150[i] && e15[i - 1] >= e150[i - 1] ? 'DOWN' : null,
    donchianBreak: bars[i].close > extreme(bars, i, 55, 'high', true) ? 'UP'
      : bars[i].close < extreme(bars, i, 55, 'low', false) ? 'DOWN' : null,
    atr20: atr[i], claimedSuccessRate: null};
  if (now - context.lastClosedAt > 3 * 86400) context.status = 'STALE';
  return context;
}

function extreme(bars, i, period, field, high) {
  let value = high ? -Infinity : Infinity;
  for (let j = i - period; j < i; j++) value = high ? Math.max(value, bars[j][field]) : Math.min(value, bars[j][field]);
  return value;
}

// Decisions use [0..i] after candle i closes. Orders execute at open of i+1.
export function simulateWindow(data, modelId, start, end, prepared = indicators(data.bars)) {
  const model = models.find(m => m.id === modelId);
  if (!model) fail('نموذج غير معروف.');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < model.warmup || end > data.bars.length || end <= start)
    fail('فترة الاختبار غير صالحة.');
  const bars = data.bars, costs = data.costs, trades = [];
  let position = null, order = null;
  function close(price, i, reason) {
    const p = position, holdDays = Math.max(1, (bars[i].time - p.entryTime) / 86400);
    const perSide = costs.spreadBps / 2 + costs.slippageBps + costs.commissionBps;
    const costR = ((p.entry + price) * perSide + p.entry * costs.carryBpsPerDay * holdDays) / 10000 / p.risk;
    const grossR = p.side * (price - p.entry) / p.risk;
    trades.push({...p, exitTime: bars[i].time, exit: price, reason, holdDays, grossR, costR, r: grossR - costR});
    position = null;
  }
  for (let i = start; i < end; i++) {
    const b = bars[i];
    // An existing stop gaps to the open before any scheduled close.
    if (position && (position.side === 1 ? b.open <= position.stop : b.open >= position.stop)) close(b.open, i, 'STOP_GAP');
    if (order?.action === 'EXIT' && position) close(b.open, i, 'RULE_EXIT');
    if (order?.action === 'ENTER' && !position) {
      const risk = 2 * order.atr;
      if (risk > 0 && b.open - order.side * risk > 0) position = {side: order.side, entry: b.open,
        entryTime: b.time, signalTime: order.signalTime, risk, stop: b.open - order.side * risk};
    }
    order = null;
    if (position && (position.side === 1 ? b.low <= position.stop : b.high >= position.stop)) close(position.stop, i, 'STOP');
    const {e15, e150, atr} = prepared;
    let direction = 0, exit = false;
    if (modelId === 'EMA15_150') {
      direction = e15[i] > e150[i] && e15[i - 1] <= e150[i - 1] ? 1 : 0;
      exit = Boolean(position && e15[i] < e150[i]);
    } else {
      direction = b.close > extreme(bars, i, 55, 'high', true) ? 1
        : b.close < extreme(bars, i, 55, 'low', false) ? -1 : 0;
      exit = Boolean(position && (position.side === 1 ? b.close < extreme(bars, i, 20, 'low', false)
        : b.close > extreme(bars, i, 20, 'high', true)));
    }
    if (position && exit) order = {action: 'EXIT'};
    else if (!position && direction && atr[i] > 0) order = {action: 'ENTER', side: direction, atr: atr[i], signalTime: b.time};
  }
  // Count the last open trade at the boundary, with full costs. Never hide it as unresolved.
  if (position) close(bars[end - 1].close, end - 1, 'WINDOW_END');
  return {start: bars[start].time, end: bars[end - 1].time, ...summarize(trades), ledger: trades};
}

export function runResearch(data, now) {
  const quality = validateDataset(data, now), n = data.bars.length, prepared = indicators(data.bars);
  const a = Math.floor(n * .6), b = Math.floor(n * .8);
  const output = models.map(m => {
    const windows = [[m.warmup, a, 'DEVELOPMENT'], [a, b, 'CHECK_A'], [b, n, 'CHECK_B']]
      .map(([start, end, label]) => ({label, ...simulateWindow(data, m.id, start, end, prepared)}));
    return {id: m.id, windows, ...summarize(windows.flatMap(w => w.ledger)),
      assessment: 'UNVALIDATED_SIMULATION', publicationAllowed: false};
  });
  return {version: MODEL_VERSION, symbol: data.symbol, source: data.source, timeframe: 'D1',
    bars: n, first: data.bars[0].time, last: data.bars.at(-1).time, costs: data.costs, quality,
    results: output, publicationAllowed: false, claimedSuccessRate: null,
    limitations: ['نتائج افتراضية بتكاليف مقدرة؛ لا تثبت ربحًا مستقبليًا أو دقة 95%.',
      'الفترتان الأخيرتان منفصلتان زمنيًا، لكن تكرار المشاهدة أو اختيار الفائز يجعلها غير مستقلة؛ يلزم اختبار أمامي جديد.',
      'الوقف مبني على OHLC مرجعي؛ التنفيذ والسبريد المتغير والسيولة والسواب الفعلي قد يختلفون.',
      'هبوط R محسوب عند إغلاق الصفقات فقط؛ لا يقيس أقصى هبوط أثناء الصفقة أو خطر الهامش.',
      'النموذجان من عائلة اتباع الاتجاه؛ اتفاقهما ليس دليلين مستقلين أو احتمال نجاح.',
      'نطاق Wilson وصفي تحت افتراض صفقات مستقلة؛ الارتباط وتغير السوق قد يجعلان عدم اليقين أكبر.']};
}
