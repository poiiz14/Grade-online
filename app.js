/* ===================== CONFIG ===================== */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

// sanity check
(() => {
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_BASE);
  if (!ok) {
    console.error('[CONFIG] API_BASE invalid:', API_BASE);
    alert('API_BASE ยังไม่ใช่ URL /exec ของ Apps Script');
  }
})();

/* ===================== GLOBAL STATE ===================== */
let GLOBAL_DATA = {
  students: [],
  grades: [],
  englishTests: [],
  advisors: [],
};
let CURRENT_USER = null;

// quick maps (เติมตอนหลัง bootstrap)
let STUDENT_BY_ID = new Map();      // id -> student
let STUDENT_NAME_BY_ID = new Map(); // id -> name
let ENGLISH_LATEST_BY_ID = new Map();

/* ===================== UTIL ===================== */
const SESSION_KEY = 'grade_online_session';
const saveSession = (s) => { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s || {})); } catch {} };
const loadSession  = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); } catch { return {}; } };
const clearSession = () => { try { localStorage.removeItem(SESSION_KEY); } catch {} };
const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v==null?'':String(v)); };
const by = (fn) => (a,b) => (fn(a) < fn(b) ? -1 : fn(a) > fn(b) ? 1 : 0);
const toNumber = (x) => (isNaN(+x)?0:+x);

function getAcademicYearFromTerm(term){
  // term รูปแบบ "2567/1" หรือ "2567/2" หรือ "2567/ฤดูร้อน"
  if(!term) return '';
  const s = String(term).split('/')[0] || '';
  return s;
}
function getSemesterFromTerm(term){
  if(!term) return '';
  const s = String(term).split('/')[1] || '';
  if(/ฤดูร้อน/.test(s)) return '3';
  return s; // '1' | '2' | อื่นๆ
}

/* ===================== JSONP CALL ===================== */
function callAPI(action, data = {}, { timeoutMs = 30000, retries = 1, backoffMs = 800 } = {}) {
  function once(t) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const payloadStr = JSON.stringify(data || {});
      const s = document.createElement('script');
      const url = `${API_BASE}?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(payloadStr)}&callback=${cb}&_ts=${Date.now()}`;

      const cleanup = () => {
        try { delete window[cb]; } catch {}
        try { s.remove(); } catch {}
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`API timeout: ${action}`));
      }, t);

      window[cb] = (resp) => {
        clearTimeout(timer);
        cleanup();
        resolve(resp);
      };
      s.onerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error(`API network error: ${action}`));
      };
      s.src = url;
      document.body.appendChild(s);
    });
  }

  return new Promise(async (resolve, reject) => {
    let n = 0, last;
    while(n <= retries) {
      try {
        resolve(await once(timeoutMs));
        return;
      } catch(e) {
        last = e; n++;
        if(n > retries) break;
        await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, n-1)));
      }
    }
    reject(last);
  });
}

/* ===================== AUTH & BOOTSTRAP ===================== */
async function authenticate(role, credentials){
  const resp = await callAPI('authenticate', {userType: role, credentials}, {timeoutMs: 30000, retries: 1});
  if(!resp?.success) throw new Error(resp?.message || 'authenticate failed');
  return resp.data;
}
async function bootstrapAll(){
  const resp = await callAPI('bootstrap', {}, {timeoutMs: 45000});
  if(!resp?.success) throw new Error(resp?.message || 'bootstrap failed');
  return resp.data;
}

function buildIndexMaps(){
  STUDENT_BY_ID.clear();
  STUDENT_NAME_BY_ID.clear();
  ENGLISH_LATEST_BY_ID.clear();

  (GLOBAL_DATA.students||[]).forEach(s=>{
    STUDENT_BY_ID.set(String(s.id||''), s);
    STUDENT_NAME_BY_ID.set(String(s.id||''), String(s.name||''));
  });

  // latest english (ต่อคน: เลือกวันล่าสุด > attempt สูงสุด)
  const latest = {};
  (GLOBAL_DATA.englishTests||[]).forEach(r=>{
    const id = String(r.studentId||'');
    const d  = Date.parse(r.examDate||'') || 0;
    const at = Number(r.attempt||0);
    const cur = latest[id];
    if(!cur || d > cur._d || (d===cur._d && at>cur._a)){
      latest[id] = {...r, _d: d, _a: at};
    }
  });
  Object.keys(latest).forEach(k => ENGLISH_LATEST_BY_ID.set(k, latest[k]));
}

/* ===================== NAVI ===================== */
function goToDashboard(){ document.getElementById('loginScreen')?.classList.add('hidden'); document.getElementById('dashboard')?.classList.remove('hidden'); }
function goToLogin(){ document.getElementById('dashboard')?.classList.add('hidden'); document.getElementById('loginScreen')?.classList.remove('hidden'); }
function logout(){ clearSession(); goToLogin(); Swal?.fire({icon:'success',title:'ออกจากระบบแล้ว',timer:1200,showConfirmButton:false}); }

/* ===================== LOGIN ===================== */
async function handleLoginSubmit(ev){
  ev?.preventDefault?.();

  const roleSel = document.getElementById('userType');
  const role = (roleSel?.value || 'student').toLowerCase();

  let credentials = {};
  if(role === 'student'){
    const citizenId = (document.getElementById('studentId')?.value || '').replace(/\s|-/g,'');
    if(!citizenId){ Swal?.fire({icon:'warning',title:'กรอกเลขบัตรประชาชน'}); return; }
    credentials = { citizenId };
  }else if(role === 'admin'){
    const email = (document.getElementById('adminEmail')?.value || '').trim();
    const password = document.getElementById('adminPassword')?.value || '';
    if(!email || !password){ Swal?.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
    credentials = { email, password };
  }else{
    const email = (document.getElementById('advisorEmail')?.value || '').trim();
    const password = document.getElementById('advisorPassword')?.value || '';
    if(!email || !password){ Swal?.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
    credentials = { email, password };
  }

  Swal.fire({title:'กำลังเข้าสู่ระบบ',allowOutsideClick:false,showConfirmButton:false,didOpen:()=>Swal.showLoading()});
  try{
    const user = await authenticate(role, credentials);
    const data = await bootstrapAll();
    Swal.close();

    CURRENT_USER = user;
    GLOBAL_DATA = data;
    buildIndexMaps();

    saveSession({role:user.role,name:user.name,id:user.id,email:user.email||''});
    if(typeof window.updateRoleUI === 'function') window.updateRoleUI(user.role, user.name);
    goToDashboard();

    if(user.role === 'admin') showAdminDashboard();
    else if(user.role === 'advisor') showAdvisorDashboard();
    else showStudentDashboard();
  }catch(e){
    Swal.close();
    Swal?.fire({icon:'error',title:'เกิดข้อผิดพลาด',text:String(e?.message||e)});
  }
}
window.handleLoginSubmit = handleLoginSubmit;

document.addEventListener('DOMContentLoaded', () => {
  const f = document.getElementById('loginForm');
  f?.addEventListener('submit', handleLoginSubmit);
  document.querySelector('button[type="submit"]')?.addEventListener('click', e => {
    e.preventDefault();
    handleLoginSubmit(e);
  });
});

/* =================================================================== */
/* ========================= ADMIN DASHBOARD ========================= */
/* =================================================================== */

function showOnlyDashboard(id){
  ['adminDashboard','studentDashboard','advisorDashboard'].forEach(x=>document.getElementById(x)?.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}

window.showAdminSection = showAdminSection;
function showAdminDashboard(){
  showOnlyDashboard('adminDashboard');
  showAdminSection('overview');

  const { students, grades, englishTests } = GLOBAL_DATA;

  // สรุปตัวเลขบนการ์ด
  setText('totalStudents', students.length);

  // ผ่าน/ไม่ผ่าน (ผลล่าสุด)
  let pass = 0, fail = 0;
  ENGLISH_LATEST_BY_ID.forEach(r=>{
    const s = (r.status||'').toString().trim().toLowerCase();
    if(['ผ่าน','pass','passed','p'].includes(s)) pass++; else fail++;
  });
  setText('passedEnglish', pass);
  setText('failedEnglish', fail);

  // รายวิชาไม่ซ้ำ
  const setSub = new Set();
  (grades||[]).forEach(g=>{
    const key = (g.courseCode||'').trim() || (g.courseTitle||'').trim();
    if(key) setSub.add(key);
  });
  setText('totalSubjects', setSub.size);

  renderAdminCharts(students);

  // เตรียม data table (แต่ render ตาม section)
  renderAdminStudents(); // default เตรียม state + first render
}

function showAdminSection(name){
  ['adminOverview','adminStudents','adminGrades','adminIndividual'].forEach(id=>document.getElementById(id)?.classList.add('hidden'));
  const map = {overview:'adminOverview',students:'adminStudents',grades:'adminGrades',individual:'adminIndividual'};
  document.getElementById(map[name]||'adminOverview')?.classList.remove('hidden');

  // active tab UI
  document.querySelectorAll('.admin-nav-btn').forEach(btn=>{
    btn.classList.remove('border-blue-500','text-blue-600');
    btn.classList.add('border-transparent','text-gray-600');
  });
  const tabs = ['overview','students','grades','individual'];
  const idx = tabs.indexOf(name);
  const navBtns = [...document.querySelectorAll('.admin-nav-btn')];
  if(idx>=0 && navBtns[idx]){
    navBtns[idx].classList.add('border-blue-500','text-blue-600');
    navBtns[idx].classList.remove('border-transparent','text-gray-600');
  }

  // section-specific render
  if(name==='students') renderAdminStudents(true);
  if(name==='grades')   renderAdminGrades(true);
}

/* ---------- Charts (ภาพรวม) ---------- */
let _chart1, _chart2;
function renderAdminCharts(students){
  const byYear = {1:0,2:0,3:0,4:0};
  (students||[]).forEach(s=>{
    const y = String(s.year||'');
    if(byYear[y]!=null) byYear[y]++;
  });

  const c1 = document.getElementById('studentsChart');
  if(c1){
    _chart1?.destroy();
    _chart1 = new Chart(c1, {
      type: 'bar',
      data: { labels:['ปี1','ปี2','ปี3','ปี4'], datasets:[{label:'จำนวนนักศึกษา', data:[byYear[1],byYear[2],byYear[3],byYear[4]]}] },
      options: { responsive:true, maintainAspectRatio:true, aspectRatio:2.2, plugins:{legend:{display:false}} }
    });
  }

  let p=0,f=0;
  ENGLISH_LATEST_BY_ID.forEach(r=>{
    const s = (r.status||'').toString().toLowerCase();
    if(['ผ่าน','pass','passed','p'].includes(s)) p++; else f++;
  });

  const c2 = document.getElementById('englishChart');
  if(c2){
    _chart2?.destroy();
    _chart2 = new Chart(c2, {
      type: 'doughnut',
      data: { labels:['ผ่าน','ไม่ผ่าน'], datasets:[{data:[p,f]}] },
      options: { responsive:true, maintainAspectRatio:true, aspectRatio:1, plugins:{legend:{position:'bottom'}} }
    });
  }
}

/* ---------- Students (search + filter + pagination) ---------- */
const AdminStudentsState = { page:1, pageSize:50, filtered:[] };

function renderAdminStudents(initialize=false){
  const students = GLOBAL_DATA.students || [];
  if(initialize){
    // set choices ชั้นปี
    const sel = document.getElementById('adminStudentsYear');
    if(sel){
      const years = [...new Set(students.map(s=>String(s.year||'')).filter(Boolean))].sort();
      sel.innerHTML = '<option value="">ทุกชั้นปี</option>' + years.map(y=>`<option value="${y}">${y}</option>`).join('');
      sel.onchange = () => { AdminStudentsState.page=1; filterAdminStudents(); };
    }
    document.getElementById('adminStudentsSearch')?.addEventListener('input', ()=>{
      AdminStudentsState.page=1; filterAdminStudents();
    });
  }
  filterAdminStudents();
}

function filterAdminStudents(){
  const q = (document.getElementById('adminStudentsSearch')?.value || '').trim().toLowerCase();
  const y = (document.getElementById('adminStudentsYear')?.value || '').trim();

  let list = (GLOBAL_DATA.students || []).slice();
  if(y) list = list.filter(s => String(s.year||'')===y);
  if(q){
    list = list.filter(s => (String(s.name||'').toLowerCase().includes(q) || String(s.id||'').toLowerCase().includes(q)));
  }

  AdminStudentsState.filtered = list;
  renderAdminStudentsPage();
}

function renderAdminStudentsPage(){
  const { page, pageSize, filtered } = AdminStudentsState;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, totalPages);

  const start = (cur-1)*pageSize;
  const rows = filtered.slice(start, start+pageSize);

  const tb = document.getElementById('studentsTable'); if(tb){ tb.innerHTML=''; }
  rows.forEach(st=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-6 py-3 text-sm text-gray-700">${st.id||'-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.name||'-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.year||'-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.advisor||'-'}</td>`;
    tb?.appendChild(tr);
  });

  // pagination UI
  setText('adminStudentsPage', cur);
  setText('adminStudentsTotalPages', totalPages);
  const prev = document.getElementById('adminStudentsPrev');
  const next = document.getElementById('adminStudentsNext');
  prev && (prev.disabled = cur<=1);
  next && (next.disabled = cur>=totalPages);
  prev?.addEventListener('click', ()=>{ if(AdminStudentsState.page>1){ AdminStudentsState.page--; renderAdminStudentsPage(); }});
  next?.addEventListener('click', ()=>{ if(AdminStudentsState.page<totalPages){ AdminStudentsState.page++; renderAdminStudentsPage(); }});
}

/* ---------- Grades (search + filter + pagination; ซ่อนคอลัมน์ภาคการศึกษา) ---------- */
const AdminGradesState = { page:1, pageSize:50, filtered:[] };

function renderAdminGrades(initialize=false){
  if(initialize){
    // filter ชั้นปี (อิงจากข้อมูล student.year)
    const years = [...new Set((GLOBAL_DATA.students||[]).map(s=>String(s.year||'')).filter(Boolean))].sort();
    const sel = document.getElementById('adminGradesYear');
    if(sel){
      sel.innerHTML = '<option value="">ทุกชั้นปี</option>'+years.map(y=>`<option value="${y}">${y}</option>`).join('');
      sel.onchange = ()=>{ AdminGradesState.page=1; filterAdminGrades(); };
    }
    document.getElementById('adminGradesSearch')?.addEventListener('input', ()=>{
      AdminGradesState.page=1; filterAdminGrades();
    });
  }
  filterAdminGrades();
}

function filterAdminGrades(){
  // search: ชื่อ/รหัส, filter: ชั้นปี
  const q = (document.getElementById('adminGradesSearch')?.value || '').trim().toLowerCase();
  const year = (document.getElementById('adminGradesYear')?.value || '').trim();

  // enrich: add student name & year for filter
  let list = (GLOBAL_DATA.grades||[]).map(g=>{
    const st = STUDENT_BY_ID.get(String(g.studentId||'')) || {};
    return {...g, studentName: st.name || '', studentYear: st.year || ''};
  });

  if(year) list = list.filter(x => String(x.studentYear||'')===year);
  if(q){
    list = list.filter(x =>
      String(x.studentId||'').toLowerCase().includes(q) ||
      String(x.studentName||'').toLowerCase().includes(q) ||
      String(x.courseCode||'').toLowerCase().includes(q) ||
      String(x.courseTitle||'').toLowerCase().includes(q)
    );
  }

  AdminGradesState.filtered = list;
  renderAdminGradesPage();
}

function renderAdminGradesPage(){
  const { page, pageSize, filtered } = AdminGradesState;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, totalPages);
  const start = (cur-1)*pageSize;
  const rows = filtered.slice(start, start+pageSize);

  const tb = document.getElementById('gradesTable'); if(tb){ tb.innerHTML=''; }
  rows.forEach(g=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-6 py-3 text-sm text-gray-700">${g.studentId||''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.courseCode||''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.courseTitle||''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.credits||''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.grade||''}</td>`;
    tb?.appendChild(tr);
  });

  // pagination
  setText('adminGradesPage', cur);
  setText('adminGradesTotalPages', totalPages);
  const prev = document.getElementById('adminGradesPrev');
  const next = document.getElementById('adminGradesNext');
  prev && (prev.disabled = cur<=1);
  next && (next.disabled = cur>=totalPages);
  prev?.addEventListener('click', ()=>{ if(AdminGradesState.page>1){ AdminGradesState.page--; renderAdminGradesPage(); }});
  next?.addEventListener('click', ()=>{ if(AdminGradesState.page<totalPages){ AdminGradesState.page++; renderAdminGradesPage(); }});
}

/* ---------- Individual: search by name + GPA รายปี/รายภาค ---------- */
window.searchIndividualByName = function(){
  const q = (document.getElementById('adminIndividualSearch')?.value || '').trim().toLowerCase();
  if(!q) { Swal?.fire({icon:'info',title:'พิมพ์อย่างน้อย 1 ตัวอักษร'}); return; }
  const hit = (GLOBAL_DATA.students||[]).find(s => String(s.name||'').toLowerCase().includes(q));
  if(!hit){ Swal?.fire({icon:'warning',title:'ไม่พบนักศึกษาที่ตรงกับคำค้น'}); return; }
  openIndividual(String(hit.id||''));
};

window.openIndividual = function(studentId){
  // ถ้ามี adminIndividual section ให้แสดง (ทั้ง Admin/Advisor จะใช้ส่วนนี้ร่วม)
  const hasAdminInd = !!document.getElementById('adminIndividual');
  if(hasAdminInd){
    showAdminSection('individual');
  }

  const st = STUDENT_BY_ID.get(String(studentId||'')) || null;
  if(!st){
    setText('studentName','-'); setText('studentCode','-'); setText('advisorName','-');
    renderEng([], 'englishTestTable');
    renderGrades([], 'gradesDetailTable');
    renderGPA([], 'gpaSummary');
    return;
  }

  // header
  setText('studentName', st.name||'-');
  setText('studentCode', st.id||'-');
  setText('advisorName', st.advisor||'-');

  // english (ทุกครั้ง)
  const myEng = (GLOBAL_DATA.englishTests||[]).filter(e=>String(e.studentId||'')===String(st.id));
  myEng.sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0) || Number(b.attempt||0)-Number(a.attempt||0));
  renderEng(myEng, 'englishTestTable');

  // grades (แสดงชื่อวิชาให้ถูก)
  const myGrades = (GLOBAL_DATA.grades||[]).filter(g=>String(g.studentId||'')===String(st.id));
  myGrades.sort(by(g=>g.term||''));
  renderGrades(myGrades, 'gradesDetailTable');

  // GPA แยกตามปีและภาค
  renderGPA(myGrades, 'gpaSummary');
};

function renderEng(list, tableId){
  const tb = document.getElementById(tableId); if(!tb) return;
  tb.innerHTML = '';
  (list||[]).forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm">${r.academicYear||''}</td>
      <td class="px-4 py-2 text-sm">${r.attempt||''}</td>
      <td class="px-4 py-2 text-sm">${r.score||''}</td>
      <td class="px-4 py-2 text-sm">${r.status||''}</td>
      <td class="px-4 py-2 text-sm">${r.examDate||''}</td>`;
    tb.appendChild(tr);
  });
}
function renderGrades(list, tableId){
  const tb = document.getElementById(tableId); if(!tb) return;
  tb.innerHTML = '';
  (list||[]).forEach(g=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm">${g.term||''}</td>
      <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
      <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
      <td class="px-4 py-2 text-sm">${g.credits||''}</td>
      <td class="px-4 py-2 text-sm">${g.grade||''}</td>`;
    tb.appendChild(tr);
  });
}
function renderGPA(list, containerId){
  const el = document.getElementById(containerId); if(!el) return;
  const gp = {'A':4,'B+':3.5,'B':3,'C+':2.5,'C':2,'D+':1.5,'D':1,'F':0};
  // สรุปรายภาค
  const termAgg = {};
  (list||[]).forEach(g=>{
    const key = String(g.term||'');
    const c = toNumber(g.credits||0);
    const gr = String(g.grade||'').toUpperCase();
    if(gp[gr]==null) return;
    if(!termAgg[key]) termAgg[key] = {tp:0, tc:0};
    termAgg[key].tp += gp[gr]*c; termAgg[key].tc += c;
  });
  // สรุปรายปี (รวมภาคในปีเดียวกัน)
  const yearAgg = {};
  Object.keys(termAgg).forEach(term=>{
    const y = getAcademicYearFromTerm(term);
    const {tp,tc} = termAgg[term];
    if(!yearAgg[y]) yearAgg[y] = {tp:0, tc:0};
    yearAgg[y].tp += tp; yearAgg[y].tc += tc;
  });

  const termRows = Object.keys(termAgg).sort().map(k=>{
    const {tp,tc} = termAgg[k]; const gpa = tc?(tp/tc).toFixed(2):'-';
    return `<tr><td class="px-3 py-2 text-sm">${k}</td><td class="px-3 py-2 text-sm">${gpa}</td></tr>`;
  }).join('');
  const yearRows = Object.keys(yearAgg).sort().map(y=>{
    const {tp,tc} = yearAgg[y]; const gpa = tc?(tp/tc).toFixed(2):'-';
    return `<tr><td class="px-3 py-2 text-sm">${y}</td><td class="px-3 py-2 text-sm">${gpa}</td></tr>`;
  }).join('');

  el.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <h4 class="font-semibold mb-2">GPA รายภาค</h4>
        <table class="w-full"><thead class="bg-gray-50"><tr>
          <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">ภาค/ปี</th>
          <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">GPA</th>
        </tr></thead><tbody>${termRows||''}</tbody></table>
      </div>
      <div>
        <h4 class="font-semibold mb-2">GPA รายปี</h4>
        <table class="w-full"><thead class="bg-gray-50"><tr>
          <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">ปีการศึกษา</th>
          <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">GPA</th>
        </tr></thead><tbody>${yearRows||''}</tbody></table>
      </div>
    </div>`;
}

/* =================================================================== */
/* ======================== STUDENT DASHBOARD ======================== */
/* =================================================================== */
function showStudentDashboard(){
  showOnlyDashboard('studentDashboard');

  const user = CURRENT_USER || {};
  const me = STUDENT_BY_ID.get(String(user.id||'')) || {};

  const myGrades = (GLOBAL_DATA.grades||[]).filter(g=>String(g.studentId||'')===String(me.id));
  const myEng = (GLOBAL_DATA.englishTests||[]).filter(e=>String(e.studentId||'')===String(me.id));

  // สรุปรวม
  const gp = {'A':4,'B+':3.5,'B':3,'C+':2.5,'C':2,'D+':1.5,'D':1,'F':0};
  let tp=0, tc=0;
  myGrades.forEach(g=>{
    const c = toNumber(g.credits||0);
    const gr = String(g.grade||'').toUpperCase();
    if(gp[gr]!=null){ tp += gp[gr]*c; tc += c; }
  });
  setText('studentGPAX', tc?(tp/tc).toFixed(2):'-');
  setText('studentCredits', tc||0);
  const latest = ENGLISH_LATEST_BY_ID.get(String(me.id||'')); setText('studentEnglishStatus', latest?.status||'-');

  // รายปีใน select
  const years = [...new Set(myGrades.map(g=>getAcademicYearFromTerm(g.term)).filter(Boolean))].sort().reverse();
  const sel = document.getElementById('studentAcademicYear');
  if(sel){
    sel.innerHTML = '<option value="">ทุกปีการศึกษา</option>'+ years.map(y=>`<option value="${y}">${y}</option>`).join('');
    sel.onchange = ()=> updateStudentSemester();
  }

  // English table
  const etb = document.getElementById('studentEnglishTable'); if(etb){ etb.innerHTML=''; }
  myEng.sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0) || Number(b.attempt||0)-Number(a.attempt||0));
  myEng.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm">${r.academicYear||''}</td>
      <td class="px-4 py-2 text-sm">${r.attempt||''}</td>
      <td class="px-4 py-2 text-sm">${r.score||''}</td>
      <td class="px-4 py-2 text-sm">${r.status||''}</td>
      <td class="px-4 py-2 text-sm">${r.examDate||''}</td>`;
    etb?.appendChild(tr);
  });

  // tab ภาคเรียน
  window.showSemester = (sem)=>{
    document.querySelectorAll('.semester-tab').forEach(b=>b.classList.remove('border-blue-500','text-blue-600'));
    const idx = {'1':0,'2':1,'3':2}[sem] || 0;
    document.querySelectorAll('.semester-tab')[idx]?.classList.add('border-blue-500','text-blue-600');
    updateStudentSemester(sem);
  };
  showSemester('1');

  function updateStudentSemester(sem){
    const tb = document.getElementById('studentGradesTable'); if(tb){ tb.innerHTML=''; }
    let list = myGrades.slice();
    const year = document.getElementById('studentAcademicYear')?.value || '';
    if(year) list = list.filter(g => getAcademicYearFromTerm(g.term) === year);

    const active = sem || (document.querySelector('.semester-tab.border-blue-500')?.textContent || '');
    let useSem = '1';
    if(/ฤดูร้อน/.test(active) || active==='3') useSem='3';
    else if(/2/.test(active) || active==='2') useSem='2';

    list = list.filter(g => getSemesterFromTerm(g.term) === useSem || (useSem==='3' && /ฤดูร้อน/.test(String(g.term||''))));

    list.forEach(g=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
        <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
        <td class="px-4 py-2 text-sm">${g.credits||''}</td>
        <td class="px-4 py-2 text-sm">${g.grade||''}</td>`;
      tb?.appendChild(tr);
    });

    // semester GPA
    const GP = {'A':4,'B+':3.5,'B':3,'C+':2.5,'C':2,'D+':1.5,'D':1,'F':0};
    let tp=0, tc=0;
    list.forEach(g=>{ const c=toNumber(g.credits||0); const gr=(g.grade||'').toUpperCase(); if(GP[gr]!=null){tp+=GP[gr]*c; tc+=c;} });
    setText('semesterGPA', tc?(tp/tc).toFixed(2):'-');
  }
}

/* =================================================================== */
/* ======================== ADVISOR DASHBOARD ======================== */
/* =================================================================== */
function showAdvisorDashboard(){
  showOnlyDashboard('advisorDashboard');

  const sess = loadSession();
  const advisees = (GLOBAL_DATA.students||[]).filter(s=>{
    const adv = String(s.advisor||'').trim();
    return adv && (adv===sess.name || adv.includes(sess.name));
  });

  // สรุปรายชั้นปี (ปี1..ปี4)
  const y1 = advisees.filter(s=>String(s.year)==='1').length;
  const y2 = advisees.filter(s=>String(s.year)==='2').length;
  const y3 = advisees.filter(s=>String(s.year)==='3').length;
  const y4 = advisees.filter(s=>String(s.year)==='4').length;
  setText('advTotal', advisees.length);
  setText('advY1', y1); setText('advY2', y2); setText('advY3', y3); setText('advY4', y4);

  // filter ปีการศึกษา (สำหรับตารางอังกฤษ)
  const years = [...new Set((GLOBAL_DATA.grades||[])
                  .filter(g=>advisees.some(s=>String(s.id)===String(g.studentId)))
                  .map(g=>getAcademicYearFromTerm(g.term)).filter(Boolean))].sort().reverse();
  const sel = document.getElementById('advisorAcademicYear');
  if(sel){
    sel.innerHTML = '<option value="">ทุกปีการศึกษา</option>'+years.map(y=>`<option value="${y}">${y}</option>`).join('');
    sel.onchange = ()=> renderAdvisorTables();
  }

  // list นักศึกษา + ปุ่มรายละเอียด
  const list = document.getElementById('advisorStudentsList');
  if(list){ list.innerHTML=''; }
  advisees.sort(by(s=>s.id)).forEach(s=>{
    const div = document.createElement('div'); div.className='p-4';
    div.innerHTML = `<div class="flex justify-between">
      <div>
        <div class="font-medium text-gray-900">${s.name||'-'}</div>
        <div class="text-sm text-gray-500">รหัส: ${s.id||'-'} | ชั้นปี: ${s.year||'-'}</div>
      </div>
      <button class="text-blue-600 hover:underline" onclick="openIndividual('${s.id||''}')">รายละเอียด</button>
    </div>`;
    list?.appendChild(div);
  });

  renderAdvisorTables();

  function renderAdvisorTables(){
    const year = sel?.value || '';
    // ตารางสรุปอังกฤษ (ล่าสุดรายคน)
    const etb = document.getElementById('advisorEnglishTable');
    if(etb){ etb.innerHTML=''; }
    let pass=0;
    advisees.forEach(s=>{
      // find latest ของคนนี้ (ไม่บังคับปี ถ้าเลือกปี ให้แสดงเฉพาะแถวที่ latest อยู่ในปีนั้น ถ้าไม่มีปีเลือก แสดง latest ปกติ)
      const all = (GLOBAL_DATA.englishTests||[]).filter(e=>String(e.studentId||'')===String(s.id));
      if(all.length===0){
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="px-4 py-2 text-sm">${s.id||''}</td><td class="px-4 py-2 text-sm">${s.name||''}</td><td class="px-4 py-2 text-sm">-</td><td class="px-4 py-2 text-sm">-</td>`;
        etb?.appendChild(tr);
        return;
      }
      all.sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0) || Number(b.attempt||0)-Number(a.attempt||0));
      let r = all[0];
      if(year){ // filter ตามปี ถ้า latest ไม่ใช่ปีที่เลือก ให้หาแถวล่าสุดในปีนั้น
        const inYear = all.filter(x=>String(x.academicYear||'')===year);
        if(inYear.length>0) r = inYear[0];
      }
      const status = (r?.status||'').toString().toLowerCase();
      if(['ผ่าน','pass','passed','p'].includes(status)) pass++;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="px-4 py-2 text-sm">${s.id||''}</td>
                      <td class="px-4 py-2 text-sm">${s.name||''}</td>
                      <td class="px-4 py-2 text-sm">${r?.status||'-'}</td>
                      <td class="px-4 py-2 text-sm">${r?.examDate||'-'}</td>`;
      etb?.appendChild(tr);
    });
    setText('advPassLatest', pass);
  }
}

/* =================================================================== */
/* ========================== HEADER HELPERS ========================== */
/* =================================================================== */
window.updateRoleUI = function(role, name){
  setText('userName', name||'');
  setText('userRole', role==='admin' ? 'ผู้ดูแลระบบ' : (role==='advisor' ? 'อาจารย์ที่ปรึกษา' : 'นักศึกษา'));
  const showChange = (role==='admin'||role==='advisor');
  const btn = document.getElementById('changePasswordBtn');
  btn && btn.classList.toggle('hidden', !showChange);
};

