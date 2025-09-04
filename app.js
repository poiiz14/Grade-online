/* ===================== CONFIG & JSONP ===================== */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

// JSONP with timeout + retries
function callAPI(action, data = {}, { timeoutMs = 30000, retries = 2, backoffMs = 800 } = {}) {
  function once(timeout) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const payload = encodeURIComponent(JSON.stringify(data || {}));
      const s = document.createElement('script');

      const cleanup = () => {
        try { delete window[cb]; } catch {}
        try { s.remove(); } catch {}
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`API timeout: ${action}`)); }, timeout);

      window[cb] = (resp) => { clearTimeout(timer); cleanup(); resolve(resp); };
      s.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error(`API network error: ${action}`)); };
      s.src = `${API_BASE}?action=${encodeURIComponent(action)}&data=${payload}&callback=${cb}`;
      document.body.appendChild(s);
    });
  }

  return new Promise(async (resolve, reject) => {
    let attempt = 0, lastErr;
    while (attempt <= retries) {
      try { return resolve(await once(timeoutMs)); }
      catch (e) { lastErr = e; attempt++; if (attempt > retries) break; await new Promise(r => setTimeout(r, backoffMs * attempt)); }
    }
    reject(lastErr);
  });
}
//กล่องเปลี่ยนรหัส + เรียก API//
async function openChangePasswordDialog() {
  const role = (currentUserType || '').toLowerCase();
  if (!['admin','advisor'].includes(role)) {
    Swal.fire({ icon:'warning', title:'ไม่สามารถใช้งานได้', text:'นักศึกษาไม่สามารถเปลี่ยนรหัสผ่านในระบบนี้' });
    return;
  }
  const email = (currentUser?.email || '').trim();
  if (!email) {
    Swal.fire({ icon:'error', title:'ไม่พบอีเมลผู้ใช้', text:'บัญชีนี้ไม่มีอีเมลในระบบ' });
    return;
  }

  const { value: formValues } = await Swal.fire({
    title: 'เปลี่ยนรหัสผ่าน',
    html:
      `<div class="text-left">
        <div class="mb-2"><b>อีเมล:</b> ${email}</div>
        <input id="cp-old" class="swal2-input" placeholder="รหัสผ่านเดิม" type="password">
        <input id="cp-new" class="swal2-input" placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)" type="password">
        <input id="cp-new2" class="swal2-input" placeholder="ยืนยันรหัสผ่านใหม่" type="password">
      </div>`,
    focusConfirm: false,
    confirmButtonText: 'บันทึก',
    cancelButtonText: 'ยกเลิก',
    showCancelButton: true,
    preConfirm: () => {
      const oldPw = document.getElementById('cp-old').value.trim();
      const newPw = document.getElementById('cp-new').value.trim();
      const newPw2 = document.getElementById('cp-new2').value.trim();
      if (!oldPw || !newPw || !newPw2) {
        Swal.showValidationMessage('กรอกข้อมูลให้ครบ');
        return false;
      }
      if (newPw.length < 6) {
        Swal.showValidationMessage('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
        return false;
      }
      if (newPw !== newPw2) {
        Swal.showValidationMessage('รหัสผ่านใหม่และยืนยันไม่ตรงกัน');
        return false;
      }
      return { oldPw, newPw };
    }
  });

  if (!formValues) return;

  try {
    Swal.fire({ title:'กำลังบันทึก...', showConfirmButton:false, allowOutsideClick:false, didOpen:() => Swal.showLoading() });
    const resp = await callAPI('changePassword', {
      userType: role,
      email: email,
      oldPassword: formValues.oldPw,
      newPassword: formValues.newPw
    }, { timeoutMs: 45000, retries: 1 });

    if (!resp?.success) throw new Error(resp?.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    Swal.fire({ icon:'success', title:'สำเร็จ', text:'เปลี่ยนรหัสผ่านเรียบร้อย' });
  } catch (e) {
    Swal.fire({ icon:'error', title:'ไม่สำเร็จ', text: e.message || 'เกิดข้อผิดพลาด' });
  }
}
/* ===================== GLOBAL STATE ===================== */
let currentUser = null;
let currentUserType = null;

let studentsData = [];
let gradesData = [];
let englishTestData = [];
let advisorsData = [];

// pagination
let currentStudentsPage = 1;
let currentGradesPage = 1;
const studentsPerPage = 20;
const gradesPerPage = 10;

// charts
let _studentsChart = null;
let _englishChart  = null;

/* ===================== BOOTSTRAP (1 call ครบ) ===================== */
async function ensureDataLoadedForRole(roleKey) {
  const resp = await callAPI('bootstrap', { userType: roleKey, user: currentUser }, { timeoutMs: 45000, retries: 2 });
  if (!resp?.success || !resp?.data) throw new Error(resp?.message || 'โหลดข้อมูลไม่สำเร็จ');

  studentsData     = Array.isArray(resp.data.students)     ? resp.data.students     : [];
  gradesData       = Array.isArray(resp.data.grades)       ? resp.data.grades       : [];
  englishTestData  = Array.isArray(resp.data.englishTests) ? resp.data.englishTests : [];
  advisorsData     = Array.isArray(resp.data.advisors)     ? resp.data.advisors     : [];
}

/* ===================== LOGIN / AUTO-LOGIN ===================== */
async function login() {
  const userType = document.getElementById('userType')?.value || 'admin';
  let credentials = {};
  if (userType === 'admin') {
    credentials.email    = (document.getElementById('adminEmail')?.value || '').trim();
    credentials.password = (document.getElementById('adminPassword')?.value || '').trim();
  } else if (userType === 'student') {
    const raw = (document.getElementById('studentId')?.value || '').trim();
    credentials.citizenId = raw.replace(/\s|-/g, '');
  } else if (userType === 'advisor') {
    credentials.email    = (document.getElementById('advisorEmail')?.value || '').trim();
    credentials.password = (document.getElementById('advisorPassword')?.value || '').trim();
  }

  try {
    Swal.fire({
    title: 'กำลังเข้าสู่ระบบ...',
    allowOutsideClick: false,
    showConfirmButton: false,   // << ซ่อนปุ่ม OK
    didOpen: () => Swal.showLoading()
  });
    const resp = await callAPI('authenticate', { userType, credentials }, { timeoutMs: 45000, retries: 2 });
    if (!resp?.success || !resp?.data) throw new Error(resp?.message || 'ข้อมูลการเข้าสู่ระบบไม่ถูกต้อง');

    currentUser = resp.data; currentUserType = userType;
    try { localStorage.setItem('currentUser', JSON.stringify(resp.data)); localStorage.setItem('currentUserType', userType); } catch {}

    Swal.update({ title: 'กำลังโหลดข้อมูล...', html: 'โปรดรอสักครู่', didOpen: () => Swal.showLoading() });
    await ensureDataLoadedForRole(userType);

    if (Swal.isVisible()) Swal.close();
    showDashboard();
  } catch (err) {
    if (Swal.isVisible()) Swal.close();
    Swal.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text: err.message || 'ไม่สามารถเข้าสู่ระบบได้' });
  }
}
window.login = login;

document.addEventListener('DOMContentLoaded', async function () {
  const savedUser = localStorage.getItem('currentUser');
  const savedUserType = localStorage.getItem('currentUserType');

  if (savedUser && savedUserType) {
    currentUser = JSON.parse(savedUser); currentUserType = savedUserType;
    try {
      Swal.fire({
      title: 'กำลังเตรียมข้อมูล...',
      allowOutsideClick: false,
      showConfirmButton: false,   // << ซ่อนปุ่ม OK
      didOpen: () => Swal.showLoading()
    });
      await ensureDataLoadedForRole(currentUserType);
      if (Swal.isVisible()) Swal.close();
      showDashboard();
    } catch (e) {
      if (Swal.isVisible()) Swal.close();
      document.getElementById('loginScreen')?.classList.remove('hidden');
      document.getElementById('dashboard')?.classList.add('hidden');
    }
  } 
  // ซ่อน/แสดงปุ่มตามบทบาทหลังแสดงแดชบอร์ด
  document.getElementById('changePasswordBtn')?.addEventListener('click', openChangePasswordDialog);
  // handlers
  document.getElementById('userType')?.addEventListener('change', function () {
    const t = this.value;
    document.getElementById('adminLogin')?.classList.toggle('hidden', t !== 'admin');
    document.getElementById('studentLogin')?.classList.toggle('hidden', t !== 'student');
    document.getElementById('advisorLogin')?.classList.toggle('hidden', t !== 'advisor');
  });

  document.getElementById('searchStudent')?.addEventListener('input', filterStudents);
  document.getElementById('yearFilter')?.addEventListener('change', filterStudents);
  document.getElementById('searchGrade')?.addEventListener('input', filterGrades);

  // เปลี่ยนปีในหน้าเกรด (admin) → lazy load
  document.getElementById('gradeYearFilter')?.addEventListener('change', async function () {
    const y = this.value;
    if (y) await lazyLoadGradesForYear(y);
    filterGrades();
  });
});

/* ===================== DASHBOARD ===================== */
function showDashboard() {
  const user = currentUser || {};
  let roleKey = (currentUserType || user.role || '').trim().toLowerCase();

  // ชื่อ/บทบาท
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  if (nameEl) nameEl.textContent = user.name || user.fullName || user.email || '-';
  if (roleEl) roleEl.textContent = roleKey === 'admin' ? 'ผู้ดูแลระบบ' : roleKey === 'advisor' ? 'อาจารย์ที่ปรึกษา' : roleKey === 'student' ? 'นักศึกษา' : '-';
  
  const cpBtn = document.getElementById('changePasswordBtn');
  if (cpBtn) cpBtn.classList.toggle('hidden', !['admin','advisor'].includes((currentUserType||'').toLowerCase()));

  // layout
  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('dashboard')?.classList.remove('hidden');
  document.getElementById('adminDashboard')?.classList.add('hidden');
  document.getElementById('studentDashboard')?.classList.add('hidden');
  document.getElementById('advisorDashboard')?.classList.add('hidden');

  if (roleKey === 'admin') {
    document.getElementById('adminDashboard')?.classList.remove('hidden');
    setTimeout(() => { try { showAdminSection('overview'); } catch(e){} }, 0);
  } else if (roleKey === 'student') {
    document.getElementById('studentDashboard')?.classList.remove('hidden');
    setTimeout(() => { try { loadStudentData(); } catch(e){} }, 0);
  } else if (roleKey === 'advisor') {
    document.getElementById('advisorDashboard')?.classList.remove('hidden');
    setTimeout(() => { try { loadAdvisorData(); } catch(e){} }, 0);
  } else {
    document.getElementById('dashboard')?.classList.add('hidden');
    document.getElementById('loginScreen')?.classList.remove('hidden');
  }
}

function logout() {
  localStorage.removeItem('currentUser'); localStorage.removeItem('currentUserType');
  currentUser = null; currentUserType = null;
  document.getElementById('loginScreen')?.classList.remove('hidden');
  document.getElementById('dashboard')?.classList.add('hidden');
}

/* ===================== ADMIN: NAV & LOAD ===================== */
async function showAdminSection(section, el) {
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.classList.remove('border-blue-500','text-blue-600'); btn.classList.add('border-transparent','text-gray-500');
  });
  if (el) { el.classList.remove('border-transparent','text-gray-500'); el.classList.add('border-blue-500','text-blue-600'); }

  document.querySelectorAll('.admin-section').forEach(sec => sec.classList.add('hidden'));
  document.getElementById(`admin${section.charAt(0).toUpperCase()+section.slice(1)}`)?.classList.remove('hidden');

  // ข้อมูลควรพร้อมจาก bootstrap แล้ว แต่กันพลาดถ้าไม่มี
  if (!studentsData.length || !englishTestData.length) {
    try { await ensureDataLoadedForRole('admin'); } catch (e) { console.warn(e); }
  }

  if (section === 'overview')   loadOverviewData();
  if (section === 'students')   loadStudentsData();
  if (section === 'grades')     loadGradesData();
  if (section === 'individual') loadIndividualData();
}

// bootstrap แยก (ใช้ในบางกรณี)
async function lazyLoadGradesForYear(year) {
  if (!year) return;
  try {
    Swal.fire({
    title: 'กำลังโหลดเกรดปี ' + year,
    allowOutsideClick: false,
    showConfirmButton: false,   // << ซ่อนปุ่ม OK
    didOpen: () => Swal.showLoading()
  });
    const resp = await callAPI('getGradesByYear', { year }, { timeoutMs: 45000, retries: 2 });
    if (!resp?.success || !Array.isArray(resp.data)) throw new Error(resp?.message || 'โหลดเกรดไม่สำเร็จ');
    gradesData = resp.data;
  } finally { if (Swal.isVisible()) Swal.close(); }
}

/* ===================== OVERVIEW (ADMIN) ===================== */
function loadOverviewData() {
  const totalStudents = studentsData.length;
  const studentsByYear = [0,0,0,0];
  studentsData.forEach(s => { if (s.year>=1 && s.year<=4) studentsByYear[s.year-1]++; });

  const englishStats = (() => {
    const total = englishTestData.length;
    const passed = englishTestData.filter(t => t.status === 'ผ่าน').length;
    const failed = total - passed;
    return {
      passed, failed,
      passedPercent: total ? Math.round(passed*100/total) : 0,
      failedPercent: total ? Math.round(failed*100/total) : 0
    };
  })();

  const subjects = new Set(); gradesData.forEach(g => subjects.add(g.subjectCode));
  const totalSubjects = subjects.size;

  document.getElementById('totalStudents').textContent = totalStudents;
  document.getElementById('passedEnglish').textContent = `${englishStats.passedPercent}% (${englishStats.passed})`;
  document.getElementById('failedEnglish').textContent = `${englishStats.failedPercent}% (${englishStats.failed})`;
  document.getElementById('totalSubjects').textContent = totalSubjects;

  // วาดหลัง DOM พร้อม → หน้าเปลี่ยนไวขึ้น
  requestAnimationFrame(() => {
    updateStudentsChart(studentsByYear);
    updateEnglishChart(englishStats);
  });
}
function updateStudentsChart(arr) {
  const cvs = document.getElementById('studentsChart'); if (!cvs) return;
  const ctx = cvs.getContext('2d'); if (_studentsChart) _studentsChart.destroy();
  _studentsChart = new Chart(ctx, {
    type:'bar',
    data:{ labels:['ชั้นปี 1','ชั้นปี 2','ชั้นปี 3','ชั้นปี 4'], datasets:[{ data:arr, backgroundColor:['#3B82F6','#10B981','#F59E0B','#EF4444'] }] },
    options:{ responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true } } }
  });
}
function updateEnglishChart(stats) {
  const cvs = document.getElementById('englishChart'); if (!cvs) return;
  const ctx = cvs.getContext('2d'); if (_englishChart) _englishChart.destroy();
  _englishChart = new Chart(ctx, {
    type:'doughnut',
    data:{ labels:['ผ่าน','ไม่ผ่าน'], datasets:[{ data:[stats.passed, stats.failed], backgroundColor:['#10B981','#EF4444'] }] },
    options:{ responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });
}

/* ===================== STUDENTS (ADMIN) ===================== */
function loadStudentsData(){ displayStudents(); }
function getFilteredStudents() {
  const yearFilter = document.getElementById('yearFilter')?.value || '';
  const q = (document.getElementById('searchStudent')?.value || '').toLowerCase();
  return (studentsData||[]).filter(s => {
    const okYear = !yearFilter || String(s.year) === String(yearFilter);
    const hay = `${s.id||''} ${s.studentId||''} ${s.name||''}`.toLowerCase();
    const okQ = q ? hay.includes(q) : true;
    return okYear && okQ;
  });
}
function displayStudents() {
  const tbody = document.getElementById('studentsTable');
  const list = getFilteredStudents();
  const start = (currentStudentsPage-1)*studentsPerPage;
  const end = Math.min(start+studentsPerPage, list.length);
  const page = list.slice(start,end);

  tbody.innerHTML = page.map(s => `
    <tr>
      <td class="px-6 py-4 text-sm">${s.id}</td>
      <td class="px-6 py-4 text-sm">${s.name}</td>
      <td class="px-6 py-4 text-sm">ชั้นปีที่ ${s.year}</td>
      <td class="px-6 py-4 text-sm">${s.advisor||'-'}</td>
      <td class="px-6 py-4 text-sm">
        <button class="text-blue-600 mr-3" onclick="editStudent('${s.id}')"><i class="fas fa-edit"></i> แก้ไข</button>
        <button class="text-red-600" onclick="deleteStudent('${s.id}')"><i class="fas fa-trash"></i> ลบ</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('studentsStart').textContent = list.length ? (start+1) : 0;
  document.getElementById('studentsEnd').textContent   = end;
  document.getElementById('studentsTotal').textContent = list.length;
}
function filterStudents(){ currentStudentsPage = 1; displayStudents(); }
function previousStudentsPage(){ if (currentStudentsPage>1){ currentStudentsPage--; displayStudents(); } }
function nextStudentsPage(){ const totalPages = Math.ceil(getFilteredStudents().length/studentsPerPage); if (currentStudentsPage<totalPages){ currentStudentsPage++; displayStudents(); } }

/* ===================== GRADES (ADMIN) ===================== */
function applyGradesFilters(){
  const year = document.getElementById('gradeYearFilter')?.value || '';
  const q = (document.getElementById('searchGrade')?.value || '').toLowerCase();
  return (gradesData||[]).filter(g => {
    const hay = `${g.studentId||''} ${g.studentName||''} ${g.subjectCode||''} ${g.subjectName||''} ${g.semester||''}`.toLowerCase();
    const okQ = q ? hay.includes(q) : true;
    const okYear = year ? String(g.semester||'').startsWith(String(year)) : true;
    return okQ && okYear;
  });
}
function renderGradesPage(){
  const stuMap = new Map((studentsData||[]).map(s => [String(s.id||s.studentId), s]));
  const list = applyGradesFilters();
  const per = gradesPerPage;
  const totalPages = Math.max(1, Math.ceil(list.length/per));
  currentGradesPage = Math.min(Math.max(1,currentGradesPage||1), totalPages);
  const start = (currentGradesPage-1)*per, end = Math.min(start+per, list.length);
  const rows = list.slice(start,end);

  const tbody = document.getElementById('gradesTable');
  tbody.innerHTML = rows.map(g => {
    const sid = String(g.studentId||'');
    const name = g.studentName || stuMap.get(sid)?.name || '-';
    return `
      <tr>
        <td class="px-6 py-3 text-sm">${sid||'-'}</td>
        <td class="px-6 py-3 text-sm">${name}</td>
        <td class="px-6 py-3 text-sm">${g.semester||'-'}</td>
        <td class="px-6 py-3 text-sm">${(g.subjectCode||'')} ${(g.subjectName||'')}</td>
        <td class="px-6 py-3 text-sm">${g.grade||'-'}</td>
        <td class="px-6 py-3 text-sm">-</td>
      </tr>`;
  }).join('');

  document.getElementById('gradesStart').textContent = list.length ? (start+1) : 0;
  document.getElementById('gradesEnd').textContent   = end;
  document.getElementById('gradesTotal').textContent = list.length;
}
function loadGradesData(){ currentGradesPage = 1; renderGradesPage(); }
function nextGradesPage(){ currentGradesPage++; renderGradesPage(); }
function previousGradesPage(){ currentGradesPage--; renderGradesPage(); }
function filterGrades(){ currentGradesPage = 1; renderGradesPage(); }

/* ===================== INDIVIDUAL (ADMIN) ===================== */
function loadIndividualData(){
  const sel = document.getElementById('individualStudent');
  sel.innerHTML = '<option value="">เลือกนักศึกษา</option>' + (studentsData||[]).map(s => `<option value="${s.id}">${s.id} - ${s.name}</option>`).join('');
  populateAcademicYears('academicYear');
  sel.onchange = loadIndividualStudentData;
  document.getElementById('academicYear').onchange = loadIndividualStudentData;
  document.getElementById('searchIndividual').oninput = function(){
    const q = (this.value||'').toLowerCase();
    const filtered = (studentsData||[]).filter(s => (s.name||'').toLowerCase().includes(q) || String(s.id||'').toLowerCase().includes(q));
    sel.innerHTML = '<option value="">เลือกนักศึกษา</option>' + filtered.map(s => `<option value="${s.id}">${s.id} - ${s.name}</option>`).join('');
  };
}
function loadIndividualStudentData(){
  const id = document.getElementById('individualStudent').value;
  const year = document.getElementById('academicYear').value;
  if (!id) { document.getElementById('individualData').classList.add('hidden'); return; }
  const s = (studentsData||[]).find(x => x.id === id); if (!s) return;

  document.getElementById('studentName').textContent = s.name;
  document.getElementById('studentCode').textContent = s.id;
  document.getElementById('advisorName').textContent = s.advisor||'-';

  const rows = (gradesData||[]).filter(g => g.studentId===id && (!year || String(g.semester||'').startsWith(year)));
  const { gpax, totalCredits } = calculateStudentGPAX(rows);
  document.getElementById('yearGPA').textContent = (year? calculateYearGPA(rows, year) : gpax).toFixed(2);
  document.getElementById('cumulativeGPA').textContent = gpax.toFixed(2);
  document.getElementById('totalCredits').textContent = totalCredits;

  const eng = (englishTestData||[]).filter(t => t.studentId===id);
  document.getElementById('englishTestTable').innerHTML = eng.map(t => `
    <tr>
      <td class="px-4 py-2 text-sm">${t.academicYear||'-'}</td>
      <td class="px-4 py-2 text-sm">${t.attempt||'-'}</td>
      <td class="px-4 py-2 text-sm">${t.score??'-'}</td>
      <td class="px-4 py-2 text-sm"><span class="px-2 py-1 text-xs rounded-full ${t.status==='ผ่าน'?'bg-green-100 text-green-800':'bg-red-100 text-red-800'}">${t.status||'-'}</span></td>
      <td class="px-4 py-2 text-sm">${formatDate(t.examDate)}</td>
    </tr>
  `).join('');

  document.getElementById('gradesDetailTable').innerHTML = rows.map(g => `
    <tr>
      <td class="px-4 py-2 text-sm">${g.semester}</td>
      <td class="px-4 py-2 text-sm">${g.subjectCode}</td>
      <td class="px-4 py-2 text-sm">${g.subjectName}</td>
      <td class="px-4 py-2 text-sm">${g.credits}</td>
      <td class="px-4 py-2 text-sm">${g.grade}</td>
    </tr>
  `).join('');

  document.getElementById('individualData').classList.remove('hidden');
}

/* ===================== STUDENT DASHBOARD ===================== */
async function loadStudentData(){
  const myId = currentUser?.id;
  const myGrades = (gradesData||[]).filter(g => g.studentId===myId);
  const myEnglish = (englishTestData||[]).filter(t => t.studentId===myId);
  const { gpax, totalCredits } = calculateStudentGPAX(myGrades);
  const latest = myEnglish.length ? myEnglish.reduce((a,b)=> new Date(b.examDate)>new Date(a.examDate)?b:a) : null;

  document.getElementById('studentGPAX').textContent = gpax.toFixed(2);
  document.getElementById('studentCredits').textContent = totalCredits;
  document.getElementById('studentEnglishStatus').textContent = latest?.status || 'ยังไม่ได้สอบ';

  populateAcademicYears('studentAcademicYear');
  showSemester('1');
  loadStudentEnglishTests();
}
async function showSemester(sem, el){
  document.querySelectorAll('.semester-tab').forEach(t=>{ t.classList.remove('border-blue-500','text-blue-600'); t.classList.add('border-transparent','text-gray-500'); });
  if (el){ el.classList.remove('border-transparent','text-gray-500'); el.classList.add('border-blue-500','text-blue-600'); }
  loadSemesterGrades(sem);
}
function loadSemesterGrades(semester){
  const year = document.getElementById('studentAcademicYear').value;
  const myId = currentUser?.id;
  const list = (gradesData||[]).filter(g => g.studentId===myId && String(g.semester||'').startsWith(year||'') && String(g.semester||'').endsWith('/'+semester));
  document.getElementById('studentGradesTable').innerHTML = list.map(g=>`
    <tr><td class="px-4 py-2 text-sm">${g.subjectCode}</td><td class="px-4 py-2 text-sm">${g.subjectName}</td><td class="px-4 py-2 text-sm">${g.credits}</td><td class="px-4 py-2 text-sm">${g.grade}</td></tr>
  `).join('');
  document.getElementById('semesterGPA').textContent = calculateSemesterGPA(list).toFixed(2);
}
function loadStudentEnglishTests(){
  const myId = currentUser?.id;
  const list = (englishTestData||[]).filter(t => t.studentId===myId);
  document.getElementById('studentEnglishTable').innerHTML = list.map(t=>`
    <tr>
      <td class="px-4 py-2 text-sm">${t.academicYear||'-'}</td>
      <td class="px-4 py-2 text-sm">${t.attempt||'-'}</td>
      <td class="px-4 py-2 text-sm">${t.score??'-'}</td>
      <td class="px-4 py-2 text-sm"><span class="px-2 py-1 text-xs rounded-full ${t.status==='ผ่าน'?'bg-green-100 text-green-800':'bg-red-100 text-red-800'}">${t.status||'-'}</span></td>
      <td class="px-4 py-2 text-sm">${formatDate(t.examDate)}</td>
    </tr>
  `).join('');
}

/* ===================== HELPERS ===================== */
function calculateStudentGPAX(grades){ let p=0,c=0; const map={'A':4,'B+':3.5,'B':3,'C+':2.5,'C':2,'D+':1.5,'D':1,'F':0};
  (grades||[]).forEach(g=>{ if(map[g.grade]!==undefined){ p+=map[g.grade]*g.credits; c+=g.credits; }});
  return { gpax: c? p/c : 0, totalCredits: c };
}
function calculateSemesterGPA(grades){ return calculateStudentGPAX(grades).gpax; }
function calculateYearGPA(grades, year){ return calculateStudentGPAX((grades||[]).filter(g=>String(g.semester||'').startsWith(year))).gpax; }
function populateAcademicYears(selectId){ const years=['2567','2566','2565','2564']; const el=document.getElementById(selectId); if(!el) return;
  el.innerHTML = '<option value="">ทุกปีการศึกษา</option>' + years.map(y=>`<option value="${y}">${y}</option>`).join(''); }
function formatDate(d){ if(!d) return '-'; const dt=new Date(d); return isNaN(dt)? String(d) : dt.toLocaleDateString('th-TH'); }

/* ===================== PLACEHOLDERS ===================== */
function editStudent(id){ Swal.fire({ icon:'info', title:'แก้ไขข้อมูลนักศึกษา', text:`${id}` }); }
function deleteStudent(id){ Swal.fire({ icon:'warning', title:'ยืนยันการลบ', showCancelButton:true }).then(r=>{ if(r.isConfirmed){ studentsData=(studentsData||[]).filter(s=>s.id!==id); displayStudents(); loadOverviewData(); Swal.fire('ลบสำเร็จ','','success'); } }); }


