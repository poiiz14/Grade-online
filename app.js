/* ===================== CONFIG & JSONP ===================== */
/** ใส่ URL ของ Apps Script Web App ( /exec ) */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

// guard: เตือนถ้ายังไม่ใช่ /exec ที่ถูกต้อง
(function(){
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_BASE)) {
    console.error('[CONFIG] API_BASE ไม่ถูกต้อง:', API_BASE);
    alert('API_BASE ยังไม่ใช่ URL /exec ของ Apps Script');
  }
})();

/*
  JSONP with timeout + retries + verbose logging
*/
function callAPI(action, data = {}, { timeoutMs = 30000, retries = 2, backoffMs = 800 } = {}) {
  function once(timeout) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const payloadStr = JSON.stringify(data || {});
      const payload = encodeURIComponent(payloadStr);
      const s = document.createElement('script');
      const url = `${API_BASE}?action=${encodeURIComponent(action)}&payload=${payload}&callback=${cb}&_ts=${Date.now()}`;

      const cleanup = () => {
        try { delete window[cb]; } catch {}
        try { s.remove(); } catch {}
      };

      const timer = setTimeout(() => {
        console.error('[API][timeout]', { action, timeoutMs: timeout, url, data });
        cleanup();
        reject(new Error(`API timeout: ${action}`));
      }, timeout);

      window[cb] = (resp) => {
        clearTimeout(timer);
        cleanup();
        console.debug('[API][ok]', { action, url, resp });
        resolve(resp);
      };

      s.onerror = (ev) => {
        clearTimeout(timer);
        cleanup();
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
        lastErr = e;
        attempt++;
        if (attempt > retries) break;
        const wait = backoffMs * Math.pow(2, attempt - 1);
        console.warn('[API][retry]', { action, attempt, waitMs: wait, error: String(e) });
        await new Promise(r => setTimeout(r, wait));
      }
    }
    reject(lastErr || new Error(`API failed: ${action}`));
  });
}

/* ============== Loader (blocking) ============== */
function showBlockingLoader(title = 'กำลังโหลดข้อมูล...', text = 'โปรดรอสักครู่') {
  if (typeof Swal === 'undefined') return;
  Swal.fire({
    title, html: text,
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    didOpen: () => Swal.showLoading()
  });
}
function hideBlockingLoader() {
  if (typeof Swal !== 'undefined' && Swal.isVisible()) Swal.close();
}

/* ===================== Session Utils ===================== */
const SESSION_KEY = 'grade_online_session';
function saveSession(s){ try{ localStorage.setItem(SESSION_KEY, JSON.stringify(s||{})); }catch{} }
function loadSession(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||'{}'); }catch{return {}} }
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch{} }

/* ===================== Auth API ===================== */
async function authenticate(role, credentials){
  console.debug('[AUTH] start', { role, credentials: { ...credentials, password: '***' }});
  const resp = await callAPI('authenticate', { userType: role, credentials }, { timeoutMs: 30000, retries: 1 });
  console.debug('[AUTH] resp', resp);
  if (!resp?.success) throw new Error(resp?.message || 'authenticate failed');
  return resp.data; // {role,id,name,email,...}
}
async function bootstrapAll(){
  console.debug('[BOOTSTRAP] start');
  const resp = await callAPI('bootstrap', {}, { timeoutMs: 45000, retries: 1 });
  console.debug('[BOOTSTRAP] resp', resp);
  if (!resp?.success) throw new Error(resp?.message || 'bootstrap failed');
  return resp.data; // {students, grades, englishTests, advisors}
}

/* ===================== Frame helpers ===================== */
function goToDashboard() {
  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('dashboard')?.classList.remove('hidden');
}
function goToLogin() {
  document.getElementById('dashboard')?.classList.add('hidden');
  document.getElementById('loginScreen')?.classList.remove('hidden');
}
function logout(){
  clearSession();
  goToLogin();
  Swal.fire({ icon:'success', title:'ออกจากระบบแล้ว', timer:1200, showConfirmButton:false });
}

/* ===================== Login Handler ===================== */
async function handleLoginSubmit(ev){
  ev?.preventDefault?.();

  const role = document.getElementById('roleInput')?.value || 'student';
  let credentials = {};
  if (role === 'student') {
    const citizenId = (document.getElementById('studentId')?.value || '').replace(/\s|-/g,'');
    credentials = { citizenId };
  } else if (role === 'admin') {
    const email = (document.getElementById('adminEmail')?.value || '').trim();
    const password = document.getElementById('adminPassword')?.value || '';
    credentials = { email, password };
  } else if (role === 'advisor') {
    const email = (document.getElementById('advisorEmail')?.value || '').trim();
    const password = document.getElementById('advisorPassword')?.value || '';
    credentials = { email, password };
  }

  try {
    showBlockingLoader('กำลังเข้าสู่ระบบ', 'โปรดรอซักครู่...');
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

    if (role==='admin')       showAdminDashboard(data);
    else if (role==='advisor') showTeacherDashboard(data);
    else                       showStudentDashboard(data, user);
  } catch (err) {
    hideBlockingLoader();
    console.error('[LOGIN][error]', err);
    Swal.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text: String(err && err.message || err || 'Login error') });
  }
}

/* ===================== Change Password (Admin/Advisor) ===================== */
async function openChangePasswordDialog(){
  const sess = loadSession();
  if (!sess?.role || !['admin','advisor'].includes(sess.role)) {
    return Swal.fire({icon:'warning',title:'สำหรับผู้ดูแล/อาจารย์ที่ปรึกษาเท่านั้น'});
  }

  const { value: formValues } = await Swal.fire({
    title: 'เปลี่ยนรหัสผ่าน',
    html: `
      <div class="space-y-3 text-left">
        <div><label class="block text-sm mb-1">อีเมล</label>
          <input id="cp_email" class="swal2-input" placeholder="email" style="width:100%" value="${sess.email||''}">
        </div>
        <div><label class="block text-sm mb-1">รหัสผ่านเดิม</label>
          <input id="cp_old" class="swal2-input" type="password" style="width:100%">
        </div>
        <div><label class="block text-sm mb-1">รหัสผ่านใหม่</label>
          <input id="cp_new" class="swal2-input" type="password" style="width:100%">
        </div>
      </div>
    `,
    focusConfirm: false,
    preConfirm: () => ({
      email: (document.getElementById('cp_email').value || '').trim(),
      oldPw: document.getElementById('cp_old').value || '',
      newPw: document.getElementById('cp_new').value || ''
    }),
    confirmButtonText: 'บันทึก',
    showCancelButton: true,
    cancelButtonText: 'ยกเลิก'
  });

  if (!formValues) return;

  try {
    showBlockingLoader('กำลังบันทึก...', 'โปรดรอสักครู่');
    const resp = await callAPI('changepassword', {
      userType: sess.role, email: formValues.email,
      oldPassword: formValues.oldPw, newPassword: formValues.newPw
    }, { timeoutMs: 45000, retries: 1 });

    hideBlockingLoader();
    if (!resp?.success) throw new Error(resp?.message || 'change password failed');
    Swal.fire({ icon:'success', title:'สำเร็จ', text:'เปลี่ยนรหัสผ่านเรียบร้อย' });
  } catch (err) {
    hideBlockingLoader();
    console.error('[CP][error]', err);
    Swal.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text:String(err && err.message || err) });
  }
}

/* ===================== DASHBOARD RENDERERS ===================== */
// toggle main dashboards
function showOnlyDashboard(id){
  ['adminDashboard','studentDashboard','advisorDashboard'].forEach(x=>{
    document.getElementById(x)?.classList.add('hidden');
  });
  document.getElementById(id)?.classList.remove('hidden');
}

/* ---------- ADMIN ---------- */
function showAdminDashboard(data){
  showOnlyDashboard('adminDashboard');
  // default section
  showAdminSection('overview');

  // fill overview numbers
  setText('totalStudents', data.students?.length || 0);
  setText('totalSubjects', data.grades?.length || 0); // ถ้าต้องการนับรายวิชาไม่ซ้ำ ค่อยปรับ
  const passed = (data.englishTests || []).filter(r=> (r.status||'').toLowerCase()==='ผ่าน' || (r.status||'').toLowerCase()==='pass').length;
  const failed = (data.englishTests || []).length - passed;
  setText('passedEnglish', passed);
  setText('failedEnglish', failed);

  // นักศึกษาตาราง (หน้าแรก)
  renderStudentsTable(data.students || []);

  // กราฟ (optional)
  try {
    if (window.Chart) {
      renderAdminCharts(data);
    }
  } catch(e){ console.warn('Chart render skipped', e); }
}

// switch admin sections
function showAdminSection(name){
  ['adminOverview','adminStudents','adminGrades','adminIndividual'].forEach(id=>{
    document.getElementById(id)?.classList.add('hidden');
  });
  const map = {overview:'adminOverview', students:'adminStudents', grades:'adminGrades', individual:'adminIndividual'};
  const target = map[name] || 'adminOverview';
  document.getElementById(target)?.classList.remove('hidden');

  // ปรับปุ่ม nav active
  document.querySelectorAll('.admin-nav-btn').forEach(btn=>{
    btn.classList.remove('border-blue-500','text-blue-600');
    btn.classList.add('border-transparent','text-gray-600');
  });
  const buttons = {
    adminOverview: 0, adminStudents:1, adminGrades:2, adminIndividual:3
  };
  const idx = buttons[target];
  const navBtns = Array.from(document.querySelectorAll('.admin-nav-btn'));
  if (navBtns[idx]) {
    navBtns[idx].classList.add('border-blue-500','text-blue-600');
    navBtns[idx].classList.remove('text-gray-600','border-transparent');
  }
}

function renderStudentsTable(students){
  const tbody = document.getElementById('studentsTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rows = students.slice(0, 20); // แสดงตัวอย่าง 20 รายการแรก
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
  const byYear = {1:0,2:0,3:0,4:0};
  (data.students||[]).forEach(s=>{ const y=String(s.year||''); if (byYear[y]!=null) byYear[y]++; });
  const ctx1 = document.getElementById('studentsChart');
  if (ctx1) {
    new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: ['ปี1','ปี2','ปี3','ปี4'],
        datasets: [{ label: 'จำนวนนักศึกษา', data: [byYear[1],byYear[2],byYear[3],byYear[4]] }]
      }
    });
  }
  const eng = (data.englishTests||[]);
  const pass = eng.filter(r=> (r.status||'').toLowerCase()==='ผ่าน' || (r.status||'').toLowerCase()==='pass').length;
  const fail = eng.length - pass;
  const ctx2 = document.getElementById('englishChart');
  if (ctx2) {
    new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['ผ่าน','ไม่ผ่าน'],
        datasets: [{ data: [pass, fail] }]
      }
    });
  }
}

/* ---------- STUDENT ---------- */
function showStudentDashboard(data, user){
  showOnlyDashboard('studentDashboard');

  // หาข้อมูลของนักศึกษาคนนี้
  const me = (data.students||[]).find(s => (String(s.id||'') === String(user.id||'')) || (String(s.citizenId||'') === String(user.citizenId||''))) || {};
  const myGrades = (data.grades||[]).filter(g => String(g.studentId||g['รหัสนักศึกษา']||'') === String(me.id||user.id||''));
  const myEnglish = (data.englishTests||[]).filter(e => String(e.studentId||e['รหัสนักศึกษา']||'') === String(me.id||user.id||''));

  // คำนวณแบบง่าย ๆ
  const credits = myGrades.reduce((sum,g)=> sum + (+g.credits || +g['หน่วยกิต'] || 0), 0);
  setText('studentCredits', credits);

  // สถานะอังกฤษ
  const latestEng = myEnglish[0];
  setText('studentEnglishStatus', latestEng ? (latestEng.status || latestEng['สถานะ'] || '-') : '-');

  // GPAX (อย่างง่าย ถ้าต้องการสูตรเต็มค่อยปรับ)
  const gradePoint = {'A':4,'B+':3.5,'B':3,'C+':2.5,'C':2,'D+':1.5,'D':1,'F':0};
  let totalPoint=0, totalCred=0;
  myGrades.forEach(g=>{
    const cr = +g.credits || +g['หน่วยกิต'] || 0;
    const gr = (g.grade || g['เกรด'] || '').toUpperCase();
    if (gradePoint[gr]!=null) { totalPoint += gradePoint[gr]*cr; totalCred += cr; }
  });
  setText('studentGPAX', totalCred ? (totalPoint/totalCred).toFixed(2) : '-');

  // ตารางรายวิชา (ภาคล่าสุดแบบง่าย)
  renderStudentGradesTable(myGrades);
}

function renderStudentGradesTable(list){
  const tbody = document.getElementById('studentGradesTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  list.slice(0, 30).forEach(g=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm text-gray-700">${g.subjectCode || g['รหัสวิชา'] || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${g.subjectName || g['รายวิชา'] || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${g.credits || g['หน่วยกิต'] || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${g.grade || g['เกรด'] || ''}</td>
    `;
    tbody.appendChild(tr);
  });
  // ค่าเฉลี่ยเทอม (ถ้าจำแนกเทอมได้ค่อยเพิ่ม)
  setText('semesterGPA', '-');
}

/* ---------- ADVISOR (Teacher) ---------- */
function showTeacherDashboard(data){
  showOnlyDashboard('advisorDashboard');

  const sess = loadSession();
  // หานักศึกษาที่ advisor ตรงกับชื่ออาจารย์ใน session (หรือ email)
  const advisees = (data.students||[]).filter(s=>{
    const adv = (s.advisor||'').toString().trim();
    return adv && (adv === sess.name || adv.indexOf(sess.name)>=0);
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
