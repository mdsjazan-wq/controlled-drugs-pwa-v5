/* app.js — Controlled Drugs PWA v5
   يعتمد على window.CD_CONFIG و supabase-js@2
*/

/* ===== Supabase + Helpers ===== */
const sb = supabase.createClient(
  window.CD_CONFIG.SUPABASE_URL,
  window.CD_CONFIG.SUPABASE_ANON_KEY
);

const $  = (id) => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);

function setText(el, t){ if(el) el.textContent = t ?? ''; }
function msg(el, t, ok=false){ if(!el) return; el.textContent = t ?? ''; el.className = ok ? 'ok' : 'muted'; }
function renderTable(el, rows){
  if(!el) return;
  if(!rows || !rows.length){ el.innerHTML = '<div class="muted">لا يوجد بيانات</div>'; return; }
  const cols = Object.keys(rows[0]);
  let h = '<div style="overflow:auto"><table class="tbl"><thead><tr>';
  cols.forEach(c => h += `<th>${c}</th>`); h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += '<tr>'; cols.forEach(c => h += `<td>${r[c] ?? ''}</td>`); h += '</tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
}
function toCSV(rows){
  if(!rows || !rows.length) return '';
  const cols = Object.keys(rows[0]);
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => {
    const v = String(r[c] ?? '').replace(/"/g,'""');
    return /[",\n]/.test(v) ? `"${v}"` : v;
  }).join(',')).join('\n');
  return `${header}\n${body}`;
}
function downloadText(filename, content, mime='text/csv'){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}

/* ===== حالة التطبيق ===== */
let CURRENT_USER = null;
let CURRENT_ROLE = null;
let MY_CENTERS = [];
let CURRENT_CENTER_ID = null;

/* ===== Auth ===== */
async function getRole(){ try{ const {data}=await sb.rpc('app_current_role'); return data; }catch{ return null; } }

async function refreshAuthUI(){
  const { data:{ user } } = await sb.auth.getUser();
  CURRENT_USER = user || null;
  if (CURRENT_USER){
    CURRENT_ROLE = await getRole();
    $('auth-screen')?.setAttribute('style','display:none');
    $('app-header')?.removeAttribute('style');
    $('app-main')?.removeAttribute('style');
    setText($('whoami'), CURRENT_USER.email || CURRENT_USER.id);
    await afterLoginInit();
  } else {
    $('auth-screen')?.removeAttribute('style');
    $('app-header')?.setAttribute('style','display:none');
    $('app-main')?.setAttribute('style','display:none');
  }
}

$('btn-login')?.addEventListener('click', async ()=>{
  const email = $('login-email')?.value?.trim();
  const pass  = $('login-password')?.value || '';
  const m = $('login-msg'); msg(m,'');
  try{
    if(!email) throw new Error('أدخل البريد أولًا');
    if(pass){
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if(error) throw error; msg(m,'تم تسجيل الدخول ✅',true);
    }else{
      const { error } = await sb.auth.signInWithOtp({ email });
      if(error) throw error; msg(m,'أرسلنا رابط الدخول إلى بريدك ✅',true);
    }
    await refreshAuthUI();
  }catch(e){ msg(m, e.message); }
});

$('btn-signup')?.addEventListener('click', async ()=>{
  const email = $('login-email')?.value?.trim();
  const pass  = $('login-password')?.value || '';
  const m = $('login-msg'); msg(m,'');
  try{
    if(!email) throw new Error('أدخل البريد'); if(!pass) throw new Error('أدخل كلمة مرور');
    const { error } = await sb.auth.signUp({ email, password: pass });
    if(error) throw error; msg(m,'تم إنشاء الحساب، تحقق من بريدك ✅',true);
  }catch(e){ msg(m, e.message); }
});

$('btn-logout')?.addEventListener('click', async ()=>{
  await sb.auth.signOut();
  CURRENT_USER=null; CURRENT_ROLE=null; MY_CENTERS=[]; CURRENT_CENTER_ID=null;
  await refreshAuthUI();
});

/* ===== Tabs ===== */
document.querySelectorAll('.chip')?.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(s=>s.classList.remove('active'));
    $('tab-'+tab)?.classList.add('active');
  });
});

/* ===== Lookups ===== */
async function loadItems(){
  const ids = ['supplyItem','issueItem','retItem','admin-wh-item-select','admin-ci-item'];
  try{
    const { data, error } = await sb.from('items').select('id,name').order('id');
    if(error) throw error;
    ids.forEach(id=>{
      const el = $(id); if(!el) return;
      el.innerHTML = (data||[]).map(i=>`<option value="${i.id}">${i.name}</option>`).join('');
    });
  }catch(e){ console.warn('items lookup:', e.message); }
}

async function loadMyCenters(){
  try{
    const { data, error } = await sb.rpc('rpc_list_my_centers');
    if(error) throw error;
    MY_CENTERS = data || [];

    // لا نفرض مركز افتراضي على الأدمن
    const def = MY_CENTERS.find(c=>c.is_default) || null;
    if (def) {
      CURRENT_CENTER_ID = def.id;
    } else {
      CURRENT_CENTER_ID = (CURRENT_ROLE === 'admin') ? null : (MY_CENTERS[0]?.id ?? null);
    }

    const selectIds = ['center-filter','issueCenter','retCenter','snapCenter','report-center','admin-ci-center'];
    selectIds.forEach(id=>{
      const el = $(id); if(!el) return;
      el.innerHTML = (MY_CENTERS||[]).map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
      if (CURRENT_CENTER_ID) el.value = String(CURRENT_CENTER_ID);
      if (id==='center-filter' && MY_CENTERS.length<=1){
        el.parentElement?.style && (el.parentElement.style.display='none');
      }
    });
  }catch(e){ console.warn('rpc_list_my_centers:', e.message); }
}

/* ===== Dashboard ===== */
async function loadWarehouseSnapshot(){
  const tb = $('tbl-warehouse')?.querySelector('tbody'); if(!tb) return;
  try{
    const { data, error } = await sb.rpc('fn_warehouse_snapshot');
    if(error) throw error;
    tb.innerHTML='';
    // ترتيب الأعمدة: الصنف | افتتاحي | توريد | مصروف | رجع فارغ | رجع منتهي | الرصيد
    (data||[]).forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.item_name ?? ''}</td>
        <td>${r.initial_qty ?? 0}</td>
        <td>${r.received_from ?? 0}</td>
        <td>${r.issued_to_center ?? 0}</td>
        <td>${r.return_empty ?? 0}</td>
        <td>${r.return_expired ?? 0}</td>
        <td>${r.on_hand ?? 0}</td>`;
      tb.appendChild(tr);
    });
  }catch(e){
    tb.innerHTML = `<tr><td colspan="7" class="muted">${e.message}</td></tr>`;
  }
}

async function loadCenterSnapshot(){
  const tb = $('tbl-centers')?.querySelector('tbody'); if(!tb) return;
  if(!CURRENT_CENTER_ID){ tb.innerHTML = '<tr><td colspan="3" class="muted">اختر مركزًا</td></tr>'; return; }
  try{
    const { data, error } = await sb.rpc('fn_center_snapshot', { p_center_id: CURRENT_CENTER_ID });
    if(error) throw error;
    const name = (MY_CENTERS.find(c=>c.id===CURRENT_CENTER_ID)||{}).name || '—';
    tb.innerHTML='';
    (data||[]).forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${name}</td><td>${r.item_name??''}</td><td>${r.on_hand??0}</td>`;
      tb.appendChild(tr);
    });
  }catch(e){
    tb.innerHTML = `<tr><td colspan="3" class="muted">${e.message}</td></tr>`;
  }
}

$('btn-print-centers')?.addEventListener('click', ()=>window.print());
$('center-filter')?.addEventListener('change', e=>{ CURRENT_CENTER_ID = +e.target.value; loadCenterSnapshot(); });

/* ===== Reports ===== */
function ensureReportsUI(){
  const tab = $('tab-reports'); if(!tab) return;
  tab.innerHTML = `
    <div class="card"><h3>تقارير المستودع</h3>
      <div class="row gap-8">
        <button id="btn-report-warehouse" class="btn btn-light">عرض التقرير</button>
        <button id="btn-export-warehouse" class="btn btn-light">تصدير CSV</button>
      </div>
      <div id="report-warehouse" style="margin-top:10px"></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>تقارير المراكز</h3>
      <div class="row gap-8">
        <select id="report-center" class="btn btn-light"></select>
        <button id="btn-report-center" class="btn btn-light">عرض التقرير</button>
        <button id="btn-export-center" class="btn btn-light">تصدير CSV</button>
      </div>
      <div id="report-center-area" style="margin-top:10px"></div>
    </div>`;

  $('btn-report-warehouse').onclick = async ()=>{
    const host = $('report-warehouse');
    try{ const {data,error}=await sb.rpc('fn_warehouse_snapshot'); if(error) throw error; renderTable(host, data); }
    catch(e){ host.innerHTML = `<div class="muted">${e.message}</div>`; }
  };
  $('btn-export-warehouse').onclick = async ()=>{
    try{ const {data,error}=await sb.rpc('fn_warehouse_snapshot'); if(error) throw error;
         downloadText(`warehouse_${todayISO()}.csv`, toCSV(data||[])); }
    catch(e){ alert(e.message); }
  };
  $('btn-report-center').onclick = async ()=>{
    const host = $('report-center-area');
    const cid = +($('report-center')?.value || CURRENT_CENTER_ID || 0);
    if(!cid) return host.innerHTML = '<div class="muted">اختر مركزًا</div>';
    try{ const {data,error}=await sb.rpc('fn_center_snapshot',{p_center_id:cid}); if(error) throw error; renderTable(host, data); }
    catch(e){ host.innerHTML = `<div class="muted">${e.message}</div>`; }
  };
  $('btn-export-center').onclick = async ()=>{
    const cid = +($('report-center')?.value || CURRENT_CENTER_ID || 0);
    if(!cid) return alert('اختر مركزًا');
    try{ const {data,error}=await sb.rpc('fn_center_snapshot',{p_center_id:cid}); if(error) throw error;
         downloadText(`center_${cid}_${todayISO()}.csv`, toCSV(data||[])); }
    catch(e){ alert(e.message); }
  };
}

/* ===== العمليات (توريد/صرف/مرتجع) — إن وُجدت عناصرها في الصفحة ===== */
$('supplyBtn')?.addEventListener('click', async ()=>{
  const item = +$('supplyItem')?.value;
  const qty  = +$('supplyQty')?.value;
  const date = $('supplyDate')?.value || todayISO();
  const el   = $('supplyMsg'); msg(el,'');
  try{
    const { error } = await sb.rpc('rpc_wh_receive_supply', { p_item_id:item, p_qty:qty, p_happened_at:date });
    if(error) throw error; msg(el, 'تم التوريد ✅', true);
    await loadWarehouseSnapshot();
  }catch(e){ msg(el, e.message); }
});

$('issueBtn')?.addEventListener('click', async ()=>{
  const center = CURRENT_CENTER_ID || +$('issueCenter')?.value;
  const item   = +$('issueItem')?.value;
  const qty    = +$('issueQty')?.value;
  const date   = $('issueDate')?.value || todayISO();
  const el     = $('issueMsg'); msg(el,'');
  try{
    const { error } = await sb.rpc('rpc_wh_issue_to_center', { p_center_id:center, p_item_id:item, p_qty:qty, p_happened_at:date });
    if(error) throw error; msg(el,'تم الصرف ✅',true);
    await Promise.all([loadWarehouseSnapshot(), loadCenterSnapshot()]);
  }catch(e){ msg(el, e.message); }
});

$('retBtn')?.addEventListener('click', async ()=>{
  const center = CURRENT_CENTER_ID || +$('retCenter')?.value;
  const item   = +$('retItem')?.value;
  const qty    = +$('retQty')?.value;
  const status = $('retStatus')?.value || 'empty';
  const date   = $('retDate')?.value || todayISO();
  const el     = $('retMsg'); msg(el,'');
  try{
    const { error } = await sb.rpc('rpc_wh_receive_return_from_center',
      { p_center_id:center, p_item_id:item, p_qty:qty, p_status:status, p_happened_at:date });
    if(error) throw error; msg(el,'تم استلام المرتجع ✅',true);
    await Promise.all([loadWarehouseSnapshot(), loadCenterSnapshot()]);
  }catch(e){ msg(el, e.message); }
});

/* ===== الإعدادات (Admin) ===== */
function ensureSettingsUI(){
  const tab = $('tab-settings'); if(!tab) return;
  if (CURRENT_ROLE !== 'admin'){
    tab.innerHTML = '<div class="card"><h3>الإعدادات</h3><div class="muted">هذه الصفحة مخصّصة لمدير النظام فقط.</div></div>';
    return;
  }

  tab.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h3>تصفير جميع الكميات</h3>
        <button id="btn-admin-reset" class="btn btn-danger">تصفير الآن</button>
        <div id="admin-reset-msg" class="muted" style="margin-top:6px"></div>
      </div>
      <div class="card">
        <h3>الرصيد الافتتاحي للمستودع</h3>
        <div class="row gap-8">
          <select id="admin-wh-item-select" class="btn btn-light"></select>
          <input id="admin-wh-qty" type="number" min="0" placeholder="الكمية" />
          <button id="btn-admin-wh-save" class="btn btn-light">اعتماد</button>
        </div>
        <div id="admin-wh-msg" class="muted" style="margin-top:6px"></div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:14px">
      <div class="card">
        <h3>الرصيد الافتتاحي للمراكز</h3>
        <div class="row gap-8">
          <select id="admin-ci-center" class="btn btn-light"></select>
          <select id="admin-ci-item" class="btn btn-light"></select>
          <input id="admin-ci-qty" type="number" min="0" placeholder="الكمية" />
          <button id="btn-admin-ci-save" class="btn btn-light">اعتماد</button>
        </div>
        <div id="admin-ci-msg" class="muted" style="margin-top:6px"></div>
      </div>

      <div class="card">
        <h3>إدارة المراكز</h3>
        <div class="row gap-8">
          <input id="admin-center-name" placeholder="اسم مركز جديد" />
          <button id="btn-admin-center-add" class="btn btn-light">إضافة</button>
        </div>
        <div id="admin-centers-list" style="margin-top:8px"></div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>إدارة المستخدمين</h3>
      <div id="admin-users-list"></div>
    </div>
  `;

  $('btn-admin-reset').onclick = async ()=>{
    const m=$('admin-reset-msg'); msg(m,'');
    try{ const { error } = await sb.rpc('rpc_admin_reset_all'); if(error) throw error;
         msg(m,'تم التصفير ✅',true); }catch(e){ msg(m, e.message); }
  };
  $('btn-admin-wh-save').onclick = async ()=>{
    const item=+$('admin-wh-item-select').value, qty=+$('admin-wh-qty').value, m=$('admin-wh-msg'); msg(m,'');
    try{
      let res = await sb.rpc('rpc_admin_set_warehouse_initial',{p_item_id:item,p_qty:qty});
      if(res.error && /does not exist/i.test(res.error.message)){
        res = await sb.rpc('rpc_set_warehouse_initial',{p_item_id:item,p_qty:qty});
      }
      if(res.error) throw res.error; msg(m,'تم الحفظ ✅',true);
    }catch(e){ msg(m, e.message); }
  };
  $('btn-admin-ci-save').onclick = async ()=>{
    const center=+$('admin-ci-center').value, item=+$('admin-ci-item').value, qty=+$('admin-ci-qty').value, m=$('admin-ci-msg'); msg(m,'');
    try{
      let res = await sb.rpc('rpc_admin_set_center_initial',{p_center_id:center,p_item_id:item,p_qty:qty});
      if(res.error && /does not exist/i.test(res.error.message)){
        res = await sb.rpc('rpc_set_center_initial',{p_center_id:center,p_item_id:item,p_qty:qty});
      }
      if(res.error) throw res.error; msg(m,'تم الحفظ ✅',true);
    }catch(e){ msg(m, e.message); }
  };
}

/* إدارة المراكز */
async function refreshAdminCenters(){
  const host=$('admin-centers-list'); if(!host) return;
  try{
    const { data, error } = await sb.rpc('rpc_admin_list_centers');
    if(error) throw error;
    let h = '<div style="overflow:auto"><table class="tbl"><thead><tr><th>#</th><th>الاسم</th><th>نشط</th><th>إجراءات</th></tr></thead><tbody>';
    (data||[]).forEach(r=>{
      h += `<tr>
        <td>${r.id}</td>
        <td>${r.name}</td>
        <td><input type="checkbox" data-activ="${r.id}" ${r.active?'checked':''}></td>
        <td><button class="btn btn-light" data-del="${r.id}">حذف</button></td>
      </tr>`;
    });
    h += '</tbody></table></div>';
    host.innerHTML = h;

    $('btn-admin-center-add').onclick = async ()=>{
      const name = $('admin-center-name').value.trim(); if(!name) return;
      const res = await sb.rpc('rpc_admin_save_center', { p_center_name: name });
      if(res.error) return alert(res.error.message);
      $('admin-center-name').value=''; await loadMyCenters(); await refreshAdminCenters();
    };
    host.querySelectorAll('[data-del]')?.forEach(btn=>{
      btn.onclick = async ()=>{
        const id = +btn.dataset.del; if(!confirm('حذف المركز؟')) return;
        const { error } = await sb.rpc('rpc_admin_delete_center', { p_center_id: id });
        if(error) return alert(error.message);
        await loadMyCenters(); await refreshAdminCenters();
      };
    });
    host.querySelectorAll('[data-activ]')?.forEach(ch=>{
      ch.onchange = async ()=>{
        const id = +ch.dataset.activ; const active = !!ch.checked;
        const { error } = await sb.rpc('rpc_admin_save_center', { p_center_id:id, p_active:active, p_center_name:null });
        if(error) return alert(error.message);
        await loadMyCenters();
      };
    });
  }catch(e){ host.innerHTML = `<div class="muted">${e.message}</div>`; }
}

/* إدارة المستخدمين */
async function refreshAdminUsers(){
  const host = $('admin-users-list'); if(!host) return;
  try{
    const { data, error } = await sb.rpc('rpc_admin_list_profiles');
    if(error) throw error;
    const ROLES = ['user','center_manager','storekeeper','admin'];

    let h = '<div style="overflow:auto"><table class="tbl"><thead><tr><th>المعرف</th><th>الاسم/البريد</th><th>الدور</th><th>المركز الافتراضي</th><th>حفظ</th></tr></thead><tbody>';
    (data||[]).forEach(r=>{
      // ملاحظة: نعرض جميع المراكز (قد تكون أوسع من MY_CENTERS) — يمكنك تقييدها إن أردت
      const centersOpts = (MY_CENTERS||[]).map(c =>
        `<option value="${c.id}" ${String(r.default_center_id||'')===String(c.id)?'selected':''}>${c.name}</option>`).join('');
      const roleOpts = ROLES.map(x=>`<option value="${x}" ${x===r.role?'selected':''}>${x}</option>`).join('');
      h += `<tr>
        <td style="white-space:nowrap">${r.user_id}</td>
        <td>${r.full_name || ''}<div class="muted">${r.email || ''}</div></td>
        <td><select data-role="${r.user_id}" class="btn btn-light">${roleOpts}</select></td>
        <td><select data-defc="${r.user_id}" class="btn btn-light"><option value="">—</option>${centersOpts}</select></td>
        <td><button class="btn btn-light" data-save="${r.user_id}">حفظ</button></td>
      </tr>`;
    });
    h += '</tbody></table></div>';
    host.innerHTML = h;

    host.querySelectorAll('[data-save]')?.forEach(btn=>{
      btn.onclick = async ()=>{
        const uid  = btn.dataset.save;
        const role = host.querySelector(`[data-role="${uid}"]`)?.value;
        const defc = host.querySelector(`[data-defc="${uid}"]`)?.value || null;
        try{
          if(role){
            const { error } = await sb.rpc('rpc_admin_set_user_role', { p_user_id: uid, p_role: role });
            if(error) throw error;
          }
          if(defc){
            const { error } = await sb.rpc('rpc_admin_set_user_default_center', { p_user_id: uid, p_center_id: +defc });
            if(error) throw error;
          }
          alert('تم الحفظ ✅');
        }catch(e){ alert(e.message); }
      };
    });
  }catch(e){ host.innerHTML = `<div class="muted">${e.message}</div>`; }
}

/* ===== بعد الدخول ===== */
async function afterLoginInit(){
  setText($('profile-role'), CURRENT_ROLE || '—');

  // 1) ابنِ الواجهات أولاً
  ensureReportsUI();
  ensureSettingsUI();

  // 2) اللـوكدات
  await loadItems();
  await loadMyCenters();

  // 3) الاسم + مركز العرض (بدون فرض مركز على الأدمن)
  try{
    const uid = (await sb.auth.getUser()).data.user?.id;
    if(uid){
      const { data: me } = await sb.from('profiles')
        .select('full_name, default_center_id').eq('user_id', uid).maybeSingle();
      if(me) setText($('profile-name'), me.full_name || '—');
      const def = MY_CENTERS.find(c=>c.is_default) || null;
      setText($('profile-center'), def ? def.name : '—');
    }
  }catch{}

  // 4) اللوحة
  await loadWarehouseSnapshot();
  if (CURRENT_CENTER_ID) await loadCenterSnapshot();

  // صفحات الإعدادات (admin)
  if (CURRENT_ROLE === 'admin'){
    await refreshAdminCenters();
    await refreshAdminUsers();
  }
}

/* ===== Start ===== */
window.addEventListener('load', refreshAuthUI);
