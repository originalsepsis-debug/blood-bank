
const ROLE=APP.role, CSRF=APP.csrf;
const FIELD_LABELS_UA={
  patient_name:'ПІБ пацієнта',
  birth_date:'Дата народження',
  patient_status:'Статус пацієнта',
  urgency:'Терміновість',
  department:'Відділення',
  component:'Компонент крові',
  patient_group:'Група крові',
  patient_rh:'Резус',
  amount:'Кількість',
  diagnosis:'Діагноз',
  stock_component:'Компонент',
  stock_group:'Група крові',
  stock_rh:'Резус',
  qr_code:'QR/Barcode'
};
function fieldNameUa(id){return FIELD_LABELS_UA[id]||id}
function toast(msg,type='warn'){
  let t=document.getElementById('toastBox');
  if(!t){t=document.createElement('div');t.id='toastBox';document.body.appendChild(t);}
  t.className='toast '+type;
  t.textContent=msg;
  t.onclick=()=>t.remove();
  setTimeout(()=>{if(t)t.remove()},4500);
}
function requireFields(ids){
  for(const id of ids){
    const el=document.getElementById(id);
    if(!el)continue;
    if(String(el.value||'').trim()===''){
      toast('⚠️ Заповніть поле: '+fieldNameUa(id),'warn');
      try{el.focus()}catch(e){}
      return false;
    }
  }
  return true;
}

if(localStorage.getItem('theme')==='dark'){document.body.classList.add('dark')}
window.REQUEST_TAB='active';
const headers={'Content-Type':'application/json','X-CSRF-Token':CSRF};
window.addEventListener('error',e=>{let d=document.createElement('div');d.className='danger';d.style.position='fixed';d.style.left='10px';d.style.right='10px';d.style.bottom='10px';d.style.zIndex=9999;d.textContent='Помилка інтерфейсу: '+e.message;document.body.appendChild(d);});

function setRequestTab(tab,btn){window.REQUEST_TAB=tab;document.querySelectorAll('.req-tab').forEach(x=>x.classList.remove('active'));if(btn)btn.classList.add('active');loadRequestsLive();}
function compKind(c){c=(c||'').toLowerCase();if(c.includes('кріо')||c.includes('cryo'))return'cryo';if(c.includes('плаз'))return'plasma';if(c.includes('тромб'))return'plt';return'rbc'}
const PERF_CACHE={};
const PERF_TTL_DEFAULT=12000;
function clearPerfCache(prefix){
  Object.keys(PERF_CACHE).forEach(k=>{ if(!prefix || k.startsWith(prefix)) delete PERF_CACHE[k]; });
}
async function jget(u, opts={}){
  const ttl = Number(opts.ttl ?? PERF_TTL_DEFAULT);
  const nowTs = Date.now();
  if(ttl>0 && PERF_CACHE[u] && (nowTs-PERF_CACHE[u].ts)<ttl){
    return PERF_CACHE[u].data;
  }
  const ctrl = new AbortController();
  const timeoutMs = Number(opts.timeout || 15000);
  const timer = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const resp = await fetch(u,{signal:ctrl.signal, cache:'no-store'});
    const text = await resp.text();
    let data;
    try{ data=JSON.parse(text); }catch(e){ data={ok:false,error:text||('HTTP '+resp.status)}; }
    if(!resp.ok){ throw new Error(data.error||('HTTP '+resp.status)); }
    if(ttl>0) PERF_CACHE[u]={ts:nowTs,data};
    return data;
  }finally{
    clearTimeout(timer);
  }
}
async function jpost(u,d){
  const payload={u,d,ts:Date.now()};
  if(!navigator.onLine){
    let q=JSON.parse(localStorage.getItem('offlineQueue')||'[]');
    q.push(payload);
    localStorage.setItem('offlineQueue',JSON.stringify(q));
    showOfflineStatus('Offline: дія збережена локально і буде відправлена після відновлення інтернету');
    return {ok:true, queued:true};
  }
  try{
    const resp=await fetch(u,{method:'POST',headers,body:JSON.stringify(d)});
    const text=await resp.text();
    let data=null;
    try{data=JSON.parse(text)}catch(e){data={ok:false,error:text||('HTTP '+resp.status)}}
    if(!resp.ok){
      toast(data.error||('Помилка сервера: '+resp.status),'warn');
      return data;
    }
    clearPerfCache();
    return data;
  }catch(e){
    let q=JSON.parse(localStorage.getItem('offlineQueue')||'[]');
    q.push(payload);
    localStorage.setItem('offlineQueue',JSON.stringify(q));
    showOfflineStatus('Помилка мережі: дія збережена локально');
    return {ok:true, queued:true};
  }
}
function val(id){return document.getElementById(id)?.value||''}
function escHtml(v){return String(v??'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
async function loadStock(){
  const summaryBox=document.getElementById('stock'); if(!summaryBox)return;
  let st=[]; try{st=await jget('/api/stock');}catch(e){st=[]}
  let entries=[]; try{let r=await jget('/api/stock/entries'); entries=r.items||[]}catch(e){entries=[]}
  let r=0,p=0,t=0,cr=0,low=0;
  let summary='<h3>Поточні залишки</h3><div class="table-scroll"><table><tr><th>Компонент</th><th>Група</th><th>Rh</th><th>К-сть</th></tr>';
  st.forEach(x=>{let q=Number(x.qty||0);if(compKind(x.component)=='rbc')r+=q;if(compKind(x.component)=='plasma')p+=q;if(compKind(x.component)=='plt')t+=q;if(compKind(x.component)=='cryo')cr+=q;if(q<5)low++;summary+=`<tr><td>${escHtml(x.component)}</td><td>${escHtml(x.group||'')}</td><td>${escHtml(x.rh||'')}</td><td>${q}</td></tr>`});
  summary+='</table></div>';
  if(window.rbcStat)rbcStat.textContent=r; if(window.plasmaStat)plasmaStat.textContent=p; if(window.pltStat)pltStat.textContent=t; if(window.cryoStat)cryoStat.textContent=cr; if(window.lowStat)lowStat.textContent=low;
  let list='<h3>Записи складу</h3><div class="notice">Тут можна видати, списати, редагувати або видаляти записи складу. Видано/списано прив’язується до погодженої вимоги.</div>';
  if(entries.length){
    list+='<div class="stock-entry-list">';
    entries.forEach(x=>{
      const positive = String(x.type||'').toLowerCase().includes('надход') || String(x.type||'').toLowerCase().includes('in');
      list+=`<div class="stock-entry-card">
        <div class="stock-entry-head"><b>#${x.id} · ${escHtml(x.type||'')}</b><span>${escHtml(x.created_at||'')}</span></div>
        <div class="stock-entry-grid">
          <div><b>Компонент</b><span>${escHtml(x.component||'')}</span></div>
          <div><b>Група</b><span>${escHtml(x.donor_group||'')}</span></div>
          <div><b>Rh</b><span>${escHtml(x.donor_rh||'')}</span></div>
          <div><b>К-сть</b><span>${escHtml(x.active_amount!=null && !x.is_closed_receipt ? x.active_amount : (x.amount||''))}</span></div>
          ${x.closed_reason?`<div><b>Статус</b><span>${escHtml(x.closed_reason)}</span></div>`:''}
          <div><b>Пакет</b><span>${escHtml(x.pack_no||'—')}</span></div>
          <div><b>Серія</b><span>${escHtml(x.series||'—')}</span></div>
          <div><b>Термін</b><span>${escHtml(x.expiry||'—')}</span></div>
        </div>
        <div class="stock-entry-actions action-wrap">
          ${positive?`<button class="btn-blue small-btn" onclick="issueStockEntryV6423(${x.id})">Видати</button><button class="btn-orange small-btn" onclick="writeoffStockEntryV6423(${x.id})">Списати</button>`:''}
          <button class="btn-blue small-btn" onclick="editStockEntry(${x.id})">Редагувати</button>
          <button class="btn-red small-btn" onclick="deleteStockEntry(${x.id})">Видалити</button>
        </div>
      </div>`;
    });
    list+='</div>';
  }else{
    list+='<div class="notice">Записів складу ще немає</div>';
  }
  summaryBox.innerHTML=(st.length?summary:'<div class="notice">Поточних залишків немає</div>')+list;
}
async function saveStock(){let d={type:val('stock_type'),component:val('stock_component'),donor_group:val('stock_group'),donor_rh:val('stock_rh'),amount:val('stock_amount'),pack_no:val('pack_no'),series:val('series'),expiry:val('expiry'),qr_code:val('qr_code')};let j=await jpost('/api/stock/add',d);alert(j.ok?'Збережено':j.error);loadAll();}
async function editStockEntry(id){
  let r=await jget('/api/stock/entries?include_closed=1',{ttl:0}); const x=(r.items||[]).find(i=>Number(i.id)===Number(id)); if(!x){toast('Запис не знайдено','warn');return;}
  let d={id};
  d.type=prompt('Тип: Надходження / Списання', x.type||'Надходження'); if(d.type===null)return;
  d.component=prompt('Компонент', x.component||''); if(d.component===null)return;
  d.donor_group=prompt('Група', x.donor_group||''); if(d.donor_group===null)return;
  d.donor_rh=prompt('Rh', x.donor_rh||''); if(d.donor_rh===null)return;
  d.amount=prompt('Кількість', x.amount||''); if(d.amount===null)return;
  d.pack_no=prompt('№ пакета', x.pack_no||''); if(d.pack_no===null)return;
  d.series=prompt('Серія', x.series||''); if(d.series===null)return;
  d.expiry=prompt('Термін придатності YYYY-MM-DD', x.expiry||''); if(d.expiry===null)return;
  d.note=prompt('Примітка', x.note||''); if(d.note===null)return;
  let j=await jpost('/api/stock/update',d); alert(j.ok?'Запис складу оновлено':j.error); loadStock(); loadComponentStockV613();
}
async function deleteStockEntry(id){
  if(!confirm('Видалити запис складу №'+id+'? Запис буде перенесено в кошик.'))return;
  let reason=prompt('Причина видалення','Помилковий запис'); if(reason===null)return;
  let j=await jpost('/api/stock/delete',{id,reason}); alert(j.ok?'Запис складу видалено':j.error); loadStock(); loadComponentStockV613();
}

function stockEntryToComponentActionV6423(x){
  return {component:x.component||'', donor_group:x.donor_group||'', donor_rh:x.donor_rh||'', qty:x.amount||1, expiry:x.expiry||'', pack_no:x.pack_no||'', series:x.series||'', stock_entry_id:x.id};
}
async function findStockEntryV6423(id){
  const r=await jget('/api/stock/entries?include_closed=1',{ttl:0,timeout:30000});
  return (r.items||[]).find(i=>Number(i.id)===Number(id));
}
async function issueStockEntryV6423(id){
  const rec=await findStockEntryV6423(id);
  if(!rec){toast('Запис складу не знайдено','bad');return;}
  const x=stockEntryToComponentActionV6423(rec);
  const request_id=await chooseApprovedRequestForComponentV6422(x);
  if(!request_id)return;
  const qty=prompt('Кількість видати', String(x.qty||1));
  if(qty===null)return;
  const r=await jpost('/api/component-stock/issue',{component:x.component, donor_group:x.donor_group, donor_rh:x.donor_rh, qty, request_id, pack_no:x.pack_no, series:x.series, expiry:x.expiry, stock_entry_id:x.stock_entry_id});
  toast(r.ok?'✅ Видано зі складу по вимозі №'+request_id:(r.error||'Помилка видачі'), r.ok?'good':'bad');
  if(r.ok){ clearPerfCache('/api/component-stock'); clearPerfCache('/api/stock'); clearPerfCache('/api/stock/entries'); clearPerfCache('/api/requests'); await loadStock(); await loadComponentStockV613(true); if(typeof loadRequests==='function') loadRequests(); if(typeof loadDashboardPro==='function') loadDashboardPro(); }
}
async function writeoffStockEntryV6423(id){
  const rec=await findStockEntryV6423(id);
  if(!rec){toast('Запис складу не знайдено','bad');return;}
  const x=stockEntryToComponentActionV6423(rec);
  let request_id=null;
  if(confirm('Прив’язати списання до погодженої вимоги?')){
    request_id=await chooseApprovedRequestForComponentV6422(x);
    if(!request_id)return;
  }
  const qty=prompt('Кількість списати', String(x.qty||1));
  if(qty===null)return;
  const series=prompt('Серія компонента для списання', x.series||'');
  if(series===null)return;
  if(!String(series).trim()){toast('Для списання потрібно вказати серію','warn');return;}
  const reason=prompt('Причина списання', 'Списання зі складу') || 'Списання зі складу';
  const r=await jpost('/api/component-stock/writeoff',{component:x.component, donor_group:x.donor_group, donor_rh:x.donor_rh, qty, request_id, reason, pack_no:x.pack_no, series:String(series).trim(), expiry:x.expiry, stock_entry_id:x.stock_entry_id});
  toast(r.ok?'✅ Списано зі складу':(r.error||'Помилка списання'), r.ok?'good':'bad');
  if(r.ok){ clearPerfCache('/api/component-stock'); clearPerfCache('/api/stock'); clearPerfCache('/api/stock/entries'); clearPerfCache('/api/requests'); await loadStock(); await loadComponentStockV613(true); if(typeof loadRequests==='function') loadRequests(); if(typeof loadDashboardPro==='function') loadDashboardPro(); }
}
async function loadRequestsLive(){
  let box=document.getElementById('requests');
  if(!box)return;
  let data=await jget('/api/requests');
  if(!Array.isArray(data)){box.innerHTML='<div class="danger">Не вдалося завантажити вимоги</div>';return;}
  let tab=window.REQUEST_TAB||'active';
  let filtered=data.filter(x=>{
    let st=(x.status||'').toLowerCase();
    if(tab==='used') return st.includes('використ');
    if(tab==='written') return st.includes('спис');
    if(tab==='rejected') return st.includes('відмов');
    return !(st.includes('використ')||st.includes('спис')||st.includes('відмов'));
  });
  let titleMap={active:'Активні вимоги',used:'Використані вимоги',written:'Списані вимоги',rejected:'Відмовлені вимоги'};
  let h=`<div class="notice"><b>${titleMap[tab]}</b>: ${filtered.length}</div>`;
  filtered.forEach(x=>{
    h+=`<div class="req-card ${x.status=='Нова'?'live-new':''}">
      <div class="req-top">
        <div>
          <div class="patient">№${x.id} ${x.patient_name||''}</div>
          <div class="meta">${x.department||''} · ${x.patient_group||''}${x.patient_rh||''}</div>
        </div>
        <span class="status">${x.status||''}</span>
      </div>
      <p>${x.component||''} <b>${x.amount||''}</b> · ${x.urgency||''}</p>
      ${x.compatibility_warning?`<div class="danger">${x.compatibility_warning}</div>`:''}
      <div class="meta">Використано: ${x.used_at||'-'} · Списано: ${x.writeoff_at||'-'} · Реакція: ${x.reaction_present||'Ні'}</div>
      <div>${actions(x, tab)}</div>
    </div>`;
  });
  box.innerHTML=h;
}
function canWriteoffRequestUI(x, tab='active'){
  const role=String(document.body.getAttribute('data-role')||window.ROLE||ROLE||'').toLowerCase();
  const st=String((x&&x.status)||'').trim();
  if(['used','written','rejected'].includes(tab)) return false;
  if(['Використано','Списано','Відмовлено','used','written','rejected'].includes(st)) return false;
  if(['admin','transfusion'].includes(role)){
    return !['','Нова','Чернетка','Очікує','Очікує розгляду'].includes(st);
  }
  if(['doctor','nurse'].includes(role)){
    return ['Погоджено','Зарезервовано','Видано'].includes(st);
  }
  return false;
}
function actions(x, tab='active'){
  let h='';
  const role=String(document.body.getAttribute('data-role')||window.ROLE||ROLE||'').toLowerCase();
  let archived = ['used','written','rejected'].includes(tab);
  if(!archived && ['admin','transfusion'].includes(role)){
    h+=`<button class="btn-blue" onclick="reqAction(${x.id},'approve')">Погодити</button><button class="btn-orange" onclick="reqAction(${x.id},'issue')">Видати</button><button class="btn-red" onclick="reqAction(${x.id},'reject')">Відмовити</button>`;
  }
  if(!archived){
    if(['admin','transfusion'].includes(role)){
      h+=`<button class="btn-green" onclick="openUsedModal(${x.id})">Використано</button>`;
    }
    if(canWriteoffRequestUI(x, tab)){
      h+=`<button class="btn-red req-writeoff-btn" onclick="openWriteoffModal(${x.id})">Списати</button>`;
    }
    h+=`<button class="btn-orange" onclick="markReaction(${x.id})">Реакція</button>`;
  }
  const canEditOld=['admin','transfusion'].includes(role) || (role==='doctor' && !archived && (x.status==='Нова'||!x.status));
  if(canEditOld){
    h+=`<button class="btn-blue" onclick="editRequest(${x.id})">Редагувати</button><button class="btn-red" onclick="deleteRequest(${x.id})">Видалити</button>`;
  }
  return h;
}
async function createRequest(){
  if(!requireFields(['patient_name','birth_date','patient_status','department','component','patient_group','patient_rh','amount','urgency','diagnosis']))return;let d={patient_name:val('patient_name'),birth_date:val('birth_date'),address:val('address'),patient_status:val('patient_status'),department:val('department'),component:val('component'),patient_group:val('patient_group'),patient_rh:val('patient_rh'),amount:val('amount'),urgency:val('urgency'),diagnosis:val('diagnosis'),note:val('note')};let j=await jpost('/api/request/create',d);toast(j.ok?'✅ Вимогу створено':(j.error||'Помилка'),'good');;loadAll();}
async function reqAction(id,action){let d={id,action};if(action=='issue'){d.donor_group=prompt('Група донора','');d.donor_rh=prompt('Rh','');d.pack_no=prompt('№ пакета','');d.series=prompt('Серія','');d.expiry=prompt('Термін','');d.override=confirm('Дозволити видачу при попередженні несумісності?')}let j=await jpost('/api/request/action',d);alert(j.ok?'Готово':j.error);loadAll();}
function openUsedModal(id){let use_date=prompt('Дата/час використання',new Date().toISOString().slice(0,16));let used_by=prompt('Хто підтвердив','');let use_confirm=prompt('Підтвердження','перелито');if(!use_date||!used_by||!use_confirm)return;jpost('/api/request/used',{id,use_date,used_by,use_confirm}).then(j=>{alert(j.ok?'Збережено':j.error);loadAll();});}
function openWriteoffModal(id){
  const role=String(document.body.getAttribute('data-role')||window.ROLE||ROLE||'').toLowerCase();
  if(!['admin','transfusion','doctor','nurse'].includes(role)){
    alert('Недостатньо прав для списання');
    return;
  }
  let writeoff_date=prompt('Дата/час списання',new Date().toISOString().slice(0,16));
  let written_by=prompt('Хто списав','');
  let writeoff_reason=prompt('Причина','');
  if(!writeoff_date||!written_by||!writeoff_reason)return;
  jpost('/api/request/writeoff',{id,writeoff_date,written_by,writeoff_reason}).then(j=>{alert(j.ok?'Списано':j.error);loadAll();});
}
function markReaction(id){let reaction_type=prompt('Тип реакції','');if(reaction_type===null)return;jpost('/api/request/reaction',{id,reaction_present:'Так',reaction_type,reaction_severity:prompt('Тяжкість',''),reaction_description:prompt('Опис',''),reaction_result:prompt('Наслідок','')}).then(j=>{alert(j.ok?'Збережено':j.error);loadAll();});}
async function editRequest(id){
  let data=await jget('/api/requests',{ttl:0}); const x=(data||[]).find(i=>Number(i.id)===Number(id));
  if(!x){toast('Вимогу не знайдено','warn');return;}
  let d={id};
  d.patient_name=prompt('ПІБ пацієнта',x.patient_name||''); if(d.patient_name===null)return;
  d.birth_date=prompt('Дата народження YYYY-MM-DD',x.birth_date||''); if(d.birth_date===null)return;
  d.department=prompt('Відділення',x.department||''); if(d.department===null)return;
  d.component=prompt('Компонент',x.component||''); if(d.component===null)return;
  d.patient_group=prompt('Група пацієнта',x.patient_group||''); if(d.patient_group===null)return;
  d.patient_rh=prompt('Rh пацієнта',x.patient_rh||''); if(d.patient_rh===null)return;
  d.amount=prompt('Кількість',x.amount||''); if(d.amount===null)return;
  d.urgency=prompt('Терміновість',x.urgency||''); if(d.urgency===null)return;
  d.diagnosis=prompt('Діагноз',x.diagnosis||''); if(d.diagnosis===null)return;
  d.note=prompt('Примітка',x.note||''); if(d.note===null)return;
  if(['admin','transfusion'].includes(ROLE)){
    d.status=prompt('Статус',x.status||'Нова'); if(d.status===null)return;
  }
  let j=await jpost('/api/request/update',d); alert(j.ok?'Вимогу оновлено':j.error); loadRequestsLive(); loadHome();
}
async function deleteRequest(id){
  if(!confirm('Видалити вимогу №'+id+'? Запис буде перенесено в кошик.'))return;
  let reason=prompt('Причина видалення','Помилкова/стара вимога'); if(reason===null)return;
  let j=await jpost('/api/request/delete',{id,reason}); alert(j.ok?'Вимогу видалено':j.error); loadRequestsLive(); loadHome();
}
async function loadReminders(){let box=document.getElementById('reminders');if(!box)return;let data=await jget('/api/doctor/reminders');if(!Array.isArray(data)||!data.length){box.innerHTML='';return}box.innerHTML='<div class="danger"><b>Незавершені видані вимоги: '+data.length+'</b></div>'}
async function loadUsersPanel(){let box=document.getElementById('users');if(!box||!['admin','transfusion'].includes(ROLE))return;let data=await jget('/api/users');window.USERS=data;renderUsersTable();}
function renderUsersTable(){let box=document.getElementById('users');if(!box||!window.USERS)return;let q=(document.getElementById('usersSearch')?.value||'').toLowerCase();let h='<div class="table-scroll"><table class="users-table"><tr><th>ID</th><th>Логін</th><th>ПІБ</th><th>Посада</th><th>Роль</th><th>Дії</th></tr>';window.USERS.filter(x=>JSON.stringify(x).toLowerCase().includes(q)).forEach(x=>{h+=`<tr><td>${x.id}</td><td><input id="ulogin_${x.id}" value="${x.username||''}"></td><td><input id="ufn_${x.id}" value="${x.full_name||''}"></td><td><input id="upos_${x.id}" value="${x.position||''}"></td><td><select id="urole_${x.id}"><option ${x.role=='doctor'?'selected':''}>doctor</option><option ${x.role=='nurse'?'selected':''}>nurse</option><option ${x.role=='transfusion'?'selected':''}>transfusion</option><option ${x.role=='admin'?'selected':''}>admin</option></select></td><td class="actions-cell"><button onclick="saveUser(${x.id})">Зберегти</button><button onclick="changeUserPassword(${x.id})">Пароль</button><button class="btn-red small-btn" onclick="deleteUser(${x.id},'${x.username||''}')">Видалити</button></td></tr>`});box.innerHTML=h+'</table></div>'}
async function createUser(){let j=await jpost('/api/users/create',{username:val('new_username'),password:val('new_password'),full_name:val('new_full_name'),position:val('new_position'),role:val('new_role')});alert(j.ok?'Створено':j.error);loadAll();}
async function saveUser(id){let j=await jpost('/api/users/update',{id,username:val('ulogin_'+id),full_name:val('ufn_'+id),position:val('upos_'+id),role:val('urole_'+id)});alert(j.ok?'Збережено':j.error);loadAll();}
async function changeUserPassword(id){let p=prompt('Новий пароль');if(!p)return;let j=await jpost('/api/users/update',{id,password:p});alert(j.ok?'Пароль змінено':j.error);} async function deleteUser(id,username){if(!confirm('Видалити користувача '+username+' у кошик?'))return;let reason=prompt('Причина видалення','');let j=await jpost('/api/admin/delete-record',{table:'users',id,reason});alert(j.ok?'Користувача переміщено в кошик':j.error);loadAll();}
async function loadAudit(){let box=document.getElementById('audit');if(!box||!['admin','transfusion'].includes(ROLE))return;let data=await jget('/api/audit');box.innerHTML='<table><tr><th>Дата</th><th>Користувач</th><th>Дія</th><th>Деталі</th></tr>'+data.map(x=>`<tr><td>${x.created_at}</td><td>${x.username}</td><td>${x.action}</td><td>${x.details}</td></tr>`).join('')+'</table>'}
async function loadAlerts(){let box=document.getElementById('alerts');if(!box)return;let a=await jget('/api/alerts');box.innerHTML=a.low&&a.low.length?'<div class="danger">'+a.low.map(x=>`${x.component} ${x.group||''}${x.rh||''}: ${x.qty}`).join('<br>')+'</div>':'<div class="good">Критичних попереджень немає</div>'}
function mozReportQuery(){
  const p=document.getElementById('moz_period')?.value||'month';
  const y=document.getElementById('moz_year')?.value||new Date().getFullYear();
  const m=document.getElementById('moz_month')?.value||String(new Date().getMonth()+1);
  const q=document.getElementById('moz_quarter')?.value||String(Math.floor(new Date().getMonth()/3)+1);
  const df=document.getElementById('moz_from')?.value||'';
  const dt=document.getElementById('moz_to')?.value||'';
  const params=new URLSearchParams({period:p,year:y,month:m,quarter:q});
  if(df)params.set('date_from',df); if(dt)params.set('date_to',dt);
  return params.toString();
}
function downloadMozPeriodReport(fmt){
  location.href=(fmt==='pdf'?'/reports/moz-period.pdf?':'/reports/moz-period.xlsx?')+mozReportQuery();
}
async function loadReport(){
  const box=document.getElementById('reportPreview'); if(!box)return;
  box.innerHTML='<div class="notice">Формується попередній перегляд звіту...</div>';
  let d=await jget('/api/reports/moz-period-summary?'+mozReportQuery());
  if(!d.ok){box.innerHTML='<div class="danger">Не вдалося сформувати звіт: '+escHtml(d.error||'')+'</div>';return;}
  const unit=d.period?.units||'дози/од.';
  const nz=(x)=>Number(x||0);
  const fmt=(x)=>{x=Number(x||0); return Number.isInteger(x)?String(x):String(Math.round(x*100)/100)};
  let h=`<div class="good"><b>${escHtml(d.period.label)}</b><br>Період: ${escHtml(d.period.date_from)} — ${escHtml(d.period.date_to)}<br>Сформовано: ${escHtml(d.period.issued_at)}<br><b>Одиниця обліку:</b> ${escHtml(unit)}</div>`;
  h+=`<div class="notice"><b>Пояснення:</b><br>Залишок поч. — на перший день періоду.<br>Одержано — надходження за період.<br>Використано/видано — видано пацієнтам за погодженими вимогами.<br>Списано строк — закінчився термін придатності.<br>Списано інше — інші причини списання.</div>`;
  const rows=(d.rows||[]);
  h+='<div class="report-cards">'+rows.map(x=>{
    const any=nz(x.opening_total)+nz(x.received_total)+nz(x.used_total)+nz(x.closing_total)+nz(x.expired_total)+nz(x.other_writeoff_total);
    const cls=any?'report-card':'report-card report-zero';
    return `<div class="${cls}"><h4>${escHtml(x.component)}</h4><div class="report-metric-grid">
      <div><span>Залишок поч.</span><b>${fmt(x.opening_total)}</b></div>
      <div><span>Одержано</span><b>${fmt(x.received_total)}</b></div>
      <div><span>Використано/видано</span><b>${fmt(x.used_total)}</b></div>
      <div><span>Залишок кін.</span><b>${fmt(x.closing_total)}</b></div>
      <div><span>Списано строк</span><b>${fmt(x.expired_total)}</b></div>
      <div><span>Списано інше</span><b>${fmt(x.other_writeoff_total)}</b></div>
    </div></div>`;
  }).join('')+'</div>';
  h+='<h3>Видано за період</h3>';
  h+=(d.issues&&d.issues.length)?'<div class="report-cards">'+d.issues.slice(0,50).map(x=>`<div class="report-card"><h4>${escHtml(x['Компонент']||'')}</h4><p>${escHtml(x['Дата видачі']||'')} · ${escHtml(x['Пацієнт']||'')}</p><p>${escHtml(x['Група']||'')} ${escHtml(x['Rh']||'')} · к-сть ${escHtml(x['Кількість']||'')} · пакет ${escHtml(x['№ пакета']||'')} · серія ${escHtml(x['Серія']||'')}</p></div>`).join('')+'</div>':'<div class="muted">Видачі за цей період не знайдено.</div>';
  h+='<h3>Списано за період</h3>';
  h+=(d.writeoffs&&d.writeoffs.length)?'<div class="report-cards">'+d.writeoffs.slice(0,50).map(x=>`<div class="report-card"><h4>${escHtml(x['Компонент']||'')}</h4><p>${escHtml(x['Дата списання']||'')} · ${escHtml(x['Пацієнт']||'')}</p><p>${escHtml(x['Група']||'')} ${escHtml(x['Rh']||'')} · к-сть ${escHtml(x['Кількість']||'')} · пакет ${escHtml(x['№ пакета']||'')} · серія ${escHtml(x['Серія']||'')}</p><p>${escHtml(x['Причина']||'')}</p></div>`).join('')+'</div>':'<div class="muted">Списання за цей період не знайдено.</div>';
  box.innerHTML=h;
}


async function loadTrash(){
  let box=document.getElementById('trash');
  if(!box||!['admin','transfusion'].includes(String(ROLE||'').toLowerCase()))return;
  let d=await jget('/api/trash',{ttl:0,timeout:30000});
  const arr=Array.isArray(d)?d:(d.items||[]);
  box.innerHTML='<div class="table-scroll"><table><tr><th>ID</th><th>Дата</th><th>Таблиця</th><th>Запис</th><th>Хто</th><th>Дія</th></tr>'+
    arr.map(x=>{const tid=x._trash_id||x.trash_id||x.id; return `<tr><td>${escHtml(tid||'')}</td><td>${escHtml(x._deleted_at||x.created_at||'')}</td><td>${escHtml(x._table||x.source_table||'')}</td><td>${escHtml(x._source_id||x.source_id||'')}</td><td>${escHtml(x._deleted_by||x.deleted_by||'')}</td><td><button class="btn-green" onclick="restoreTrashV628(${tid})">Відновити</button><button class="btn-red" onclick="deleteTrashV628(${tid})">Стерти</button></td></tr>`}).join('')+
    '</table></div>';
}
async function restoreTrash(id){
  if(!confirm('Відновити запис з кошика?'))return;
  let j=await jpost('/api/trash/restore',{id});
  alert(j.ok?'Відновлено':j.error);
  loadAll();
}

document.addEventListener('DOMContentLoaded',()=>{initPerformanceLoadingV642();});

async function loadHome(){
  let box=document.getElementById('dashboard');
  if(!box)return;
  let d=await jget('/api/dashboard');
  const max=Math.max(1,...(d.daily||[]).map(x=>Number(x.count||0)));
  const bars=(d.daily||[]).slice().reverse().map(x=>`<div class="chart-bar" style="height:${30+100*Number(x.count||0)/max}px" title="${x.day}">${x.count}</div>`).join('');
  box.innerHTML='<div class="dashboard-grid">'+
    '<div class="dashboard-box"><b>Статуси</b><br>'+d.requests.map(x=>`${x.status}: ${x.count}`).join('<br>')+'</div>'+
    '<div class="dashboard-box"><b>Компоненти</b><br>'+d.components.map(x=>`${x.component}: ${x.amount}`).join('<br>')+'</div>'+
    '<div class="dashboard-box"><b>Відділення</b><br>'+d.departments.map(x=>`${x.department||'-'}: ${x.count}`).join('<br>')+'</div>'+
    '<div class="dashboard-box"><b>Реакції</b><br>'+((d.reactions||[]).map(x=>`${x.reaction_type||'Невказано'}: ${x.count}`).join('<br>')||'Немає')+'</div>'+
    '</div><h3>Динаміка вимог</h3><div class="chart-row">'+bars+'</div><button class="btn-blue" onclick="testNotification()">Тест push</button>';
}
async function loadPatientHistory(){
  const box=document.getElementById('patientHistory'); if(!box)return;
  let name=val('patientSearch');
  let d=await jget('/api/patients/history?name='+encodeURIComponent(name),{ttl:0});
  const list=(d&&d.rows)||[];
  if(!list.length){box.innerHTML='<div class="notice">Записів пацієнта не знайдено.</div>';return;}
  box.innerHTML=list.map(x=>`<div class="req-card patient-history-card"><b>№${x.id||''} ${x.patient_name||''}</b><br>${x.created_at||''}<br>${x.component||''} · ${x.patient_group||''} ${x.patient_rh||''} · К-сть: ${x.amount||''}<br><b>Статус:</b> ${x.status||''}${x.writeoff_at?`<br><b>Списано:</b> ${x.writeoff_at} · ${x.writeoff_reason||''}`:''}${x.used_at?`<br><b>Використано:</b> ${x.used_at}`:''}${x.reaction_present&&x.reaction_present!=='Ні'?`<br><b>Реакція:</b> ${x.reaction_type||x.reaction_present}`:''}</div>`).join('');
}
async function loadBackups(){let box=document.getElementById('backups');if(!box||!['admin','transfusion'].includes(String(ROLE||'').toLowerCase()))return;let d=await jget('/api/backups');box.innerHTML='<div class="table-scroll"><table><tr><th>ID</th><th>Дата</th><th>Файл</th><th>Дія</th></tr>'+d.map(x=>`<tr><td>${x.id}</td><td>${x.created_at}</td><td>${x.filename}</td><td><button onclick="location.href='/api/backups/download/${x.id}'">Скачати</button><button class="btn-red" onclick="restoreBackup(${x.id})">Відновити</button></td></tr>`).join('')+'</table></div>'}
async function createBackup(){let j=await jpost('/api/backups/create',{});alert(j.ok?'Резервну копію створено':j.error);loadAll()}
async function restoreBackup(id){if(!confirm('Відновити резервну копію?'))return;let j=await jpost('/api/backups/restore',{id});alert(j.ok?'Відновлено':j.error);location.reload()}

function toggleTheme(){
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark')?'dark':'light');
}
async function loadTransfusionJournal(){
  let box=document.getElementById('transfusionJournal');
  if(!box)return;
  let d=await jget('/api/transfusions');
  box.innerHTML='<div class="table-scroll"><table><tr><th>ID</th><th>Дата</th><th>Пацієнт</th><th>Компонент</th><th>Пакет</th><th>Лікар</th><th>Реакція</th></tr>'+
    d.map(x=>`<tr><td>${x.id}</td><td>${x.used_at||x.issued_at||''}</td><td>${x.patient_name||''}</td><td>${x.component||''}</td><td><span class="qr-badge">${x.pack_no||x.qr_code||'-'}</span></td><td>${x.doctor_name||''}</td><td>${x.reaction_present||'Ні'}</td></tr>`).join('')+
    '</table></div>';
}

function showOfflineStatus(text){
  let box=document.getElementById('offlineStatus');
  if(!box)return;
  box.textContent=text;
  box.className='offline-badge';
  setTimeout(()=>{box.className='notice hidden'},5000);
}
async function flushOfflineQueue(){
  if(!navigator.onLine)return;
  let q=JSON.parse(localStorage.getItem('offlineQueue')||'[]');
  if(!q.length)return;
  let rest=[];
  for(const item of q){
    try{
      let r=await fetch(item.u,{method:'POST',headers,body:JSON.stringify(item.d)});
      if(!r.ok)rest.push(item);
    }catch(e){rest.push(item)}
  }
  localStorage.setItem('offlineQueue',JSON.stringify(rest));
  if(rest.length===0)showOfflineStatus('Offline-чергу синхронізовано');
}
window.addEventListener('online',flushOfflineQueue);
window.addEventListener('offline',()=>showOfflineStatus('Немає інтернету. Дії будуть збережені локально.'));
setInterval(flushOfflineQueue,10000);

async function requestBrowserNotification(){
  if(!('Notification' in window))return false;
  if(Notification.permission==='granted')return true;
  if(Notification.permission!=='denied'){
    const p=await Notification.requestPermission();
    return p==='granted';
  }
  return false;
}
async function testNotification(){
  await jpost('/api/notifications/test',{});
  if(await requestBrowserNotification()){
    new Notification('Банк крові', {body:'Тестове повідомлення V5.1'});
  }else{
    alert('Тестове повідомлення створено в системі');
  }
}

let qrStream=null;
async function openQrScanner(){show('qrScannerSec');}
async function startQrScanner(){
  let video=document.getElementById('qrVideo'), result=document.getElementById('qrResult');
  if(!video)return;
  if(!('BarcodeDetector' in window)){
    result.innerHTML='<div class="danger">BarcodeDetector недоступний. Введіть код вручну.</div>';
    return;
  }
  qrStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
  video.srcObject=qrStream;
  await video.play();
  const detector=new BarcodeDetector({formats:['qr_code','code_128','ean_13','ean_8']});
  const scan=async()=>{
    if(!qrStream)return;
    try{
      const codes=await detector.detect(video);
      if(codes.length){
        const code=codes[0].rawValue;
        result.innerHTML='<div class="good">Знайдено: <b>'+code+'</b></div>';
        let inp=document.getElementById('qr_code');
        if(inp)inp.value=code;
        stopQrScanner();
        return;
      }
    }catch(e){}
    requestAnimationFrame(scan);
  };
  scan();
}
function stopQrScanner(){
  if(qrStream){
    qrStream.getTracks().forEach(t=>t.stop());
    qrStream=null;
  }
}

async function saveReactionRegistry(){
  let j=await jpost('/api/reactions/register',{
    request_id:val('rx_request_id'),
    patient_name:val('rx_patient_name'),
    reaction_type:val('rx_type'),
    severity:val('rx_severity'),
    description:val('rx_description'),
    action_taken:val('rx_action'),
    result:val('rx_result')
  });
  alert(j.ok?'Реакцію збережено':j.error);
  loadReactionRegistry();
}
async function loadReactionRegistry(){
  let box=document.getElementById('reactionRegistry');
  if(!box)return;
  let d=await jget('/api/reactions/registry');
  box.innerHTML='<div class="table-scroll"><table><tr><th>ID</th><th>Дата</th><th>Пацієнт</th><th>Тип</th><th>Тяжкість</th><th>Результат</th></tr>'+
    d.map(x=>`<tr><td>${x.id}</td><td>${x.created_at}</td><td>${x.patient_name}</td><td>${x.reaction_type}</td><td>${x.severity}</td><td>${x.result}</td></tr>`).join('')+
    '</table></div>';
}
async function saveTransfusionEvent(){
  let j=await jpost('/api/transfusions/event',{
    request_id:val('sign_request_id'),
    nurse_name:val('sign_nurse'),
    started_at:val('sign_started'),
    finished_at:val('sign_finished'),
    result:val('sign_result')
  });
  let box=document.getElementById('transfusionEvents');
  if(j.ok){
    box.innerHTML='<div class="sign-box">Підтверджено. Signature: '+j.signature+'</div>';
  }else{
    toast(j.error||'Помилка','warn');
  }
  loadTransfusionEvents();
}
async function loadTransfusionEvents(){
  let box=document.getElementById('transfusionEvents');
  if(!box)return;
  let d=await jget('/api/transfusions/events');
  box.innerHTML+=(box.innerHTML?'<hr>':'')+'<div class="table-scroll"><table><tr><th>ID</th><th>Вимога</th><th>Пацієнт</th><th>Початок</th><th>Кінець</th><th>Підпис</th></tr>'+
    d.map(x=>`<tr><td>${x.id}</td><td>${x.request_id}</td><td>${x.patient_name}</td><td>${x.started_at}</td><td>${x.finished_at}</td><td>${(x.signature||'').slice(0,12)}...</td></tr>`).join('')+
    '</table></div>';
}

async function testTelegram(){
  let r=await jpost('/api/telegram/test',{});
  toast(r.ok?'✅ Telegram повідомлення відправлено':'⚠️ Telegram: '+(r.response||r.error||'помилка'), r.ok?'good':'warn');
  loadTelegramStatus();
}
async function loadTelegramLogs(){
  let box=document.getElementById('telegramLogs');
  if(!box)return;
  let d=await jget('/api/telegram/logs');
  box.innerHTML='<div class="table-scroll"><table><tr><th>Дата</th><th>Тип</th><th>OK</th><th>Повідомлення</th></tr>'+
    d.map(x=>`<tr><td>${x.created_at}</td><td>${x.event_type}</td><td>${x.ok?'✅':'❌'}</td><td>${(x.message||'').slice(0,120)}</td></tr>`).join('')+
    '</table></div>';
}
async function loadTelegramQueue(){
  let box=document.getElementById('telegramQueue');
  if(!box)return;
  let d=await jget('/api/telegram/queue');
  box.innerHTML='<div class="table-scroll"><table><tr><th>Дата</th><th>Тип</th><th>Спроби</th><th>Sent</th><th>Помилка</th></tr>'+
    d.map(x=>`<tr><td>${x.created_at}</td><td>${x.event_type}</td><td>${x.attempts}</td><td>${x.sent?'✅':'⏳'}</td><td>${(x.last_error||'').slice(0,100)}</td></tr>`).join('')+
    '</table></div>';
}
async function retryTelegramQueue(){
  let r=await jpost('/api/telegram/retry',{});
  toast('Повторено. Надіслано: '+(r.sent||0),'good');
  loadTelegramStatus();
}

async function loadHealth(){
  let box=document.getElementById('healthBox'); if(!box)return;
  let h=await jget('/api/health');
  box.innerHTML=`<div class="dashboard-grid">
    <div class="dashboard-box"><b>Система</b><br>${h.ok?'✅ OK':'❌ ERROR'}<br>${h.version||''}</div>
    <div class="dashboard-box"><b>База даних</b><br>${h.database_status_label||h.database||'—'}<br>${h.database_type || (h.postgres?'PostgreSQL':'SQLite')}</div>
    <div class="dashboard-box"><b>Остання резервна копія</b><br>${h.backup_status_label||h.backup_age_label||'немає'}<br>${h.latest_backup_at||''}</div>
    <div class="dashboard-box"><b>Telegram</b><br>${h.telegram_status_label || (h.telegram_configured?'✅ Налаштовано':'⚠️ Не налаштовано')}</div>
  </div>`;
  updateHomeSystemStatusV6424(h);
}

function updateHomeSystemStatusV6424(h){
  try{
    const sys=document.getElementById('roleSystemStatus');
    const db=document.getElementById('roleDbStatus');
    const bak=document.getElementById('roleBackupStatus');
    const tg=document.getElementById('roleTelegramStatus');
    if(sys) sys.innerHTML=(h.ok?'✅ OK':'❌ ERROR')+'<br>'+(h.version||'');
    if(db) db.innerHTML=(h.database_status_label||h.database||'—')+'<br>'+(h.database_type || (h.postgres?'PostgreSQL':'SQLite'));
    if(bak) bak.innerHTML=(h.backup_status_label||h.backup_age_label||'немає')+(h.latest_backup_at?'<br><small>'+h.latest_backup_at+'</small>':'');
    if(tg) tg.innerHTML=h.telegram_status_label || (h.telegram_configured?'✅ Налаштовано':'⚠️ Не налаштовано');
  }catch(e){}
}

async function loadHomeStatusV6424(){
  try{ const h=await jget('/api/health'); updateHomeSystemStatusV6424(h); }catch(e){
    updateHomeSystemStatusV6424({ok:false,version:'V6.4.35',database_status_label:'❌ Недоступно',database_type:'—',backup_status_label:'—',telegram_status_label:'—'});
  }
}

async function runMaintenance(){
  let r=await jpost('/api/maintenance/run',{});
  toast(r.ok?'✅ Maintenance виконано':(r.error||'Помилка maintenance'),r.ok?'good':'warn');
  loadHealth();
}
async function createRollbackSnapshot(){
  let r=await jpost('/api/backups/rollback-snapshot',{});
  toast(r.ok?'✅ Rollback snapshot створено':'⚠️ '+(r.error||'Помилка snapshot'),r.ok?'good':'warn');
  loadHealth();
}

let deferredPWAInstall=null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPWAInstall=e;
  updatePWAStatus();
});
window.addEventListener('appinstalled', ()=>{
  deferredPWAInstall=null;
  toast('✅ PWA додаток встановлено','good');
  updatePWAStatus();
});
function isStandalonePWA(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;
}

async function installPWA(){
  if(isStandalonePWA()){toast('✅ Додаток вже встановлено','good');return}
  if(deferredPWAInstall){
    deferredPWAInstall.prompt();
    const choice=await deferredPWAInstall.userChoice;
    deferredPWAInstall=null;
    toast(choice.outcome==='accepted'?'✅ Встановлення підтверджено':'⚠️ Встановлення скасовано', choice.outcome==='accepted'?'good':'warn');
    updatePWAStatus();
    return;
  }
  showPWAHelp();
  toast('ℹ️ Використай інструкцію встановлення для свого браузера','warn');
}
function showPWAHelp(){
  let box=document.getElementById('pwaHelpBox');
  if(box) box.style.display = box.style.display==='none' ? 'block' : 'none';
}
async function clearPWACache(){
  try{
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.update()));
    }
    toast('✅ Кеш PWA оновлено. Перезавантаж сторінку','good');
  }catch(e){toast('⚠️ Не вдалося очистити кеш','warn')}
}

document.addEventListener('DOMContentLoaded',()=>{setTimeout(()=>{updatePWAStatus();loadTelegramMe();},500)});

let barcodeCameraStream=null;
async function startScanner(){
  try{
    const video=document.getElementById('scannerVideo');
    barcodeCameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    video.srcObject=barcodeCameraStream;
    await video.play();
    toast('✅ Камеру запущено','good');
    if('BarcodeDetector' in window){
      const detector=new BarcodeDetector({formats:['qr_code','code_128','ean_13','ean_8','code_39']});
      const loop=async()=>{
        if(!barcodeCameraStream)return;
        try{
          const codes=await detector.detect(video);
          if(codes&&codes.length){
            document.getElementById('barcodeInput').value=codes[0].rawValue;
            stopScanner(); barcodeLookup(); return;
          }
        }catch(e){}
        requestAnimationFrame(loop);
      };
      loop();
    }
  }catch(e){toast('⚠️ Не вдалося запустити камеру','warn')}
}
function stopScanner(){
  if(barcodeCameraStream){barcodeCameraStream.getTracks().forEach(t=>t.stop()); barcodeCameraStream=null}
  let v=document.getElementById('scannerVideo'); if(v)v.srcObject=null;
}
function criticalOverlay(reason){
  let old=document.getElementById('criticalOverlay'); if(old)old.remove();
  document.body.insertAdjacentHTML('beforeend',`<div id="criticalOverlay" class="critical-overlay"><div class="critical-box"><h1>🔴 НЕСУМІСНО</h1><p>${reason||''}</p><button onclick="document.getElementById('criticalOverlay').remove()">Закрити</button></div></div>`);
}
function htmlPackage(p){
  if(!p)return '';
  return `<div class="dashboard-grid"><div class="dashboard-box"><b>Компонент</b><br>${p.component||''}</div><div class="dashboard-box"><b>Група/Rh</b><br>${p.donor_group||''} ${p.donor_rh||''}</div><div class="dashboard-box"><b>Кількість</b><br>${p.amount||''}</div><div class="dashboard-box"><b>Термін</b><br>${p.expiry||''}</div><div class="dashboard-box"><b>QR</b><br>${p.qr_code||''}</div></div>`;
}
async function barcodeLookup(){
  let code=val('barcodeInput'), box=document.getElementById('barcodeResult');
  if(!code){toast('Введіть або відскануйте код','warn');return}
  let r=await jpost('/api/barcode/scan',{code});
  if(r.ok)box.innerHTML='<h3>Пакет знайдено</h3>'+htmlPackage(r.package);
  else{box.innerHTML='<div class="notice">⚠️ '+(r.error||'Не знайдено')+'</div>'; toast(r.error||'Не знайдено','warn')}
}
async function barcodeIssueCheck(){
  let code=val('barcodeInput'), request_id=val('barcodeRequestId'), box=document.getElementById('barcodeResult');
  if(!code||!request_id){toast('Потрібен код і ID вимоги','warn');return}
  let r=await jpost('/api/barcode/issue-check',{code,request_id});
  if(r.compatible){box.innerHTML='<div class="compat-ok">✅ СУМІСНО</div>'+htmlPackage(r.package);toast('✅ Сумісно','good')}
  else{box.innerHTML='<div class="compat-bad">🔴 НЕСУМІСНО: '+(r.reason||r.error||'')+'</div>'+htmlPackage(r.package);criticalOverlay(r.reason||r.error)}
}
async function barcodeIssue(){
  let code=val('barcodeInput'), request_id=val('barcodeRequestId'), box=document.getElementById('barcodeResult');
  let r=await jpost('/api/barcode/issue',{code,request_id});
  if(r.ok){box.innerHTML='<div class="compat-ok">✅ ВИДАНО</div>';toast('✅ Пакет видано','good')}
  else{if(r.red_alert)criticalOverlay(r.reason||r.error);toast(r.reason||r.error||'Не вдалося видати','warn')}
}
async function loadTraceability(){
  let code=val('traceCode'), box=document.getElementById('traceabilityResult');
  let d=await jget('/api/traceability/package/'+encodeURIComponent(code));
  box.innerHTML='<div class="table-scroll"><table><tr><th>Дата</th><th>Дія</th><th>Пацієнт</th><th>Вимога</th><th>Користувач</th><th>Примітка</th></tr>'+d.map(x=>`<tr><td>${x.created_at||''}</td><td>${x.action_type||''}</td><td>${x.patient_name||''}</td><td>${x.request_id||''}</td><td>${x.user_name||''}</td><td>${x.notes||''}</td></tr>`).join('')+'</table></div>';
}
async function loadIncompatibilities(){
  let box=document.getElementById('incompatibilityResult');
  let d=await jget('/api/incompatibility');
  box.innerHTML='<div class="table-scroll"><table><tr><th>Дата</th><th>Пацієнт</th><th>Пацієнт</th><th>Донор</th><th>Компонент</th><th>Причина</th></tr>'+d.map(x=>`<tr><td>${x.created_at||''}</td><td>${x.patient_name||''}</td><td>${x.patient_group||''} ${x.patient_rh||''}</td><td>${x.donor_group||''} ${x.donor_rh||''}</td><td>${x.component||''}</td><td>${x.reason||''}</td></tr>`).join('')+'</table></div>';
}

async function loadDashboardPro(){
  let box=document.getElementById('dashboardProBox'); if(!box)return;
  let d=await jget('/api/dashboard/pro');
  box.innerHTML=`<div class="dashboard-grid">
    <div class="dashboard-box"><b>Видано сьогодні</b><br><span class="dashboard-number">${d.issued_today||0}</span></div>
    <div class="dashboard-box"><b>Списано сьогодні</b><br><span class="dashboard-number">${d.writeoffs_today||0}</span></div>
    <div class="dashboard-box"><b>Несумісності</b><br><span class="dashboard-number">${d.incompat_today||0}</span></div>
    <div class="dashboard-box"><b>Активні вимоги</b><br><span class="dashboard-number">${d.active_requests||0}</span></div>
    <div class="dashboard-box"><b>Склад</b><br><span class="dashboard-number">${d.stock_items||0}</span></div>
    <div class="dashboard-box"><b>Темп. тривоги</b><br><span class="dashboard-number">${d.temperature_alerts_today||0}</span></div>
  </div>`;
}
async function saveTemperature(){
  let r=await jpost('/api/temperature/add',{fridge_name:val('fridgeName'),temperature:val('fridgeTemp'),notes:val('fridgeNotes')});
  toast(r.ok?(r.alert?'🌡️ Збережено. Є тривога':'✅ Температуру збережено'):(r.error||'Помилка'),r.ok?'good':'warn');
  loadTemperature();
}
async function loadTemperature(){
  let box=document.getElementById('temperatureResult'); if(!box)return;
  let d=await jget('/api/temperature');
  box.innerHTML='<div class="table-scroll"><table><tr><th>Дата</th><th>Холодильник</th><th>Темп.</th><th>Користувач</th><th>Alert</th><th>Примітка</th></tr>'+
    d.map(x=>`<tr><td>${x.created_at||''}</td><td>${x.fridge_name||''}</td><td>${x.temperature||''}</td><td>${x.entered_by||''}</td><td>${x.alert_triggered?'🔴':'✅'}</td><td>${x.notes||''}</td></tr>`).join('')+'</table></div>';
}
async function saveWriteoff(){
  let r=await jpost('/api/writeoff',{package_code:val('writeoffCode'),reason:val('writeoffReason'),notes:val('writeoffNotes')});
  toast(r.ok?'✅ Списано':(r.error||'Помилка списання'),r.ok?'good':'warn');
  loadWriteoffs();
}
async function loadWriteoffs(){
  let box=document.getElementById('writeoffResult'); if(!box)return;
  let d=await jget('/api/writeoffs');
  box.innerHTML='<div class="table-scroll"><table><tr><th>Дата</th><th>Код</th><th>Компонент</th><th>К-сть</th><th>Причина</th><th>Хто</th></tr>'+
    d.map(x=>`<tr><td>${x.created_at||''}</td><td>${x.package_code||''}</td><td>${x.component||''}</td><td>${x.amount||''}</td><td>${x.reason||''}</td><td>${x.written_by||''}</td></tr>`).join('')+'</table></div>';
}
async function sendDailyReport(){
  let r=await jpost('/api/telegram/daily-report',{});
  let box=document.getElementById('dailyReportResult');
  if(box)box.innerHTML='<pre class="notice">'+(r.report||r.error||'')+'</pre>';
  toast(r.ok?'✅ Добовий звіт сформовано':'⚠️ '+(r.error||'Помилка'),r.ok?'good':'warn');
}
async function loadDailyReports(){
  let box=document.getElementById('dailyReportResult'); if(!box)return;
  let d=await jget('/api/daily-reports');
  box.innerHTML='<div class="table-scroll"><table><tr><th>Дата</th><th>Тип</th><th>Telegram</th><th>Текст</th></tr>'+
    d.map(x=>`<tr><td>${x.created_at||''}</td><td>${x.report_type||''}</td><td>${x.sent_telegram?'✅':'—'}</td><td><pre>${x.report_text||''}</pre></td></tr>`).join('')+'</table></div>';
}
document.addEventListener('DOMContentLoaded',()=>{setTimeout(()=>{ if(['admin','transfusion'].includes(String(ROLE||'').toLowerCase()) && document.getElementById('dashboardProSec')?.classList.contains('active')) loadDashboardPro(); },800)});


// V5.9.6 Role UI Clean
const ROLE_SECTION_MAP={
  admin:["dashboard","stock","requests","reports","users","telegram","telegramPersonal","pwa","monitor","audit","maintenance","barcode","traceability","incompat","dashboardPro","temperature","writeoff","dailyReport","trash","backup","trash"],
  transfusion:["dashboard","stock","requests","reports","users","telegram","telegramPersonal","pwa","monitor","audit","maintenance","barcode","traceability","incompat","dashboardPro","temperature","writeoff","dailyReport","trash"],
  doctor:["dashboard","requests","patients","history","telegramPersonal","pwa"],
  nurse:["dashboard","requests","patients","history","telegramPersonal","pwa"]
};
function roleCleanSectionKey(id){
  id=(id||'').toLowerCase();
  if(id.includes('monitor')||id.includes('health')||id.includes('maintenance'))return 'monitor';
  if(id.includes('audit'))return 'audit';
  if(id.includes('user'))return 'users';
  if(id.includes('telegrampersonal'))return 'telegramPersonal';
  if(id.includes('telegram'))return 'telegram';
  if(id.includes('pwa'))return 'pwa';
  if(id.includes('barcode'))return 'barcode';
  if(id.includes('traceability')||id.includes('trace'))return 'traceability';
  if(id.includes('incompat'))return 'incompat';
  if(id.includes('dashboardpro'))return 'dashboardPro';
  if(id.includes('temperature'))return 'temperature';
  if(id.includes('writeoff'))return 'writeoff';
  if(id.includes('dailyreport'))return 'dailyReport';
  if(id.includes('stock'))return 'stock';
  if(id.includes('request'))return 'requests';
  if(id.includes('report'))return 'reports';
  if(id.includes('patient'))return 'patients';
  if(id.includes('history'))return 'history';
  return 'dashboard';
}
function roleCleanCurrentRole(){
  let txt=(document.body.innerText||'').toLowerCase();
  if(txt.includes('admin')||txt.includes('адміністратор'))return 'admin';
  if(txt.includes('transfusion')||txt.includes('трансфуз'))return 'transfusion';
  if(txt.includes('doctor')||txt.includes('лікар')||txt.includes('доктор'))return 'doctor';
  if(txt.includes('nurse')||txt.includes('медсест'))return 'nurse';
  return 'doctor';
}
async function roleCleanApply(){
  let role=roleCleanCurrentRole();
  try{
    let cfg=await jget('/api/ui/role-config');
    if(cfg&&cfg.ok&&cfg.role)role=cfg.role;
  }catch(e){}
  document.body.setAttribute('data-role',role||'unknown');
  const allowed=ROLE_SECTION_MAP[role]||ROLE_SECTION_MAP.doctor;
  document.querySelectorAll('nav button').forEach(btn=>{
    const call=btn.getAttribute('onclick')||'';
    const m=call.match(/show\('([^']+)'\)/);
    if(!m)return;
    const key=roleCleanSectionKey(m[1]);
    btn.classList.toggle('role-hidden',!allowed.includes(key));
  });
  document.querySelectorAll('.section').forEach(sec=>{
    const key=roleCleanSectionKey(sec.id);
    sec.classList.toggle('role-hidden',!allowed.includes(key));
  });
  document.querySelectorAll('.role-admin-only,.audit-action').forEach(el=>{
    el.classList.toggle('role-hidden',!['admin','transfusion'].includes(role));
  });
  if(['doctor','nurse'].includes(role)){
    document.querySelectorAll('.dashboard-box,.card').forEach(el=>{
      const txt=(el.innerText||'').toLowerCase();
      if(txt.includes('database')||txt.includes('вік резервної копії')||txt.includes('maintenance')||txt.includes('відновлення')||txt.includes('audit xlsx')||txt.includes('audit csv')){
        el.classList.add('role-hidden');
      }
    });
  }
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(roleCleanApply,800));


// V6.0 Stable Clean Architecture UI permissions
async function v60ApplyPermissions(){
  try{
    const cfg = await jget('/api/permissions');
    if(!cfg || !cfg.ok) return;
    const role = cfg.role || 'doctor';
    const allowed = (cfg.permissions && cfg.permissions.sections) || [];
    document.body.setAttribute('data-role', role);
    document.querySelectorAll('nav button').forEach(btn=>{
      const call=btn.getAttribute('onclick')||'';
      const m=call.match(/show\('([^']+)'\)/);
      if(!m)return;
      const key=roleCleanSectionKey ? roleCleanSectionKey(m[1]) : m[1].replace('Sec','');
      btn.classList.toggle('role-hidden', allowed.indexOf(key)===-1);
    });
    document.querySelectorAll('.section').forEach(sec=>{
      const key=roleCleanSectionKey ? roleCleanSectionKey(sec.id) : sec.id.replace('Sec','');
      sec.classList.toggle('role-hidden', allowed.indexOf(key)===-1 && sec.id !== 'dashboardSec');
    });
    document.querySelectorAll('.role-admin-only,.audit-action,a[href*="audit/export"],a[href*="backups"],button[onclick*="Maintenance"],button[onclick*="відновлення"]').forEach(el=>{
      el.classList.toggle('role-hidden', !['admin','transfusion'].includes(role));
    });
  }catch(e){}
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(v60ApplyPermissions,900));


// V6.0.2 Interface Repair
const V602_FEATURE_TARGETS={
  monitor:['monitorSec','healthSec','dashboardProSec'],
  pwa:['pwaInstallSec','pwaSec'],
  telegram:['telegramPersonalSec','telegramSec'],
  barcode:['barcodeSec','qrSec','scanSec'],
  traceability:['traceabilitySec','traceSec'],
  stock:['stockSec','warehouseSec'],
  requests:['requestsSec','requestSec','myRequestsSec'],
  request:['requestSec','requestsSec','myRequestsSec'],
  reports:['reportsSec','reportSec'],
  users:['usersSec','userSec'],
  audit:['monitorSec','reportsSec'],
  temperature:['temperatureSec','fridgeSec'],
  writeoff:['writeoffSec'],
  dailyReport:['dailyReportSec'],
  dashboardPro:['dashboardProSec','dashboardSec']
};

function v602RepairLayout(){
  document.documentElement.style.overflowX='hidden';
  document.body.style.overflowX='hidden';
  document.querySelectorAll('table').forEach(t=>{
    if(!t.parentElement.classList.contains('table-scroll')){
      const w=document.createElement('div');
      w.className='table-scroll';
      t.parentNode.insertBefore(w,t);
      w.appendChild(t);
    }
  });
  document.querySelectorAll('a[href*="audit/export"]').forEach(a=>{
    a.classList.add('audit-action');
    if(!a.textContent.trim()){
      if(a.href.includes('xlsx')) a.textContent='📄 Audit XLSX';
      else if(a.href.includes('csv')) a.textContent='📄 Audit CSV';
    }
  });
  document.querySelectorAll('.card,.dashboard-box,.section').forEach(el=>{
    if(!el.textContent.trim() && el.children.length===0){
      el.classList.add('empty-card-fixed');
      el.textContent='—';
    }
  });
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(v602RepairLayout,500));
window.addEventListener('resize',()=>setTimeout(v602RepairLayout,200));


// V6.1 Role Dashboard UI overrides
async function loadHomeQuickInfo(){
  try{
    const req=await jget('/api/requests/mine');
    const s=document.getElementById('homeStockCount');
    const r=document.getElementById('homeRequestCount');
    if(s){
      if(['admin','transfusion'].includes(String(ROLE||'').toLowerCase())){
        try{ const stock=await jget('/api/stock'); s.textContent=Array.isArray(stock)?stock.length:'—'; }catch(e){s.textContent='—';}
      }else{ s.textContent='—'; }
    }
    if(r)r.textContent=Array.isArray(req)?req.filter(x=>!['used','written','rejected','Використано','Списано','Відмовлено'].includes(String(x.status||''))).length:'—';
  }catch(e){}
}
const oldLoadAllV61 = typeof loadAll === 'function' ? loadAll : null;
document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ if(typeof loadHomeQuickInfo==='function') loadHomeQuickInfo(); updatePWAStatus();},700));


// V6.1.3 Hotfix

async function loadBackupsV613(){
  const box=document.getElementById('backupListV613'); if(!box)return;
  let d=[]; try{d=await jget('/api/backups')}catch(e){d=[]}
  if(!Array.isArray(d)||!d.length){box.innerHTML='<div class="notice">Резервних копій ще немає. Натисніть “Створити резервну копію”.</div>';return}
  box.innerHTML='<div class="table-scroll"><table><tr><th>Дата</th><th>Файл</th><th>Розмір</th><th>Дія</th></tr>'+d.map(x=>`<tr><td>${x.created_at||''}</td><td>${x.file||x.filename||''}</td><td>${x.size||x.size_bytes||''}</td><td>${x.download_url?`<a class="btn-blue" href="${x.download_url}">Скачати</a>`:'—'}</td></tr>`).join('')+'</table></div>';
}
async function createBackupV613(){let r=await jpost('/api/backups/create',{}); toast(r.ok?'✅ Резервну копію створено':(r.error||'Помилка резервної копії'),r.ok?'good':'warn'); loadBackupsV613();}
function applyDarkModeV613(){if(localStorage.getItem('bloodBankDarkMode')==='1')document.body.classList.add('dark'); window.toggleTheme=function(){document.body.classList.toggle('dark'); localStorage.setItem('bloodBankDarkMode',document.body.classList.contains('dark')?'1':'0');};}
const oldShowPreV613=typeof show==='function'?show:null;

const oldLoadAllV613=typeof loadAll==='function'?loadAll:null;
document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{applyDarkModeV613();applyRoleVisibilityV613();},700));


// V6.1.4 UI/Forms/QR fixes
function groupByV614(arr, key){return arr.reduce((a,x)=>{const k=x[key]||'—';(a[k]=a[k]||[]).push(x);return a;},{});}
function renderComponentDetailsV614(items, filter){
  const table=document.getElementById('componentStockTable'); if(!table)return;
  const data=filter?items.filter(x=>x.component===filter):items;
  const grouped=groupByV614(data,'component');
  table.innerHTML=Object.keys(grouped).map(comp=>{const rows=grouped[comp];return `<details class="component-detail" ${filter===comp?'open':''}><summary>${comp} — ${rows.reduce((s,x)=>s+Number(x.total||0),0)}</summary><div class="table-scroll"><table><tr><th>Група</th><th>Rh</th><th>Кількість</th><th>Пакетів</th><th>Найближчий термін придатності</th></tr>${rows.map(x=>`<tr><td>${x.donor_group||''}</td><td>${x.donor_rh||''}</td><td>${x.total||0}</td><td>${x.packs||0}</td><td>${x.nearest_expiry||''}</td></tr>`).join('')}</table></div></details>`;}).join('') || '<div class="notice">Компонентів на складі ще немає.</div>';
}
async function toggleComponentDetailsV614(component){let res={items:[]}; try{res=await jget('/api/stock/summary')}catch(e){} renderComponentDetailsV614(res.items||[], component); const el=document.getElementById('componentStockTable'); if(el)el.scrollIntoView({behavior:'smooth',block:'start'});}

document.addEventListener('DOMContentLoaded',()=>{setTimeout(()=>{document.querySelectorAll('.quick-info, .quick-info *').forEach(el=>el.classList.add('day-readable'));},600);});

// V6.1.4 reaction actual ids
const oldSaveReactionActualV614 = typeof saveReactionRegistry==='function'?saveReactionRegistry:null;


// V6.1.5 UI + iPhone scanner hotfix
function setThemeIconV615(){
  document.querySelectorAll('button[onclick*="toggleTheme"],.theme-toggle').forEach(b=>{
    b.setAttribute('title', document.body.classList.contains('dark')?'Перейти у денний режим':'Перейти у нічний режим');
    b.setAttribute('aria-label', b.getAttribute('title'));
  });
}
const prevToggleThemeV615 = window.toggleTheme;
window.toggleTheme=function(){
  document.body.classList.toggle('dark');
  localStorage.setItem('bloodBankDarkMode',document.body.classList.contains('dark')?'1':'0');
  setThemeIconV615();
};

function groupByV615(arr,key){return arr.reduce((a,x)=>{const k=x[key]||'—';(a[k]=a[k]||[]).push(x);return a;},{});}
function renderComponentDetailsV615(items, filter){
  const table=document.getElementById('componentStockTable'); if(!table)return;
  const data=filter?items.filter(x=>x.component===filter):items;
  const grouped=groupByV615(data,'component');
  table.innerHTML=Object.keys(grouped).map(comp=>{
    const rows=grouped[comp], sum=rows.reduce((s,x)=>s+Number(x.total||0),0);
    return `<details class="component-detail" ${filter===comp?'open':''}><summary>▶ ${comp} — ${sum}</summary>
      <div class="table-scroll"><table><tr><th>Група</th><th>Rh</th><th>Кількість</th><th>Пакетів</th><th>Найближчий термін</th></tr>
      ${rows.map(x=>`<tr><td>${x.donor_group||''}</td><td>${x.donor_rh||''}</td><td>${x.total||0}</td><td>${x.packs||0}</td><td>${x.nearest_expiry||''}</td></tr>`).join('')}
      </table></div></details>`;
  }).join('') || '<div class="notice">Компонентів на складі ще немає.</div>';
}
async function toggleComponentDetailsV615(component){
  let res={items:[]}; try{res=await jget('/api/stock/summary')}catch(e){}
  renderComponentDetailsV615(res.items||[],component);
}
async function loadWarningsV615(){
  const box=document.getElementById('warningsListV615'); if(!box)return;
  let d={warnings:[],counts:{active:0,inactive:0,total:0}}; try{d=await jget('/api/warnings')}catch(e){}
  const active=(d.active||d.warnings||[]).filter(w=>w.active!==false);
  const inactive=(d.inactive||[]);
  const c=d.counts||{active:active.filter(w=>w.level!=='ok').length,inactive:inactive.length,total:active.length+inactive.length};
  const header=`<div class="notice flat-notice"><b>Активних попереджень: ${c.active||0}</b>${inactive.length?` · Неактивних: ${c.inactive||0}`:''}</div>`;
  const list=active.map(w=>`<div class="warning-item ${w.level||'info'}"><b>${w.title||''}</b><br>${w.text||''}</div>`).join('') || '<div class="warning-item ok">Активних попереджень немає</div>';
  box.innerHTML=header+list;
}
async function loadTrashV615(){
  const box=document.getElementById('trashListV615'); if(!box)return;
  let d={items:[]};
  try{d=await jget('/api/trash',{ttl:0,timeout:30000})}catch(e){box.innerHTML='<div class="danger">Помилка завантаження кошика: '+esc(e.message||e)+'</div>';return;}
  const items=d.items||[];
  if(!items.length){box.innerHTML='<div class="notice">Кошик порожній.</div>';return;}
  box.innerHTML=items.map(x=>{
    const tid=x._trash_id||x.trash_id||'';
    const table=x._table||'запис';
    const title=x.patient_name||x.component||x.full_name||x.username||x.status||('Запис #'+(x._source_id||x.id||''));
    const meta=[x._deleted_at||x.created_at||'', x._deleted_by?('видалив: '+x._deleted_by):'', x._reason?('причина: '+x._reason):''].filter(Boolean).join(' · ');
    const actions=tid?`<div class="trash-actions"><button class="btn-green" onclick="restoreTrashV628(${tid})">Відновити</button><button class="btn-red" onclick="deleteTrashV628(${tid})">Стерти</button></div>`:'<div class="meta">Legacy-запис: доступне тільки ручне очищення статусу.</div>';
    return `<div class="trash-item"><b>${esc(table)} #${esc(String(x._source_id||x.id||''))}</b><br>${esc(title)}${meta?`<div class="meta">${esc(meta)}</div>`:''}${actions}</div>`;
  }).join('');
}
async function restoreTrashV628(id){
  if(!confirm('Відновити запис із кошика?'))return;
  const j=await jpost('/api/trash/restore',{id});
  alert(j.ok?'Відновлено':(j.error||'Помилка'));
  await loadTrashV615();
}
async function deleteTrashV628(id){
  if(!confirm('Остаточно стерти запис із кошика? Відновити після цього буде неможливо.'))return;
  const j=await jpost('/api/trash/delete',{id});
  alert(j.ok?'Стерто':(j.error||'Помилка'));
  await loadTrashV615();
}
async function loadTransfusionJournalV615(){
  const box=document.getElementById('transfusionJournalListV615'); if(!box)return;
  let req=[]; try{req=await jget('/api/requests/mine')}catch(e){}
  box.innerHTML=Array.isArray(req)&&req.length?req.map(x=>`<div class="journal-item"><b>${x.patient_name||'Пацієнт'}</b><br>${x.component||''} ${x.patient_group||''} ${x.patient_rh||''}<br>Статус: ${x.status||'active'}</div>`).join(''):'<div class="notice">Записів журналу поки немає.</div>';
}

const oldShowV615 = typeof show==='function'?show:null;

document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(()=>{
    if(localStorage.getItem('bloodBankDarkMode')==='1')document.body.classList.add('dark');
    setThemeIconV615();
    if(document.getElementById('warningsSec')?.classList.contains('active')) loadWarningsV615(); if(document.getElementById('trashSec')?.classList.contains('active')) loadTrashV615(); if(document.getElementById('transfusionJournalSec')?.classList.contains('active')) loadTransfusionJournalV615();
    const f=document.getElementById('barcodeImageFileV615');
    if(f)f.addEventListener('change',()=>toast('Фото вибрано. Якщо код не розпізнано автоматично — введіть код вручну.','warn'));
  },700);
});


// V6.1.6 patient/components/iPhone scanner final overrides
function scanManualBarcodeV616(){
  const el=document.getElementById('manualBarcodeInputV616')||document.getElementById('manualBarcodeInputV614')||document.getElementById('qrManual');
  const code=(el&&el.value||'').trim();
  if(!code){toast('Введіть QR/Barcode код вручну. На iPhone камера не підтримує BarcodeDetector.','warn');return;}
  jpost('/api/barcode/scan',{code}).then(r=>{
    toast(r.ok?'✅ Код знайдено':(r.error||'Код не знайдено'), r.ok?'good':'warn');
    const out=document.getElementById('qrResult')||document.getElementById('barcodeResult');
    if(out)out.innerHTML=`<div class="notice"><b>Перевірено код:</b> ${code}<br><pre style="white-space:pre-wrap">${JSON.stringify(r,null,2)}</pre></div>`;
  }).catch(()=>toast('Помилка перевірки коду','warn'));
}

const oldApplyRoleVisibilityV616 = typeof applyRoleVisibilityV613==='function'?applyRoleVisibilityV613:null;
document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(()=>{
    const p=document.getElementById('patientsSec');
    if(p)p.classList.remove('role-hidden');
    const f=document.getElementById('barcodeImageFileV616');
    if(f)f.addEventListener('change',()=>toast('Фото вибрано. Автоматичне розпізнавання на iPhone недоступне — введіть код вручну з етикетки.','warn'));
  },900);
});


// V6.1.7 FINAL patient route fix: patientsSec is always allowed
function normalizeSectionIdV617(id){
  const aliases={
    patientSec:'patientsSec',
    patient:'patientsSec',
    patients:'patientsSec',
    Пацієнт:'patientsSec',
    journalSec:'transfusionJournalSec',
    warningSec:'warningsSec',
    warnings:'warningsSec',
    cartSec:'trashSec',
    trash:'trashSec'
  };
  return aliases[id]||id;
}

const oldApplyRoleVisibilityV617 = typeof applyRoleVisibilityV613==='function'?applyRoleVisibilityV613:null;
document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(()=>{
    applyRoleVisibilityV613();
    const p=document.getElementById('patientsSec');
    if(p){p.classList.remove('role-hidden');p.style.display='';}
  },800);
});


// V6.1.8 patient visibility fix

document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(()=>{
    const p=document.getElementById('patientsSec');
    if(p && !p.classList.contains('active')){
      p.classList.remove('role-hidden');
      p.style.display='';
    }
  },900);
});


// V6.1.9 RESTORE SECTIONS HOTFIX
// Причина: V6.1.8 patient visibility fix перевизначив safeOpenFeature(id) як show(id),
// через це кнопки safeOpenFeature('stock'/'dashboardPro'/'temperature'/...) шукали неіснуючі id.
(function(){
  const BB_FEATURE_ALIASES_V619 = {
    stock:'stockSec', warehouse:'stockSec', donors:'stockSec',
    dashboardPro:'dashboardProSec', dashboard:'homeSec',
    temperature:'temperatureSec', fridge:'temperatureSec',
    barcode:'barcodeSec', qr:'qrScannerSec', scanner:'qrScannerSec',
    monitor:'maintenanceSec', health:'maintenanceSec', maintenance:'maintenanceSec',
    patient:'patientsSec', patientSec:'patientsSec', patients:'patientsSec',
    request:'requestsSec', requests:'requestsSec', myRequests:'requestsSec',
    history:'transfusionJournalSec', journal:'transfusionJournalSec', journalSec:'transfusionJournalSec',
    telegram:'telegramSec', telegramPersonal:'telegramPersonalSec',
    pwa:'pwaInstallSec', reports:'reportsSec', users:'usersSec', audit:'auditSec', backup:'backupSec',
    traceability:'traceabilitySec', incompat:'incompatSec', writeoff:'writeoffSec', dailyReport:'dailyReportSec',
    components:'componentsSec', reactions:'reactionRegistrySec', warnings:'warningsSec', warningSec:'warningsSec',
    trash:'trashSec', cartSec:'trashSec'
  };
  function bbResolveSectionV619(id){ return BB_FEATURE_ALIASES_V619[id] || id; }
  window.show = function(id){
    id = bbResolveSectionV619(id);
    if(id === 'patientsSec' && typeof window.forceShowPatientV617 === 'function') return window.forceShowPatientV617();
    const el = document.getElementById(id);
    if(!el){ try{ toast('Розділ не знайдено або недоступний для ролі','warn'); }catch(e){} return false; }
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    el.classList.add('active');
    el.classList.remove('role-hidden');
    el.style.display='';
    if(id==='stockSec' && typeof loadStock==='function') loadStock();
    if(id==='dashboardProSec' && typeof loadDashboardPro==='function') loadDashboardPro();
    if(id==='temperatureSec' && typeof loadTemperature==='function') loadTemperature();
    if(id==='componentsSec' && typeof loadComponentStockV613==='function') loadComponentStockV613();
    if(id==='warningsSec' && typeof loadWarningsV615==='function') loadWarningsV615();
    if(id==='trashSec' && typeof loadTrashV615==='function') loadTrashV615();
    if(id==='transfusionJournalSec' && typeof loadTransfusionJournalV615==='function') loadTransfusionJournalV615();
    if(id==='backupSec' && typeof loadBackupsV613==='function') loadBackupsV613();
    if(id==='usersSec' && typeof loadUsersPanel==='function') loadUsersPanel();
    try{ el.scrollIntoView({behavior:'smooth', block:'start'}); }catch(e){}
    return true;
  };
  window.safeOpenFeature = function(feature){ return window.show(bbResolveSectionV619(feature)); };
  window.openRoleFeature = window.safeOpenFeature;
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{
    ['stock','dashboardPro','temperature','barcode','monitor','patient','request','myRequests','history','donors'].forEach(k=>{
      document.querySelectorAll(`[data-feature="${k}"]`).forEach(b=>{ b.classList.remove('role-hidden'); b.style.display=''; });
    });
  },1000));
})();


// V6.3.0 ASYNC RUNTIME FIX CANONICAL FRONTEND FUNCTIONS
function componentColorV613(name){
  name=(name||'').toLowerCase();
  if(name.includes('плаз'))return'yellow';
  if(name.includes('тромб'))return'blue';
  if(name.includes('кріо'))return'purple';
  if(name.includes('ерит')||name.includes('кров'))return'red';
  return'gray';
}

function normalizeSectionIdV623(id){
  const aliases={
    patientSec:'patientsSec', patient:'patientsSec', patients:'patientsSec', 'Пацієнт':'patientsSec',
    request:'requestsSec', requests:'requestsSec',
    stock:'stockSec', donors:'stockSec',
    dashboardPro:'dashboardProSec', dashboard:'dashboardProSec',
    temperature:'temperatureSec', temp:'temperatureSec',
    barcode:'barcodeSec', qr:'barcodeSec',
    monitor:'maintenanceSec', maintenance:'maintenanceSec',
    components:'componentsSec', component:'componentsSec',
    traceability:'traceabilitySec',
    journalSec:'transfusionJournalSec', journal:'transfusionJournalSec', history:'transfusionJournalSec',
    warningSec:'warningsSec', warnings:'warningsSec', warning:'warningsSec',
    cartSec:'trashSec', trash:'trashSec',
    users:'usersSec', backup:'backupSec', settings:'settingsSec'
  };
  return aliases[id]||id;
}

function forceShowPatientV617(){
  const el=document.getElementById('patientsSec');
  if(!el){try{toast('Розділ Пацієнт відсутній у HTML','warn')}catch(e){};return false;}
  document.querySelectorAll('.section').forEach(s=>{s.classList.remove('active'); if(s.id==='patientsSec')s.style.display='';});
  el.classList.add('active');
  el.classList.remove('role-hidden');
  el.style.display='';
  try{el.scrollIntoView({behavior:'smooth',block:'start'});}catch(e){}
  return true;
}


function updateNavigationActiveV647(id){
  try{
    id=normalizeSectionIdV623(id||window.ACTIVE_SECTION_ID||'homeSec');
    const titleMap={homeSec:'🏠 Головна',requestsSec:'Вимоги',stockSec:'Склад',alertsSec:'Попередження',patientsSec:'Пацієнт',transfusionJournalSec:'Журнал трансфузій',qrScannerSec:'QR',reactionRegistrySec:'Реакції',signSec:'Підпис',telegramSec:'Налаштування Telegram-бота',usersSec:'Користувачі',auditSec:'Журнал',reportsSec:'Звіти',backupSec:'Резервні копії',trashSec:'Кошик',maintenanceSec:'Моніторинг',pwaInstallSec:'Додаток',telegramPersonalSec:'Мої Telegram-сповіщення',barcodeSec:'QR/Barcode',traceabilitySec:'Простежуваність',incompatSec:'Несумісності',dashboardProSec:'Розширена панель',temperatureSec:'Температура',writeoffSec:'Списання',dailyReportSec:'Добові звіти',componentsSec:'Компоненти',warningsSec:'Попередження складу'};
    document.querySelectorAll('.nav button').forEach(btn=>btn.classList.remove('nav-active','active-nav'));
    document.querySelectorAll('.nav button').forEach(btn=>{
      const attr=(btn.getAttribute('onclick')||'')+' '+(btn.getAttribute('data-feature')||'');
      if(attr.includes(id) || (id==='stockSec'&&attr.includes('stock')) || (id==='dashboardProSec'&&attr.includes('dashboardPro')) || (id==='temperatureSec'&&attr.includes('temperature')) || (id==='patientsSec'&&attr.includes('Patient'))) btn.classList.add('nav-active','active-nav');
    });
    const box=document.getElementById('activeSectionTitle');
    if(box) box.textContent=titleMap[id]||'Розділ';
  }catch(e){}
}

function show(id){
  id=normalizeSectionIdV623(id);
  if(id==='patientsSec'){
    const ok=forceShowPatientV617();
    window.ACTIVE_SECTION_ID='patientsSec';
    updateNavigationActiveV647('patientsSec');
    loadSectionDataV642('patientsSec');
    return ok;
  }
  const el=document.getElementById(id);
  if(!el){try{toast('Розділ не знайдено','warn')}catch(e){};return false;}
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  el.classList.remove('role-hidden');
  window.ACTIVE_SECTION_ID=id;
  updateNavigationActiveV647(id);
  loadSectionDataV642(id);
  return true;
}

async function runIfV642(fnName){
  try{ if(typeof window[fnName]==='function') return await window[fnName](); }catch(e){ console.warn('load failed', fnName, e); }
}
async function loadSectionDataV642(id){
  id=normalizeSectionIdV623(id||window.ACTIVE_SECTION_ID||'homeSec');
  if(window.SECTION_LOADING_V642===id) return;
  window.SECTION_LOADING_V642=id;
  try{
    const tasks=[];
    if(id==='homeSec') tasks.push(runIfV642('loadHome'), runIfV642('loadReminders'), runIfV642('loadHomeStatusV6424'));
    else if(id==='stockSec') tasks.push(runIfV642('loadStock'));
    else if(id==='requestsSec') tasks.push(runIfV642('loadRequestsLive'), runIfV642('loadReminders'));
    else if(id==='alertsSec') tasks.push(runIfV642('loadAlerts'));
    else if(id==='usersSec') tasks.push(runIfV642('loadUsersPanel'));
    else if(id==='auditSec') tasks.push(runIfV642('loadAudit'));
    else if(id==='trashSec') tasks.push(runIfV642('loadTrashV615'), runIfV642('loadTrash'));
    else if(id==='backupSec') tasks.push(runIfV642('loadBackupsV613'), runIfV642('loadBackups'));
    else if(id==='transfusionJournalSec') tasks.push(runIfV642('loadTransfusionJournalV615'), runIfV642('loadTransfusionJournal'));
    else if(id==='reactionRegistrySec') tasks.push(runIfV642('loadReactionRegistry'));
    else if(id==='telegramSec') tasks.push(runIfV642('loadTelegramStatus'));
    else if(id==='maintenanceSec') tasks.push(runIfV642('loadHealth'));
    else if(id==='incompatSec') tasks.push(runIfV642('loadIncompatibilities'));
    else if(id==='dashboardProSec') tasks.push(runIfV642('loadDashboardPro'));
    else if(id==='temperatureSec') tasks.push(runIfV642('loadTemperature'));
    else if(id==='writeoffSec') tasks.push(runIfV642('loadWriteoffs'));
    else if(id==='dailyReportSec') tasks.push(runIfV642('loadDailyReports'));
    else if(id==='componentsSec') tasks.push(runIfV642('loadComponentStockV613'));
    else if(id==='warningsSec') tasks.push(runIfV642('loadWarningsV615'));
    await Promise.allSettled(tasks);
  }finally{
    window.SECTION_LOADING_V642=null;
  }
}

function safeShowV613(primary,fallback){
  primary=normalizeSectionIdV623(primary);
  fallback=normalizeSectionIdV623(fallback);
  if(document.getElementById(primary))return show(primary);
  if(document.getElementById(fallback))return show(fallback);
  try{toast('Розділ не знайдено','warn')}catch(e){}
  return false;
}

function safeOpenFeature(feature){return show(feature);}
function openRoleFeature(feature){return safeOpenFeature(feature);}

async function applyRoleVisibilityV613(){
  let role=document.body.getAttribute('data-role')||window.ROLE||'admin';
  try{const cfg=await jget('/api/ui/role-config'); if(cfg&&cfg.ok&&cfg.role)role=cfg.role;}catch(e){}
  const allowed={
    admin:['homeSec','stockSec','requestsSec','patientsSec','componentsSec','warningsSec','traceabilitySec','temperatureSec','dashboardProSec','barcodeSec','transfusionJournalSec','usersSec','auditSec','trashSec','backupSec','settingsSec','maintenanceSec','telegramSec','telegramPersonalSec','pwaInstallSec','reportsSec','reactionRegistrySec','signSec'],
    transfusion:['homeSec','stockSec','requestsSec','patientsSec','componentsSec','warningsSec','traceabilitySec','temperatureSec','dashboardProSec','barcodeSec','transfusionJournalSec','settingsSec','maintenanceSec','telegramSec','telegramPersonalSec','pwaInstallSec','reportsSec','usersSec','auditSec','trashSec','reactionRegistrySec','signSec'],
    doctor:['homeSec','requestsSec','patientsSec','transfusionJournalSec','telegramPersonalSec','pwaInstallSec','reactionRegistrySec','signSec'],
    nurse:['homeSec','requestsSec','patientsSec','transfusionJournalSec','telegramPersonalSec','pwaInstallSec','reactionRegistrySec','signSec']
  };
  const list=allowed[role]||allowed.doctor;
  document.querySelectorAll('.section').forEach(sec=>{if(list.includes(sec.id)){sec.classList.remove('role-hidden');}else{sec.classList.add('role-hidden');}});
  const p=document.getElementById('patientsSec');
  if(p){p.classList.remove('role-hidden');p.style.display='';}
  document.querySelectorAll('button').forEach(b=>{
    const txt=(b.textContent||'').trim().toLowerCase();
    const oc=b.getAttribute('onclick')||'';
    if(txt.includes('пацієнт') || oc.includes('patientsSec') || oc.includes('patientSec')){
      b.classList.remove('role-hidden'); b.style.display=''; b.setAttribute('onclick','forceShowPatientV617()');
    }
  });
}

async function loadComponentStockV613(force=false){
  const cards=document.getElementById('componentSummaryCards');
  const table=document.getElementById('componentStockTable');
  if(!cards && !table) return;

  if(['doctor','nurse'].includes(String(ROLE||'').toLowerCase())){
    if(cards) cards.innerHTML='<div class="notice">Компоненти складу доступні тільки адміністратору або трансфузіологу.</div>';
    if(table) table.innerHTML='';
    return;
  }

  if(window.COMPONENT_STOCK_LOADING && !force) return;
  window.COMPONENT_STOCK_LOADING=true;
  if(cards && (force || !cards.innerHTML.trim())){
    cards.innerHTML='<div class="notice">Завантаження компонентів…</div>';
  }

  let res={ok:false,items:[],error:''};
  try{
    res=await jget('/api/component-stock',{ttl:force?0:30000,timeout:60000});
    if(!res || res.ok===false) throw new Error((res&&res.error)||'component-stock error');
  }catch(e){
    const msg=String((e&&e.message)||e||'');
    if(msg.toLowerCase().includes('abort')){
      if(cards) cards.innerHTML='<div class="notice">Компоненти ще завантажуються. Натисніть “Оновити компоненти”.</div><button class="btn-blue" onclick="loadComponentStockV613(true)">Оновити компоненти</button>';
      if(table) table.innerHTML='';
      window.COMPONENT_STOCK_LOADING=false;
      return;
    }
    try{
      const fallback=await jget('/api/stock/summary',{ttl:force?0:30000,timeout:60000});
      res={ok:!!fallback.ok, items:fallback.items||[], error:fallback.error||''};
    }catch(e2){
      res={ok:false,items:[],error:(e2&&e2.message)||'Помилка завантаження компонентів'};
    }
  }finally{
    window.COMPONENT_STOCK_LOADING=false;
  }

  const items=(res.items||[]).map(x=>({
    component:x.component||'Невказаний компонент',
    donor_group:x.donor_group||x.group||'—',
    donor_rh:x.donor_rh||x.rh||'—',
    qty:Number(x.qty ?? x.amount ?? x.total ?? 0),
    packs:x.packs||'',
    nearest_expiry:x.nearest_expiry||''
  })).filter(x=>Number(x.qty)!==0);

  if(!res.ok){
    const safe=escapeHtmlV630(res.error||'невідомо');
    const msg='<div class="danger">Помилка завантаження компонентів: '+safe+'<br><button class="btn-blue" onclick="loadComponentStockV613(true)">Спробувати ще раз</button></div>';
    if(cards) cards.innerHTML=msg;
    if(table) table.innerHTML='';
    return;
  }

  const grouped={};
  items.forEach(x=>{ (grouped[x.component]=grouped[x.component]||[]).push(x); });
  const comps=Object.keys(grouped).sort((a,b)=>a.localeCompare(b,'uk'));

  if(!comps.length){
    if(cards) cards.innerHTML='<div class="notice">Немає компонентів</div>';
    if(table) table.innerHTML='';
    return;
  }

  window.COMPONENT_STOCK_GROUPS=[];
  const html=comps.map(comp=>{
    const rows=grouped[comp];
    const sum=rows.reduce((s,x)=>s+Number(x.qty||0),0);
    const nearest=rows.map(x=>x.nearest_expiry).filter(Boolean).sort()[0]||'';
    const rowHtml=rows.map(x=>{
      const idx=window.COMPONENT_STOCK_GROUPS.push({component:comp, donor_group:x.donor_group, donor_rh:x.donor_rh, qty:x.qty, expiry:x.nearest_expiry||'', pack_no:x.pack_no||'', series:x.series||''})-1;
      return `<div class="component-row">
        <div><b>Група</b><span>${escapeHtmlV630(x.donor_group)}</span></div>
        <div><b>Rh</b><span>${escapeHtmlV630(x.donor_rh)}</span></div>
        <div><b>К-сть</b><span>${escapeHtmlV630(String(x.qty))}</span></div>
        <div><b>Пакетів</b><span>${escapeHtmlV630(String(x.packs||''))}</span></div>
        <div><b>Найближчий термін</b><span>${escapeHtmlV630(x.nearest_expiry||'—')}</span></div>
        <div class="component-row-actions">
          <button class="btn-blue small-btn" onclick="issueComponentStockV6422(${idx})">Видати</button>
          <button class="btn-orange small-btn" onclick="writeoffComponentStockV6422(${idx})">Списати</button>
          <button class="btn-blue small-btn" onclick="editComponentStockV6417(${idx})">Редагувати</button>
          <button class="btn-red small-btn" onclick="deleteComponentStockV6417(${idx})">Видалити</button>
        </div>
      </div>`;
    }).join('');
    return `<details class="component-detail ${componentColorV613(comp)}">
      <summary><span class="component-title"><span class="component-arrow">▸</span>${escapeHtmlV630(comp)}</span><strong class="component-count">${sum}</strong>${nearest?`<small>Термін: ${escapeHtmlV630(nearest)}</small>`:''}</summary>
      <div class="component-detail-body">${rowHtml}</div>
    </details>`;
  }).join('');

  if(cards) cards.innerHTML='<div class="component-actions"><button class="btn-blue" onclick="loadComponentStockV613(true)">Оновити компоненти</button></div>'+html;
  if(table) table.innerHTML='';
}

async function editComponentStockV6417(idx){
  const x=(window.COMPONENT_STOCK_GROUPS||[])[idx];
  if(!x){toast('Компонент не знайдено','bad');return;}
  const component=prompt('Компонент', x.component||''); if(component===null)return;
  const group=prompt('Група крові', x.donor_group||''); if(group===null)return;
  const rh=prompt('Rh', x.donor_rh||''); if(rh===null)return;
  const qty=prompt('Кількість на складі', String(x.qty??'')); if(qty===null)return;
  const expiry=prompt('Найближчий термін придатності / термін для коригування', x.expiry||'') || '';
  const r=await jpost('/api/component-stock/update',{
    old_component:x.component, old_donor_group:x.donor_group, old_donor_rh:x.donor_rh,
    new_component:component, new_donor_group:group, new_donor_rh:rh, qty:qty, expiry:expiry
  });
  toast(r.ok?'✅ Компонент оновлено':(r.error||'Помилка редагування'), r.ok?'good':'bad');
  if(r.ok){ clearPerfCache('/api/component-stock'); clearPerfCache('/api/stock'); await loadComponentStockV613(true); if(typeof loadDashboardPro==='function') loadDashboardPro(); }
}

async function deleteComponentStockV6417(idx){
  const x=(window.COMPONENT_STOCK_GROUPS||[])[idx];
  if(!x){toast('Компонент не знайдено','bad');return;}
  if(!confirm(`Видалити зі складу: ${x.component} ${x.donor_group} ${x.donor_rh}? Записи буде перенесено в кошик.`))return;
  const reason=prompt('Причина видалення', 'Видалено компонент зі складу') || 'Видалено компонент зі складу';
  const r=await jpost('/api/component-stock/delete',{component:x.component, donor_group:x.donor_group, donor_rh:x.donor_rh, reason});
  toast(r.ok?'🗑️ Компонент видалено':(r.error||'Помилка видалення'), r.ok?'good':'bad');
  if(r.ok){ clearPerfCache('/api/component-stock'); clearPerfCache('/api/stock'); await loadComponentStockV613(true); if(typeof loadDashboardPro==='function') loadDashboardPro(); }
}

async function chooseApprovedRequestForComponentV6422(x){
  let res={items:[]};
  try{
    res=await jget('/api/component-stock/approved-requests?component='+encodeURIComponent(x.component||'')+'&donor_group='+encodeURIComponent(x.donor_group||'')+'&donor_rh='+encodeURIComponent(x.donor_rh||''),{ttl:0,timeout:30000});
  }catch(e){
    toast('Не вдалося завантажити погоджені вимоги','bad');
  }
  const items=res.items||[];
  let text='Введіть № погодженої вимоги';
  if(items.length){
    text='Погоджені вимоги:\n'+items.slice(0,12).map(r=>`№${r.id} — ${r.patient_name||''} · ${r.component||''} · ${r.patient_group||''}${r.patient_rh||''} · к-сть ${r.amount||''}`).join('\n')+'\n\nВведіть № вимоги';
  }
  const id=prompt(text, items[0]?String(items[0].id):'');
  if(id===null) return null;
  const n=parseInt(id,10);
  if(!n){toast('Потрібно вказати № вимоги','warn');return null;}
  return n;
}

async function issueComponentStockV6422(idx){
  const x=(window.COMPONENT_STOCK_GROUPS||[])[idx];
  if(!x){toast('Компонент не знайдено','bad');return;}
  const request_id=await chooseApprovedRequestForComponentV6422(x);
  if(!request_id)return;
  const qty=prompt('Кількість видати', String(x.qty||1));
  if(qty===null)return;
  const r=await jpost('/api/component-stock/issue',{component:x.component, donor_group:x.donor_group, donor_rh:x.donor_rh, qty, request_id, pack_no:x.pack_no||'', series:x.series||'', expiry:x.expiry||''});
  toast(r.ok?'✅ Компонент видано по вимозі №'+request_id:(r.error||'Помилка видачі'), r.ok?'good':'bad');
  if(r.ok){ clearPerfCache('/api/component-stock'); clearPerfCache('/api/stock'); clearPerfCache('/api/requests'); await loadComponentStockV613(true); if(typeof loadRequests==='function') loadRequests(); if(typeof loadDashboardPro==='function') loadDashboardPro(); }
}

async function writeoffComponentStockV6422(idx){
  const x=(window.COMPONENT_STOCK_GROUPS||[])[idx];
  if(!x){toast('Компонент не знайдено','bad');return;}
  let request_id=null;
  if(confirm('Прив’язати списання до погодженої вимоги?')){
    request_id=await chooseApprovedRequestForComponentV6422(x);
    if(!request_id)return;
  }
  const qty=prompt('Кількість списати', String(x.qty||1));
  if(qty===null)return;
  const series=prompt('Серія компонента для списання', x.series||'');
  if(series===null)return;
  if(!String(series).trim()){toast('Для списання потрібно вказати серію','warn');return;}
  const reason=prompt('Причина списання', 'Списання компонента зі складу') || 'Списання компонента зі складу';
  const r=await jpost('/api/component-stock/writeoff',{component:x.component, donor_group:x.donor_group, donor_rh:x.donor_rh, qty, request_id, reason, pack_no:x.pack_no||'', series:String(series).trim(), expiry:x.expiry||''});
  toast(r.ok?'✅ Компонент списано':(r.error||'Помилка списання'), r.ok?'good':'bad');
  if(r.ok){ clearPerfCache('/api/component-stock'); clearPerfCache('/api/stock'); clearPerfCache('/api/requests'); await loadComponentStockV613(true); if(typeof loadRequests==='function') loadRequests(); if(typeof loadDashboardPro==='function') loadDashboardPro(); }
}

async function scanManualBarcodeV614(){
  const el=document.getElementById('manualBarcodeInputV614')||document.getElementById('qrManual');
  const code=(el&&el.value||'').trim();
  if(!code){toast('На iPhone введіть код вручну з етикетки','warn');return;}
  try{
    const r=await jget('/api/traceability/'+encodeURIComponent(code));
    toast(r.ok?'✅ Код знайдено':(r.error||'Код не знайдено'), r.ok?'good':'warn');
    const out=document.getElementById('qrResult')||document.getElementById('barcodeResult');
    if(out)out.innerHTML=`<div class="notice"><b>Перевірено код:</b> ${code}<br><pre style="white-space:pre-wrap">${JSON.stringify(r,null,2)}</pre></div>`;
  }catch(e){toast('Помилка перевірки коду','warn');}
}

async function loadTelegramStatus(){
  const box=document.getElementById('telegramStatus');
  if(!box)return;
  const s=await jget('/api/telegram/status');
  box.innerHTML=`<div class="setting-list"><div><b>Bot:</b> ${s.enabled?'увімкнено':'вимкнено'}</div><div><b>Token:</b> ${s.has_token?'є':'немає'}</div><div><b>Chat ID:</b> ${s.chat_id||'не задано'}</div></div>`;
}

async function loadTelegramMe(){
  const box=document.getElementById('telegramMeBox');
  if(!box)return;
  const d=await jget('/api/telegram/me');
  const role=(d.role||document.body.getAttribute('data-role')||window.ROLE||'doctor').toLowerCase();
  const settings=d.settings||{};
  let allowed=d.allowed_notifications || (role==='admin'?['new_requests','critical','expiring','reactions','backups']:(role==='transfusion'?['new_requests','critical','expiring','reactions']:['new_requests']));
  if(['doctor','nurse'].includes(role)) allowed=['new_requests'];
  const a=document.getElementById('telegramConnectBtn');
  const url=d.connect_url||d.link_url||'#';
  if(a){a.href=url; a.style.display=url&&url!=='#'?'inline-flex':'none';}
  box.innerHTML=`<div class="notice flat-notice"><b>Статус:</b> ${d.telegram_enabled?'увімкнено':'вимкнено'} · <b>Chat ID:</b> ${d.telegram_chat_id||'не підключено'}${d.telegram_username?' · @'+d.telegram_username:''}</div>`;
  const setChecked=(id,val)=>{const el=document.getElementById(id); if(el) el.checked=!!val;};
  setChecked('tg_set_enabled', d.telegram_enabled);
  setChecked('tg_set_new_requests', settings.new_requests);
  setChecked('tg_set_critical', settings.critical);
  setChecked('tg_set_expiring', settings.expiring);
  setChecked('tg_set_reactions', settings.reactions);
  setChecked('tg_set_backups', settings.backups);
  document.querySelectorAll('[data-tg-option]').forEach(row=>{
    const opt=row.getAttribute('data-tg-option');
    row.style.display = (opt==='enabled' || allowed.includes(opt)) ? '' : 'none';
  });
  const label=document.getElementById('tg_label_new_requests');
  const hint=document.getElementById('tg_hint_new_requests');
  if(['doctor','nurse'].includes(role)){
    if(label) label.textContent='Статус моїх вимог';
    if(hint) hint.textContent='Коли вашу вимогу погоджено, видано або відмовлено';
  }else{
    if(label) label.textContent='Нові вимоги';
    if(hint) hint.textContent='Коли створено нову вимогу на кров';
  }
  const poll=document.getElementById('telegramPollBtn');
  if(poll) poll.style.display=['admin','transfusion'].includes(role)?'inline-flex':'none';
  const commands=document.getElementById('telegramBotCommandsBox');
  if(commands){
    commands.innerHTML=['admin','transfusion'].includes(role)
      ? 'Команди бота: <b>/stock</b>, <b>/critical</b>, <b>/requests</b>, <b>/expiring</b>'
      : 'Команди бота для вашої ролі: <b>/requests</b>, <b>/help</b>. Склад і критичні залишки доступні тільки трансфузіологу/адміну.';
  }
}

async function saveTelegramMeSettings(){
  const get=id=>{const el=document.getElementById(id);return !!(el&&el.checked)};
  const role=(document.body.getAttribute('data-role')||window.ROLE||'').toLowerCase();
  const personal=['doctor','nurse'].includes(role);
  const r=await jpost('/api/telegram/me/settings',{
    telegram_enabled:get('tg_set_enabled'),
    new_requests:get('tg_set_new_requests'),
    critical: personal ? false : get('tg_set_critical'),
    expiring: personal ? false : get('tg_set_expiring'),
    reactions: personal ? false : get('tg_set_reactions'),
    backups: personal ? false : get('tg_set_backups')
  });
  toast(r.ok?'✅ Збережено':'⚠️ '+(r.error||'Помилка'), r.ok?'good':'warn');
  if(r.ok) loadTelegramMe();
}

async function testMyTelegram(){const r=await jpost('/api/telegram/me/test',{});toast(r.ok?'✅ Повідомлення відправлено':'⚠️ '+(r.response||r.error||'Telegram не підключено'), r.ok?'good':'warn');}
async function pollTelegram(){const r=await jpost('/api/telegram/poll',{});toast(r.ok?'✅ Telegram синхронізовано. Оброблено: '+(r.processed||0):'⚠️ '+(r.error||'Помилка'), r.ok?'good':'warn');loadTelegramStatus();}

function updatePWAStatus(){
  const box=document.getElementById('pwaStatusBox');
  const btn=document.getElementById('pwaInstallBtn');
  if(!box)return;
  const standalone=isStandalonePWA();
  box.innerHTML=standalone?'✅ Встановлено як додаток':'ℹ️ Можна встановити як додаток через меню браузера';
  if(btn)btn.style.display=window.deferredPrompt?'inline-flex':'none';
}


async function loadAll(){
  // V6.4.22: легке оновлення. Не вантажимо всі 20+ API кожні 5 секунд.
  try{ if(!window.ROLE_VISIBILITY_DONE_V642){ await applyRoleVisibilityV613(); window.ROLE_VISIBILITY_DONE_V642=true; } }catch(e){}
  try{ await loadSectionDataV642(window.ACTIVE_SECTION_ID||'homeSec'); }catch(e){}
  try{loadHomeQuickInfo();}catch(e){}
  try{ if((document.querySelector('.section.active')?.id||'homeSec')==='homeSec') loadHomeStatusV6424(); }catch(e){}
  try{updatePWAStatus();}catch(e){}
}
function initPerformanceLoadingV642(){
  window.ACTIVE_SECTION_ID=document.querySelector('.section.active')?.id || 'homeSec';
  updateNavigationActiveV647(window.ACTIVE_SECTION_ID);
  loadAll();
  if(window.APP_REFRESH_TIMER_V642) clearInterval(window.APP_REFRESH_TIMER_V642);
  window.APP_REFRESH_TIMER_V642=setInterval(()=>{
    const active=document.querySelector('.section.active')?.id || window.ACTIVE_SECTION_ID || 'homeSec';
    // активна вкладка оновлюється рідше, щоб не підвішувати телефон і Render
    loadSectionDataV642(active);
    try{updatePWAStatus();}catch(e){}
  },30000);
}

// ================= V6.3.0 UI helpers =================

function escapeHtmlV630(v){return String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));}
function tableHtmlV630(items){
  items=items||[];
  if(!items.length)return '<div class="notice">Немає даних</div>';
  const keys=Object.keys(items[0]);
  return '<div class="table-scroll"><table><tr>'+keys.map(k=>'<th>'+escapeHtmlV630(k)+'</th>').join('')+'</tr>'+items.map(r=>'<tr>'+keys.map(k=>'<td>'+escapeHtmlV630(r[k])+'</td>').join('')+'</tr>').join('')+'</table></div>';
}
async function apiV630(url,opts){
  opts=opts||{}; opts.headers=Object.assign({'Content-Type':'application/json','X-CSRF-Token':CSRF},opts.headers||{});
  const resp=await fetch(url,opts); const text=await resp.text(); let data;
  try{data=JSON.parse(text)}catch(e){data={ok:false,error:text||('HTTP '+resp.status)}}
  if(!resp.ok)throw new Error(data.error||('HTTP '+resp.status));
  return data;
}

async function loadUnitsV630(){
  const box=document.getElementById('unitsV630');
  if(!box) return;
  box.innerHTML='Завантаження одиниць компонентів...';
  try{
    const r=await apiV630('/api/units');
    const items=r.items||[];
    box.innerHTML='<h3>Одиниці компонентів</h3>'+tableHtmlV630(items.slice(0,100));
  }catch(e){ box.innerHTML='<div class="err">'+escapeHtmlV630(e.message||e)+'</div>'; }
}
async function autoExpireUnitsV630(){
  const box=document.getElementById('unitsV630');
  try{
    const r=await apiV630('/api/units/auto-expire',{method:'POST',body:JSON.stringify({})});
    if(box) box.innerHTML='<div class="ok">Перевірено: '+(r.checked||0)+'. Протермінованих: '+((r.expired||[]).length)+'</div>'+tableHtmlV630(r.expired||[]);
  }catch(e){ if(box) box.innerHTML='<div class="err">'+escapeHtmlV630(e.message||e)+'</div>'; }
}
async function loadTemperatureSummaryV630(){
  const box=document.getElementById('temperatureResult');
  if(!box) return;
  box.innerHTML='Завантаження підсумку температур...';
  try{
    const r=await apiV630('/api/temperature/summary');
    let html='<h3>Підсумок температур, норма '+escapeHtmlV630(r.normal_range||'2–6°C')+'</h3>';
    if((r.alerts||[]).length){ html+='<div class="err">Є відхилення температури</div>'+tableHtmlV630(r.alerts); }
    html+=tableHtmlV630(r.items||[]);
    box.innerHTML=html;
  }catch(e){ box.innerHTML='<div class="err">'+escapeHtmlV630(e.message||e)+'</div>'; }
}
// ================= END V6.3.0 UI helpers =================


// V640_CLIENT_HELPERS
async function loadUpgradeV640(){
  const box=document.getElementById('upgradeV640Box');
  if(!box) return;
  const endpoints=['/api/upgrade/v640-check','/api/security/login-policy','/api/backups/schedule/status','/api/system/postgres-readiness','/api/pwa/status','/api/dashboard/role'];
  let html='';
  for(const ep of endpoints){
    try{ const r=await api(ep); html += `<div class="notice"><b>${ep}</b><pre>${escapeHtmlV630(JSON.stringify(r,null,2))}</pre></div>`; }
    catch(e){ html += `<div class="notice danger"><b>${ep}</b>: ${escapeHtmlV630(String(e.message||e))}</div>`; }
  }
  box.innerHTML=html;
}
async function runScheduledBackupV640(){
  try{ const r=await api('/api/backups/schedule/run',{method:'POST',headers:{'X-CSRF-Token':CSRF,'Content-Type':'application/json'},body:'{}'}); toast('Резервна копія: '+(r.filename||'готово')); loadUpgradeV640(); }
  catch(e){ toast('Помилка резервної копії: '+e.message); }
}
async function enableTelegram2FAV640(){
  const r=await api('/api/security/2fa/setup',{method:'POST',headers:{'X-CSRF-Token':CSRF,'Content-Type':'application/json'},body:JSON.stringify({mode:'telegram'})}); toast(r.ok?'2FA Telegram увімкнено':'Помилка 2FA');
}
async function disable2FAV640(){
  const r=await api('/api/security/2fa/disable',{method:'POST',headers:{'X-CSRF-Token':CSRF,'Content-Type':'application/json'},body:'{}'}); toast(r.ok?'2FA вимкнено':'Помилка 2FA');
}


// V6.4.22: остаточна видимість розділів у браузері та PWA.
// Мета: doctor/nurse бачать лише персональні Telegram-сповіщення і PWA-додаток;
// системні налаштування Telegram — тільки admin/transfusion; резервні копії — тільки admin.
(function(){
  const ROLE_SECTIONS_V6410={
    admin:['homeSec','requestsSec','patientsSec','transfusionJournalSec','reactionRegistrySec','signSec','stockSec','alertsSec','qrScannerSec','barcodeSec','traceabilitySec','incompatSec','temperatureSec','writeoffSec','dailyReportSec','componentsSec','warningsSec','telegramPersonalSec','telegramSec','usersSec','auditSec','reportsSec','backupSec','trashSec','maintenanceSec','pwaInstallSec','dashboardProSec'],
    transfusion:['homeSec','requestsSec','patientsSec','transfusionJournalSec','reactionRegistrySec','signSec','stockSec','alertsSec','qrScannerSec','barcodeSec','traceabilitySec','incompatSec','temperatureSec','writeoffSec','dailyReportSec','componentsSec','warningsSec','telegramPersonalSec','telegramSec','usersSec','auditSec','reportsSec','maintenanceSec','trashSec','pwaInstallSec','dashboardProSec'],
    doctor:['homeSec','requestsSec','patientsSec','transfusionJournalSec','reactionRegistrySec','signSec','telegramPersonalSec','pwaInstallSec'],
    nurse:['homeSec','requestsSec','patientsSec','transfusionJournalSec','reactionRegistrySec','signSec','telegramPersonalSec','pwaInstallSec']
  };
  function sectionFromButtonV6410(btn){
    const oc=btn.getAttribute('onclick')||'';
    const m=oc.match(/show\('([^']+)'\)/); if(m) return m[1];
    const f=btn.getAttribute('data-feature')||'';
    const map={stock:'stockSec',barcode:'barcodeSec',temperature:'temperatureSec',dashboardPro:'dashboardProSec',patient:'patientsSec'};
    return map[f]||'';
  }
  window.applyPWARoleVisibilityV6410=function(){
    const role=(document.body.getAttribute('data-role')||window.ROLE||'doctor').toLowerCase();
    const allowed=ROLE_SECTIONS_V6410[role]||ROLE_SECTIONS_V6410.doctor;
    document.querySelectorAll('.section').forEach(sec=>{
      const ok=allowed.includes(sec.id);
      sec.classList.toggle('role-hidden', !ok);
      if(!ok && sec.classList.contains('active')) sec.classList.remove('active');
    });
    document.querySelectorAll('.nav button').forEach(btn=>{
      const sid=sectionFromButtonV6410(btn);
      if(!sid) return;
      btn.classList.toggle('role-hidden', !allowed.includes(sid));
    });
    document.querySelectorAll('[onclick*="telegramSec"], [data-section="telegramSec"]').forEach(el=>{
      el.classList.toggle('role-hidden', !['admin','transfusion'].includes(role));
    });
    document.querySelectorAll('[onclick*="backupSec"], [data-section="backupSec"]').forEach(el=>{
      el.classList.toggle('role-hidden', role!=='admin');
    });
  };
  document.addEventListener('DOMContentLoaded',()=>setTimeout(window.applyPWARoleVisibilityV6410,1200));
})();

// V6.4.22 FINAL ROLE CLEANUP: прибирає зайві панелі для doctor/nurse у браузері та PWA.
(function(){
  const PERSONAL_SECTIONS={
    doctor:['homeSec','requestsSec','patientsSec','transfusionJournalSec','reactionRegistrySec','signSec','telegramPersonalSec','pwaInstallSec'],
    nurse:['homeSec','requestsSec','patientsSec','transfusionJournalSec','reactionRegistrySec','signSec','telegramPersonalSec','pwaInstallSec']
  };
  const SERVICE_SECTIONS=['stockSec','alertsSec','qrScannerSec','barcodeSec','traceabilitySec','incompatSec','temperatureSec','writeoffSec','dailyReportSec','componentsSec','warningsSec','telegramSec','usersSec','auditSec','reportsSec','backupSec','trashSec','maintenanceSec','dashboardProSec','upgradeV640Sec'];
  function sidFromButton(btn){
    const oc=btn.getAttribute('onclick')||'';
    const m=oc.match(/(?:show|safeShowV613)\('([^']+)'\)/); if(m) return m[1];
    const f=btn.getAttribute('data-feature')||'';
    const map={stock:'stockSec',barcode:'barcodeSec',temperature:'temperatureSec',dashboardPro:'dashboardProSec',patient:'patientsSec',request:'requestsSec',myRequests:'requestsSec',history:'transfusionJournalSec',monitor:'maintenanceSec'};
    return map[f]||'';
  }
  window.finalRoleCleanupV6413=function(){
    const role=(document.body.getAttribute('data-role')||window.ROLE||'').toLowerCase();
    if(!['doctor','nurse'].includes(role)){
      document.querySelectorAll('[data-tg-option]').forEach(row=>{row.style.display='';});
      const poll=document.getElementById('telegramPollBtn'); if(poll) poll.style.display='inline-flex';
      return;
    }
    const allowed=PERSONAL_SECTIONS[role];
    document.querySelectorAll('.section').forEach(sec=>{
      const ok=allowed.includes(sec.id);
      sec.classList.toggle('role-hidden', !ok);
      if(!ok && sec.classList.contains('active')) sec.classList.remove('active');
    });
    if(!document.querySelector('.section.active')){
      const home=document.getElementById('homeSec'); if(home) home.classList.add('active');
    }
    document.querySelectorAll('.nav button,.role-tile-grid button,.role-bottom-nav button,.role-action-grid button').forEach(btn=>{
      const sid=sidFromButton(btn);
      if(!sid) return;
      btn.classList.toggle('role-hidden', SERVICE_SECTIONS.includes(sid));
    });
    document.querySelectorAll('.admin-transfusion-only,.audit-role-panel').forEach(el=>el.classList.add('role-hidden'));
    ['critical','expiring','reactions','backups'].forEach(opt=>{
      document.querySelectorAll(`[data-tg-option="${opt}"]`).forEach(el=>{el.style.display='none'; el.classList.add('role-hidden');});
      const cb=document.getElementById('tg_set_'+opt); if(cb) cb.checked=false;
    });
    const nr=document.querySelector('[data-tg-option="new_requests"]'); if(nr){nr.style.display=''; nr.classList.remove('role-hidden');}
    const en=document.querySelector('[data-tg-option="enabled"]'); if(en){en.style.display=''; en.classList.remove('role-hidden');}
    const label=document.getElementById('tg_label_new_requests'); if(label) label.textContent='Статус моїх вимог';
    const hint=document.getElementById('tg_hint_new_requests'); if(hint) hint.textContent='Коли вашу вимогу погоджено, видано або відмовлено';
    const poll=document.getElementById('telegramPollBtn'); if(poll) poll.style.display='none';
    const commands=document.getElementById('telegramBotCommandsBox'); if(commands) commands.innerHTML='Команди бота для вашої ролі: <b>/requests</b>, <b>/help</b>. Склад, критичні залишки й терміни доступні тільки трансфузіологу/адміну.';
  };
  const oldShow=window.show;
  if(typeof oldShow==='function'){
    window.show=function(id){
      const res=oldShow(id);
      setTimeout(window.finalRoleCleanupV6413,0);
      return res;
    };
  }
  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(window.finalRoleCleanupV6413,100);
    setTimeout(window.finalRoleCleanupV6413,900);
    setTimeout(window.finalRoleCleanupV6413,1800);
  });
})();

// V6.4.22: doctor/nurse мають право списувати тільки власні погоджені/видані вимоги.
// Кнопки списання формуються функцією canWriteoffRequestUI(), а бекенд додатково перевіряє статус і власника.
function cleanupRequestWriteoffButtonsV6421(){ return true; }
