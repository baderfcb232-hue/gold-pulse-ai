import {requestJson} from '/http.js';
import {translateUiText,currentLocale,setLocalizedText} from '/i18n-dom.js?v=v2-i18n-3';
const $ = id => document.getElementById(id);
const node = (tag, cls, text) => {const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) setLocalizedText(el,text); return el;};
const page = ({'/auth': 'auth', '/account': 'account', '/admin': 'admin', '/privacy': 'privacy'})[location.pathname] || 'auth';
document.querySelectorAll('[data-page]').forEach(el => {el.hidden = el.dataset.page !== page;});
const titles = {auth: 'تسجيل الدخول', account: 'حسابي', admin: 'إدارة نبض', privacy: 'الخصوصية'};
document.title = `${titles[page]} | نبض`;
let member = null, csrf = '', usersPage = 0, flowToken = '', signedIn = false;
const date = value => value ? new Intl.DateTimeFormat(currentLocale()==='en'?'en-GB':'ar-PS', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Gaza'}).format(Number(value) * 1000) : '—';
function message(text, error = false) {const el = $('portal-message'); setLocalizedText(el,text); el.classList.toggle('error', error); el.hidden = false;}
async function api(path, data) {
  return requestJson(path, {method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? {} : {'Content-Type': 'application/json', 'X-NABD-CSRF': csrf}, ...(data === undefined ? {} : {body: JSON.stringify(data)})}, 30000);
}
function form(id, run) {
  $(id).onsubmit = async event => {
    event.preventDefault(); const el = event.currentTarget, buttons = [...el.querySelectorAll('button[type=submit],button:not([type])')];
    buttons.forEach(b => {b.disabled = true;});
    try {await run(el, Object.fromEntries(new FormData(el)));} catch (error) {message(error.message, true);}
    finally {buttons.forEach(b => {b.disabled = false;});}
  };
}
function tab(name) {
  document.querySelectorAll('[data-auth-form]').forEach(el => {el.hidden = el.dataset.authForm !== name;});
  document.querySelectorAll('[data-auth-tab]').forEach(el => {el.classList.toggle('active', el.dataset.authTab === name);});
}
function authNotice(title, detail, confirmed = false) {
  let notice = $('auth-result');
  if (!notice) {
    notice = node('div', 'portal-message'); notice.id = 'auth-result';
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
    notice.tabIndex = -1;
    $('auth-readiness').after(notice);
  }
  notice.style.borderColor = confirmed ? '#66c99a80' : '';
  notice.style.background = confirmed ? '#16382b' : '';
  notice.style.color = confirmed ? '#c1f0d7' : '';
  notice.replaceChildren(node('strong', '', title), node('p', '', detail));
  $('portal-message').hidden = true;
  notice.focus();
}
document.querySelectorAll('[data-auth-tab]').forEach(el => {el.onclick = () => {tab(el.dataset.authTab); if ($('auth-result')) $('auth-result').remove();};});
async function logout(all = false) {
  await api(all ? '/api/auth/sessions/revoke' : '/api/auth/logout', all ? {all: true} : {}); location.assign('/auth');
}
$('member-logout').onclick = () => logout().catch(error => message(error.message, true));
form('member-login', async (el, values) => {const response = await api('/api/auth/login', values); el.reset(); if (response.mfaRequired) tab('mfa-login'); else location.assign('/account');});
form('member-register', async (el, values) => {const response = await api('/api/auth/register', {...values, acceptPrivacy: el.elements.privacy.checked}); el.reset(); tab('login'); $('member-login').elements.email.value = values.email; $('member-resend').elements.email.value = values.email; authNotice('تم استلام طلب التسجيل — الخطوة التالية تأكيد البريد', response.message + ' افتح رسالة نبض واضغط رابط التأكيد، ثم أكمل تأكيد بريدك قبل الدخول. تحقق أيضًا من البريد غير الهام.');});
for (const action of ['forgot', 'resend']) form('member-' + action, async (el, values) => {const response = await api('/api/auth/' + action, values); el.reset(); message(response.message);});
form('member-verify', async (el, values) => {const response = await api('/api/auth/verify', {token: flowToken, ...values}); flowToken = ''; el.reset(); tab('login'); authNotice('✓ تم تأكيد بريدك واكتمل تسجيلك بنجاح', 'حسابك جاهز. أدخل بريدك الإلكتروني وكلمة المرور التي حفظتها لتسجيل الدخول إلى نبض.', true);});
form('member-reset', async (el, values) => {const response = await api('/api/auth/reset', {token: flowToken, ...values}); flowToken = ''; el.reset(); message(response.message); tab('login');});
form('member-mfa-login', async (el, values) => {await api('/api/auth/mfa-login', values); el.reset(); location.assign('/account');});
form('profile-form', async (el, values) => {await api('/api/auth/profile', {name: values.name, notifications: el.elements.notifications.checked});
  try {localStorage.setItem('nabd-signal-notices', el.elements.notifications.checked ? 'on' : 'off');} catch {}
  $('member-name').textContent = values.name; message('تم حفظ معلوماتك وتفضيلاتك.');});
form('password-form', async (el, values) => {await api('/api/auth/password', values); el.reset(); location.assign('/auth');});
form('mfa-start', async (el, values) => {const response = await api('/api/auth/mfa/start', values); el.reset(); $('mfa-secret').textContent = response.secret; $('mfa-enrollment').hidden = false; message('أضف المفتاح في تطبيق المصادقة ثم أدخل الرمز خلال عشر دقائق.');});
form('mfa-confirm', async (el, values) => {const response = await api('/api/auth/mfa/confirm', values); el.reset(); $('mfa-secret').textContent = ''; $('mfa-enrollment').hidden = true; $('mfa-start').hidden = true; $('mfa-recovery').hidden = false; $('recovery-codes').textContent = response.recoveryCodes.join('\n'); $('mfa-state').textContent = 'التحقق بخطوتين مفعّل.'; $('admin-link').hidden = member?.role !== 'admin'; message('تم تفعيل التحقق بخطوتين. احفظ رموز الاسترداد في مكان آمن قبل مغادرة الصفحة.');});
async function sessions() {
  const response = await api('/api/auth/sessions');
  $('sessions-list').replaceChildren(...response.sessions.map(s => {
    const row = node('div', 'session-row'); row.append(node('strong', '', s.current ? 'هذا الجهاز' : 'جلسة أخرى'), node('p', '', s.agent), node('p', '', `بدأت ${date(s.created_at)} · آخر نشاط ${date(s.seen_at)}`));
    const button = node('button', 'button ghost', 'إنهاء الجلسة'); button.onclick = async () => {try {await api('/api/auth/sessions/revoke', {id: s.id}); if (s.current) location.assign('/auth'); else await sessions();} catch (error) {message(error.message, true);}};
    row.append(button); return row;
  }));
}
// Member MT5 registrations are metadata-only. Never solicit or transmit broker passwords.
async function memberMt5Accounts() {
  const response = await api('/api/auth/mt5-accounts');
  const list = $('member-mt5-list'), formEl = $('member-mt5-form');
  const accounts = response.accounts || [];
  formEl.hidden = accounts.length > 0;
  if (!accounts.length) {
    list.replaceChildren(node('p', 'subtle', 'لم تسجّل حساب MT5 بعد. يمكنك إدخال معلومات حساب Demo واحد للمرحلة التجريبية.'));
    return;
  }
  list.replaceChildren(...accounts.map(account => {
    const row = node('div', 'mt5-registration-row');
    const details = node('div');
    details.append(node('strong', '', account.broker + ' · Demo'),
      node('p', 'subtle', 'رقم الحساب: ' + account.login + ' · السيرفر: ' + account.server_name),
      node('p', 'mt5-inactive', 'بانتظار إعداد الربط · غير متصل · لا يوجد تداول تلقائي'));
    const remove = node('button', 'button ghost', 'حذف طلب التسجيل');
    remove.type = 'button';
    remove.onclick = async () => {
      if (!confirm('حذف طلب تسجيل حساب MT5 التجريبي؟')) return;
      remove.disabled = true;
      try {
        await api('/api/auth/mt5-accounts/remove', {id: account.id});
        message('تم حذف طلب تسجيل حساب MT5.');
        await memberMt5Accounts();
      } catch (error) {
        message(error.message, true);
        remove.disabled = false;
      }
    };
    const state = account.hosting_status || 'NOT_REQUESTED';
    const labels = {
      NOT_REQUESTED: 'لم تطلب الاستضافة المركزية بعد',
      REQUESTED: 'طلب الاستضافة قيد مراجعة الإدارة · لا يوجد اتصال',
      APPROVED: 'تمت الموافقة الإدارية على التجهيز · لا يوجد اتصال أو تداول',
      REJECTED: 'لم تتم الموافقة على الطلب · يمكنك تقديم طلب جديد',
      _WORKER: 'مراقبة MT5 التجريبية'
    };
    details.append(node('p', 'subtle', labels[state] || 'الاستضافة غير مفعّلة'));
    if (state === 'APPROVED') {
      const monitoringLabels={
        NOT_ISSUED:'لم يتم تجهيز مراقبة Windows بعد',
        AWAITING_WORKER:'بانتظار أول تقرير من Windows MT5',
        STALE:'توقف وصول تقارير Windows حديثة',
        MT5_OFFLINE:'Windows متصل بالموقع لكن MT5 غير متصل بالحساب',
        OBSERVED_DEMO:'تم رصد حساب Demo متصل من Windows · التداول غير مفعّل'
      };
      details.append(node('p', 'mt5-inactive',
        monitoringLabels[account.monitoring_status] || 'مراقبة الحساب غير مفعّلة'));
    }
    if (state === 'NOT_REQUESTED' || state === 'REJECTED') {
      const hosting = node('div', 'mt5-hosting-consent');
      const label = node('label', 'check-label');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      label.append(checkbox, node('span', '', 'أوافق على إرسال طلب استضافة Demo لإدارة نبض. أفهم أن الربط والتداول غير مفعّلين.'));
      const request = node('button', 'button ghost', 'طلب استضافة الحساب من نبض');
      request.type = 'button';
      request.onclick = async () => {
        if (!checkbox.checked) {message('وافق على شرح طلب الاستضافة أولًا.', true); return;}
        request.disabled = true;
        try {
          const answer = await api('/api/auth/mt5-hosting/request', {id: account.id, consent: true});
          message(answer.message);
          await memberMt5Accounts();
        } catch (error) {
          message(error.message, true);
          request.disabled = false;
        }
      };
      hosting.append(label, request);
      details.append(hosting);
    }
    row.append(details, remove);
    return row;
  }));
}
form('member-mt5-form', async (el, values) => {
  const response = await api('/api/auth/mt5-accounts', {
    broker: values.broker, server: values.server, login: values.login,
    environment: values.environment, acknowledge: el.elements.acknowledge.checked
  });
  el.reset();
  message(response.message);
  await memberMt5Accounts();
});
$('revoke-all').onclick = () => logout(true).catch(error => message(error.message, true));
form('deletion-form', async (el, values) => {await api('/api/auth/delete-request', values); el.reset(); message('تم إيقاف الحساب وتسجيل طلب الحذف للمراجعة.'); $('account-content').hidden = true; $('member-logout').hidden = true;});
const states = {active: 'مفعّل', disabled: 'معطّل', deletion_requested: 'طلب حذف'};
async function users() {
  const form = $('user-search'), params = new URLSearchParams({search: form.elements.search.value, status: form.elements.status.value, page: usersPage});
  const response = await api('/api/admin/users?' + params);
  $('users-page').textContent = `صفحة ${usersPage + 1}`; $('users-prev').disabled = usersPage === 0; $('users-next').disabled = response.users.length < 50;
  if (!response.users.length) {$('admin-users').replaceChildren(node('p', 'subtle', 'لا توجد حسابات مطابقة.')); return;}
  const wrap = node('div', 'users-table-wrap'), table = node('table', 'users-table'), header = node('tr');
  for (const value of ['المستخدم', 'البريد', 'التسجيل', 'الصلاحية والحالة', 'الإجراءات']) header.append(node('th', '', value));
  const head = node('thead'); head.append(header); const body = node('tbody');
  for (const u of response.users) {
    const row = node('tr'), info = node('td'); info.append(node('strong', '', u.name), node('p', 'subtle', u.role === 'admin' ? 'أدمن' : 'مستخدم'));
    const mail = node('td', '', u.email); mail.dir = 'ltr'; const joined = node('td', '', date(u.created_at));
    const state = node('td'), actions = node('td');
    if (u.role === 'admin') state.append(node('span', 'pill outline', 'حساب المسؤول'));
    else {
      const select = node('select'); select.setAttribute('aria-label', currentLocale()==='en' ? 'Account status: ' + u.name : 'حالة حساب ' + u.name);
      for (const [value, label] of Object.entries(states)) {const option = node('option', '', label); option.value = value; select.append(option);} select.value = u.status;
      const label = node('label', 'check-label'), permission = node('input'); permission.type = 'checkbox'; permission.checked = u.recommendations; label.append(permission, node('span', '', 'التوصيات')); state.append(select, label);
      const save = node('button', 'button ghost', 'حفظ'); save.onclick = async () => {save.disabled = true; try {await api('/api/admin/users/update', {id: u.id, status: select.value, recommendations: permission.checked}); message('تم حفظ حالة المستخدم وصلاحيته.'); await users();} catch (error) {message(error.message, true);} finally {save.disabled = false;}};
      const reset = node('button', 'button ghost', 'رابط استعادة'); reset.disabled = !u.verified || u.status !== 'active'; reset.onclick = async () => {reset.disabled = true; try {await api('/api/admin/users/reset', {id: u.id}); message('تم إرسال رابط الاستعادة للمستخدم.');} catch (error) {message(error.message, true);} finally {reset.disabled = false;}};
      actions.append(save, reset);
    }
    state.append(node('p', 'subtle', u.verified ? 'بريد مؤكد' : 'بانتظار تأكيد البريد')); row.append(info, mail, joined, state, actions); body.append(row);
  }
  table.append(head, body); wrap.append(table); $('admin-users').replaceChildren(wrap);
}
form('user-search', async () => {usersPage = 0; await users();});
$('users-prev').onclick = () => {usersPage = Math.max(0, usersPage - 1); users().catch(error => message(error.message, true));};
$('users-next').onclick = () => {usersPage++; users().catch(error => message(error.message, true));};
const mt5HostingLabels = {
  REQUESTED: 'بانتظار المراجعة',
  APPROVED: 'موافق عليه للتجهيز فقط — لا صلاحيات تداول',
  REJECTED: 'لم تتم الموافقة'
};
const mt5MonitorLabels = {
  NOT_APPROVED:'غير معتمد',
  NOT_ISSUED:'لا يوجد رمز مراقبة بعد',
  AWAITING_WORKER:'بانتظار أول تقرير مراقبة',
  STALE:'تحديث Windows متأخر أو منقطع',
  MT5_OFFLINE:'عامل Windows يعمل لكن MT5 غير متصل',
  OBSERVED_DEMO:'تم رصد اتصال MT5 Demo · التداول غير مفعّل'
};
function showWorkerOneTime(data) {
  const panel=$('admin-worker-onetime');
  const code=node('code','secret-code',data.token);
  const worker=node('code','secret-code',data.worker_id);
  const account=node('code','secret-code',data.account_id);
  const close=node('button','button ghost','إخفاء الرمز من الصفحة');
  close.type='button';
  close.onclick=()=>{panel.replaceChildren();panel.hidden=true;};
  panel.replaceChildren(
    node('strong','','رمز مراقبة Windows لمرة واحدة — احفظه على السيرفر المركزي بصورة آمنة، وليس في الدردشة أو GitHub.'),
    node('p','','معرّف الحساب في نبض:'),account,
    node('p','','معرّف عامل Windows:'),worker,
    node('p','','رمز المراقبة السري (يظهر الآن فقط):'),code,
    node('p','','الرمز يسمح فقط بإرسال حالة الاتصال، ولا يفتح أو يغلق صفقات. إنشاء رمز جديد يلغي القديم فورًا.'),close);
  panel.hidden=false;
}

async function adminMt5Hosting() {
  const response = await api('/api/admin/mt5-hosting');
  const list = $('admin-mt5-hosting');
  const requests = response.accounts || [];
  if (!requests.length) {
    list.replaceChildren(node('p', 'subtle', 'لا توجد طلبات استضافة MT5 حتى الآن.'));
    return;
  }
  list.replaceChildren(...requests.map(request => {
    const row = node('div', 'mt5-registration-row');
    const info = node('div');
    info.append(node('strong', '', request.member_name + ' · ' + request.member_email),
      node('p', 'subtle', request.broker + ' · Demo · حساب ' + request.login + ' · ' + request.server_name),
      node('p', 'mt5-inactive', mt5HostingLabels[request.status] || 'غير معروف'),
      node('p', 'subtle', mt5MonitorLabels[request.monitoring_status] || 'مراقبة غير متاحة'),
      node('p', 'subtle', 'تاريخ الطلب: ' + date(request.requested_at)));
    const actions = node('div', 'mt5-admin-actions');
    if (request.status === 'REQUESTED') {
      for (const [decision, label] of [['APPROVE', 'الموافقة على التجهيز'], ['REJECT', 'رفض الطلب']]) {
        const button = node('button', 'button ghost', label);
        button.type = 'button';
        button.onclick = async () => {
          if (!confirm('هذا قرار إداري فقط ولا يربط حساب MT5 ولا يفعّل التداول. تأكيد ' + label + '؟')) return;
          button.disabled = true;
          try {
            await api('/api/admin/mt5-hosting/review', {id: request.account_id, decision});
            message('تم تسجيل القرار. ربط MT5 والتداول ما زالا غير مفعّلين.');
            await adminMt5Hosting();
          } catch (error) {
            message(error.message, true);
            button.disabled = false;
          }
        };
        actions.append(button);
      }
    }
    if (request.status === 'APPROVED') {
      const provision=node('button','button ghost',
        request.worker_provisioned ? 'تدوير رمز مراقبة Windows' : 'إصدار رمز مراقبة Windows');
      provision.type='button';
      provision.onclick=async()=>{
        if(!confirm('سيتم توليد رمز مراقبة جديد صالح لهذه النسخة فقط. لا يمنح أي صلاحيات تداول. هل تؤكد؟'))return;
        provision.disabled=true;
        try{
          const result=await api('/api/admin/mt5-monitor/provision',
            {id:request.account_id,confirm:'ISSUE_READONLY_TOKEN'});
          showWorkerOneTime(result);
          await adminMt5Hosting();
          message('تم إنشاء رمز مراقبة Windows. انسخه من اللوحة مرة واحدة.');
        }catch(error){message(error.message,true);}
        finally{provision.disabled=false;}
      };
      actions.append(provision);
      if(request.worker_provisioned){
        const revoke=node('button','button danger','إلغاء رمز المراقبة');
        revoke.type='button';
        revoke.onclick=async()=>{
          if(!confirm('سيتم إيقاف جميع تقارير هذا العامل فورًا. هل تؤكد؟'))return;
          revoke.disabled=true;
          try{
            await api('/api/admin/mt5-monitor/revoke',{id:request.account_id});
            const panel=$('admin-worker-onetime');panel.replaceChildren();panel.hidden=true;
            await adminMt5Hosting();
            message('تم إلغاء رمز مراقبة Windows.');
          }catch(error){message(error.message,true);revoke.disabled=false;}
        };
        actions.append(revoke);
      }
    }
    row.append(info, actions);
    return row;
  }));
}
$('admin-mt5-hosting-refresh').onclick = () => adminMt5Hosting().catch(error => message(error.message, true));
const events = {REGISTER: 'إنشاء حساب', EMAIL_VERIFIED: 'تأكيد البريد', LOGIN: 'تسجيل دخول', PASSWORD_RESET: 'استعادة كلمة المرور', PASSWORD_CHANGED: 'تغيير كلمة المرور', MFA_ENABLED: 'تفعيل التحقق بخطوتين', DELETION_REQUESTED: 'طلب حذف', USER_UPDATED: 'تحديث مستخدم', RESET_SENT: 'إرسال رابط استعادة', BACKUP_CREATED: 'نسخ خارجي', BACKUP_EXPORTED: 'تصدير نسخة مشفرة', BACKUP_RESTORED: 'استعادة نسخة'};
async function audit() {const response = await api('/api/admin/audit'); $('admin-audit').replaceChildren(...response.events.map(event => {const row = node('div', 'audit-row'); row.append(node('strong', '', events[event.event] || event.event), node('p', '', date(event.time)), node('p', '', currentLocale()==='en' ? `Performed by: ${event.actor || 'system'}${event.subject ? ' · Account: ' + event.subject : ''}` : `المنفّذ: ${event.actor || 'النظام'}${event.subject ? ' · الحساب: ' + event.subject : ''}`)); return row;}));}
$('refresh-audit').onclick = () => audit().catch(error => message(error.message, true));
async function overview() {
  const response = await api('/api/admin/overview'), sum = response.counts.reduce((total, x) => total + Number(x.count), 0), ops = response.operational;
  const labels = {LIVE: 'متصل', NO_DATA: 'بانتظار البيانات', STALE: 'بيانات قديمة', DISCONNECTED: 'منقطع', WAITING_BROKER: 'بانتظار MT5', READY: 'جاهز'};
  $('admin-summary').replaceChildren(...[['الحسابات', sum], ['حالة MT5', labels[ops.mt5] || ops.mt5], ['جاهزية التوصيات', labels[ops.publication] || ops.publication], ['تليجرام', labels[ops.telegram] || ops.telegram]].map(([label, value]) => {const el = node('div', 'summary-tile'); el.append(node('span', '', label), node('strong', '', value || 'غير متاح')); return el;}));
  const backups = response.accounts.backups;
  $('backup-state').textContent = `${backups.state === 'READY' ? 'الوجهة مضبوطة' : backups.state === 'ERROR' ? 'تعذر آخر نسخ' : 'النسخ التلقائي بانتظار ضبط الوجهة والمفتاح'} · آخر نسخة ناجحة: ${date(backups.last_success)}`;
  $('backup-now').disabled = backups.state === 'NOT_CONFIGURED';
}
$('backup-now').onclick = async () => {const button = $('backup-now'); button.disabled = true; try {await api('/api/admin/backup', {}); message('تم حفظ نسخة خارجية مشفرة.'); await overview();} catch (error) {message(error.message, true);} finally {button.disabled = false;}};
form('backup-download', async (el, values) => {const response = await api('/api/admin/backup/download', values); el.reset(); const url = URL.createObjectURL(new Blob([response.backup], {type: 'application/octet-stream'})); const link = node('a'); link.href = url; link.download = response.filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); message('تم تجهيز النسخة المشفرة للتنزيل.');});
form('restore-form', async (el, values) => {const file = el.elements.file.files[0]; if (!file || file.size > 20 * 1024 * 1024) throw Error('اختر ملف نسخة مشفرة لا يتجاوز 20 ميغابايت.'); await api('/api/admin/restore', {backup: await file.text(), password: values.password, code: values.code, confirm: values.confirm}); el.reset(); location.assign('/auth');});

async function initialize() {
  if (page === 'privacy') return;
  if (page === 'auth') {
    const fragment = new URLSearchParams(location.hash.slice(1));
    for (const flow of ['verify', 'reset']) if (fragment.has(flow)) {flowToken = fragment.get(flow); tab(flow); history.replaceState(null, '', '/auth'); break;}
    const readiness = await api('/api/auth/status'); $('auth-readiness').textContent = readiness.ready ? 'حسابات نبض جاهزة · أكّد بريدك قبل أول دخول.' : readiness.note;
    if (!readiness.ready) {message(readiness.note || 'خدمة الحسابات غير متاحة مؤقتًا.', true); document.querySelectorAll('[data-auth-form] button[type=submit]').forEach(button => {button.disabled = true;}); return;}
  }
  const response = await api('/api/auth/me'); member = response.user; csrf = response.csrf || ''; signedIn = Boolean(member);
  $('member-logout').hidden = !signedIn; $('admin-link').hidden = member?.role !== 'admin';
  if (page === 'account') {
    $('account-guard').hidden = signedIn; $('account-content').hidden = !signedIn; if (!member) return;
    $('member-name').textContent = member.name; $('member-email').textContent = member.email;
    $('profile-form').elements.name.value = member.name; $('profile-form').elements.notifications.checked = member.notifications;
    $('member-access').textContent = member.recommendations ? 'صلاحية مشاهدة التوصيات متاحة لحسابك.' : 'صلاحية التوصيات معلّقة؛ تواصل مع الإدارة.';
    $('mfa-state').textContent = member.mfa ? 'التحقق بخطوتين مفعّل.' : member.role === 'admin' ? 'فعّل التحقق بخطوتين لفتح لوحة الأدمن.' : 'أضف تطبيق مصادقة لحماية دخولك.';
    $('mfa-start').hidden = member.mfa; $('deletion-form').hidden = member.role === 'admin';
    try {localStorage.setItem('nabd-signal-notices', member.notifications ? 'on' : 'off');} catch {}
    await Promise.all([sessions(), memberMt5Accounts()]);
  }
  if (page === 'admin') {
    if (!response.adminReady) {if (member?.role === 'admin') $('admin-guard-note').textContent = 'حسابك مسؤول. أكمل تفعيل التحقق بخطوتين من صفحة حسابي ثم افتح الإدارة.'; return;}
    $('admin-guard').hidden = true; $('admin-content').hidden = false; await Promise.all([overview(), users(), audit(), adminMt5Hosting()]);
  }
}
// Re-read display-only dates in the selected locale; no auth mutation or trade request.
document.addEventListener('nabd:language-change',()=>{
  if(!signedIn)return;
  if(page==='account'&&!$('account-content').hidden)void Promise.allSettled([sessions(),memberMt5Accounts()]);
  if(page==='admin'&&!$('admin-content').hidden)void Promise.allSettled([users(),audit(),overview()]);
});
initialize().catch(error => {message(error.status === 503 ? 'خدمة الحسابات بانتظار التهيئة أو غير متاحة مؤقتًا. الرئيسية والأسعار والأخبار متاحة.' : error.message, true); if (page === 'account') $('account-guard').hidden = false;});
