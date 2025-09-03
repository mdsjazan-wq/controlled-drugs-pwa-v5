const $ = (id)=>document.getElementById(id);
const todayISO = ()=> new Date().toISOString().slice(0,10);
function toast(el, txt, ok=false){ el.style.color = ok ? '#089981' : '#b00020'; el.textContent = txt; }
function fmtInt(n){ return (n??0).toLocaleString('en-US'); }

const sb = supabase.createClient(window.CD_CONFIG.SUPABASE_URL, window.CD_CONFIG.SUPABASE_ANON_KEY);

// Tabs
document.querySelectorAll('.chip').forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const t = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.getElementById('tab-'+t).classList.add('active');
  };
});

// Auth
async function getRole(){
  try{ const { data } = await sb.rpc('app_current_role'); return data || '-'; }catch{ return '-'; }
}
async function refreshUI(){
  const { data:{user} } = await sb.auth.getUser();
  if(!user){
    document.getElementById('auth-screen').style.display='';
    document.getElementById('app-header').style.display='none';
    document.getElementById('app-main').style.display='none';
    return;
  }
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app-header').style.display='';
  document.getElementById('app-main').style.display='';
  $('whoami').textContent = user.email || user.id;
  const role = await getRole(); $('profile-role').textContent = role;

  await loadLookups();
  await loadWarehouseSnapshot();
}
$('btn-login').onclick = async ()=>{
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const el = $('login-msg'); el.textContent = '';
  try{
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error) throw error;
    toast(el,'تم تسجيل الدخول ✅',true);
    refreshUI();
  }catch(e){ toast(el,e.message); }
};
$('btn-otp').onclick = async ()=>{
  const email = $('login-email').value.trim();
  const el = $('login-msg'); el.textContent = '';
  try{
    const { error } = await sb.auth.signInWithOtp({ email });
    if(error) throw error;
    toast(el,'أرسلنا رابط تسجيل الدخول لبريدك ✅',true);
  }catch(e){ toast(el,e.message); }
};
$('btn-logout').onclick = async ()=>{ await sb.auth.signOut(); refreshUI(); };

// Lookups
async function loadLookups(){
  const { data: items } = await sb.from('items').select('id,name').order('id');
  const { data: centers } = await sb.from('centers').select('id,name,active').order('id');
  const itemsOpts = (items||[]).map(i=>`<option value="${i.id}">${i.name}</option>`).join('');
  const centersOpts = (centers||[]).filter(c=>c.active!==false).map(c=>`<option value="${c.id}">${c.name}</option>`).join('');

  ['req-issue-item','req-ret-item','whinit-item','centinit-item'].forEach(id=>{ const el=$(id); if(el) el.innerHTML = itemsOpts; });
  ['req-issue-center','req-ret-center','center-filter','centinit-center'].forEach(id=>{ const el=$(id); if(el) el.innerHTML = centersOpts; });
  ['req-issue-date','req-ret-date'].forEach(id=>{ const el=$(id); if(el) el.value = todayISO(); });
}

// Dashboard
async function loadWarehouseSnapshot(){
  const tbody = document.querySelector('#tbl-warehouse tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="muted">جارٍ التحميل…</td></tr>';
  try{
    const { data, error } = await sb.rpc('fn_warehouse_snapshot');
    if(error) throw error;
    const rows = (data||[]).map(r=>`<tr>
      <td>${r.item_name ?? ('#'+r.item_id)}</td>
      <td>${fmtInt(r.initial_qty)}</td>
      <td>${fmtInt(r.received_from)}</td>
      <td>${fmtInt(r.issued_to_center)}</td>
      <td>${fmtInt(r.return_empty)}</td>
      <td>${fmtInt(r.return_expired)}</td>
      <td>${fmtInt(r.on_hand)}</td>
    </tr>`).join('');
    tbody.innerHTML = rows || '<tr><td colspan="7" class="muted">لا يوجد بيانات</td></tr>';
  }catch(e){ tbody.innerHTML = `<tr><td colspan="7">${e.message}</td></tr>`; }
}

$('btn-center-snap')?.addEventListener('click', async ()=>{
  const p_center_id = Number($('center-filter').value);
  const tbody = document.querySelector('#tbl-center-snap tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="muted">جارٍ التحميل…</td></tr>';
  try{
    const { data, error } = await sb.rpc('fn_center_snapshot', { p_center_id });
    if(error) throw error;
    const rows = (data||[]).map(r=>`<tr>
      <td>${r.item_name ?? ('#'+r.item_id)}</td>
      <td>${fmtInt(r.initial_qty)}</td>
      <td>${fmtInt(r.received_from_main)}</td>
      <td>${fmtInt(r.returned_to_main)}</td>
      <td>${fmtInt(r.on_hand)}</td>
    </tr>`).join('');
    tbody.innerHTML = rows || '<tr><td colspan="5" class="muted">لا يوجد بيانات</td></tr>';
  }catch(e){ tbody.innerHTML = `<tr><td colspan="5">${e.message}</td></tr>`; }
});

// Requests
async function fillRequestLookups(){ /* already in loadLookups */ }
async function createIssueRequest(){
  const p_center_id = Number($('req-issue-center').value);
  const p_item_id = Number($('req-issue-item').value);
  const p_qty = Number($('req-issue-qty').value);
  const p_happened_at = $('req-issue-date').value || todayISO();
  const el = $('msg-create-issue'); el.textContent='';
  try{
    const { data:newId, error } = await sb.rpc('rpc_request_create_issue', { p_center_id, p_item_id, p_qty, p_happened_at });
    if(error) throw error;
    toast(el, `تم إرسال طلب الصرف ✅ (رقم: ${newId})`, true);
    await loadPendingRequests();
  }catch(e){ toast(el, e.message); }
}
async function createReturnRequest(){
  const p_center_id = Number($('req-ret-center').value);
  const p_item_id = Number($('req-ret-item').value);
  const p_qty = Number($('req-ret-qty').value);
  const p_status = $('req-ret-status').value;
  const p_happened_at = $('req-ret-date').value || todayISO();
  const el = $('msg-create-return'); el.textContent='';
  try{
    const { data:newId, error } = await sb.rpc('rpc_request_create_return', { p_center_id, p_item_id, p_qty, p_status, p_happened_at });
    if(error) throw error;
    toast(el, `تم إرسال طلب الرجيع ✅ (رقم: ${newId})`, true);
    await loadPendingRequests();
  }catch(e){ toast(el, e.message); }
}
async function loadPendingRequests(){
  const tbody = document.querySelector('#tbl-requests tbody');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="muted">جارٍ التحميل…</td></tr>';
  try{
    const { data, error } = await sb.rpc('rpc_request_list_pending');
    if(error) throw error;
    const rows = (data||[]).map(r=>`<tr>
      <td>${r.id}</td>
      <td>${r.req_type}</td>
      <td>${r.center_name}</td>
      <td>${r.item_name}</td>
      <td>${fmtInt(r.qty)}</td>
      <td>${r.return_status ?? ''}</td>
      <td>${r.happened_at ?? ''}</td>
      <td>${r.status}</td>
      <td>
        <button class="btn btn-primary" onclick="approveRequest(${r.id}, true)">اعتماد</button>
        <button class="btn btn-danger" onclick="approveRequest(${r.id}, false)">رفض</button>
      </td>
    </tr>`).join('');
    tbody.innerHTML = rows || '<tr><td colspan="9" class="muted">لا يوجد طلبات</td></tr>';
  }catch(e){ tbody.innerHTML = `<tr><td colspan="9">${e.message}</td></tr>`; }
}
async function approveRequest(id, ok){
  const p_request_id = Number(id);
  const p_approve = !!ok;
  const p_happened_at = todayISO();
  try{
    const { error } = await sb.rpc('rpc_request_approve', { p_request_id, p_approve, p_happened_at });
    if(error) throw error;
    await loadPendingRequests();
    await loadWarehouseSnapshot();
  }catch(e){ alert(e.message); }
}
$('btn-create-issue')?.addEventListener('click', createIssueRequest);
$('btn-create-return')?.addEventListener('click', createReturnRequest);
$('btn-refresh-requests')?.addEventListener('click', loadPendingRequests);

// Admin
async function adminResetAll(){
  const el = $('msg-reset-all'); el.textContent='';
  if(!confirm('هل أنت متأكد من تصفير كل الكميات؟')) return;
  try{
    const { error } = await sb.rpc('rpc_admin_reset_all');
    if(error) throw error;
    toast(el,'تم التصفير ✅',true);
    await loadWarehouseSnapshot();
  }catch(e){ toast(el, e.message); }
}
async function adminSetWhInit(){
  const p_item_id = Number($('whinit-item').value);
  const p_qty = Number($('whinit-qty').value);
  const el = $('msg-whinit'); el.textContent='';
  try{
    const { error } = await sb.rpc('rpc_admin_set_initial_warehouse', { p_item_id, p_qty });
    if(error) throw error;
    toast(el,'تم الحفظ ✅',true);
    await loadWarehouseSnapshot();
  }catch(e){ toast(el, e.message); }
}
async function adminSetCenterInit(){
  const p_center_id = Number($('centinit-center').value);
  const p_item_id   = Number($('centinit-item').value);
  const p_qty       = Number($('centinit-qty').value);
  const el = $('msg-centinit'); el.textContent='';
  try{
    const { error } = await sb.rpc('rpc_admin_set_initial_center', { p_center_id, p_item_id, p_qty });
    if(error) throw error;
    toast(el,'تم الحفظ ✅',true);
  }catch(e){ toast(el, e.message); }
}
$('btn-reset-all')?.addEventListener('click', adminResetAll);
$('btn-whinit-set')?.addEventListener('click', adminSetWhInit);
$('btn-centinit-set')?.addEventListener('click', adminSetCenterInit);

// Centers admin
async function adminLoadCenters(){
  const tbody = document.querySelector('#tbl-centers-admin tbody'); if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="muted">جارٍ التحميل…</td></tr>';
  try{
    const { data, error } = await sb.rpc('rpc_admin_list_centers');
    if(error) throw error;
    const rows = (data||[]).map(c=>`<tr>
      <td>${c.id}</td>
      <td><input id="cen-name-${c.id}" value="${c.name}"/></td>
      <td><input id="cen-act-${c.id}" type="checkbox" ${c.active ? 'checked':''}/></td>
      <td>
        <button class="btn btn-primary" onclick="adminSaveCenter(${c.id})">حفظ</button>
        <button class="btn btn-danger" onclick="adminDeleteCenter(${c.id})">حذف</button>
      </td>
    </tr>`).join('');
    tbody.innerHTML = rows || '<tr><td colspan="4" class="muted">لا يوجد مراكز</td></tr>';
  }catch(e){ tbody.innerHTML = `<tr><td colspan="4">${e.message}</td></tr>`; }
}
async function adminAddCenter(){
  const name = $('center-new-name').value.trim(); if(!name) return;
  const msg = $('msg-centers-admin'); msg.textContent='';
  try{
    const { error } = await sb.rpc('rpc_admin_upsert_center', { p_center_id: null, p_name: name, p_active: true });
    if(error) throw error;
    $('center-new-name').value = '';
    msg.textContent='تمت الإضافة ✅';
    await adminLoadCenters(); await loadLookups();
  }catch(e){ msg.textContent = e.message; }
}
async function adminSaveCenter(id){
  const name = document.getElementById(`cen-name-${id}`).value;
  const active = document.getElementById(`cen-act-${id}`).checked;
  const msg = $('msg-centers-admin'); msg.textContent='';
  try{
    const { error } = await sb.rpc('rpc_admin_upsert_center', { p_center_id: id, p_name: name, p_active: active });
    if(error) throw error;
    msg.textContent='تم الحفظ ✅';
    await adminLoadCenters(); await loadLookups();
  }catch(e){ msg.textContent = e.message; }
}
async function adminDeleteCenter(id){
  const msg = $('msg-centers-admin'); msg.textContent='';
  if(!confirm('حذف المركز؟ قد يفشل لو عليه بيانات.')) return;
  try{
    const { error } = await sb.rpc('rpc_admin_delete_center', { p_center_id: id });
    if(error) throw error;
    msg.textContent='تم الحذف ✅';
    await adminLoadCenters(); await loadLookups();
  }catch(e){ msg.textContent = e.message; }
}
$('btn-center-add')?.addEventListener('click', adminAddCenter);

// Users admin
async function adminLoadUsers(){
  const tbody = document.querySelector('#tbl-users-admin tbody'); if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="muted">جارٍ التحميل…</td></tr>';
  try{
    const { data: centers } = await sb.rpc('rpc_admin_list_centers');
    const centerOpts = (centers||[]).filter(c=>c.active!==false).map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
    const { data, error } = await sb.rpc('rpc_admin_list_profiles');
    if(error) throw error;
    const rows = (data||[]).map(u=>`<tr>
      <td style="font-family:monospace">${u.user_id}</td>
      <td>${u.full_name || u.email || ''}</td>
      <td>
        <select id="u-role-${u.user_id}">
          <option value="user" ${u.role==='user'?'selected':''}>user</option>
          <option value="storekeeper" ${u.role==='storekeeper'?'selected':''}>storekeeper</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>admin</option>
        </select>
      </td>
      <td>
        <select id="u-center-${u.user_id}">${centerOpts}</select>
        <script>document.getElementById('u-center-${u.user_id}').value='${u.default_center_id || ''}'</script>
      </td>
      <td><button class="btn btn-primary" onclick="adminSaveUser('${u.user_id}')">حفظ</button></td>
    </tr>`).join('');
    tbody.innerHTML = rows || '<tr><td colspan="5" class="muted">لا يوجد مستخدمون</td></tr>';
  }catch(e){ tbody.innerHTML = `<tr><td colspan="5">${e.message}</td></tr>`; }
}
async function adminSaveUser(uid){
  const role = document.getElementById(`u-role-${uid}`).value;
  const center = Number(document.getElementById(`u-center-${uid}`).value || 0) || null;
  const msg = $('msg-users-admin'); msg.textContent='';
  try{
    const { error: e1 } = await sb.rpc('rpc_admin_set_user_role', { p_user_id: uid, p_role: role });
    if(e1) throw e1;
    const { error: e2 } = await sb.rpc('rpc_admin_set_user_center', { p_user_id: uid, p_center_id: center });
    if(e2) throw e2;
    msg.textContent='تم الحفظ ✅';
  }catch(e){ msg.textContent = e.message; }
}

// When switching to settings tab and role is admin, load admin lists
const navObs = new MutationObserver(async ()=>{
  if(document.getElementById('tab-settings').classList.contains('active')){
    const role = await getRole();
    if(role==='admin'){ await adminLoadCenters(); await adminLoadUsers(); }
  }
});
navObs.observe(document.body,{attributes:true,subtree:true,attributeFilter:['class']});

// init
refreshUI();
loadPendingRequests();