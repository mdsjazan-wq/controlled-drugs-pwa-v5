/* app.js
   نسخة v4 — واجهة الأمام: تسجيل، مراكزي، لوحة التحكم، التقارير (مفعلة)، دعم طباعة وتصدير CSV
   تتطلب:
   - config.js فيه window.CD_CONFIG = { USE_SUPABASE, SUPABASE_URL, SUPABASE_ANON_KEY }
   - <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
*/

/* ===================== 1) Supabase & Helpers ===================== */

if (!window.CD_CONFIG || !window.CD_CONFIG.SUPABASE_URL) {
  console.error('CD_CONFIG مفقودة. تأكد من تحميل config.js قبل app.js');
}
const sb = supabase.createClient(window.CD_CONFIG.SUPABASE_URL, window.CD_CONFIG.SUPABASE_ANON_KEY);

const $  = (id) => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0,10);

function setText(el, text) { if (el) el.textContent = text; }
function showMsg(el, text, ok=false) { if (!el) return; el.textContent = text || ''; el.className = ok ? 'ok' : 'muted'; }
function renderTable(el, rows) {
  if (!el) return;
  if (!rows || !rows.length) { el.innerHTML = '<div class="muted">لا يوجد بيانات</div>'; return; }
  const cols = Object.keys(rows[0]);
  let html = '<div style="overflow:auto"><table class="tbl"><thead><tr>';
  cols.forEach(c => html += `<th>${c}</th>`);
  html += '</tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr>';
    cols.forEach(c => html += `<td>${(r[c] ?? '')}</td>`);
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}
function toCSV(rows) {
  if (!rows || !rows.length) return '';
  const cols = Object.keys(rows[0]);
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => {
    const v = (r[c] ?? '').toString().replace(/"/g,'""');
    return /[",\n]/.test(v) ? `"${v}"` : v;
  }).join(',')).join('\n');
  return `${header}\n${body}`;
}
function downloadText(filename, content, mime='text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type: mime}));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ========== 2) حالة التطبيق العامة (مستخدم/دور/مراكز/مركز حالي) ========== */
let CURRENT_USER = null;
let CURRENT_ROLE = null;
let MY_CENTERS = [];          // [{id, name, is_default}]
let CURRENT_CENTER_ID = null; // قيمة مركز العمل الحالي

async function getRole() {
  const { data, error } = await sb.rpc('app_current_role');
  if (error) { console.warn('app_current_role error:', error.message); return null; }
  return data;
}

/* ========== 3) Auth: تسجيل الدخول/الخروج وتهيئة الواجهة ========== */

async function refreshAuthUI() {
  const authScreen = $('auth-screen');
  const header = $('app-header');
  const main = $('app-main');

  const { data: { user } } = await sb.auth.getUser();
  CURRENT_USER = user || null;

  if (CURRENT_USER) {
    // اجلب الدور
    CURRENT_ROLE = await getRole();

    // من أنا؟
    setText($('whoami'), CURRENT_USER.email || CURRENT_USER.id);
    // عرض/إخفاء الشاشات
    if (authScreen) authScreen.style.display = 'none';
    if (header) header.style.display = '';
    if (main)   main.style.display = '';

    // تهيئة البيانات الأولية
    await afterLoginInit();
  } else {
    if (authScreen) authScreen.style.display = '';
    if (header) header.style.display = 'none';
    if (main)   main.style.display = 'none';
  }
}

$('btn-login')?.addEventListener('click', async () => {
  const email = $('login-email')?.value?.trim();
  const password = $('login-password')?.value || '';
  const msg = $('login-msg');
  showMsg(msg, '');
  try {
    if (!email) throw new Error('أدخل البريد أولاً');
    if (password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      showMsg(msg, 'تم تسجيل الدخول ✅', true);
    } else {
      const { error } = await sb.auth.signInWithOtp({ email });
      if (error) throw error;
      showMsg(msg, 'تم إرسال رابط تسجيل الدخول إلى بريدك ✅', true);
    }
    await refreshAuthUI();
  } catch (e) { showMsg(msg, e.message); }
});

$('btn-signup')?.addEventListener('click', async () => {
  const email = $('login-email')?.value?.trim();
  const password = $('login-password')?.value || '';
  const msg = $('login-msg');
  showMsg(msg, '');
  try {
    if (!email) throw new Error('أدخل البريد أولاً');
    if (!password) throw new Error('أدخل كلمة مرور للتسجيل');
    const { error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    showMsg(msg, 'تم إنشاء الحساب، تحقق من بريدك ✅', true);
  } catch (e) { showMsg(msg, e.message); }
});

$('btn-logout')?.addEventListener('click', async () => {
  await sb.auth.signOut();
  CURRENT_USER = null; CURRENT_ROLE = null; MY_CENTERS = []; CURRENT_CENTER_ID = null;
  await refreshAuthUI();
});

/* ========== 4) تنقّل التبويبات (Dashboard / Requests / Reports / Settings) ========== */
document.querySelectorAll('.chip')?.forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(s => s.classList.remove('active'));
    $('tab-' + tab)?.classList.add('active');
  });
});

/* ========== 5) تحميل البيانات المرجعية: أصناف + مراكزي ========== */

async function loadLookupsItems() {
  // الأصناف: id, name
  const selects = ['issueItem', 'retItem', 'supplyItem'];
  const { data: items, error } = await sb.from('items').select('id,name').order('id');
  if (error) { console.warn('items lookup error:', error.message); return; }
  selects.forEach(id => {
    const sel = $(id); if (!sel) return;
    sel.innerHTML = (items||[]).map(i => `<option value="${i.id}">${i.name}</option>`).join('');
  });
}

async function loadMyCenters() {
  const { data, error } = await sb.rpc('rpc_list_my_centers');
  if (error) { console.warn('rpc_list_my_centers error:', error.message); return; }
  MY_CENTERS = data || [];
  const def = MY_CENTERS.find(c => c.is_default) || MY_CENTERS[0] || null;
  CURRENT_CENTER_ID = def ? def.id : null;

  // Dashboard filter + forms (إن وجدت)
  const targets = ['center-filter','issueCenter','retCenter','snapCenter'];
  targets.forEach(id => {
    const sel = $(id); if (!sel) return;
    sel.innerHTML = MY_CENTERS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    if (CURRENT_CENTER_ID) sel.value = String(CURRENT_CENTER_ID);
    // إن كان لديه مركز واحد فقط، أخفِ الفلتر (لتحسين الواجهة)
    if (id==='center-filter' && MY_CENTERS.length <= 1) {
      sel.parentElement?.style && (sel.parentElement.style.display = 'none');
    }
  });

  // ربط تغيير الفلتر بتحديث أرصدة المراكز/التقارير
  $('center-filter')?.addEventListener('change', async (e) => {
    CURRENT_CENTER_ID = +e.target.value;
    await loadCentersSnapshot();
  });
  ['issueCenter','retCenter','snapCenter'].forEach(id => {
    $(id)?.addEventListener('change', (e) => { CURRENT_CENTER_ID = +e.target.value; });
  });
}

/* ========== 6) لوحة التحكم: ملخصات المستودع + أرصدة المراكز ========== */

async function loadWarehouseSnapshot() {
  const tbody = $('tbl-warehouse')?.querySelector('tbody');
  if (!tbody) return;
  try {
    const { data, error } = await sb.rpc('fn_warehouse_snapshot');
    if (error) throw error;
    // توقع أعمدة: item_name, initial_qty, received_from, issued_to_center, return_empty, return_expired, on_hand
    tbody.innerHTML = '';
    (data||[]).forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.item_name ?? ''}</td>
        <td>${row.on_hand ?? 0}</td>
        <td>${row.return_empty ?? 0}</td>
        <td>${row.return_expired ?? 0}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">${e.message}</td></tr>`;
  }
}

async function loadCentersSnapshot() {
  const tbody = $('tbl-centers')?.querySelector('tbody');
  if (!tbody) return;
  if (!CURRENT_CENTER_ID) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">لا يوجد مركز محدد</td></tr>`;
    return;
  }
  try {
    const { data, error } = await sb.rpc('fn_center_snapshot', { p_center_id: CURRENT_CENTER_ID });
    if (error) throw error;
    // نتوقع: item_name, on_hand (وقد توجد أعمدة أخرى)
    // جلب اسم المركز لعرضه مع كل سطر
    const myCenter = MY_CENTERS.find(c => c.id === CURRENT_CENTER_ID);
    const centerName = myCenter ? myCenter.name : '—';

    tbody.innerHTML = '';
    (data||[]).forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${centerName}</td>
        <td>${row.item_name ?? ''}</td>
        <td>${row.on_hand ?? 0}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">${e.message}</td></tr>`;
  }
}

$('btn-print-centers')?.addEventListener('click', () => {
  window.print();
});

/* ========== 7) تفعيل التقارير (تبويب التقارير) — إنشاء عناصر ديناميكيًا ========== */

function ensureReportsUI() {
  const tab = $('tab-reports');
  if (!tab) return;

  // امسح المحتوى الافتراضي "قريبًا" وأنشئ واجهة بسيطة
  tab.innerHTML = `
    <div class="card">
      <h3>تقارير المستودع</h3>
      <div class="row gap-8">
        <button id="btn-report-warehouse" class="btn btn-light">عرض التقرير</button>
        <button id="btn-export-warehouse" class="btn btn-light">تصدير CSV</button>
      </div>
      <div id="report-warehouse" style="margin-top:10px"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>تقارير المراكز</h3>
      <div class="row gap-8">
        <select id="report-center" class="btn btn-light"></select>
        <button id="btn-report-center" class="btn btn-light">عرض التقرير</button>
        <button id="btn-export-center" class="btn btn-light">تصدير CSV</button>
      </div>
      <div id="report-center-area" style="margin-top:10px"></div>
    </div>
  `;

  // عبّئ قائمة المراكز في التقارير
  const rsel = $('report-center');
  if (rsel) {
    rsel.innerHTML = MY_CENTERS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    if (CURRENT_CENTER_ID) rsel.value = String(CURRENT_CENTER_ID);
  }

  // أزرار المستودع
  $('btn-report-warehouse')?.addEventListener('click', async () => {
    const host = $('report-warehouse');
    try {
      const { data, error } = await sb.rpc('fn_warehouse_snapshot');
      if (error) throw error;
      renderTable(host, data);
    } catch (e) {
      host.innerHTML = `<div class="muted">${e.message}</div>`;
    }
  });
  $('btn-export-warehouse')?.addEventListener('click', async () => {
    try {
      const { data, error } = await sb.rpc('fn_warehouse_snapshot');
      if (error) throw error;
      downloadText(`warehouse_snapshot_${todayISO()}.csv`, toCSV(data||[]), 'text/csv');
    } catch (e) { alert(e.message); }
  });

  // أزرار المراكز
  $('btn-report-center')?.addEventListener('click', async () => {
    const host = $('report-center-area');
    const cid = +($('report-center')?.value || CURRENT_CENTER_ID || 0);
    if (!cid) { host.innerHTML = '<div class="muted">اختر مركزًا</div>'; return; }
    try {
      const { data, error } = await sb.rpc('fn_center_snapshot', { p_center_id: cid });
      if (error) throw error;
      renderTable(host, data);
    } catch (e) {
      host.innerHTML = `<div class="muted">${e.message}</div>`;
    }
  });
  $('btn-export-center')?.addEventListener('click', async () => {
    const cid = +($('report-center')?.value || CURRENT_CENTER_ID || 0);
    if (!cid) return alert('اختر مركزًا');
    try {
      const { data, error } = await sb.rpc('fn_center_snapshot', { p_center_id: cid });
      if (error) throw error;
      downloadText(`center_${cid}_snapshot_${todayISO()}.csv`, toCSV(data||[]), 'text/csv');
    } catch (e) { alert(e.message); }
  });
}

/* ========== 8) (اختياري) عمليات: توريد/صرف/مرتجع إن وُجدت عناصرها ========== */

$('supplyBtn')?.addEventListener('click', async () => {
  const item = +$('supplyItem')?.value;
  const qty  = +$('supplyQty')?.value;
  const date = $('supplyDate')?.value || todayISO();
  const el   = $('supplyMsg');
  showMsg(el, '');
  try {
    const { error } = await sb.rpc('rpc_wh_receive_supply', { p_item_id: item, p_qty: qty, p_happened_at: date });
    if (error) throw error;
    showMsg(el, 'تم التوريد بنجاح ✅', true);
    await loadWarehouseSnapshot();
  } catch (e) { showMsg(el, e.message); }
});

$('issueBtn')?.addEventListener('click', async () => {
  const centerId = CURRENT_CENTER_ID || +$('issueCenter')?.value;
  const item = +$('issueItem')?.value;
  const qty  = +$('issueQty')?.value;
  const date = $('issueDate')?.value || todayISO();
  const el   = $('issueMsg');
  showMsg(el, '');
  try {
    const { error } = await sb.rpc('rpc_wh_issue_to_center', {
      p_center_id: centerId, p_item_id: item, p_qty: qty, p_happened_at: date
    });
    if (error) throw error;
    showMsg(el, 'تم الصرف بنجاح ✅', true);
    await Promise.all([loadWarehouseSnapshot(), loadCentersSnapshot()]);
  } catch (e) { showMsg(el, e.message); }
});

$('retBtn')?.addEventListener('click', async () => {
  const centerId = CURRENT_CENTER_ID || +$('retCenter')?.value;
  const item = +$('retItem')?.value;
  const qty  = +$('retQty')?.value;
  const status = $('retStatus')?.value || 'empty'; // empty | expired
  const date = $('retDate')?.value || todayISO();
  const el   = $('retMsg');
  showMsg(el, '');
  try {
    const { error } = await sb.rpc('rpc_wh_receive_return_from_center', {
      p_center_id: centerId, p_item_id: item, p_qty: qty, p_status: status, p_happened_at: date
    });
    if (error) throw error;
    showMsg(el, 'تم استلام المرتجع ✅', true);
    // حسب تعريف fn_warehouse_snapshot عندك: الرجيع لا يدخل الرصيد (إلا لو عدّلناه)
    await Promise.all([loadWarehouseSnapshot(), loadCentersSnapshot()]);
  } catch (e) { showMsg(el, e.message); }
});

/* ========== 9) تهيئة بعد الدخول ========== */

async function afterLoginInit() {
  // الاسم والدور على لوحة التحكم
  setText($('profile-role'), CURRENT_ROLE || '—');

  // تحميل الأصناف (إن وجدت حقولها)
  await loadLookupsItems();

  // تحميل مراكزي وتثبيت المركز الافتراضي
  await loadMyCenters();

  // عرض اسمي من profiles (لو RLS تسمح)
  try {
    const uid = (await sb.auth.getUser()).data.user?.id;
    if (uid) {
      const { data: me, error } = await sb.from('profiles').select('full_name').eq('user_id', uid).maybeSingle();
      if (!error && me) setText($('profile-name'), me.full_name || '—');
    }
  } catch {}

  // عرض مركز افتراضي (إن أردت)
  try {
    const def = MY_CENTERS.find(c => c.is_default) || MY_CENTERS[0];
    setText($('profile-center'), def ? def.name : '—');
  } catch {}

  // تحميل ملخصات لوحة التحكم
  await loadWarehouseSnapshot();
  await loadCentersSnapshot();

  // تفعيل واجهة التقارير وإنشاء عناصرها
  ensureReportsUI();
}

/* ========== 10) بدء التشغيل ========== */

window.addEventListener('load', () => {
  refreshAuthUI();
});
