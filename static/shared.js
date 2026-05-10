
const ROLE=APP.role, CSRF=APP.csrf;
const FIELD_LABELS_UA={
  patient_name:'ПІБ пацієнта',
  birth_date:'Дата народження',
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
function show(id){document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));document.getElementById(id)?.classList.add('active');loadAll();}
function setRequestTab(tab,btn){window.REQUEST_TAB=tab;document.querySelectorAll('.req-tab').forEach(x=>x.classList.remove('active'));if(btn)btn.classList.add('active');loadRequestsLive();}
function compKind(c){c=(c||'').toLowerCase();if(c.includes('кріо')||c.includes('cryo'))return'cryo';if(c.includes('плаз'))return'plasma';if(c.includes('тромб'))return'plt';return'rbc'}
async function jget(u){return await (await fetch(u)).json()}
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
async function loadAll(){await Promise.allSettled([loadStock(),loadRequestsLive(),loadReminders(),loadUsersPanel(),loadAudit(),loadAlerts(),loadTrash(),loadBackups(),loadHome(),loadTransfusionJournal(),loadReactionRegistry(),loadTransfusionEvents(),loadTelegramStatus()]);}
async function loadStock(){let st=await jget('/api/stock');let r=0,p=0,t=0,cr=0,low=0,h='<table><tr><th>Компонент</th><th>Група</th><th>К-сть</th></tr>';st.forEach(x=>{let q=Number(x.qty||0);if(compKind(x.component)=='rbc')r+=q;if(compKind(x.component)=='plasma')p+=q;if(compKind(x.component)=='plt')t+=q;if(compKind(x.component)=='cryo')cr+=q;if(q<5)low++;h+=`<tr><td>${x.component}</td><td>${x.group||''}${x.rh||''}</td><td>${q}</td></tr>`});rbcStat.textContent=r;plasmaStat.textContent=p;pltStat.textContent=t;if(window.cryoStat)cryoStat.textContent=cr;lowStat.textContent=low;if(stock)stock.innerHTML=h+'</table>'}
async function saveStock(){let d={type:val('stock_type'),component:val('stock_component'),donor_group:val('stock_group'),donor_rh:val('stock_rh'),amount:val('stock_amount'),pack_no:val('pack_no'),series:val('series'),expiry:val('expiry'),qr_code:val('qr_code')};let j=await jpost('/api/stock/add',d);alert(j.ok?'Збережено':j.error);loadAll();}
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
function actions(x, tab='active'){
  let h='';
  let archived = ['used','written','rejected'].includes(tab);
  if(!archived && ['admin','transfusion'].includes(ROLE)){
    h+=`<button class="btn-blue" onclick="reqAction(${x.id},'approve')">Погодити</button><button class="btn-orange" onclick="reqAction(${x.id},'issue')">Видати</button><button class="btn-red" onclick="reqAction(${x.id},'reject')">Відмовити</button>`;
  }
  if(!archived){
    h+=`<button class="btn-green" onclick="openUsedModal(${x.id})">Використано</button><button class="btn-red" onclick="openWriteoffModal(${x.id})">Списати</button><button class="btn-orange" onclick="markReaction(${x.id})">Реакція</button>`;
  }
  h+=`<button onclick="location.href='/reports/request/${x.id}.pdf'">PDF</button>`;
  return h
}
async function createRequest(){
  if(!requireFields(['patient_name','birth_date','department','component','patient_group','patient_rh','amount','diagnosis']))return;let d={patient_name:val('patient_name'),birth_date:val('birth_date'),address:val('address'),patient_status:val('patient_status'),department:val('department'),component:val('component'),patient_group:val('patient_group'),patient_rh:val('patient_rh'),amount:val('amount'),urgency:val('urgency'),diagnosis:val('diagnosis'),note:val('note')};let j=await jpost('/api/request/create',d);toast(j.ok?'✅ Вимогу створено':(j.error||'Помилка'),'good');;loadAll();}
async function reqAction(id,action){let d={id,action};if(action=='issue'){d.donor_group=prompt('Група донора','');d.donor_rh=prompt('Rh','');d.pack_no=prompt('№ пакета','');d.series=prompt('Серія','');d.expiry=prompt('Термін','');d.override=confirm('Дозволити видачу при попередженні несумісності?')}let j=await jpost('/api/request/action',d);alert(j.ok?'Готово':j.error);loadAll();}
function openUsedModal(id){let use_date=prompt('Дата/час використання',new Date().toISOString().slice(0,16));let used_by=prompt('Хто підтвердив','');let use_confirm=prompt('Підтвердження','перелито');if(!use_date||!used_by||!use_confirm)return;jpost('/api/request/used',{id,use_date,used_by,use_confirm}).then(j=>{alert(j.ok?'Збережено':j.error);loadAll();});}
function openWriteoffModal(id){let writeoff_date=prompt('Дата/час списання',new Date().toISOString().slice(0,16));let written_by=prompt('Хто списав','');let writeoff_reason=prompt('Причина','');if(!writeoff_date||!written_by||!writeoff_reason)return;jpost('/api/request/writeoff',{id,writeoff_date,written_by,writeoff_reason}).then(j=>{alert(j.ok?'Списано':j.error);loadAll();});}
function markReaction(id){let reaction_type=prompt('Тип реакції','');if(reaction_type===null)return;jpost('/api/request/reaction',{id,reaction_present:'Так',reaction_type,reaction_severity:prompt('Тяжкість',''),reaction_description:prompt('Опис',''),reaction_result:prompt('Наслідок','')}).then(j=>{alert(j.ok?'Збережено':j.error);loadAll();});}
async function loadReminders(){let box=document.getElementById('reminders');if(!box)return;let data=await jget('/api/doctor/reminders');if(!Array.isArray(data)||!data.length){box.innerHTML='';return}box.innerHTML='<div class="danger"><b>Незавершені видані вимоги: '+data.length+'</b></div>'}
async function loadUsersPanel(){let box=document.getElementById('users');if(!box||!['admin','transfusion'].includes(ROLE))return;let data=await jget('/api/users');window.USERS=data;renderUsersTable();}
function renderUsersTable(){let box=document.getElementById('users');if(!box||!window.USERS)return;let q=(document.getElementById('usersSearch')?.value||'').toLowerCase();let h='<div class="table-scroll"><table class="users-table"><tr><th>ID</th><th>Логін</th><th>ПІБ</th><th>Посада</th><th>Роль</th><th>Дії</th></tr>';window.USERS.filter(x=>JSON.stringify(x).toLowerCase().includes(q)).forEach(x=>{h+=`<tr><td>${x.id}</td><td><input id="ulogin_${x.id}" value="${x.username||''}"></td><td><input id="ufn_${x.id}" value="${x.full_name||''}"></td><td><input id="upos_${x.id}" value="${x.position||''}"></td><td><select id="urole_${x.id}"><option ${x.role=='doctor'?'selected':''}>doctor</option><option ${x.role=='nurse'?'selected':''}>nurse</option><option ${x.role=='transfusion'?'selected':''}>transfusion</option><option ${x.role=='admin'?'selected':''}>admin</option></select></td><td class="actions-cell"><button onclick="saveUser(${x.id})">Зберегти</button><button onclick="changeUserPassword(${x.id})">Пароль</button><button class="btn-red small-btn" onclick="deleteUser(${x.id},'${x.username||''}')">Видалити</button></td></tr>`});box.innerHTML=h+'</table></div>'}
async function createUser(){let j=await jpost('/api/users/create',{username:val('new_username'),password:val('new_password'),full_name:val('new_full_name'),position:val('new_position'),role:val('new_role')});alert(j.ok?'Створено':j.error);loadAll();}
async function saveUser(id){let j=await jpost('/api/users/update',{id,username:val('ulogin_'+id),full_name:val('ufn_'+id),position:val('upos_'+id),role:val('urole_'+id)});alert(j.ok?'Збережено':j.error);loadAll();}
async function changeUserPassword(id){let p=prompt('Новий пароль');if(!p)return;let j=await jpost('/api/users/update',{id,password:p});alert(j.ok?'Пароль змінено':j.error);} async function deleteUser(id,username){if(!confirm('Видалити користувача '+username+' у кошик?'))return;let reason=prompt('Причина видалення','');let j=await jpost('/api/admin/delete-record',{table:'users',id,reason});alert(j.ok?'Користувача переміщено в кошик':j.error);loadAll();}
async function loadAudit(){let box=document.getElementById('audit');if(!box||!['admin','transfusion'].includes(ROLE))return;let data=await jget('/api/audit');box.innerHTML='<table><tr><th>Дата</th><th>Користувач</th><th>Дія</th><th>Деталі</th></tr>'+data.map(x=>`<tr><td>${x.created_at}</td><td>${x.username}</td><td>${x.action}</td><td>${x.details}</td></tr>`).join('')+'</table>'}
async function loadAlerts(){let box=document.getElementById('alerts');if(!box)return;let a=await jget('/api/alerts');box.innerHTML=a.low&&a.low.length?'<div class="danger">'+a.low.map(x=>`${x.component} ${x.group||''}${x.rh||''}: ${x.qty}`).join('<br>')+'</div>':'<div class="good">Критичних попереджень немає</div>'}
async function loadReport(){let d=await jget('/api/reports/preview');reportPreview.innerHTML='<table><tr><th>ID</th><th>Дата</th><th>Пацієнт</th><th>Компонент</th><th>Статус</th></tr>'+d.rows.map(x=>`<tr><td>${x.id}</td><td>${x.created_at}</td><td>${x.patient_name}</td><td>${x.component}</td><td>${x.status}</td></tr>`).join('')+'</table>'}

async function loadTrash(){
  let box=document.getElementById('trash');
  if(!box||ROLE!='admin')return;
  let d=await jget('/api/trash');
  box.innerHTML='<div class="table-scroll"><table><tr><th>ID</th><th>Дата</th><th>Таблиця</th><th>Запис</th><th>Хто</th><th>Дія</th></tr>'+
    d.map(x=>`<tr><td>${x.id}</td><td>${x.created_at}</td><td>${x.source_table}</td><td>${x.source_id}</td><td>${x.deleted_by||''}</td><td><button class="btn-green" onclick="restoreTrash(${x.id})">Відновити</button></td></tr>`).join('')+
    '</table></div>';
}
async function restoreTrash(id){
  if(!confirm('Відновити запис з кошика?'))return;
  let j=await jpost('/api/trash/restore',{id});
  alert(j.ok?'Відновлено':j.error);
  loadAll();
}

document.addEventListener('DOMContentLoaded',()=>{loadAll();setInterval(loadAll,5000);});

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
async function loadPatientHistory(){let name=val('patientSearch');let d=await jget('/api/patients/history?name='+encodeURIComponent(name));patientHistory.innerHTML='<div class="table-scroll"><table><tr><th>ID</th><th>Дата</th><th>Компонент</th><th>Статус</th><th>Реакція</th></tr>'+d.rows.map(x=>`<tr><td>${x.id}</td><td>${x.created_at}</td><td>${x.component}</td><td>${x.status}</td><td>${x.reaction_present}</td></tr>`).join('')+'</table></div>'}
async function loadBackups(){let box=document.getElementById('backups');if(!box||ROLE!='admin')return;let d=await jget('/api/backups');box.innerHTML='<div class="table-scroll"><table><tr><th>ID</th><th>Дата</th><th>Файл</th><th>Дія</th></tr>'+d.map(x=>`<tr><td>${x.id}</td><td>${x.created_at}</td><td>${x.filename}</td><td><button onclick="location.href='/api/backups/download/${x.id}'">Скачати</button><button class="btn-red" onclick="restoreBackup(${x.id})">Restore</button></td></tr>`).join('')+'</table></div>'}
async function createBackup(){let j=await jpost('/api/backups/create',{});alert(j.ok?'Backup створено':j.error);loadAll()}
async function restoreBackup(id){if(!confirm('Відновити backup?'))return;let j=await jpost('/api/backups/restore',{id});alert(j.ok?'Відновлено':j.error);location.reload()}

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

async function loadTelegramStatus(){
  let box=document.getElementById('telegramStatus');
  if(!box)return;
  let s=await jget('/api/telegram/status');
  box.innerHTML=`<div class="dashboard-grid">
    <div class="dashboard-box"><b>Увімкнено</b><br>${s.enabled?'✅ Так':'❌ Ні'}</div>
    <div class="dashboard-box"><b>Bot token</b><br>${s.bot_configured?'✅ Є':'❌ Немає'}</div>
    <div class="dashboard-box"><b>Chat ID</b><br>${s.chat_configured?'✅ Є':'❌ Немає'}</div>
    <div class="dashboard-box"><b>Silent time</b><br>${s.silent_now?'🌙 Тихий режим':'🔔 Активний режим'}<br>${s.silent_start}:00 - ${s.silent_end}:00</div>
  </div>`;
  loadTelegramLogs();
  loadTelegramQueue();
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
    <div class="dashboard-box"><b>Система</b><br>${h.ok?'✅ OK':'❌ ERROR'}<br>${h.version}</div>
    <div class="dashboard-box"><b>Database</b><br>${h.database}<br>${h.postgres?'PostgreSQL':'SQLite'}</div>
    <div class="dashboard-box"><b>Backup age</b><br>${h.backup_age_hours??'немає'} год</div>
    <div class="dashboard-box"><b>Telegram</b><br>${h.telegram_configured?'✅ Налаштовано':'⚠️ Не налаштовано'}</div>
  </div>`;
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

async function loadTelegramMe(){
  let box=document.getElementById('telegramMeBox');
  if(!box)return;
  let d=await jget('/api/telegram/me');
  let a=document.getElementById('telegramConnectBtn');
  if(a){
    if(d.link_url){a.href=d.link_url; a.style.display='inline-flex'}
    else{a.href='#'; a.style.display='none'}
  }
  box.innerHTML=`<div class="dashboard-grid">
    <div class="dashboard-box"><b>Bot</b><br>${d.bot_username?'@'+d.bot_username:'⚠️ Додай TELEGRAM_BOT_USERNAME в Render'}</div>
    <div class="dashboard-box"><b>Chat ID</b><br>${d.telegram_chat_id||'не підключено'}</div>
    <div class="dashboard-box"><b>Username</b><br>${d.telegram_username||'—'}</div>
    <div class="dashboard-box"><b>Статус</b><br>${d.telegram_enabled?'✅ Увімкнено':'⚠️ Вимкнено'}</div>
  </div>`;
  const s=d.settings||{};
  let set=(id,v)=>{let el=document.getElementById(id); if(el)el.checked=!!v};
  set('tg_set_enabled',d.telegram_enabled);
  set('tg_set_new_requests',s.new_requests);
  set('tg_set_critical',s.critical);
  set('tg_set_expiring',s.expiring);
  set('tg_set_reactions',s.reactions);
  set('tg_set_backups',s.backups);
}
async function saveTelegramMeSettings(){
  let get=id=>{let el=document.getElementById(id); return !!(el&&el.checked)};
  let r=await jpost('/api/telegram/me/settings',{
    telegram_enabled:get('tg_set_enabled'),
    new_requests:get('tg_set_new_requests'),
    critical:get('tg_set_critical'),
    expiring:get('tg_set_expiring'),
    reactions:get('tg_set_reactions'),
    backups:get('tg_set_backups')
  });
  if(r.ok){toast('✅ Telegram налаштування збережено','good')}
  else{toast('⚠️ '+(r.error||'Не вдалося зберегти Telegram налаштування'),'warn')}
  loadTelegramMe();
}
async function testMyTelegram(){
  let r=await jpost('/api/telegram/me/test',{});
  toast(r.ok?'✅ Повідомлення відправлено':'⚠️ '+(r.response||r.error||'Telegram не підключено'), r.ok?'good':'warn');
}
async function pollTelegram(){
  let r=await jpost('/api/telegram/poll',{});
  toast(r.ok?'✅ Telegram синхронізовано. Оброблено: '+(r.processed||0):'⚠️ '+(r.error||'Помилка'), r.ok?'good':'warn');
  loadTelegramMe();
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
function updatePWAStatus(){
  let box=document.getElementById('pwaStatusBox');
  let btn=document.getElementById('pwaInstallBtn');
  if(!box)return;
  let standalone=isStandalonePWA();
  box.innerHTML=`<div class="dashboard-grid">
    <div class="dashboard-box"><b>Статус</b><br>${standalone?'✅ Встановлено':'🌐 В браузері'}</div>
    <div class="dashboard-box"><b>Install prompt</b><br>${deferredPWAInstall?'✅ Доступний':'⚠️ Не доступний'}</div>
    <div class="dashboard-box"><b>Service Worker</b><br>${'serviceWorker' in navigator?'✅ Є':'❌ Немає'}</div>
  </div>`;
  if(btn) btn.disabled=standalone;
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

async function loadTelegramMe(){
  let box=document.getElementById('telegramMeBox');
  if(!box)return;
  let d=await jget('/api/telegram/me');
  let a=document.getElementById('telegramConnectBtn');
  if(a){
    if(d.link_url){a.href=d.link_url; a.style.display='inline-flex'}
    else{a.href='#'; a.style.display='none'}
  }
  box.innerHTML=`<div class="dashboard-grid">
    <div class="dashboard-box"><b>Bot</b><br>${d.bot_username?'@'+d.bot_username:'⚠️ Додай TELEGRAM_BOT_USERNAME в Render'}</div>
    <div class="dashboard-box"><b>Chat ID</b><br>${d.telegram_chat_id||'не підключено'}</div>
    <div class="dashboard-box"><b>Username</b><br>${d.telegram_username||'—'}</div>
    <div class="dashboard-box"><b>Статус</b><br>${d.telegram_enabled?'✅ Увімкнено':'⚠️ Вимкнено'}</div>
  </div>`;
  const s=d.settings||{};
  const set=(id,v)=>{let el=document.getElementById(id); if(el)el.checked=!!v};
  set('tg_set_enabled',d.telegram_enabled);
  set('tg_set_new_requests',s.new_requests);
  set('tg_set_critical',s.critical);
  set('tg_set_expiring',s.expiring);
  set('tg_set_reactions',s.reactions);
  set('tg_set_backups',s.backups);
}
async function saveTelegramMeSettings(){
  let get=id=>{let el=document.getElementById(id); return !!(el&&el.checked)};
  let r=await jpost('/api/telegram/me/settings',{
    telegram_enabled:get('tg_set_enabled'),
    new_requests:get('tg_set_new_requests'),
    critical:get('tg_set_critical'),
    expiring:get('tg_set_expiring'),
    reactions:get('tg_set_reactions'),
    backups:get('tg_set_backups')
  });
  toast(r.ok?'✅ Telegram налаштування збережено':(r.error||'Помилка'), r.ok?'good':'warn');
  loadTelegramMe();
}
async function testMyTelegram(){
  let r=await jpost('/api/telegram/me/test',{});
  toast(r.ok?'✅ Повідомлення відправлено':'⚠️ '+(r.response||r.error||'Telegram не підключено'), r.ok?'good':'warn');
}
async function pollTelegram(){
  let r=await jpost('/api/telegram/poll',{});
  toast(r.ok?'✅ Telegram синхронізовано. Оброблено: '+(r.processed||0):'⚠️ '+(r.error||'Помилка'), r.ok?'good':'warn');
  loadTelegramMe();
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
document.addEventListener('DOMContentLoaded',()=>{setTimeout(()=>{loadDashboardPro&&loadDashboardPro();},800)});


// V5.9.6 Role UI Clean
const ROLE_SECTION_MAP={
  admin:["dashboard","stock","requests","reports","users","telegram","pwa","monitor","audit","maintenance","barcode","traceability","incompat","dashboardPro","temperature","writeoff","dailyReport"],
  transfusion:["dashboard","stock","requests","reports","users","telegram","pwa","monitor","audit","maintenance","barcode","traceability","incompat","dashboardPro","temperature","writeoff","dailyReport"],
  doctor:["dashboard","requests","patients","history","telegram","pwa"],
  nurse:["dashboard","requests","stock","barcode","traceability","temperature","telegram","pwa"]
};
function roleCleanSectionKey(id){
  id=(id||'').toLowerCase();
  if(id.includes('monitor')||id.includes('health')||id.includes('maintenance'))return 'monitor';
  if(id.includes('audit'))return 'audit';
  if(id.includes('user'))return 'users';
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
      if(txt.includes('database')||txt.includes('backup age')||txt.includes('maintenance')||txt.includes('rollback')||txt.includes('audit xlsx')||txt.includes('audit csv')){
        el.classList.add('role-hidden');
      }
    });
  }
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(roleCleanApply,800));
