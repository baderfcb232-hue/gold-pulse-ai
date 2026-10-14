import {models, runResearch, parseDailyCSV} from '/research-engine.mjs';

const $ = id => document.getElementById(id);
const node = (tag, cls, text) => {const n = document.createElement(tag); if (cls) n.className = cls;
  if (text != null) n.textContent = String(text); return n;};
const num = value => value == null ? '—' : Number(value).toLocaleString('en-US', {maximumFractionDigits: 2});
const pct = value => value == null ? '—' : num(value * 100) + '%';
const date = value => new Date(value * 1000).toISOString().slice(0, 10);
const labels = {DEVELOPMENT: 'استكشافية', CHECK_A: 'مراجعة زمنية A', CHECK_B: 'مراجعة زمنية B'};
let report = null;
function saveFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type})), link = node('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('models').replaceChildren(...models.map((m, i) => {
  const card = node('article', 'card'); card.append(node('span', 'eyebrow', `0${i + 1} / DAILY TREND`),
    node('h3', '', m.name), node('p', '', m.rules), node('p', 'subtle', m.difference)); return card;
}));

async function loadCatalog() {
  try {
    const response = await fetch('/api/research', {cache: 'no-store'});
    if (!response.ok) throw Error('تعذر جلب مكتبة البحث.');
    const {catalog, researchPolicy} = await response.json();
    $('publication-status').textContent = researchPolicy.publicationAllowed ? 'راجع سياسة الإرسال' : 'Telegram متوقف · بحث فقط';
    $('policy-reason').textContent = researchPolicy.reason;
    $('review-date').textContent = `مراجعة المصادر: ${catalog.reviewedAt}`;
    $('families').replaceChildren(...catalog.families.map(f => {const tr = node('tr');
      tr.append(...[f.name, f.state, f.note].map(text => node('td', '', text))); return tr;}));
    $('sources').replaceChildren(...catalog.sources.map(s => {
      const card = node('article', 'card'), link = node('a', '', 'قراءة المصدر الأصلي ↗');
      link.href = s.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      card.append(node('h3', '', s.title), node('p', '', s.finding), node('p', 'subtle', s.limit), link); return card;
    }));
  } catch { $('publication-status').textContent = 'تعذر التحقق من حالة الإرسال';
    $('catalog-error').textContent = 'لم تصل مكتبة المصادر؛ أعد تحميل الصفحة بعد عودة الخادم.'; }
}
loadCatalog();

$('download-template').addEventListener('click', () => saveFile('nabd-d1-template.csv',
  'DATE,TIME,OPEN,HIGH,LOW,CLOSE\r\n', 'text/csv;charset=utf-8'));
$('research-form').addEventListener('submit', async event => {
  event.preventDefault(); $('research-error').textContent = '';
  report = null; $('report').hidden = true;
  const button = event.submitter; button.disabled = true;
  $('run-status').textContent = 'قراءة البيانات وفحص التواريخ والتكاليف…';
  try {
    const file = $('dataset-file').files[0];
    if (!file || file.size > 2_000_000) throw Error('اختر ملفًا بحجم لا يتجاوز2 MB.');
    const raw = await file.text(), form = new FormData(event.target);
    const bars = file.name.toLowerCase().endsWith('.json') ? (() => {const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : parsed.bars;})() : parseDailyCSV(raw);
    const costs = {acknowledged: $('cost-ack').checked};
    for (const key of ['spreadBps', 'slippageBps', 'commissionBps', 'carryBpsPerDay']) costs[key] = Number(form.get(key));
    report = runResearch({timeframe: 'D1', symbol: form.get('symbol').trim(), source: form.get('source').trim(), bars, costs});
    renderReport(); $('run-status').textContent = 'اكتمل الاختبار. النتيجة لا تفعّل توصيات أو صفقات.';
    $('report').scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (error) {$('research-error').textContent = error instanceof SyntaxError ? 'ملف JSON غير صالح.' : error.message;
    $('run-status').textContent = 'لم يكتمل الاختبار؛ لا توجد نتائج جديدة.';}
  finally {button.disabled = false;}
});

function renderReport() {
  $('report').hidden = false;
  $('report-meta').textContent = `${report.symbol} · ${report.source} · ${report.bars} شمعةD1 · ${date(report.first)} إلى ${date(report.last)} · ${report.version}`;
  $('research-results').replaceChildren(...report.results.map(result => {
    const card = node('article', 'card research-result'), model = models.find(m => m.id === result.id);
    card.append(node('h3', '', model.name), node('span', 'pill warn', 'محاكاة غير معتمدة للتداول'));
    const metrics = node('div', 'metrics-grid');
    for (const [label, value, note] of [
      ['الصفقات', num(result.trades), `${result.wins} رابحة / ${result.losses} خاسرة / ${result.flat} متعادلة`],
      ['نسبة الربح التاريخية', pct(result.winRate), 'ليست احتمال ربح الصفقة القادمة'],
      ['متوسط الصافي', num(result.expectancyR) + 'R', 'لكل صفقة بعد التكاليف المقدرة'],
      ['أقصى هبوط عند الإغلاق', num(result.maxDrawdownR) + 'R', 'لا يشمل الهبوط أثناء المركز أو الهامش']]) {
      const metric = node('div', 'metric'); metric.append(node('span', '', label), node('strong', '', value), node('small', '', note)); metrics.append(metric);
    }
    card.append(metrics);
    const wrap = node('div', 'research-table-wrap'), table = node('table'), head = node('thead'), tr = node('tr');
    tr.append(...['الفترة', 'الشموع', 'الصفقات', 'نسبة الربح', 'الصافي R', 'عامل الربح', 'إغلاق حدود الفترة'].map(t => node('th', '', t))); head.append(tr); table.append(head);
    const tbody = node('tbody');
    for (const w of result.windows) {const row = node('tr'); row.append(...[labels[w.label], `${date(w.start)} — ${date(w.end)}`,
      num(w.trades), pct(w.winRate), num(w.totalR), w.profitFactor == null ? w.noLossesObserved ? 'لا خسائر مرصودة؛ عينة محدودة' : '—' : num(w.profitFactor), num(w.boundaryExits)].map(t => node('td', '', t))); tbody.append(row);}
    table.append(tbody); wrap.append(table); card.append(wrap);
    const interval = result.wilson95;
    card.append(node('p', 'subtle', interval ? `نطاقWilson الوصفي95% لنسبة الربح المرصودة: ${pct(interval[0])}–${pct(interval[1])}. ليس دقة95% ولا تقديرًا مضمونًا للمستقبل؛ يفترض استقلال الصفقات.` : 'لم تُرصد صفقات؛ نسبة النجاح غير معرّفة.'));
    if (result.trades < 100 || result.windows.slice(1).some(w => w.trades < 30))
      card.append(node('p', 'subtle', 'عينة الصفقات محدودة للمراجعة. لا نحذف الفترات الضعيفة أو الصفقات المغلقة عند نهاية الفترة.'));
    return card;
  }));
  const notices = [report.quality.zeroCostAssumption ? 'التكاليف الأربع تساوي صفرًا بافتراضك؛ لا تمثل تكاليف وسيط مُتحققًا منها.' : 'التكاليف افتراضات ثابتة من إدخالك وليست سجل تنفيذ وسيط.',
    `أيام التقويم الغائبة: ${report.quality.missingDays}. قد تشمل عطلات أو بيانات مفقودة؛ لم نملأها بأسعار مصطنعة.`, ...report.limitations];
  $('report-limits').replaceChildren(node('strong', '', 'كيف تقرأ هذه النتيجة'), ...notices.map(t => node('p', '', t)));
}
$('download-report').addEventListener('click', () => {if (report) saveFile('nabd-research-report.json', JSON.stringify(report, null, 2), 'application/json');});
