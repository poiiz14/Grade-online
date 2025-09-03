/* ===== Config & JSONP helper ===== */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

function callAPI(action, data = {}) {
  return new Promise((resolve, reject) => {
    const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    const payload = encodeURIComponent(JSON.stringify(data));
    window[cb] = (resp) => { try { resolve(resp); } finally { delete window[cb]; script.remove(); } };
    script.onerror = () => { delete window[cb]; script.remove(); reject(new Error('JSONP error')); };
    script.src = `${API_BASE}?action=${encodeURIComponent(action)}&data=${payload}&callback=${cb}`;
    document.body.appendChild(script);
  });
}

/* ===== Global state ===== */
let currentUser = null;
let currentUserType = null;
let studentsData = [];
let gradesData = [];
let englishTestData = [];
let advisorsData = [];
let currentStudentsPage = 1;
let currentGradesPage = 1;
let studentsPerPage = 20;
let gradesPerPage = 10;

/* Charts (global instances) */
let _studentsChart = null;
let _englishChart  = null;

/* ===== Helpers ===== */
function getUserDisplayName(user) {
  if (!user || typeof user !== 'object') return '-';
  return user.name || user.fullName || user.displayName || user.email || user.id || '-';
}
function getRoleLabel(role, userObj) {
  if (role === 'admin') return 'ผู้ดูแลระบบ';
  if (role === 'advisor') return 'อาจารย์ที่ปรึกษา';
  if (role === 'student') return 'นักศึกษา';
  return userObj?.role || '-';
}

function getGradeColor(g) {
  // ใช้สีเขียวถ้า A/B+, เหลืองถ้ากลาง, แดงถ้า F/W/I
  const good = ['A','B+','B'];
  const mid  = ['C+','C','D+','D'];
  const bad  = ['F','W','I'];
  if (good.includes(g)) return 'text-green-700';
  if (mid.includes(g))  return 'text-yellow-700';
  if (bad.includes(g))  return 'text-red-700';
  return 'text-gray-700';
}

/* ===== Auth & Routing ===== */
async function login() {
  const userType = document.getElementById('userType')?.value || 'admin';

  let credentials = {};
  if (userType === 'admin') {
    credentials.email = (document.getElementById('adminEmail')?.value || '').trim();
    credentials.password = (document.getElementById('adminPassword')?.value || '').trim();
  } else if (userType === 'student') {
    const rawCid = (document.getElementById('studentId')?.value || '').trim();
    credentials.citizenId = rawCid.replace(/\s|-/g, '');
  } else if (userType === 'advisor') {
    credentials.email = (document.getElementById('advisorEmail')?.value || '').trim();
    credentials.password = (document.getElementById('advisorPassword')?.value || '').trim();
  }

  try {
    Swal.fire({ title: 'กำลังเข้าสู่ระบบ...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const resp = await callAPI('authenticate', { userType, credentials });
    console.log('AUTH RESP:', resp);

    if (resp && resp.success && resp.data) {
      currentUser = resp.data;
      currentUserType = userType;
      try {
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        localStorage.setItem('currentUserType', currentUserType);
      } catch (_) {}

      try {
        await loadAdminData(); // รวมโหลด students/grades/english/advisors
      } catch (err) {
        console.error('Initial load error:', err);
        await Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'เข้าสู่ระบบสำเร็จ แต่โหลดข้อมูลบางส่วนไม่ครบ' });
      }

      Swal.close();
      showDashboard();
      return;
    }

    const msg = (resp && resp.message) ? resp.message : 'ข้อมูลการเข้าสู่ระบบไม่ถูกต้อง';
    Swal.fire({ icon: 'error', title: 'เข้าสู่ระบบไม่สำเร็จ', text: msg });
  } catch (error) {
    console.error('Login error:', error);
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง' });
  }
}

function logout() {
  currentUser = null; currentUserType = null;
  localStorage.removeItem('currentUser'); localStorage.removeItem('currentUserType');
  document.getElementById('dashboard')?.classList.add('hidden');
  document.getElementById('loginScreen')?.classList.remove('hidden');
}

/* ===== Dashboard ===== */
function showDashboard() {
  const user = currentUser || {};
  const roleKey = currentUserType || '';

  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  if (nameEl) nameEl.textContent = getUserDisplayName(user);
  if (roleEl) roleEl.textContent = getRoleLabel(roleKey, user);

  const loginScreen = document.getElementById('loginScreen');
  const dashboard   = document.getElementById('dashboard');
  loginScreen && loginScreen.classList.add('hidden');
  dashboard   && dashboard.classList.remove('hidden');

  const adminDash   = document.getElementById('adminDashboard');
  const studentDash = document.getElementById('studentDashboard');
  const advisorDash = document.getElementById('advisorDashboard');
  adminDash && adminDash.classList.add('hidden');
  studentDash && studentDash.classList.add('hidden');
  advisorDash && advisorDash.classList.add('hidden');

  if (roleKey === 'admin') {
    adminDash && adminDash.classList.remove('hidden');
    setTimeout(() => { try { showAdminSection('overview'); } catch(e) { console.error(e); } }, 0);
  } else if (roleKey === 'student') {
    studentDash && studentDash.classList.remove('hidden');
    setTimeout(async () => {
      try {
        if (!Array.isArray(gradesData) || gradesData.length === 0) await loadGradesFromSheets();
        if (!Array.isArray(englishTestData) || englishTestData.length === 0) await loadEnglishTestFromSheets();
        showSemester('1');
      } catch (e) { console.error(e); }
    }, 0);
  } else if (roleKey === 'advisor') {
    advisorDash && advisorDash.classList.remove('hidden');
    setTimeout(async () => {
      try {
        if (!Array.isArray(studentsData) || studentsData.length === 0) await loadStudentsFromSheets();
        // ถ้ามีฟังก์ชัน render รายชื่อนักศึกษาในความดูแล ให้เรียกที่นี่
      } catch (e) { console.error(e); }
    }, 0);
  } else {
    dashboard && dashboard.classList.add('hidden');
    loginScreen && loginScreen.classList.remove('hidden');
  }
}

/* ===== Admin sections ===== */
async function showAdminSection(section, el) {
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.classList.remove('border-blue-500','text-blue-600');
    btn.classList.add('border-transparent','text-gray-500');
  });
  if (el) { el.classList.remove('border-transparent','text-gray-500'); el.classList.add('border-blue-500','text-blue-600'); }

  document.querySelectorAll('.admin-section').forEach(sec => sec.classList.add('hidden'));
  const targetId = `admin${section.charAt(0).toUpperCase() + section.slice(1)}`;
  document.getElementById(targetId)?.classList.remove('hidden');

  try {
    if (!studentsData.length || !gradesData.length || !englishTestData.length || !advisorsData.length) {
      await loadAdminData();
    }
  } catch (e) {
    console.error('load data error:', e);
    Swal.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text:'ไม่สามารถโหลดข้อมูลได้' });
    return;
  }

  try {
    if (section === 'overview')  loadOverviewData();
    if (section === 'students')  loadStudentsData();
    if (section === 'grades')    loadGradesData();
    if (section === 'individual') loadIndividualData();
  } catch (e) { console.error('render section error:', e); }
}

/* ===== Data loaders (call real API) ===== */
async function loadStudentsFromSheets() {
  const resp = await callAPI('getStudents', {});
  studentsData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
}
async function loadGradesFromSheets() {
  const resp = await callAPI('getGrades', {});
  gradesData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
}
async function loadEnglishTestFromSheets() {
  const resp = await callAPI('getEnglishTests', {});
  englishTestData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
}
async function loadAdvisorsFromSheets() {
  const resp = await callAPI('getAdvisors', {});
  advisorsData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
}

async function loadAdminData() {
  try {
    await Promise.all([
      loadStudentsFromSheets(),
      loadGradesFromSheets(),
      loadEnglishTestFromSheets(),
      loadAdvisorsFromSheets()
    ]);
  } catch (error) {
    console.error('Error loading admin data:', error);
    Swal.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text:'ไม่สามารถโหลดข้อมูลได้' });
  }
}

/* ===== Overview rendering ===== */
function loadOverviewData() {
  // ตัวเลขบนการ์ด
  document.getElementById('totalStudents').textContent = studentsData.length.toString();

  const passed = englishTestData.filter(r => r.status === 'ผ่าน').length;
  const failed = englishTestData.filter(r => r.status && r.status !== 'ผ่าน').length;
  document.getElementById('passedEnglish').textContent = passed.toString();
  document.getElementById('failedEnglish').textContent = failed.toString();

  const subjects = new Set(gradesData.map(g => g.subjectCode).filter(Boolean));
  document.getElementById('totalSubjects').textContent = subjects.size.toString();

  // กราฟนักศึกษาแยกชั้นปี
  const yearCount = [1,2,3,4].map(y => studentsData.filter(s => String(s.year) === String(y)).length);
  updateStudentsChart(yearCount);

  // กราฟอังกฤษ
  updateEnglishChart({ passed, failed });
}

function updateStudentsDataTable(list) {
  const tbody = document.getElementById('studentsTable');
  if (!tbody) return;
  tbody.innerHTML = list.map(st => `
    <tr>
      <td class="px-6 py-3 text-sm text-gray-900">${st.studentId || st.id || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-900">${st.name || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-900">${st.year || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-900">${st.advisor || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-900">-</td>
    </tr>`).join('');
}
function loadStudentsData() { updateStudentsDataTable(studentsData); }

function loadGradesData() {
  const tbody = document.getElementById('gradesTable');
  if (!tbody) return;
  tbody.innerHTML = (gradesData || []).slice(0, 50).map(g => `
    <tr>
      <td class="px-6 py-3 text-sm text-gray-900">${g.studentId || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-900">${g.studentName || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-900">${g.semester || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-900">${g.subjectCode || ''} ${g.subjectName || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-900 ${getGradeColor(g.grade)}">${g.grade || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-900">-</td>
    </tr>`).join('');
}

function loadIndividualData() {
  // ขึ้นอยู่กับ UI ของปอย — โค้ดนี้เป็น placeholder ให้ไม่ error
}

/* ===== Charts ===== */
function updateStudentsChart(dataArray) {
  const canvas = document.getElementById('studentsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (_studentsChart) _studentsChart.destroy();
  _studentsChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: ['ชั้นปี 1','ชั้นปี 2','ชั้นปี 3','ชั้นปี 4'],
      datasets: [{ label:'จำนวนนักศึกษา', data: Array.isArray(dataArray) ? dataArray : [0,0,0,0],
        backgroundColor: ['#3B82F6','#10B981','#F59E0B','#EF4444'] }] },
    options: { responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true } } }
  });
}

function updateEnglishChart(stats) {
  const canvas = document.getElementById('englishChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (_englishChart) _englishChart.destroy();
  const passed = stats?.passed ?? 0, failed = stats?.failed ?? 0;
  _englishChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels:['ผ่าน','ไม่ผ่าน'], datasets:[{ data:[passed, failed], backgroundColor:['#10B981','#EF4444'] }]},
    options: { responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });
}

/* ===== Student view: by semester ===== */
function calculateSemesterGPA(rows) {
  // สมมติ mapping เกรด — ปรับได้ตามเกณฑ์สถานศึกษา
  const map = { 'A':4, 'B+':3.5, 'B':3, 'C+':2.5, 'C':2, 'D+':1.5, 'D':1, 'F':0 };
  let sum = 0, credits = 0;
  rows.forEach(r => {
    const c = Number(r.credits || 0);
    const gp = map[r.grade] ?? null;
    if (gp !== null && c > 0) { sum += gp * c; credits += c; }
  });
  return credits > 0 ? sum / credits : 0;
}

function loadSemesterGrades(semester) {
  const academicYear = document.getElementById('studentAcademicYear')?.value || '';
  const semSuffix = '/' + String(semester);

  const list = Array.isArray(gradesData) ? gradesData : [];
  const currentStudentId = (currentUserType === 'student' && currentUser?.id) ? currentUser.id : null;

  const studentGrades = list.filter(grade => {
    if (!grade) return false;
    if (!grade.semester) return false;
    if (currentStudentId && grade.studentId !== currentStudentId) return false;
    const s = String(grade.semester);
    const matchesSemester = s.endsWith(semSuffix);
    const matchesYear = academicYear ? s.startsWith(String(academicYear)) : true;
    return matchesSemester && matchesYear;
  });

  const tbody = document.getElementById('studentGradesTable');
  if (tbody) {
    tbody.innerHTML = studentGrades.map(grade => `
      <tr>
        <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectCode || '-'}</td>
        <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectName || '-'}</td>
        <td class="px-4 py-2 text-sm text-gray-900">${grade.credits || '-'}</td>
        <td class="px-4 py-2 text-sm font-medium ${getGradeColor(grade.grade)}">${grade.grade || '-'}</td>
      </tr>`).join('');
  }

  const gpaEl = document.getElementById('semesterGPA');
  if (gpaEl) gpaEl.textContent = calculateSemesterGPA(studentGrades).toFixed(2);
}

/* ===== Modals (minimal) ===== */
function showAddStudentModal(){ document.getElementById('addStudentModal')?.classList.remove('hidden'); document.getElementById('addStudentModal')?.classList.add('flex'); }
function closeAddStudentModal(){ const m = document.getElementById('addStudentModal'); m?.classList.add('hidden'); m?.classList.remove('flex'); }
function showAddGradeModal(){ document.getElementById('addGradeModal')?.classList.remove('hidden'); document.getElementById('addGradeModal')?.classList.add('flex'); }
function closeAddGradeModal(){ const m = document.getElementById('addGradeModal'); m?.classList.add('hidden'); m?.classList.remove('flex'); }

/* ===== Submit handlers (call API จริง) ===== */
document.getElementById('addStudentForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    studentId: document.getElementById('newStudentId').value.trim(),
    name:      document.getElementById('newStudentName').value.trim(),
    year:      document.getElementById('newStudentYear').value,
    citizenId: document.getElementById('newStudentCitizenId').value.replace(/\s|-/g,''),
    advisor:   document.getElementById('newStudentAdvisor').value
  };
  const resp = await callAPI('addStudent', payload);
  if (resp?.success) {
    await loadStudentsFromSheets(); loadStudentsData(); closeAddStudentModal();
    Swal.fire({ icon:'success', title:'บันทึกสำเร็จ' });
  } else {
    Swal.fire({ icon:'error', title:'บันทึกล้มเหลว', text: resp?.message || 'กรุณาลองใหม่' });
  }
});

document.getElementById('addGradeForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    studentId:   document.getElementById('gradeStudentSelect').value,
    semester:    document.getElementById('gradeSemester').value.trim(),
    subjectCode: document.getElementById('gradeSubjectCode').value.trim(),
    subjectName: document.getElementById('gradeSubjectName').value.trim(),
    credits:     Number(document.getElementById('gradeCredits').value || 0),
    grade:       document.getElementById('gradeValue').value
  };
  const resp = await callAPI('addGrade', payload);
  if (resp?.success) {
    await loadGradesFromSheets(); loadGradesData(); closeAddGradeModal();
    Swal.fire({ icon:'success', title:'บันทึกสำเร็จ' });
  } else {
    Swal.fire({ icon:'error', title:'บันทึกล้มเหลว', text: resp?.message || 'กรุณาลองใหม่' });
  }
});
