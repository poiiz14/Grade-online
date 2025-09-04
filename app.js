/* ===================== CONFIG ===================== */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

// เตือนถ้า API_BASE ไม่ใช่ /exec
(function(){
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_BASE);
  if (!ok) {
    console.error('[CONFIG] API_BASE ไม่ถูกต้อง:', API_BASE);
    alert('API_BASE ยังไม่ใช่ URL /exec ของ Apps Script');
  }
})();

/* ===================== JSONP CALLER ===================== */
function callAPI(action, data = {}, { timeoutMs = 30000, retries = 1, backoffMs = 800 } = {}) {
  function once(timeout) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const payloadStr = JSON.stringify(data || {});
      const payload = encodeURIComponent(payloadStr);
      const s = document.createElement('script');
      const url = `${API_BASE}?action=${encodeURIComponent(action)}&payload=${payload}&callback=${cb}&_ts=${Date.now()}`;

      const cleanup = () => { try{ delete window[cb]; }catch{} try{ s.remove(); }catch{} };

      const timer = setTimeout(() => {
        console.error('[API][timeout]', { action, timeoutMs: timeout, url, data });
        cleanup(); reject(new Error(`API timeout: ${action}`));
      }, timeout);

      window[cb] = (resp) => {
        clearTimeout(timer); cleanup();
        console.debug('[API][ok]', { action, resp });
        resolve(resp);
      };

      s.onerror = (ev) => {
        clearTimeout(timer); cleanup();
        console.error('[API][network-error]', { action, url, ev });
        reject(new Error(`API network error: ${action}`));
      };

      s.src = url;
      document.body.appendChild(s);
      console.debug('[API][send]', { action, url, payload: payloadStr });
    });
  }

  return new Promise(async (resolve, reject) => {
    let attempt = 0, lastErr;
    while (attempt <= retries) {
      try { return resolve(await once(timeoutMs)); }
      catch (e) {
        lastErr = e; attempt++;
        if (attempt > retries) break;
        const wait = backoffMs * Math.pow(2, attempt - 1);
        console.warn('[API][retry]', { action, attempt, waitMs: wait, error: String(e) });
        await new Promise(r => setTimeout(r, wait));
      }
    }
    reject(lastErr || new Error(`API failed: ${action}`));
  });
}

/* ===================== UI Helpers ===================== */
function showBlockingLoader(title = 'กำลังโหลด...', text = 'โปรดรอสักครู่') {
  if (!window.Swal) return;
  Swal.fire({ title, html: text, allowOutsideClick:false, allowEscapeKey:false, showConfirmButton:false, didOpen:() => Swal.showLoading() });
}
function hideBlockingLoader() { if (window.Swal?.isVisible()) Swal.close(); }

const SESSION_KEY = 'grade_online_session';
const saveSession = s => { try{ localStorage.setItem(SESSION_KEY, JSON.stringify(s||{})); }catch{} };
const loadSession = () => { try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||'{}'); }catch{ return {}; } };
const clearSession = () => { try{ localStorage.removeItem(SESSION_KEY); }catch{} };

function goToDashboard(){ document.getElementById('loginScreen')?.classList.add('hidden'); document.getElementById('dashboard')?.classList.remove('hidden'); }
function goToLogin(){ document.getElementById('dashboard')?.classList.add('hidden'); document.getElementById('loginScreen')?.classList.remove('hidden'); }
function logout(){ clearSession(); goToLogin(); Swal?.fire({icon:'success',title:'ออกจากระบบแล้ว',timer:1200,showConfirmButton:false}); }

/* ===================== API Wrappers ===================== */
async function authenticate(role, credentials){
  console.debug('[AUTH] start', { role, credentials: { ...credentials, password: '***' }});
  const resp = await callAPI('authenticate', { userType: role, credentials }, { timeoutMs: 30000, retries: 1 });
  if (!resp?.success) throw new Error(resp?.message || 'authenticate failed');
  return resp.data;
}
async function bootstrapAll(){
  const resp = await callAPI('bootstrap', {}, { timeoutMs: 45000, retries: 1 });
  if (!resp?.success) throw new Error(resp?.message || 'bootstrap failed');
  return resp.data; // {students, grades, englishTests, advisors}
}

/* ===================== LOGIN HANDLER ===================== */
async function handleLoginSubmit(ev){
  ev?.preventDefault?.();
  console.log('[LOGIN] submit triggered');

  const roleSel = document.getElementById('userType');
  const hiddenRole = document.getElementById('roleInput')?.value;
  const role = (roleSel?.value || hiddenRole || 'student').toLowerCase();

  // sync hidden
  const hidden = document.getElementById('roleInput'); if (hidden) hidden.value = role;

  let credentials = {};
  if (role === 'student') {
    const citizenId = (document.getElementById('studentId')?.value || '').replace(/\s|-/g,'');
    if (!citizenId || citizenId.length < 5) { Swal?.fire({icon:'warning',title:'กรอกเลขบัตรประชาชนให้ถูกต้อง'}); return; }
    credentials = { citizenId };
  } else if (role === 'admin') {
    const email = (document.getElementById('adminEmail')?.value || '').trim();
    const password = document.getElementById('adminPassword')?.value || '';
    if (!email || !password) { Swal?.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่านให้ครบ'}); return; }
    credentials = { email, password };
  } else if (role === 'advisor') {
    const email = (document.getElementById('advisorEmail')?.value || '').trim();
    const password = document.getElementById('advisorPassword')?.value || '';
    if (!email || !password) { Swal?.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่านให้ครบ'}); return; }
    credentials = { email, password };
  } else {
    Swal?.fire({icon:'error',title:'ประเภทผู้ใช้ไม่ถูกต้อง'}); return;
  }

  try {
    showBlockingLoader('กำลังเข้าสู่ระบบ','กำลังตรวจสอบผู้ใช้...');
    const user = await authenticate(role, credentials);
    saveSession({ role: user.role, name: user.name, id: user.id, email: user.email || '' });

    const data = await bootstrapAll();
    hideBlockingLoader();

    if (typeof window.updateRoleUI === 'function') window.updateRoleUI(user.role, user.name);
    goToDashboard();

    console.log('[READY] user & data', { user, counts:{
      students: data.students?.length||0,
      grades: data.grades?.length||0,
      englishTests: data.englishTests?.length||0,
      advisors: data.advisors?.length||0
    }});

    if (user.role==='admin') showAdminDashboard(data);
    else if (user.role==='advisor') showTeacherDashboard(data);
    else showStudentDashboard(data, user);

  } catch (err) {
    hideBlockingLoader();
    console.error('[LOGIN][error]', err);
    Swal?.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text:String(err?.message||err) });
  }
}
window.handleLoginSubmit = handleLoginSubmit;

/* bind ให้ครบทั้ง submit และปุ่ม */
document.addEventListener('DOMContentLoaded', () => {
  console.log('[BOOT] DOM ready');
  const form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', handleLoginSubmit);
    console.log('[BOOT] attach submit listener to #loginForm');
  } else {
    console.warn('[BOOT] #loginForm not found');
  }

  const loginBtn = document.querySelector('button[type="submit"], #loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', (e)=>{ e.preventDefault(); handleLoginSubmit(e); });
    console.log('[BOOT] attach click listener to login button');
  }

  // อ่าน role จาก query ?role=
  const params = new URLSearchParams(location.search);
  const qRole = (params.get('role')||'').toLowerCase();
  if (qRole) {
    const sel = document.getElementById('userType');
    if (sel) { sel.value = qRole; sel.dispatchEvent(new Event('change')); }
    const hidden = document.getElementById('roleInput'); if (hidden) hidden.value = qRole;
    console.log('[BOOT] role from query:', qRole);
  }

  // ถ้ามี session ให้แสดงชื่อ/บทบาทบน header
  const sess = loadSession();
  if (sess?.role && sess?.name && typeof window.updateRoleUI === 'function') {
    window.updateRoleUI(sess.role, sess.name);
  }
});

/* ===================== DASHBOARDS (พร้อมใช้งาน) ===================== */
function showOnlyDashboard(id){
  ['adminDashboard','studentDashboard','advisorDashboard'].forEach(x=>document.getElementById(x)?.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}

/* ---------- ADMIN ---------- */
function showAdminDashboard(data){
  showOnlyDashboard('adminDashboard');
  showAdminSection('overview'); // default

  // เติมตัวเลขภาพรวม
  setText('totalStudents', data.students?.length || 0);
  setText('totalSubjects', data.grades?.length || 0);

  const passCount = (data.englishTests||[]).filter(r=>{
    const s = (r.status || r['สถานะ'] || '').toString().trim().toLowerCase();
    return s === 'ผ่าน' || s === 'pass' || s === 'passed';
  }).length;
  const totalEng = (data.englishTests||[]).length;
  setText('passedEnglish', passCount);
  setText('failedEnglish', Math.max(totalEng - passCount, 0));

  // ตารางนักศึกษา (ตัวอย่างแสดง 20 คนแรก)
  renderStudentsTable(data.students || []);

  // กราฟ
  try { if (window.Chart) renderAdminCharts(data); } catch(e){ console.warn('Chart skipped', e); }
}

// ให้เรียกได้จาก HTML onclick
window.showAdminSection = showAdminSection;
function showAdminSection(name){
  ['adminOverview','adminStudents','adminGrades','adminIndividual'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const map = {overview:'adminOverview', students:'adminStudents', grades:'adminGrades', individual:'adminIndividual'};
  const target = map[name] || 'adminOverview';
  document.getElementById(target)?.classList.remove('hidden');

  // active tab
  document.querySelectorAll('.admin-nav-btn').forEach(btn=>{
    btn.classList.remove('border-blue-500','text-blue-600');
    btn.classList.add('border-transparent','text-gray-600');
  });
  const tabs = ['overview','students','grades','individual'];
  const idx = tabs.indexOf(name);
  const navBtns = Array.from(document.querySelectorAll('.admin-nav-btn'));
  if (idx>=0 && navBtns[idx]) {
    navBtns[idx].classList.add('border-blue-500','text-blue-600');
    navBtns[idx].classList.remove('text-gray-600','border-transparent');
  }
}

function renderStudentsTable(students){
  const tbody = document.getElementById('studentsTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rows = (students||[]).slice(0,20);
  rows.forEach(st=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-6 py-3 text-sm text-gray-700">${st.id||'-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.name||'-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.year||'-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.advisor||'-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">
        <button class="px-2 py-1 text-blue-600 hover:underline" onclick="openIndividual('${st.id||''}')">ดู</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  setText('studentsTotal', students.length || 0);
  setText('studentsStart', rows.length ? 1 : 0);
  setText('studentsEnd', rows.length);
}

function renderAdminCharts(data){
  // จำนวนนักศึกษาตามชั้นปี
  const byYear = {1:0,2:0,3:0,4:0};
  (data.students||[]).forEach(s=>{ const y = String(s.year||''); if(byYear[y]!=null) byYear[y]++; });
  const ctx1 = document.getElementById('studentsChart');
  if (ctx1) {
    new Chart(ctx1, {
      type:'bar',
      data:{ labels:['ปี1','ปี2','ปี3','ปี4'], datasets:[{ label:'จำนวนนักศึกษา', data:[byYear[1],byYear[2],byYear[3],byYear[4]] }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
  // สถิติภาษาอังกฤษ
  const eng = data.englishTests||[];
  const pass = eng.filter(r=>['ผ่าน','pass','passed'].includes((r.status||'').toString().toLowerCase())).length;
  const fail = Math.max(eng.length - pass, 0);
  const ctx2 = document.getElementById('englishChart');
  if (ctx2) {
    new Chart(ctx2, {
      type:'doughnut',
      data:{ labels:['ผ่าน','ไม่ผ่าน'], datasets:[{ data:[pass, fail] }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
}

// รายบุคคล (ปุ่ม "ดู")
window.openIndividual = function(studentId){
  showAdminSection('individual');
  // TODO: เติม logic load รายบุคคลตาม studentId หากต้องการ
};

/* ---------- STUDENT ---------- */
function showStudentDashboard(data, user){
  showOnlyDashboard('studentDashboard');

  const me = (data.students||[]).find(s => String(s.id||'')===String(user.id||'')
    || String(s.citizenId||'')===String(user.citizenId||'')) || {};

  const myGrades = (data.grades||[]).filter(g => String(g.studentId||'') === String(me.id||user.id||''));
  const myEnglish = (data.englishTests||[]).filter(e => String(e.studentId||'') === String(me.id||user.id||''));

  // หน่วยกิตสะสม
  const credits = myGrades.reduce((sum,g)=> sum + (+g.credits || 0), 0);
  setText('studentCredits', credits);

  // สถานะอังกฤษล่าสุด
  const latestEng = myEnglish[0];
  setText('studentEnglishStatus', latestEng ? (latestEng.status || '-') : '-');

  // GPAX แบบง่าย
  const gp = {'A':4,'B+':3.5,'B':3,'C+':2.5,'C':2,'D+':1.5,'D':1,'F':0};
  let tp=0, tc=0;
  myGrades.forEach(g=>{
    const cr = +g.credits || 0;
    const gr = (g.grade||'').toUpperCase();
    if (gp[gr]!=null){ tp += gp[gr]*cr; tc += cr; }
  });
  setText('studentGPAX', tc? (tp/tc).toFixed(2) : '-');

  renderStudentGradesTable(myGrades);
}
function renderStudentGradesTable(list){
  const tbody = document.getElementById('studentGradesTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  (list||[]).slice(0,30).forEach(g=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm text-gray-700">${g.courseCode || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${g.courseTitle || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${g.credits || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${g.grade || ''}</td>
    `;
    tbody.appendChild(tr);
  });
  setText('semesterGPA','-'); // ถ้าต้องการคำนวณแยกเทอมค่อยเพิ่ม
}

/* ---------- ADVISOR ---------- */
function showTeacherDashboard(data){
  showOnlyDashboard('advisorDashboard');

  const sess = loadSession();
  const advisees = (data.students||[]).filter(s=>{
    const adv = (s.advisor||'').toString().trim();
    return adv && (adv === sess.name || adv.includes(sess.name));
  });

  const list = document.getElementById('advisorStudentsList');
  if (list) {
    list.innerHTML = '';
    advisees.forEach(s=>{
      const div = document.createElement('div');
      div.className = 'p-4';
      div.innerHTML = `
        <div class="flex justify-between">
          <div>
            <div class="font-medium text-gray-900">${s.name||'-'}</div>
            <div class="text-sm text-gray-500">รหัส: ${s.id||'-'} | ชั้นปี: ${s.year||'-'}</div>
          </div>
          <button class="text-blue-600 hover:underline" onclick="openIndividual('${s.id||''}')">รายละเอียด</button>
        </div>`;
      list.appendChild(div);
    });
  }
}

/* ===================== Small helpers ===================== */
function setText(id, val){
  const el = document.getElementById(id);
  if (el) el.textContent = (val==null ? '' : String(val));
}
