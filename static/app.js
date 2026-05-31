const csrf = window.APP.csrf;
const role = window.APP.user.role;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const roleNames = {admin:'Адміністратор',transfusion:'Трансфузіолог',doctor:'Лікар',nurse:'Медсестра'};
const statusNames = {created:'Створена',approved:'Погоджена',reserved:'Зарезервована',partial_issued:'Частково видана',issued:'Видана',used:'Використана',rejected:'Відмовлена',deleted:'Видалена',in_stock:'На складі',written_off:'Списана',expired:'Протермінована',ok:'Норма',low:'Нижче норми',high:'Вище норми',alarm:'Тривога',routine:'Планова',urgent:'Термінова',emergency:'Невідкладна'};
const actionNames = {income:'Надходження',issue:'Видача',issue_net:'Видача нетто',used:'Використано',return:'Повернення',writeoff:'Списання',expired:'Протерміновано',delete:'Видалення',restore:'Відновлення'};

async function api(url, opts={}) {
  opts.headers = Object.assign({'Content-Type':'application/json','X-CSRF-Token':csrf}, opts.headers || {});
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({ok:false,error:'Bad JSON'}));
  if (!j.ok) throw new Error(j.error || 'Помилка');
  return j;
}
async function apiForm(url, formData, opts={}) {
  const r = await fetch(url, Object.assign({method:'POST', headers:{'X-CSRF-Token':csrf}, body:formData}, opts));
  const j = await r.json().catch(() => ({ok:false,error:'Bad JSON'}));
  if (!j.ok) throw new Error(j.error || 'Помилка');
  return j;
}
function ensureUiShell(){
  if(!document.getElementById('toastBox')){
    const box=document.createElement('div');
    box.id='toastBox';
    box.className='toast-box';
    document.body.appendChild(box);
  }
  if(!document.getElementById('modalHost')){
    const host=document.createElement('div');
    host.id='modalHost';
    host.className='modal-host hidden';
    host.innerHTML = `<div class="modal-card">
      <h3 id="modalTitle"></h3>
      <p id="modalText"></p>
      <input id="modalInput" class="modal-input">
      <div class="modal-actions">
        <button id="modalCancel" type="button" class="secondary">Скасувати</button>
        <button id="modalOk" type="button">OK</button>
      </div>
    </div>`;
    document.body.appendChild(host);
  }
}
function notify(msg, type='info'){
  ensureUiShell();
  const box=document.getElementById('toastBox');
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  t.textContent=String(msg || '');
  box.appendChild(t);
  setTimeout(()=>{ t.classList.add('hide'); setTimeout(()=>t.remove(), 350); }, 3500);
}
function askModal({title='Підтвердження', text='', placeholder='', defaultValue='', input=false, danger=false}={}){
  ensureUiShell();
  const host=document.getElementById('modalHost');
  const titleEl=document.getElementById('modalTitle');
  const textEl=document.getElementById('modalText');
  const inputEl=document.getElementById('modalInput');
  const okBtn=document.getElementById('modalOk');
  const cancelBtn=document.getElementById('modalCancel');
  titleEl.textContent=title;
  textEl.textContent=text;
  inputEl.value=defaultValue || '';
  inputEl.placeholder=placeholder || '';
  inputEl.style.display=input ? '' : 'none';
  okBtn.className=danger ? 'danger' : '';
  host.classList.remove('hidden');
  if(input) setTimeout(()=>inputEl.focus(), 50);
  return new Promise(resolve=>{
    const close = v => {
      host.classList.add('hidden');
      okBtn.onclick = cancelBtn.onclick = host.onclick = inputEl.onkeydown = null;
      resolve(v);
    };
    okBtn.onclick=()=>close(input ? inputEl.value : true);
    cancelBtn.onclick=()=>close(null);
    host.onclick=e=>{ if(e.target===host) close(null); };
    inputEl.onkeydown=e=>{ if(e.key==='Enter') close(inputEl.value); if(e.key==='Escape') close(null); };
  });
}
const askText = (title, defaultValue='', placeholder='') => askModal({title, defaultValue, placeholder, input:true});
const askConfirm = (text, title='Підтвердження', danger=false) => askModal({title, text, danger});
async function safe(fn){ try { await fn(); } catch(e){ notify(e.message || e, 'error'); } }
function formObj(form){ return Object.fromEntries(new FormData(form).entries()); }
function formObjWithChecks(form){
  const o = formObj(form);
  form.querySelectorAll('input[type="checkbox"]').forEach(x => o[x.name] = x.checked ? 1 : 0);
  return o;
}
function setCheck(form, name, value){ const el=form?.querySelector(`[name="${name}"]`); if(el) el.checked = String(value)==='1' || value===true; }
function pill(v){ return `<span class="pill">${esc(statusNames[v] || actionNames[v] || v || '—')}</span>`; }
function table(headers, rows){
  rows = rows || [];
  let h = '<table class="table"><thead><tr>' + headers.map(x => `<th>${esc(x[0])}</th>`).join('') + '</tr></thead><tbody>';
  h += rows.map(r => '<tr>' + headers.map(x => `<td data-label="${esc(x[0])}">${x[2] ? x[2](r) : esc(r[x[1]])}</td>`).join('') + '</tr>').join('');
  h += '</tbody></table>';
  h += rows.map(r => '<div class="mobile-card">' + headers.map(x => `<div class="mobile-row"><b>${esc(x[0])}</b><span>${x[2] ? x[2](r) : esc(r[x[1]])}</span></div>`).join('') + '</div>').join('');
  if (!rows.length) h += '<div class="empty">Немає даних</div>';
  return h;
}

async function loadComponents(){
  try{
    const j = await api('/api/components');
    const opts = '<option value="">Компонент</option>' + (j.components||[]).map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    document.querySelectorAll('select.component-select').forEach(sel=>{ const cur=sel.value; sel.innerHTML=opts; if(cur) sel.value=cur; });
    const sf=$('#stockComponentFilter');
    if(sf){ const cur=sf.value; sf.innerHTML='<option value="">Усі компоненти</option>' + (j.components||[]).map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join(''); if(cur) sf.value=cur; }
  }catch(e){ console.warn('components load failed', e); }
}


async function loadNurses(){
  const sel = $('#nurseSelect');
  if(!sel || !['admin','transfusion','doctor'].includes(role)) return;
  try{
    const j = await api('/api/nurses');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Медсестра / оберіть зі списку</option>' + (j.nurses||[]).map(n =>
      `<option value="${Number(n.id)||0}" data-name="${esc(n.full_name||'')}" data-position="${esc(n.position||'')}">${esc(n.full_name||'')} ${n.position ? '· '+esc(n.position) : ''}</option>`
    ).join('');
    if(cur) sel.value = cur;
  }catch(e){ console.warn('nurses load failed', e); }
}
function syncNurseHidden(){
  const sel = $('#nurseSelect');
  if(!sel) return;
  const opt = sel.selectedOptions && sel.selectedOptions[0];
  const name = opt ? (opt.dataset.name || '') : '';
  const pos = opt ? (opt.dataset.position || '') : '';
  const n = $('#nurseNameHidden'); if(n) n.value = name;
  const p = $('#nursePositionHidden'); if(p) p.value = pos;
}
$('#nurseSelect') && ($('#nurseSelect').onchange = syncNurseHidden);


function showTab(id){
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
  $('#'+id).classList.remove('hidden');
  if(id==='home') loadHome();
  if(id==='requests'){ loadNurses(); loadRequests(); }
  if(id==='patients') loadPatients();
  if(id==='stock') loadStock();
  if(id==='users') loadUsers();
  if(id==='reports') loadReports();
  if(id==='temperature') loadTemperature();
  if(id==='telegram') loadTelegram();
  if(id==='backups') loadBackups();
  if(id==='migration') loadMigrationLog();
  if(id==='control'){ loadIntegrity(); loadAudit(); loadLoginEvents(); }
  if(id==='trash') loadTrash();
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
if(role !== 'admin') document.querySelectorAll('.admin-only').forEach(e => e.style.display='none');
if(!['admin','transfusion'].includes(role)) document.querySelectorAll('.admin-tools').forEach(e => e.style.display='none');
if(role==='nurse') document.querySelectorAll('#requestForm').forEach(e => e.closest('.card') ? e.closest('.card').style.display='none' : e.style.display='none');
if(!['admin','transfusion','nurse'].includes(role)) document.querySelectorAll('#temperatureReadingForm').forEach(e => e.closest('.card') ? e.closest('.card').style.display='none' : e.style.display='none');

async function loadHome(){
  $('#me').innerHTML = `<div class="card"><b>${esc(window.APP.user.full_name)}</b><br>${esc(roleNames[role] || role)} · ${esc(window.APP.user.position || '')}</div>`;
  $('#health').textContent = JSON.stringify(await api('/api/public-health'), null, 2);
  const s = await api('/api/stock/summary');
  $('#summary').innerHTML = table([['Компонент','component_type'],['Група','abo'],['Rh','rh'],['К-сть','qty']], s.summary);
  if(['admin','transfusion'].includes(role)) await loadTransfusionDashboard();
}

async function loadTransfusionDashboard(){
  const box = $('#transfusionDashboard');
  if(box) box.classList.remove('hidden');
  const j = await api('/api/dashboard/transfusion');
  const c = j.counts || {};
  $('#dashboardCards').innerHTML = [
    ['Нові вимоги', c.new_requests||0],
    ['На сьогодні', c.today_needed||0],
    ['На складі', c.in_stock||0],
    ['Видано', c.issued||0],
    ['Протерміновані', c.expired||0],
    ['Темп. відхилення', c.temp_alarm||0]
  ].map(x=>`<div class="dash-card"><b>${esc(x[1])}</b><span>${esc(x[0])}</span></div>`).join('');
  $('#dashNewRequests').innerHTML = table([['ID','id'],['Пацієнт','patient_name'],['Компонент','component_type'],['Група','abo'],['Rh','rh'],['К-сть','quantity'],['Потрібно','needed_date'],['Дії','id',r=>`<a class="button secondary" target="_blank" rel="noopener" href="/api/requests/${Number(r.id)||0}/print.pdf">PDF</a>`]], j.new_requests);
  $('#dashTodayRequests').innerHTML = table([['ID','id'],['Пацієнт','patient_name'],['Статус','status',r=>pill(r.status)],['Компонент','component_type'],['Залишок','remaining_quantity'],['Дії','id',r=>`<a class="button secondary" target="_blank" rel="noopener" href="/api/requests/${Number(r.id)||0}/print.pdf">PDF</a>`]], j.today_requests);
  $('#dashCriticalStock').innerHTML = table([['Компонент','component_type'],['Група','abo'],['Rh','rh'],['К-сть','qty']], j.critical_stock);
  $('#dashExpired').innerHTML = table([['ID','id'],['Компонент','component_type'],['Група','abo'],['Rh','rh'],['Код','unit_code'],['Серія','series'],['Термін','expiry_date'],['Статус','status',r=>pill(r.status)]], j.expired_units);
  $('#dashTempAlerts').innerHTML = table([['Час','measured_at'],['Пристрій','device_name'],['Місце','location'],['Темп.','temperature'],['Норма','min_temp',r=>`${esc(r.min_temp)}…${esc(r.max_temp)}`],['Статус','status',r=>pill(r.status)]], j.temp_alerts);
  $('#dashRecentMovements').innerHTML = table([['Час','created_at'],['Дія','action',r=>pill(r.action)],['Компонент','component_type'],['Код','unit_code'],['Пацієнт','patient_name'],['Користувач','user_name']], j.recent_movements);
}

async function loadPatients(){
  const q = ($('#patientSearch')?.value || '').trim();
  const status = $('#patientStatusFilter')?.value || '';
  const j = await api('/api/patients' + (q ? '?q=' + encodeURIComponent(q) : ''));
  let rows = j.patients || [];
  if(status) rows = rows.filter(r => String(r.patient_status||'') === status);
  $('#patientsList').innerHTML = table([
    ['ID','id'],['ПІБ','full_name'],['Дата нар.','birth_date'],['Проживання','address'],['Відділення','department'],['Діагноз','diagnosis'],['Статус','patient_status'],['Група','abo'],['Rh','rh'],['Примітка','note'],['Дії','id',r=>`<button data-action="open-patient" data-id="${Number(r.id)||0}">Картка</button> ${['admin','transfusion'].includes(role)?`<button class="danger" data-action="delete-patient" data-id="${Number(r.id)||0}">Видалити</button>`:''}`]
  ], rows);
}
async function openPatient(id){ await safe(async()=>{ const j=await api(`/api/patients/${id}`,{method:'GET'}); $('#patientCard').textContent = JSON.stringify(j, null, 2); }); }
async function deletePatient(id){ await safe(async()=>{ if(!await askConfirm('Перемістити пацієнта в приховані?', 'Пацієнт', true)) return; const reason=await askText('Причина', 'помилковий запис') || ''; await api(`/api/patients/${id}`,{method:'DELETE',body:{reason}}); loadPatients(); }); }
$('#patientForm') && ($('#patientForm').onsubmit = e => safe(async()=>{ e.preventDefault(); await api('/api/patients',{method:'POST',body:formObj(e.target)}); e.target.reset(); loadPatients(); }));
$('#loadPatients') && ($('#loadPatients').onclick = () => safe(loadPatients));
$('#patientStatusFilter') && ($('#patientStatusFilter').onchange = () => safe(loadPatients));
$('#patientSearch') && ($('#patientSearch').onkeydown = e => { if(e.key==='Enter') safe(loadPatients); });

let currentReqFilter = 'all';
function todayStr(){ return new Date().toISOString().slice(0,10); }
function requestRoleTitle(){
  if(role==='doctor') return 'Мої вимоги';
  if(role==='nurse') return 'Призначені мені вимоги';
  return 'Вимоги';
}
function renderRequestHint(rows){
  const active = rows.filter(r=>!['used','rejected','deleted'].includes(r.status)).length;
  const today = rows.filter(r=>r.needed_date===todayStr()).length;
  const created = rows.filter(r=>r.status==='created').length;
  const issued = rows.filter(r=>['issued','partial_issued'].includes(r.status)).length;
  const used = rows.filter(r=>r.status==='used').length;
  const label = role==='doctor' ? 'Показані лише вимоги, створені вами.' : role==='nurse' ? 'Показані лише вимоги, де ви призначені медсестрою.' : 'Показані всі доступні вам вимоги.';
  $('#roleRequestHint').innerHTML = `<b>${esc(label)}</b><br>Активні: ${active} · На сьогодні: ${today} · Нові: ${created} · Видані: ${issued} · Використані: ${used}`;
}
function filterRequests(rows){
  const t=todayStr();
  if(currentReqFilter==='active') return rows.filter(r=>!['used','rejected','deleted'].includes(r.status));
  if(currentReqFilter==='today') return rows.filter(r=>r.needed_date===t);
  if(currentReqFilter==='created') return rows.filter(r=>r.status==='created');
  if(currentReqFilter==='issued') return rows.filter(r=>['issued','partial_issued'].includes(r.status));
  if(currentReqFilter==='used') return rows.filter(r=>r.status==='used');
  return rows;
}
async function loadRequests(){
  const j = await api('/api/requests');
  $('#requestsTitle').textContent = requestRoleTitle();
  renderRequestHint(j.requests||[]);
  document.querySelectorAll('[data-req-filter]').forEach(b=>b.classList.toggle('active', b.dataset.reqFilter===currentReqFilter));
  const rows = filterRequests(j.requests||[]);
  $('#requestsList').innerHTML = table([
    ['ID','id'],['Пацієнт','patient_name'],['Дата нар.','birth_date'],['Проживання','address'],['Відділення','department'],['Діагноз','diagnosis'],['Статус хворого','patient_status'],
    ['Терміновість','urgency',r=>pill(r.urgency)],['Показання','indication'],['Анамнез','transfusion_history'],['Реакції','reaction_note'],['Компонент','component_type'],['Група','abo'],['Rh','rh'],['К-сть','quantity'],['Видано','delivered_count'],['Залишок','remaining_quantity'],['Потрібно на','needed_date'],['Лікар','doctor_name'],['Посада лікаря','doctor_position'],['Медсестра','nurse_name'],['Примітка','request_note'],['Статус','status',r=>pill(r.status)],['Дії','id',r=>actionsReq(r)]
  ], rows);
}
document.querySelectorAll('[data-req-filter]').forEach(b=>b.onclick=()=>{ currentReqFilter=b.dataset.reqFilter||'all'; loadRequests(); });
function actionsReq(r){
  let a = '';
  if(['admin','transfusion'].includes(role) && r.status === 'created') a += `<button data-action="approve-request" data-id="${Number(r.id)||0}">Погодити</button> <button class="danger" data-action="reject-request" data-id="${Number(r.id)||0}">Відмовити</button> `;
  if(['admin','transfusion'].includes(role) && ['approved','reserved','partial_issued','issued'].includes(r.status) && Number(r.remaining_quantity||0)>0) a += `<button data-action="issue-request" data-id="${Number(r.id)||0}">Видати</button> `;
  a += `<a class="button secondary" target="_blank" rel="noopener" href="/api/requests/${Number(r.id)||0}/print.pdf">PDF</a> `;
  if(r.status === 'created') a += `<button class="secondary" data-action="delete-request" data-id="${Number(r.id)||0}">Видалити</button>`;
  return `<div class="actions">${a || '—'}</div>`;
}
async function approve(id){ await safe(async()=>{ await api(`/api/requests/${id}/approve`,{method:'POST',body:{}}); notify('Вимогу погоджено','success'); loadRequests(); loadHome(); }); }
async function rejectReq(id){ await safe(async()=>{ let reason=await askText('Причина відмови') || ''; await api(`/api/requests/${id}/reject`,{method:'POST',body:{reason}}); notify('Вимогу відмовлено','success'); loadRequests(); loadHome(); }); }
async function deleteReq(id){ await safe(async()=>{ let reason=await askText('Причина видалення', 'помилкова вимога') || ''; if(!await askConfirm('Перемістити створену вимогу в кошик?', 'Вимога', true)) return; await api(`/api/requests/${id}/delete`,{method:'POST',body:{reason}}); notify('Вимогу переміщено в кошик','success'); loadRequests(); loadTrash(); }); }
async function restoreReq(id){ await safe(async()=>{ await api(`/api/requests/${id}/restore`,{method:'POST',body:{}}); notify('Вимогу відновлено','success'); loadTrash(); loadRequests(); }); }
async function issueReq(id){ await safe(async()=>{
  const j = await api(`/api/requests/${id}/available-units`);
  const remaining = Number(j.request.remaining_quantity || j.request.quantity || 0);
  const ids = j.units.slice(0, remaining).map(x => x.id);
  if(ids.length < 1) throw new Error('Немає сумісних одиниць на складі');
  const msg = ids.join(',');
  const custom = await askText(`Одиниці для видачі через кому. Можна видати частково. Залишок по вимозі: ${remaining}. FEFO: ${msg}`, msg);
  if(!custom) return;
  await api('/api/issue',{method:'POST',body:{request_id:id, unit_ids:custom.split(',').map(x=>Number(x.trim())).filter(Boolean)}});
  notify('Компонент видано','success');
  loadRequests(); loadStock(); loadHome();
}); }
$('#requestForm').onsubmit = e => safe(async()=>{ e.preventDefault(); syncNurseHidden(); await api('/api/requests',{method:'POST',body:formObj(e.target)}); e.target.reset(); await loadNurses(); loadRequests(); notify('Вимогу створено', 'success'); });

function filterStockRows(rows){
  const q = ($('#stockSearch')?.value || '').toLowerCase().trim();
  const comp = $('#stockComponentFilter')?.value || '';
  const abo = $('#stockAboFilter')?.value || '';
  const rh = $('#stockRhFilter')?.value || '';
  const st = $('#stockStatusFilter')?.value || '';
  let out = rows || [];
  if(q) out = out.filter(r => [r.component_type,r.unit_code,r.series,r.source,r.note,r.request_id].some(v=>String(v||'').toLowerCase().includes(q)));
  if(comp) out = out.filter(r => r.component_type === comp);
  if(abo) out = out.filter(r => r.abo === abo);
  if(rh) out = out.filter(r => r.rh === rh);
  if(st) out = out.filter(r => r.status === st);
  return out;
}
function renderStockHint(allRows, rows){
  const total = allRows.length, shown = rows.length;
  const inStock = rows.filter(r=>r.status==='in_stock').length;
  const issued = rows.filter(r=>r.status==='issued').length;
  const used = rows.filter(r=>r.status==='used').length;
  const expired = rows.filter(r=>r.status==='expired').length;
  const written = rows.filter(r=>r.status==='written_off').length;
  const box=$('#stockFilterHint');
  if(box) box.innerHTML = `Показано: <b>${shown}</b> з ${total} · На складі: ${inStock} · Видано: ${issued} · Використано: ${used} · Списано: ${written} · Протерміновано: ${expired}`;
}
async function loadStock(){
  const j = await api('/api/stock');
  const allRows = j.units || [];
  const rows = filterStockRows(allRows);
  renderStockHint(allRows, rows);
  $('#stockList').innerHTML = table([
    ['ID','id'],['Компонент','component_type'],['Група','abo'],['Rh','rh'],['Код','unit_code'],['Серія','series'],['Джерело','source'],['Надійшло','received_date'],['Термін','expiry_date'],['Статус','status',r=>pill(r.status)],['Вимога','request_id'],['Дії','id',r=>actionsUnit(r)]
  ], rows);
}
function actionsUnit(r){
  let a='';
  if(['admin','transfusion'].includes(role) && ['in_stock','reserved'].includes(r.status)) a += `<button class="danger" data-action="writeoff-unit" data-id="${Number(r.id)||0}">Списати</button> `;
  if(['admin','transfusion'].includes(role) && ['in_stock','reserved','expired','written_off'].includes(r.status)) a += `<button class="secondary" data-action="delete-unit" data-id="${Number(r.id)||0}">В кошик</button> `;
  if(r.status === 'issued') a += `<button data-action="used-unit" data-id="${Number(r.id)||0}">Використано</button> `;
  if(['admin','transfusion'].includes(role) && r.status === 'issued') a += `<button class="secondary" data-action="return-unit" data-id="${Number(r.id)||0}">Повернути</button> `;
  a += `<button class="secondary trace-btn" data-trace-id="${Number(r.id)||0}">Слід</button> `;
  a += `<a class="button secondary" target="_blank" rel="noopener" href="/api/units/${Number(r.id)||0}/trace.pdf">PDF слід</a>`;
  return `<div class="actions">${a}</div>`;
}
async function writeoff(id){ await safe(async()=>{ let reason=await askText('Причина списання') || ''; await api(`/api/units/${id}/writeoff`,{method:'POST',body:{reason}}); loadStock(); loadHome(); }); }
async function deleteUnit(id){ await safe(async()=>{ let reason=await askText('Причина переміщення в кошик','помилковий запис') || ''; await api(`/api/units/${id}/delete`,{method:'POST',body:{reason}}); loadStock(); loadTrash(); loadHome(); }); }
async function restoreUnit(id){ await safe(async()=>{ let reason=await askText('Причина відновлення','відновити') || ''; await api(`/api/units/${id}/restore`,{method:'POST',body:{reason}}); loadTrash(); loadStock(); loadHome(); }); }

function reactionModal(){
  ensureUiShell();
  const host=document.getElementById('modalHost');
  const titleEl=document.getElementById('modalTitle');
  const textEl=document.getElementById('modalText');
  const inputEl=document.getElementById('modalInput');
  const okBtn=document.getElementById('modalOk');
  const cancelBtn=document.getElementById('modalCancel');
  titleEl.textContent='Підтвердити використання компонента';
  textEl.textContent='Оберіть реакцію після трансфузії та, за потреби, додайте опис.';
  inputEl.style.display='none';
  okBtn.className='';
  const oldExtra=document.getElementById('reactionExtraFields');
  if(oldExtra) oldExtra.remove();
  const extra=document.createElement('div');
  extra.id='reactionExtraFields';
  extra.innerHTML = `<select id="reactionType" class="modal-input">
      <option value="none">Реакції немає</option>
      <option value="fever">Підвищення температури</option>
      <option value="chills">Озноб</option>
      <option value="urticaria">Кропив’янка / висип</option>
      <option value="hypotension">Гіпотензія</option>
      <option value="dyspnea">Задишка</option>
      <option value="back_pain">Біль у попереку</option>
      <option value="hemolysis_suspected">Підозра на гемоліз</option>
      <option value="other">Інше</option>
    </select>
    <select id="reactionSeverity" class="modal-input">
      <option value="none">Тяжкість: немає</option>
      <option value="mild">Легка</option>
      <option value="moderate">Середня</option>
      <option value="severe">Тяжка</option>
    </select>
    <textarea id="reactionNote" class="modal-input" rows="3" placeholder="Опис / примітка">Реакції немає</textarea>`;
  textEl.after(extra);
  host.classList.remove('hidden');
  const typeEl=extra.querySelector('#reactionType');
  const sevEl=extra.querySelector('#reactionSeverity');
  const noteEl=extra.querySelector('#reactionNote');
  const sync=()=>{
    if(typeEl.value==='none'){
      sevEl.value='none';
      noteEl.value = noteEl.value || 'Реакції немає';
    }else if(sevEl.value==='none'){
      sevEl.value='mild';
      if(noteEl.value==='Реакції немає') noteEl.value='';
    }
  };
  typeEl.onchange=sync;
  return new Promise(resolve=>{
    const close = v => {
      host.classList.add('hidden');
      extra.remove();
      okBtn.onclick = cancelBtn.onclick = host.onclick = null;
      resolve(v);
    };
    okBtn.onclick=()=>{ sync(); close({reaction_type:typeEl.value, reaction_severity:sevEl.value, reaction_note:noteEl.value}); };
    cancelBtn.onclick=()=>close(null);
    host.onclick=e=>{ if(e.target===host) close(null); };
  });
}

async function used(id){ await safe(async()=>{ const reaction=await reactionModal(); if(!reaction) return; const j=await api(`/api/units/${id}/used`,{method:'POST',body:reaction}); notify('Використано: '+(j.reaction?.label || 'реакції немає'), j.reaction?.type==='none'?'success':'error'); loadStock(); loadRequests(); loadReports(); }); }
async function returnUnit(id){ await safe(async()=>{ let reason=await askText('Причина повернення на склад', 'не використано') || ''; await api(`/api/units/${id}/return`,{method:'POST',body:{reason}}); loadStock(); loadRequests(); loadReports(); loadHome(); }); }
$('#stockForm').onsubmit = e => safe(async()=>{ e.preventDefault(); await api('/api/stock',{method:'POST',body:formObj(e.target)}); e.target.reset(); loadStock(); loadHome(); });
$('#expireBtn').onclick = () => safe(async()=>{ const j=await api('/api/stock/expire',{method:'POST',body:{}}); notify(`Заблоковано протермінованих: ${j.expired}`); loadStock(); loadHome(); });
['stockSearch','stockComponentFilter','stockAboFilter','stockRhFilter','stockStatusFilter'].forEach(id=>{
  const el=$('#'+id);
  if(!el) return;
  el.onchange = () => safe(loadStock);
  el.oninput = () => { if(id==='stockSearch') safe(loadStock); };
});
$('#loadStock') && ($('#loadStock').onclick = () => safe(loadStock));

async function trace(code){ await safe(async()=>{ const j = await api('/api/traceability/' + encodeURIComponent(code)); showTab('trace'); $('#traceBox').textContent = JSON.stringify(j, null, 2); }); }
$('#traceForm').onsubmit = e => safe(async()=>{ e.preventDefault(); const code = new FormData(e.target).get('code'); await trace(code); });

document.addEventListener('click', e => {
  const btn = e.target.closest('.trace-btn');
  if(!btn) return;
  e.preventDefault();
  const id = btn.dataset.traceId;
  if(id) safe(()=>trace(id));
});

async function loadUsers(){
  if(role !== 'admin') return;
  const j = await api('/api/users');
  $('#usersList').innerHTML = table([
    ['ID','id'],['Логін','username'],['ПІБ','full_name'],['Посада','position'],['Роль','role',r=>esc(roleNames[r.role]||r.role)],['Активний','active',r=>r.active?'Так':'Ні'],['Перший вхід','first_login',r=>r.first_login?'Так':'Ні'],['Дії','id',r=>`<button class="secondary" data-action="reset-password" data-id="${Number(r.id)||0}">Пароль</button> <button class="danger" data-action="deactivate-user" data-id="${Number(r.id)||0}">Вимкнути</button>`]
  ], j.users);
}
async function resetPass(id){ await safe(async()=>{ const password=await askText('Новий тимчасовий пароль', '123456'); if(!password)return; await api(`/api/users/${id}`,{method:'PUT',body:{password}}); loadUsers(); }); }
async function deactivateUser(id){ await safe(async()=>{ if(!await askConfirm('Вимкнути користувача?', 'Користувач', true))return; await api(`/api/users/${id}`,{method:'DELETE',body:{}}); loadUsers(); }); }
$('#userForm') && ($('#userForm').onsubmit = e => safe(async()=>{ e.preventDefault(); await api('/api/users',{method:'POST',body:formObj(e.target)}); e.target.reset(); loadUsers(); }));

function reportQuery(){
  const s = $('#reportStart')?.value || '';
  const e = $('#reportEnd')?.value || '';
  const q = new URLSearchParams();
  if(s) q.set('start', s);
  if(e) q.set('end', e);
  return q.toString();
}
function isoDate(d){ return d.toISOString().slice(0,10); }
function setReportPeriod(kind){
  const now = new Date();
  let start='', end=isoDate(now);
  if(kind==='today'){
    start=end;
  }else if(kind==='month'){
    start = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  }else if(kind==='quarter'){
    const qMonth = Math.floor(now.getMonth()/3)*3;
    start = isoDate(new Date(now.getFullYear(), qMonth, 1));
  }else if(kind==='year'){
    start = isoDate(new Date(now.getFullYear(), 0, 1));
  }else if(kind==='clear'){
    start=''; end='';
  }
  if($('#reportStart')) $('#reportStart').value=start;
  if($('#reportEnd')) $('#reportEnd').value=end;
  document.querySelectorAll('[data-report-period]').forEach(b=>b.classList.toggle('active', b.dataset.reportPeriod===kind));
  loadReports();
}
document.querySelectorAll('[data-report-period]').forEach(b=>b.onclick=()=>setReportPeriod(b.dataset.reportPeriod));
$('#pdfFontCheck') && ($('#pdfFontCheck').onclick = () => safe(async()=>{
  const j = await api('/api/system/pdf-fonts');
  $('#pdfFontBox').textContent = JSON.stringify(j.pdf, null, 2);
}));
async function loadReports(){
  const q = reportQuery();
  if($('#csvLink')) $('#csvLink').href = '/api/reports/export.csv' + (q ? '?' + q : '');
  if($('#xlsxLink')) $('#xlsxLink').href = '/api/reports/export.xlsx' + (q ? '?' + q : '');
  if($('#pdfLink')) $('#pdfLink').href = '/api/reports/export.pdf' + (q ? '?' + q : '');
  if($('#mozLink')) $('#mozLink').href = '/api/reports/moz-template.xlsx' + (q ? '?' + q : '');
  const j = await api('/api/reports/preview' + (q ? '?' + q : ''));
  $('#reportMovements').innerHTML = '<h4>Журнал рухів</h4>' + table([['Дія','action',r=>pill(r.action)],['К-сть','qty']], j.movements) + '<h4>Нетто-підсумок</h4>' + table([['Надходження','income'],['Видача факт','issue'],['Повернення','return'],['Видача нетто','issue_net'],['Використано','used'],['Списано','writeoff'],['Протерміновано','expired']], j.net_movements) + '<h4>Скоригований підсумок</h4>' + table([['Надходження','income'],['Видача факт','issue'],['Повернення','return'],['Видача нетто','issue_net'],['Використано','used'],['Списано','writeoff'],['Протерміновано','expired'],['Корекції','adjustment']], j.adjusted_net_movements);
  $('#reportComponents').innerHTML = '<h4>Журнал по компонентах</h4>' + table([['Компонент','component_type'],['Група','abo'],['Rh','rh'],['Дія','action',r=>pill(r.action)],['К-сть','qty']], j.by_component) + '<h4>Нетто по компонентах</h4>' + table([['Компонент','component_type'],['Група','abo'],['Rh','rh'],['Надходження','income'],['Видача факт','issue'],['Повернення','return'],['Видача нетто','issue_net'],['Використано','used']], j.net_by_component) + '<h4>Скориговано по компонентах</h4>' + table([['Компонент','component_type'],['Група','abo'],['Rh','rh'],['Надходження','income'],['Видача факт','issue'],['Повернення','return'],['Видача нетто','issue_net'],['Використано','used'],['Корекції','adjustment']], j.adjusted_net_by_component);
  $('#reportDaily').innerHTML = table([['Дата','day'],['Дія','action',r=>pill(r.action)],['К-сть','qty']], j.daily);
  $('#reportState').innerHTML = '<h4>Склад</h4>' + table([['Статус','status',r=>pill(r.status)],['К-сть','qty']], j.stock) + '<h4>Вимоги</h4>' + table([['Статус','status',r=>pill(r.status)],['К-сть','qty']], j.requests);
  $('#adjustList').innerHTML = table([['Дата','created_at'],['Період','period_start',r=>`${esc(r.period_start||'')} — ${esc(r.period_end||'')}`],['Компонент','component_type'],['Група','abo'],['Rh','rh'],['Дія','action',r=>pill(r.action)],['Корекція','quantity_delta'],['Причина','reason'],['Дії','id',r=>`<button class="danger" data-action="delete-adjust" data-id="${Number(r.id)||0}">Скасувати</button>`]], j.adjustments);
  if(['admin','transfusion'].includes(role)){
    const a = await api('/api/audit');
    $('#reportAuditList').innerHTML = table([['Дата','created_at'],['Дія','action'],['Сутність','entity'],['ID','entity_id'],['Деталі','details']], a.audit);
  }
}
$('#loadReports').onclick = () => safe(loadReports);
$('#adjustForm') && ($('#adjustForm').onsubmit = e => safe(async()=>{ e.preventDefault(); await api('/api/reports/adjustments',{method:'POST',body:formObj(e.target)}); e.target.reset(); loadReports(); }));
async function deleteAdjust(id){ await safe(async()=>{ if(!await askConfirm('Скасувати корекцію?', 'Звіти', true))return; await api(`/api/reports/adjustments/${id}`,{method:'DELETE',body:{}}); loadReports(); }); }
$('#clearHistory') && ($('#clearHistory').onclick = () => safe(async()=>{
  const start=$('#histStart').value, end=$('#histEnd').value, reason=$('#histReason').value || 'Очищення періоду';
  if(!start || !end) throw new Error('Вкажіть період');
  if(!await askConfirm(`Приховати рухи у звітах за ${start} — ${end}?`, 'Історія звітів', true)) return;
  await api('/api/reports/history/clear',{method:'POST',body:{start,end,reason}}); loadReports(); loadTrash();
}));
$('#restoreHistory') && ($('#restoreHistory').onclick = () => safe(async()=>{
  const start=$('#histStart').value, end=$('#histEnd').value;
  if(!start || !end) throw new Error('Вкажіть період');
  await api('/api/reports/history/restore',{method:'POST',body:{start,end}}); loadReports(); loadTrash();
}));

async function loadTrash(){
  if(!['admin','transfusion'].includes(role)) return;
  const j = await api('/api/trash');
  $('#trashRequests').innerHTML = table([['ID','id'],['Пацієнт','patient_name'],['Компонент','component_type'],['Група','abo'],['Rh','rh'],['К-сть','quantity'],['Видалено','deleted_at'],['Причина','delete_reason'],['Дії','id',r=>`<button data-action="restore-request" data-id="${Number(r.id)||0}">Відновити</button>`]], j.requests);
  $('#trashUnits').innerHTML = table([['ID','id'],['Компонент','component_type'],['Група','abo'],['Rh','rh'],['Код','unit_code'],['Серія','series'],['Статус','status',r=>pill(r.status)],['Причина','delete_reason'],['Дії','id',r=>`<button data-action="restore-unit" data-id="${Number(r.id)||0}">Відновити на склад</button>`]], j.units);
  $('#trashMovements').innerHTML = table([['ID','id'],['Дата','created_at'],['Дія','action',r=>pill(r.action)],['Одиниця','unit_id'],['Вимога','request_id'],['Причина приховання','delete_reason'],['Приховано','deleted_at']], j.movements);
}
$('#loadTrash') && ($('#loadTrash').onclick = () => safe(loadTrash));


function temperatureQuery(){
  const q = new URLSearchParams();
  const d = $('#temperatureFilterDevice')?.value || '';
  const s = $('#temperatureStart')?.value || '';
  const e = $('#temperatureEnd')?.value || '';
  if(d) q.set('device_id', d);
  if(s) q.set('start', s);
  if(e) q.set('end', e);
  return q.toString();
}
async function loadTemperature(){
  await safe(async()=>{
    const devs = await api('/api/temperature/devices');
    const options = '<option value="">Всі пристрої</option>' + devs.devices.map(d=>`<option value="${d.id}">${esc(d.name)} · ${esc(d.location||'')}</option>`).join('');
    if($('#temperatureFilterDevice')){
      const old=$('#temperatureFilterDevice').value;
      $('#temperatureFilterDevice').innerHTML=options;
      if(old) $('#temperatureFilterDevice').value=old;
    }
    if($('#temperatureDeviceSelect')){
      $('#temperatureDeviceSelect').innerHTML = devs.devices.filter(d=>d.active).map(d=>`<option value="${d.id}">${esc(d.name)} · норма ${esc(d.min_temp)}…${esc(d.max_temp)} °C</option>`).join('');
    }
    $('#temperatureDevices').innerHTML = table([
      ['ID','id'],['Назва','name'],['Тип','device_type'],['Місце','location'],['Мін °C','min_temp'],['Макс °C','max_temp'],['Активний','active',r=>r.active?'Так':'Ні'],['Дії','id',r=>['admin','transfusion'].includes(role)?`<button class="danger" data-action="delete-temp-device" data-id="${Number(r.id)||0}">Видалити</button>`:'—']
    ], devs.devices);
    const q = temperatureQuery();
    if($('#temperatureCsvLink')) $('#temperatureCsvLink').href = '/api/temperature/export.csv' + (q ? '?' + q : '');
    if($('#temperatureXlsxLink')) $('#temperatureXlsxLink').href = '/api/temperature/export.xlsx' + (q ? '?' + q : '');
    const j = await api('/api/temperature/readings' + (q ? '?' + q : ''));
    $('#temperatureSummary').innerHTML = table([['Пристрій','device_name'],['Статус','status',r=>pill(r.status)],['К-сть','qty']], j.summary);
    $('#temperatureReadings').innerHTML = table([
      ['Дата/час','measured_at'],['Пристрій','device_name'],['Місце','location'],['Темп. °C','temperature'],['Вологість','humidity'],['Статус','status',r=>pill(r.status)],['Примітка','note'],['Користувач','user_name'],['Дії','id',r=>['admin','transfusion'].includes(role)?`<button class="danger" data-action="delete-temp-reading" data-id="${Number(r.id)||0}">Приховати</button>`:'—']
    ], j.readings);
  });
}
$('#temperatureDeviceForm') && ($('#temperatureDeviceForm').onsubmit = e => safe(async()=>{ e.preventDefault(); await api('/api/temperature/devices',{method:'POST',body:formObjWithChecks(e.target)}); e.target.reset(); const active=e.target.querySelector('[name="active"]'); if(active) active.checked=true; loadTemperature(); }));
$('#temperatureReadingForm') && ($('#temperatureReadingForm').onsubmit = e => safe(async()=>{ e.preventDefault(); const body=formObj(e.target); if(body.measured_at) body.measured_at = body.measured_at.replace('T',' '); const j=await api('/api/temperature/readings',{method:'POST',body}); notify(j.status==='ok'?'Записано. Температура в нормі':'Записано. Є відхилення температури'); e.target.reset(); loadTemperature(); }));
$('#loadTemperature') && ($('#loadTemperature').onclick = () => safe(loadTemperature));
async function deleteTempDevice(id){ await safe(async()=>{ const reason=await askText('Причина видалення пристрою','не використовується')||''; await api(`/api/temperature/devices/${id}`,{method:'DELETE',body:{reason}}); loadTemperature(); }); }
async function deleteTempReading(id){ await safe(async()=>{ const reason=await askText('Причина приховування запису','помилковий запис')||''; await api(`/api/temperature/readings/${id}`,{method:'DELETE',body:{reason}}); loadTemperature(); }); }


async function loadTelegram(){
  await safe(async()=>{
    const me = await api('/api/telegram/me');
    const f = $('#telegramMeForm');
    if(f){
      f.chat_id.value = me.subscriber.chat_id || '';
      ['enabled','notify_new_request','notify_approve','notify_reject','notify_issue','notify_used','notify_critical','notify_expired','notify_system'].forEach(k=>setCheck(f,k,me.subscriber[k]));
    }
    if(['admin','transfusion'].includes(role)){
      const cfg = await api('/api/telegram/config');
      $('#telegramConfigBox').textContent = JSON.stringify(cfg.config, null, 2);
      const cf = $('#telegramConfigForm');
      if(cf){ setCheck(cf,'enabled',cfg.config.enabled); cf.critical_threshold.value = cfg.config.critical_threshold || 2; }
      loadTelegramLog();
    }
  });
}
async function loadTelegramLog(){
  if(!['admin','transfusion'].includes(role)) return;
  const j = await api('/api/telegram/log');
  $('#telegramLog').innerHTML = table([['Дата','created_at'],['Подія','event'],['Chat ID','chat_id'],['OK','ok',r=>r.ok?'так':'ні'],['Помилка','error'],['Текст','text']], j.log);
}
$('#telegramMeForm') && ($('#telegramMeForm').onsubmit = e => safe(async()=>{ e.preventDefault(); await api('/api/telegram/me',{method:'POST',body:formObjWithChecks(e.target)}); notify('Збережено'); loadTelegram(); }));
$('#telegramConfigForm') && ($('#telegramConfigForm').onsubmit = e => safe(async()=>{ e.preventDefault(); await api('/api/telegram/config',{method:'POST',body:formObjWithChecks(e.target)}); notify('Налаштування бота збережено'); loadTelegram(); }));
$('#telegramTest') && ($('#telegramTest').onclick = () => safe(async()=>{ const f=$('#telegramMeForm'); const j=await api('/api/telegram/test',{method:'POST',body:{chat_id:f.chat_id.value}}); notify(j.sent ? 'Тест відправлено' : 'Не відправлено. Перевірте bot token / chat_id'); loadTelegramLog(); }));
$('#loadTelegramLog') && ($('#loadTelegramLog').onclick = () => safe(loadTelegramLog));

async function loadBackups(){
  if(role !== 'admin') return;
  const pol = await api('/api/backup/policy');
  if($('#backupPolicyForm')){
    $('#backupPolicyForm').enabled.checked = !!Number(pol.policy?.enabled || 0);
    $('#backupPolicyForm').keep_last.value = pol.policy?.keep_last || 14;
    $('#backupPolicyBox').textContent = JSON.stringify(pol.policy || {}, null, 2);
  }
  const j = await api('/api/backups');
  $('#backupsList').innerHTML = table([
    ['Дата','created_at'],
    ['Файл','file',r=>`<a href="/api/backups/${encodeURIComponent(r.file)}">${esc(r.file)}</a>`],
    ['Розмір','size'],
    ['Таблиці','manifest',r=>esc(Object.entries(r.manifest?.tables||{}).map(([k,v])=>`${k}:${v}`).join(', '))],
    ['SHA256','manifest',r=>esc((r.manifest?.sha256||'').slice(0,16))]
  ], j.backups);
  const lg = await api('/api/backup/log');
  $('#backupLog').innerHTML = table([['Дата','created_at'],['Дія','action'],['Файл','file_name'],['OK','ok',r=>r.ok?'так':'ні'],['Помилка','error'],['Деталі','details']], lg.log);
}
$('#createBackup') && ($('#createBackup').onclick = () => safe(async()=>{ const j=await api('/api/backup/create',{method:'POST',body:{}}); notify('Створено: '+j.file); loadBackups(); }));
$('#runAutoBackup') && ($('#runAutoBackup').onclick = () => safe(async()=>{ const j=await api('/api/backup/auto-run',{method:'POST',body:{}}); notify('Auto-backup створено: '+j.file); loadBackups(); }));
$('#backupPolicyForm') && ($('#backupPolicyForm').onsubmit = e => safe(async()=>{ e.preventDefault(); const body=formObjWithChecks(e.target); const j=await api('/api/backup/policy',{method:'PUT',body}); notify('Політику backup збережено'); $('#backupPolicyBox').textContent = JSON.stringify(j.policy, null, 2); loadBackups(); }));
$('#loadBackups') && ($('#loadBackups').onclick = () => safe(loadBackups));
$('#verifyBackupForm') && ($('#verifyBackupForm').onsubmit = e => safe(async()=>{ e.preventDefault(); const fd=new FormData(e.target); const j=await apiForm('/api/backup/verify',fd); $('#backupVerifyResult').textContent = JSON.stringify(j, null, 2); }));
$('#restoreBackupForm') && ($('#restoreBackupForm').onsubmit = e => safe(async()=>{ e.preventDefault(); if(!await askConfirm('УВАГА: поточні дані будуть замінені даними з backup. Перед відновленням система створить emergency backup. Backup містить медичні та персональні дані. Продовжити?', 'Відновлення backup', true)) return; const fd=new FormData(e.target); const j=await apiForm('/api/backup/restore',fd); notify('Відновлено'); $('#backupVerifyResult').textContent = JSON.stringify(j, null, 2); loadBackups(); }));



async function loadMigrationLog(){
  if(role !== 'admin') return;
  const j = await api('/api/migration/log');
  $('#migrationLog').innerHTML = table([
    ['Дата','created_at'],['Дія','action'],['Джерело','source_kind'],['Файл','file_name'],['OK','ok',r=>r.ok?'так':'ні'],
    ['Користувачі','imported_users'],['Пацієнти','imported_patients'],['Вимоги','imported_requests'],['Одиниці','imported_units'],['Рухи','imported_movements'],['Пропущено','skipped'],['Помилка','error']
  ], j.log);
}
$('#loadMigrationLog') && ($('#loadMigrationLog').onclick = () => safe(loadMigrationLog));
$('#migrationAnalyzeForm') && ($('#migrationAnalyzeForm').onsubmit = e => safe(async()=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const j = await apiForm('/api/migration/analyze', fd);
  $('#migrationResult').textContent = JSON.stringify(j, null, 2);
  loadMigrationLog();
}));
$('#migrationImportForm') && ($('#migrationImportForm').onsubmit = e => safe(async()=>{
  e.preventDefault();
  if(!await askConfirm('Перед імпортом має бути створена резервна копія V7. Імпортувати дані у поточну базу?', 'Міграція', true)) return;
  const fd = new FormData(e.target);
  const j = await apiForm('/api/migration/import', fd);
  $('#migrationResult').textContent = JSON.stringify(j, null, 2);
  notify('Міграцію виконано');
  loadMigrationLog(); loadHome(); loadPatients(); loadRequests(); loadStock();
}));

if('serviceWorker' in navigator) navigator.serviceWorker.register('/static/service-worker.js');

const actionHandlers = {
  'open-patient': openPatient,
  'delete-patient': deletePatient,
  'approve-request': approve,
  'reject-request': rejectReq,
  'issue-request': issueReq,
  'delete-request': deleteReq,
  'writeoff-unit': writeoff,
  'delete-unit': deleteUnit,
  'used-unit': used,
  'return-unit': returnUnit,
  'restore-unit': restoreUnit,
  'reset-password': resetPass,
  'deactivate-user': deactivateUser,
  'delete-adjust': deleteAdjust,
  'restore-request': restoreReq,
  'delete-temp-device': deleteTempDevice,
  'delete-temp-reading': deleteTempReading
};
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action][data-id]');
  if(!btn) return;
  const fn = actionHandlers[btn.dataset.action];
  if(!fn) return;
  e.preventDefault();
  const id = Number(btn.dataset.id || 0);
  if(!id) return notify('Некоректний ID дії', 'error');
  fn(id);
});

loadComponents(); loadNurses();
showTab('home');

async function loadIntegrity(){
  await safe(async()=>{
    const j = await api('/api/system/integrity');
    $('#integrityBox').textContent = JSON.stringify(j.report, null, 2);
  });
}
async function loadPermissions(){
  await safe(async()=>{
    const j = await api('/api/system/permissions');
    $('#permissionsBox').textContent = JSON.stringify(j.matrix, null, 2);
  });
}
async function loadAudit(){
  await safe(async()=>{
    const q = new URLSearchParams();
    const a = $('#auditAction')?.value || '';
    const e = $('#auditEntity')?.value || '';
    const u = $('#auditUserId')?.value || '';
    if(a) q.set('action', a); if(e) q.set('entity', e); if(u) q.set('user_id', u);
    const j = await api('/api/audit' + (q.toString() ? '?' + q.toString() : ''));
    $('#systemAuditList').innerHTML = table([
      ['Дата','created_at'],['Користувач','user_name',r=>esc(r.user_name||r.username||r.user_id||'—')],['Дія','action'],['Об’єкт','entity'],['ID','entity_id'],['Деталі','details']
    ], j.audit);
  });
}
async function loadLoginEvents(){
  await safe(async()=>{
    const q = new URLSearchParams();
    const user = $('#loginEventUser')?.value || '';
    const success = $('#loginEventSuccess')?.value || '';
    if(user) q.set('username', user);
    if(success !== '') q.set('success', success);
    const j = await api('/api/login-events' + (q.toString() ? '?' + q.toString() : ''));
    $('#loginEventsList').innerHTML = table([
      ['Дата','created_at'],['Логін','username'],['ПІБ','full_name'],['Роль','role',r=>esc(roleNames[r.role]||r.role||'—')],['IP','ip'],['Успіх','success',r=>r.success?'Так':'Ні'],['Причина','reason'],['User-Agent','user_agent']
    ], j.events);
  });
}
$('#loadIntegrity') && ($('#loadIntegrity').onclick = () => safe(loadIntegrity));
$('#loadPermissions') && ($('#loadPermissions').onclick = () => safe(loadPermissions));
$('#loadAudit') && ($('#loadAudit').onclick = () => safe(loadAudit));
$('#loadLoginEvents') && ($('#loadLoginEvents').onclick = () => safe(loadLoginEvents));
$('#runExpireCheck') && ($('#runExpireCheck').onclick = () => safe(async()=>{ const j=await api('/api/system/run-expire-check',{method:'POST',body:{}}); notify('Заблоковано протерміновані: '+j.expired); loadIntegrity(); loadStock(); loadReports(); }));
