// === API base & JSONP helper ===
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

// ===== JSONP helper (with timeout & retries) =====
function callAPI(action, data = {}, { timeoutMs = 30000, retries = 2, backoffMs = 800 } = {}) {
  function once(timeout) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const script = document.createElement('script');
      const payload = encodeURIComponent(JSON.stringify(data || {}));

      const cleanup = () => {
        try { delete window[cb]; } catch {}
        try { script.remove(); } catch {}
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`API timeout: ${action}`));
      }, timeout);

      window[cb] = (resp) => {
        clearTimeout(timer);
        cleanup();
        resolve(resp);
      };
      script.onerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error(`API network error: ${action}`));
      };

      script.src = `${API_BASE}?action=${encodeURIComponent(action)}&data=${payload}&callback=${cb}`;
      document.body.appendChild(script);
    });
  }
  return new Promise(async (resolve, reject) => {
    let attempt = 0, lastErr;
    while (attempt <= retries) {
      try {
        const resp = await once(timeoutMs);
        return resolve(resp);
      } catch (e) {
        lastErr = e;
        attempt++;
        if (attempt > retries) break;
        await new Promise(r => setTimeout(r, backoffMs * attempt)); // exponential-ish backoff
      }
    }
    reject(lastErr);
  });
}

// ======================== Global State ========================
let currentUser = null;
let currentUserType = null;

// Chart instances
let _studentsChart = null;
let _englishChart  = null;

// Datasets
let studentsData = [];
let gradesData = [];
let englishTestData = [];
let advisorsData = [];

// Pagination state
let currentStudentsPage = 1;
let currentGradesPage = 1;
const studentsPerPage = 20;
const gradesPerPage = 10;

// (อ้างอิงไว้เฉยๆ ใช้จริงฝั่ง GAS)
const SHEETS_CONFIG = {
  database: '1IxHHZ_I8SfUR-dgffruH5M0A4K8o6h3yDOwlZXsasIE',
  year1: '1SgfH9vNDJikq9FAU9eIHUE7kn493Rq90kWLkf25vDcM',
  year2: '1HNkU70E-mrVw20g4Qyxg-pvK_6qYBQTBOvahA9EaL64',
  year3: '1HJi3PZtfRxu6KvtJOzlB-gbA-fkX_203dhl_bhkjcxs',
  year4: '1wennsO79xTiTs_DKQwgiNvgZoXfmI-8DMR6xXwTHJv4',
  english: '1GYkqTZmvtU0GUjla477M9D3z_-i9CGd5iQj5E-inSp4'
};

// === Auto-login & initial wiring on page load ===
document.addEventListener('DOMContentLoaded', async function () {
  // ---- auto-login (ถ้ามี session เดิม) ----
  const savedUser = localStorage.getItem('currentUser');
  const savedUserType = localStorage.getItem('currentUserType');

  if (savedUser && savedUserType) {
    currentUser = JSON.parse(savedUser);
    currentUserType = savedUserType;

    try {
      Swal.fire({
        title: 'กำลังเตรียมข้อมูล...',
        html: 'โปรดรอสักครู่',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      // โหลดข้อมูลให้ครบก่อนเข้าหน้า ตามบทบาท
      await ensureDataLoadedForRole(currentUserType);

      if (Swal.isVisible()) Swal.close();
      showDashboard();  // เข้าหน้าถัดไปทันทีเมื่อโหลดครบ
    } catch (e) {
      console.warn('Auto-preload error:', e);
      if (Swal.isVisible()) Swal.close();
      // ถ้าโหลดพลาด ให้กลับหน้า login
      document.getElementById('loginScreen')?.classList.remove('hidden');
      document.getElementById('dashboard')?.classList.add('hidden');
    }
  }

  // ---- ตั้งค่า handler พื้นฐาน ----
  document.getElementById('userType')?.addEventListener('change', function () {
    const userType = this.value;
    document.getElementById('adminLogin')?.classList.toggle('hidden', userType !== 'admin');
    document.getElementById('studentLogin')?.classList.toggle('hidden', userType !== 'student');
    document.getElementById('advisorLogin')?.classList.toggle('hidden', userType !== 'advisor');
  });

  document.getElementById('searchStudent')?.addEventListener('input', filterStudents);
  document.getElementById('yearFilter')?.addEventListener('change', filterStudents);
  document.getElementById('searchGrade')?.addEventListener('input', filterGrades);
  document.getElementById('gradeYearFilter')?.addEventListener('change', filterGrades);
});

// ===== Preload datasets per-role (โหลดครบก่อนเข้า Dashboard) =====
async function preloadForAdmin() {
  // นักศึกษา, เกรด, อังกฤษ, อาจารย์ที่ปรึกษา
  await loadAdminData();
}
async function preloadForStudent() {
  // ต้องมี grade+อังกฤษของตน
  await Promise.all([
    loadGradesFromSheets(),
    loadEnglishTestFromSheets()
  ]);
}
async function preloadForAdvisor() {
  // ต้องมีรายชื่อนักศึกษา + เกรด + อังกฤษ + รายชื่ออาจารย์
  await Promise.all([
    loadStudentsFromSheets(),
    loadGradesFromSheets(),
    loadEnglishTestFromSheets(),
    loadAdvisorsFromSheets()
  ]);
}
async function ensureDataLoadedForRole(roleKey) {
  // เรียกครั้งเดียวจบ
  const resp = await callAPI('bootstrap', {
    userType: roleKey,
    user: currentUser // ต้องมี {id,name,email} อย่างน้อย
  }, { timeoutMs: 45000, retries: 2 });

  if (!resp?.success || !resp?.data) {
    throw new Error(resp?.message || 'โหลดข้อมูลไม่สำเร็จ');
  }

  // set datasets ทีเดียว
  studentsData     = Array.isArray(resp.data.students)     ? resp.data.students     : [];
  gradesData       = Array.isArray(resp.data.grades)       ? resp.data.grades       : [];
  englishTestData  = Array.isArray(resp.data.englishTests) ? resp.data.englishTests : [];
  advisorsData     = Array.isArray(resp.data.advisors)     ? resp.data.advisors     : [];
}

// ===== Login flow: authenticate -> preload datasets (blocking) -> showDashboard =====
async function login() {
  const userType = document.getElementById('userType')?.value || 'admin';

  // เก็บ credential ตามบทบาท
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
    // 1) ยืนยันตัวตน
    Swal.fire({ title: 'กำลังเข้าสู่ระบบ...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const resp = await callAPI('authenticate', { userType, credentials }, { timeoutMs: 45000, retries: 2 });

    if (!resp?.success || !resp?.data) {
      throw new Error(resp?.message || 'ข้อมูลการเข้าสู่ระบบไม่ถูกต้อง');
    }

    // 2) ตั้งค่า state
    currentUser = resp.data;
    currentUserType = userType;
    try {
      localStorage.setItem('currentUser', JSON.stringify(resp.data));
      localStorage.setItem('currentUserType', userType);
    } catch {}

    // 3) โหลดข้อมูลครบก่อนเข้าหน้า
    Swal.update({ title: 'กำลังโหลดข้อมูล...', html: 'โปรดรอสักครู่', didOpen: () => Swal.showLoading() });
    await ensureDataLoadedForRole(userType);

    // 4) แสดงแดชบอร์ด
    if (Swal.isVisible()) Swal.close();
    showDashboard();

  } catch (err) {
    console.error('Login error:', err);
    if (Swal.isVisible()) Swal.close();
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message || 'ไม่สามารถเข้าสู่ระบบได้' });
  }
}
window.login = login;

function logout() {
  localStorage.removeItem('currentUser');
  localStorage.removeItem('currentUserType');
  currentUser = null;
  currentUserType = null;

  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');

  // Reset forms
  document.querySelectorAll('input').forEach(input => input.value = '');
}

function getUserDisplayName(user) {
  if (!user || typeof user !== 'object') return '-';
  return user.name || user.fullName || user.displayName || user.email || user.id || '-';
}
function getRoleLabel(role, userObj) {
  if (role === 'admin')   return 'ผู้ดูแลระบบ';
  if (role === 'advisor') return 'อาจารย์ที่ปรึกษา';
  if (role === 'student') return 'นักศึกษา';
  return userObj?.role || '-';
}

// ===== แสดง Dashboard ตามบทบาท =====
function showDashboard() {
  const user = currentUser || {};
  let roleKey = (currentUserType || user.role || '').trim().toLowerCase();

  // อัปเดตชื่อ/บทบาท
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  if (nameEl) nameEl.textContent = user.name || user.fullName || user.email || '-';
  if (roleEl) roleEl.textContent =
    roleKey === 'admin' ? 'ผู้ดูแลระบบ' :
    roleKey === 'advisor' ? 'อาจารย์ที่ปรึกษา' :
    roleKey === 'student' ? 'นักศึกษา' : '-';

  // toggle layout
  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('dashboard')?.classList.remove('hidden');

  // hide all dashboards
  document.getElementById('adminDashboard')?.classList.add('hidden');
  document.getElementById('studentDashboard')?.classList.add('hidden');
  document.getElementById('advisorDashboard')?.classList.add('hidden');

  if (roleKey === 'admin') {
    document.getElementById('adminDashboard')?.classList.remove('hidden');
    // เปิดแท็บภาพรวมเป็นค่าเริ่มต้น
    setTimeout(() => { try { showAdminSection('overview'); } catch(e){} }, 0);
  } else if (roleKey === 'student') {
    document.getElementById('studentDashboard')?.classList.remove('hidden');
    setTimeout(() => {
      try { showSemester('1'); } catch(e){}
      try { loadStudentEnglishTests(); } catch(e){}
    }, 0);
  } else if (roleKey === 'advisor') {
    document.getElementById('advisorDashboard')?.classList.remove('hidden');
    setTimeout(() => { try { loadAdvisorData(); } catch(e){} }, 0);
  } else {
    // ไม่รู้บทบาท → กลับหน้า login
    document.getElementById('dashboard')?.classList.add('hidden');
    document.getElementById('loginScreen')?.classList.remove('hidden');
    console.warn('Unknown role key:', roleKey, 'user:', user);
  }
}

// ===== Admin: Nav + Load data =====
async function showAdminSection(section, el) {
  // อัปเดตสไตล์ปุ่ม
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.classList.remove('border-blue-500', 'text-blue-600');
    btn.classList.add('border-transparent', 'text-gray-500');
  });
  if (el) {
    el.classList.remove('border-transparent', 'text-gray-500');
    el.classList.add('border-blue-500', 'text-blue-600');
  }

  // โชว์/ซ่อน section
  document.querySelectorAll('.admin-section').forEach(sec => sec.classList.add('hidden'));
  const targetId = `admin${section.charAt(0).toUpperCase() + section.slice(1)}`;
  document.getElementById(targetId)?.classList.remove('hidden');

  // โหลดข้อมูลหากยังไม่ครบ
  try {
    const needsStudents = !Array.isArray(studentsData) || studentsData.length === 0;
    const needsGrades   = !Array.isArray(gradesData)   || gradesData.length === 0;
    const needsEnglish  = !Array.isArray(englishTestData) || englishTestData.length === 0;
    const needsAdvisors = !Array.isArray(advisorsData) || advisorsData.length === 0;
    if (needsStudents || needsGrades || needsEnglish || needsAdvisors) {
      await loadAdminData();
    }
  } catch (e) {
    console.error('load data error:', e);
    Swal?.fire?.({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถโหลดข้อมูลได้' });
    return;
  }

  // เรนเดอร์ตามส่วนที่เลือก
  try {
    if (section === 'overview'  && typeof loadOverviewData  === 'function') loadOverviewData();
    if (section === 'students'  && typeof loadStudentsData  === 'function') loadStudentsData();
    if (section === 'grades'    && typeof loadGradesData    === 'function') loadGradesData();
    if (section === 'individual'&& typeof loadIndividualData=== 'function') loadIndividualData();
  } catch (e) {
    console.error('render section error:', e);
  }
}

// โหลด datasets ทั้งหมด (admin)
async function loadAdminData() {
  const tasks = [
    (async () => { try { const r = await callAPI('getStudents', {});       studentsData    = (r?.success && Array.isArray(r.data)) ? r.data : []; } catch(e){ console.warn('getStudents fail', e);} })(),
    (async () => { try { const r = await callAPI('getGrades', {});         gradesData      = (r?.success && Array.isArray(r.data)) ? r.data : []; } catch(e){ console.warn('getGrades fail', e);} })(),
    (async () => { try { const r = await callAPI('getEnglishTests', {});   englishTestData = (r?.success && Array.isArray(r.data)) ? r.data : []; } catch(e){ console.warn('getEnglishTests fail', e);} })(),
    (async () => { try { const r = await callAPI('getAdvisors', {});       advisorsData    = (r?.success && Array.isArray(r.data)) ? r.data : []; } catch(e){ console.warn('getAdvisors fail', e);} })(),
  ];
  await Promise.allSettled(tasks);
}

// ===== Overview (Admin) =====
function loadOverviewData() {
  const totalStudents = studentsData.length;
  const studentsByYear = [0, 0, 0, 0];
  studentsData.forEach(student => {
    if (student.year >= 1 && student.year <= 4) studentsByYear[student.year - 1]++;
  });

  // English test statistics
  const englishStats = calculateEnglishStats();
  const totalSubjects = calculateTotalSubjects();

  // Update UI
  document.getElementById('totalStudents').textContent = totalStudents;
  document.getElementById('passedEnglish').textContent = `${englishStats.passedPercent}% (${englishStats.passed})`;
  document.getElementById('failedEnglish').textContent = `${englishStats.failedPercent}% (${englishStats.failed})`;
  document.getElementById('totalSubjects').textContent = totalSubjects;

  // Update charts
  requestAnimationFrame(() => {
  updateStudentsChart(studentsByYear);
  updateEnglishChart(englishStats);
});
function calculateEnglishStats() {
  const total = englishTestData.length;
  const passed = englishTestData.filter(test => test.status === 'ผ่าน').length;
  const failed = total - passed;
  return {
    passed,
    failed,
    passedPercent: total > 0 ? Math.round((passed / total) * 100) : 0,
    failedPercent: total > 0 ? Math.round((failed / total) * 100) : 0
  };
}
function calculateTotalSubjects() {
  const subjects = new Set();
  gradesData.forEach(grade => subjects.add(grade.subjectCode));
  return subjects.size;
}
function updateStudentsChart(dataArray) {
  const canvas = document.getElementById('studentsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (_studentsChart) _studentsChart.destroy();
  _studentsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['ชั้นปี 1', 'ชั้นปี 2', 'ชั้นปี 3', 'ชั้นปี 4'],
      datasets: [{ label: 'จำนวนนักศึกษา', data: Array.isArray(dataArray) ? dataArray : [0,0,0,0], backgroundColor: ['#3B82F6','#10B981','#F59E0B','#EF4444'] }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}
function updateEnglishChart(stats) {
  const canvas = document.getElementById('englishChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (_englishChart) _englishChart.destroy();
  const passed = stats?.passed ?? 0;
  const failed = stats?.failed ?? 0;
  _englishChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['ผ่าน', 'ไม่ผ่าน'], datasets: [{ data: [passed, failed], backgroundColor: ['#10B981','#EF4444'] }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });
}

// ===== Loaders (แยก) พร้อม try/catch =====
async function loadStudentsFromSheets() {
  try {
    const resp = await callAPI('getStudents', {});
    studentsData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
  } catch (e) {
    console.warn('loadStudentsFromSheets error:', e);
    studentsData = [];
  }
}
async function loadGradesFromSheets() {
  try {
    const resp = await callAPI('getGrades', {});
    gradesData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
  } catch (e) {
    console.warn('loadGradesFromSheets error:', e);
    gradesData = [];
  }
}
async function loadEnglishTestFromSheets() {
  try {
    const resp = await callAPI('getEnglishTests', {});
    englishTestData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
  } catch (e) {
    console.warn('loadEnglishTestFromSheets error:', e);
    englishTestData = [];
  }
}
async function loadAdvisorsFromSheets() {
  try {
    const resp = await callAPI('getAdvisors', {});
    advisorsData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
  } catch (e) {
    console.warn('loadAdvisorsFromSheets error:', e);
    advisorsData = [];
  }
}

// ===== Students table (Admin) =====
function loadStudentsData() {
  displayStudents();
}
function displayStudents() {
  const tbody = document.getElementById('studentsTable');
  const start = (currentStudentsPage - 1) * studentsPerPage;
  const end = start + studentsPerPage;
  const filteredStudents = getFilteredStudents();
  const pageStudents = filteredStudents.slice(start, end);

  tbody.innerHTML = pageStudents.map(student => `
    <tr>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${student.id}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${student.name}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">ชั้นปีที่ ${student.year}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${student.advisor}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <button onclick="editStudent('${student.id}')" class="text-blue-600 hover:text-blue-900 mr-3"><i class="fas fa-edit"></i> แก้ไข</button>
        <button onclick="deleteStudent('${student.id}')" class="text-red-600 hover:text-red-900"><i class="fas fa-trash"></i> ลบ</button>
      </td>
    </tr>
  `).join('');

  // Update pagination info
  document.getElementById('studentsStart').textContent = filteredStudents.length ? (start + 1) : 0;
  document.getElementById('studentsEnd').textContent = Math.min(end, filteredStudents.length);
  document.getElementById('studentsTotal').textContent = filteredStudents.length;
}
function getFilteredStudents() {
  const yearFilter = document.getElementById('yearFilter').value;
  const searchTerm = (document.getElementById('searchStudent').value || '').toLowerCase();

  return (studentsData || []).filter(student => {
    const matchesYear = !yearFilter || String(student.year) === yearFilter;
    const matchesSearch =
      !searchTerm ||
      (student.name || '').toLowerCase().includes(searchTerm) ||
      String(student.id || '').toLowerCase().includes(searchTerm) ||
      String(student.studentId || '').toLowerCase().includes(searchTerm);
    return matchesYear && matchesSearch;
  });
}
function filterStudents() { currentStudentsPage = 1; displayStudents(); }
function previousStudentsPage() {
  if (currentStudentsPage > 1) { currentStudentsPage--; displayStudents(); }
}
function nextStudentsPage() {
  const filteredStudents = getFilteredStudents();
  const totalPages = Math.ceil(filteredStudents.length / studentsPerPage);
  if (currentStudentsPage < totalPages) { currentStudentsPage++; displayStudents(); }
}

// ===== Modals & Forms (Admin) =====
function showAddStudentModal() {
  const advisorSelect = document.getElementById('newStudentAdvisor');
  advisorSelect.innerHTML = '<option value="">เลือกอาจารย์ที่ปรึกษา</option>' +
    (advisorsData || []).map(advisor => `<option value="${advisor.name}">${advisor.name}</option>`).join('');
  document.getElementById('addStudentModal').classList.remove('hidden');
  document.getElementById('addStudentModal').classList.add('flex');
}
function closeAddStudentModal() {
  document.getElementById('addStudentModal').classList.add('hidden');
  document.getElementById('addStudentModal').classList.remove('flex');
  document.getElementById('addStudentForm').reset();
}
function showAddGradeModal() {
  const studentSelect = document.getElementById('gradeStudentSelect');
  studentSelect.innerHTML = '<option value="">เลือกนักศึกษา</option>' +
    (studentsData || []).map(student => `<option value="${student.id}">${student.id} - ${student.name}</option>`).join('');
  document.getElementById('addGradeModal').classList.remove('hidden');
  document.getElementById('addGradeModal').classList.add('flex');
}
function closeAddGradeModal() {
  document.getElementById('addGradeModal').classList.add('hidden');
  document.getElementById('addGradeModal').classList.remove('flex');
  document.getElementById('addGradeForm').reset();
}

// Submit add student
document.getElementById('addStudentForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const formData = {
    id: document.getElementById('newStudentId').value.trim(),
    name: document.getElementById('newStudentName').value.trim(),
    year: parseInt(document.getElementById('newStudentYear').value, 10),
    citizenId: document.getElementById('newStudentCitizenId').value.trim(),
    advisor: document.getElementById('newStudentAdvisor').value
  };

  try {
    Swal.fire({ title: 'กำลังบันทึกข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const resp = await callAPI('addStudent', formData);
    if (resp && resp.success) {
      Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', text: 'เพิ่มข้อมูลนักศึกษาเรียบร้อยแล้ว' });
      closeAddStudentModal();
      await loadStudentsFromSheets();
      displayStudents();
      loadOverviewData();
    } else {
      throw new Error(resp && resp.message ? resp.message : 'ไม่สามารถบันทึกข้อมูลได้');
    }
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: String(error.message || error) });
  }
});

// Submit add grade
document.getElementById('addGradeForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const formData = {
    studentId: document.getElementById('gradeStudentSelect').value,
    semester: document.getElementById('gradeSemester').value.trim(),
    subjectCode: document.getElementById('gradeSubjectCode').value.trim(),
    subjectName: document.getElementById('gradeSubjectName').value.trim(),
    credits: parseInt(document.getElementById('gradeCredits').value, 10),
    grade: document.getElementById('gradeValue').value,
    date: new Date().toISOString().split('T')[0]
  };

  try {
    Swal.fire({ title: 'กำลังบันทึกข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const resp = await callAPI('addGrade', formData);
    if (resp && resp.success) {
      Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', text: 'เพิ่มผลการเรียนเรียบร้อยแล้ว' });
      closeAddGradeModal();
      await loadGradesFromSheets();
      if (!document.getElementById('adminGrades').classList.contains('hidden')) {
        loadGradesData();
      }
      loadOverviewData();
    } else {
      throw new Error(resp && resp.message ? resp.message : 'ไม่สามารถบันทึกข้อมูลได้');
    }
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: String(error.message || error) });
  }
});

// ===== Student dashboard =====
async function loadStudentData() {
  try {
    const studentGrades = (gradesData || []).filter(grade => grade.studentId === currentUser.id);
    const studentEnglish = (englishTestData || []).filter(test => test.studentId === currentUser.id);
    const { gpax, totalCredits } = calculateStudentGPAX(studentGrades);
    const englishStatus = getLatestEnglishStatus(studentEnglish);

    document.getElementById('studentGPAX').textContent = gpax.toFixed(2);
    document.getElementById('studentCredits').textContent = totalCredits;
    document.getElementById('studentEnglishStatus').textContent = englishStatus;

    populateAcademicYears('studentAcademicYear');
    showSemester('1');
    loadStudentEnglishTests();
  } catch (error) {
    console.error('Error loading student data:', error);
  }
}
function calculateStudentGPAX(grades) {
  let totalPoints = 0; let totalCredits = 0;
  const gradePoints = { 'A':4.0, 'B+':3.5, 'B':3.0, 'C+':2.5, 'C':2.0, 'D+':1.5, 'D':1.0, 'F':0.0 };
  (grades || []).forEach(grade => {
    if (gradePoints.hasOwnProperty(grade.grade)) {
      totalPoints += gradePoints[grade.grade] * grade.credits;
      totalCredits += grade.credits;
    }
  });
  const gpax = totalCredits > 0 ? totalPoints / totalCredits : 0;
  return { gpax, totalCredits };
}
function getLatestEnglishStatus(englishTests) {
  if (!englishTests?.length) return 'ยังไม่ได้สอบ';
  const latest = englishTests.reduce((acc, t) => (new Date(t.examDate) > new Date(acc.examDate) ? t : acc));
  return latest.status || '-';
}

async function showSemester(semester, el) {
  // อัปเดตสไตล์แท็บภาคเรียน
  document.querySelectorAll('.semester-tab').forEach(tab => {
    tab.classList.remove('border-blue-500', 'text-blue-600');
    tab.classList.add('border-transparent', 'text-gray-500');
  });
  if (el) {
    el.classList.remove('border-transparent', 'text-gray-500');
    el.classList.add('border-blue-500', 'text-blue-600');
  }

  // ให้แน่ใจว่า gradesData มีแล้ว (ปกติจะมีก่อนเข้าหน้าที่นี่)
  if (!Array.isArray(gradesData) || gradesData.length === 0) {
    try { await loadGradesFromSheets(); } catch (e) { console.error(e); }
  }

  // เรนเดอร์
  try { loadSemesterGrades(semester); } catch (e) { console.error('render semester error:', e); }
}
function loadSemesterGrades(semester) {
  const academicYear = document.getElementById('studentAcademicYear').value;
  const semSuffix = '/' + String(semester);

  const studentGrades = (gradesData || []).filter(grade => {
    if (!grade || !grade.semester) return false;
    const matchesStudent = grade.studentId === currentUser.id;
    const matchesSemester = String(grade.semester).endsWith(semSuffix);
    const matchesYear = academicYear ? String(grade.semester).startsWith(academicYear) : true;
    return matchesStudent && matchesSemester && matchesYear;
  });

  const tbody = document.getElementById('studentGradesTable');
  tbody.innerHTML = studentGrades.map(grade => `
    <tr>
      <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectCode}</td>
      <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectName}</td>
      <td class="px-4 py-2 text-sm text-gray-900">${grade.credits}</td>
      <td class="px-4 py-2 text-sm font-medium ${getGradeColor(grade.grade)}">${grade.grade}</td>
    </tr>
  `).join('');

  const semesterGPA = calculateSemesterGPA(studentGrades);
  document.getElementById('semesterGPA').textContent = semesterGPA.toFixed(2);
}
function calculateSemesterGPA(grades) {
  let totalPoints = 0; let totalCredits = 0;
  const gradePoints = { 'A':4.0, 'B+':3.5, 'B':3.0, 'C+':2.5, 'C':2.0, 'D+':1.5, 'D':1.0, 'F':0.0 };
  (grades || []).forEach(grade => {
    if (gradePoints.hasOwnProperty(grade.grade)) {
      totalPoints += gradePoints[grade.grade] * grade.credits;
      totalCredits += grade.credits;
    }
  });
  return totalCredits > 0 ? totalPoints / totalCredits : 0;
}
function getGradeColor(grade) {
  const colors = {
    'A':'text-green-600','B+':'text-green-500','B':'text-blue-600','C+':'text-blue-500',
    'C':'text-yellow-600','D+':'text-orange-500','D':'text-red-500','F':'text-red-600'
  };
  return colors[grade] || 'text-gray-600';
}
function loadStudentEnglishTests() {
  const myId = currentUser?.id;
  const studentEnglish = (englishTestData || []).filter(t => t.studentId === myId);
  const tbody = document.getElementById('studentEnglishTable');
  if (!tbody) return;

  tbody.innerHTML = studentEnglish.map(test => `
    <tr>
      <td class="px-4 py-2 text-sm text-gray-900">${test.academicYear || '-'}</td>
      <td class="px-4 py-2 text-sm text-gray-900">${test.attempt || '-'}</td>
      <td class="px-4 py-2 text-sm text-gray-900">${test.score ?? '-'}</td>
      <td class="px-4 py-2 text-sm">
        <span class="px-2 py-1 text-xs rounded-full ${test.status === 'ผ่าน' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${test.status || '-'}</span>
      </td>
      <td class="px-4 py-2 text-sm text-gray-900">${formatDate(test.examDate)}</td>
    </tr>
  `).join('');
}

// ===== Advisor dashboard =====
async function loadAdvisorData() {
  try {
    const advisorStudents = (studentsData || []).filter(student => student.advisor === currentUser.name);
    populateAcademicYears('advisorAcademicYear');
    displayAdvisorStudents(advisorStudents);
  } catch (error) {
    console.error('Error loading advisor data:', error);
  }
}
function displayAdvisorStudents(students) {
  const container = document.getElementById('advisorStudentsList');
  container.innerHTML = (students || []).map(student => {
    const studentGrades = (gradesData || []).filter(grade => grade.studentId === student.id);
    const studentEnglish = (englishTestData || []).filter(test => test.studentId === student.id);
    const { gpax } = calculateStudentGPAX(studentGrades);

    return `
      <div class="p-6">
        <div class="flex justify-between items-center mb-4">
          <div>
            <h4 class="text-lg font-semibold text-gray-900">${student.name}</h4>
            <p class="text-sm text-gray-600">รหัส: ${student.id} | ชั้นปีที่ ${student.year} | GPAX: ${gpax.toFixed(2)}</p>
          </div>
          <div class="flex space-x-2">
            <button onclick="showStudentGrades('${student.id}')" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">ดูผลการเรียน</button>
            <button onclick="showStudentEnglish('${student.id}')" class="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700">ดูผลสอบภาษาอังกฤษ</button>
          </div>
        </div>
        <div id="student-${student.id}-details" class="hidden">
          <div id="student-${student.id}-grades" class="mb-4"></div>
          <div id="student-${student.id}-english"></div>
        </div>
      </div>
    `;
  }).join('');
}
function showStudentGrades(studentId) {
  const detailsDiv = document.getElementById(`student-${studentId}-details`);
  const gradesDiv = document.getElementById(`student-${studentId}-grades`);

  if (detailsDiv.classList.contains('hidden')) {
    const academicYear = document.getElementById('advisorAcademicYear').value;
    const studentGrades = (gradesData || []).filter(grade => {
      const matchesStudent = grade.studentId === studentId;
      const matchesYear = !academicYear || String(grade.semester || '').startsWith(academicYear);
      return matchesStudent && matchesYear;
    });

    gradesDiv.innerHTML = `
      <h5 class="font-medium text-gray-900 mb-2">ผลการเรียน</h5>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left">ภาคการศึกษา</th>
              <th class="px-3 py-2 text-left">รหัสวิชา</th>
              <th class="px-3 py-2 text-left">ชื่อวิชา</th>
              <th class="px-3 py-2 text-left">หน่วยกิต</th>
              <th class="px-3 py-2 text-left">เกรด</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            ${studentGrades.map(grade => `
              <tr>
                <td class="px-3 py-2">${grade.semester}</td>
                <td class="px-3 py-2">${grade.subjectCode}</td>
                <td class="px-3 py-2">${grade.subjectName}</td>
                <td class="px-3 py-2">${grade.credits}</td>
                <td class="px-3 py-2 font-medium ${getGradeColor(grade.grade)}">${grade.grade}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    detailsDiv.classList.remove('hidden');
  } else {
    detailsDiv.classList.add('hidden');
  }
}
function showStudentEnglish(studentId) {
  const detailsDiv = document.getElementById(`student-${studentId}-details`);
  const englishDiv = document.getElementById(`student-${studentId}-english`);

  if (detailsDiv.classList.contains('hidden')) {
    const studentEnglish = (englishTestData || []).filter(test => test.studentId === studentId);

    englishDiv.innerHTML = `
      <h5 class="font-medium text-gray-900 mb-2">ผลสอบภาษาอังกฤษ สบช.</h5>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left">ปีการศึกษา</th>
              <th class="px-3 py-2 text-left">ครั้งที่สอบ</th>
              <th class="px-3 py-2 text-left">คะแนน</th>
              <th class="px-3 py-2 text-left">สถานะ</th>
              <th class="px-3 py-2 text-left">วันที่สอบ</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            ${(studentEnglish || []).map(test => `
              <tr>
                <td class="px-3 py-2">${test.academicYear || '-'}</td>
                <td class="px-3 py-2">${test.attempt}</td>
                <td class="px-3 py-2">${test.score}</td>
                <td class="px-3 py-2">
                  <span class="px-2 py-1 text-xs rounded-full ${test.status === 'ผ่าน' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${test.status}</span>
                </td>
                <td class="px-3 py-2">${formatDate(test.examDate)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    detailsDiv.classList.remove('hidden');
  } else {
    detailsDiv.classList.add('hidden');
  }
}

// ===== Individual (Admin) =====
function loadIndividualData() {
  const studentSelect = document.getElementById('individualStudent');
  studentSelect.innerHTML = '<option value="">เลือกนักศึกษา</option>' +
    (studentsData || []).map(student => `<option value="${student.id}">${student.id} - ${student.name}</option>`).join('');

  populateAcademicYears('academicYear');

  document.getElementById('individualStudent').addEventListener('change', loadIndividualStudentData);
  document.getElementById('academicYear').addEventListener('change', loadIndividualStudentData);
  document.getElementById('searchIndividual').addEventListener('input', function() {
    const searchTerm = (this.value || '').toLowerCase();
    const filteredStudents = (studentsData || []).filter(student =>
      (student.name || '').toLowerCase().includes(searchTerm) ||
      String(student.id || '').toLowerCase().includes(searchTerm)
    );
    studentSelect.innerHTML = '<option value="">เลือกนักศึกษา</option>' +
      filteredStudents.map(student => `<option value="${student.id}">${student.id} - ${student.name}</option>`).join('');
  });
}
function loadIndividualStudentData() {
  const studentId = document.getElementById('individualStudent').value;
  const academicYear = document.getElementById('academicYear').value;

  if (!studentId) { document.getElementById('individualData').classList.add('hidden'); return; }
  const student = (studentsData || []).find(s => s.id === studentId);
  if (!student) return;

  // Student info
  document.getElementById('studentName').textContent = student.name;
  document.getElementById('studentCode').textContent = student.id;
  document.getElementById('advisorName').textContent = student.advisor;

  // Grades
  const studentGrades = (gradesData || []).filter(grade => {
    const matchesStudent = grade.studentId === studentId;
    const matchesYear = !academicYear || String(grade.semester || '').startsWith(academicYear);
    return matchesStudent && matchesYear;
  });

  const { gpax, totalCredits } = calculateStudentGPAX(studentGrades);
  const yearGPA = academicYear ? calculateYearGPA(studentGrades, academicYear) : gpax;

  document.getElementById('yearGPA').textContent = yearGPA.toFixed(2);
  document.getElementById('cumulativeGPA').textContent = gpax.toFixed(2);
  document.getElementById('totalCredits').textContent = totalCredits;

  // English
  const studentEnglish = (englishTestData || []).filter(test => test.studentId === studentId);
  const englishTbody = document.getElementById('englishTestTable');
  englishTbody.innerHTML = (studentEnglish || []).map(test => `
    <tr>
      <td class="px-4 py-2 text-sm text-gray-900">${test.academicYear || '-'}</td>
      <td class="px-4 py-2 text-sm text-gray-900">${test.attempt}</td>
      <td class="px-4 py-2 text-sm text-gray-900">${test.score}</td>
      <td class="px-4 py-2 text-sm">
        <span class="px-2 py-1 text-xs rounded-full ${test.status === 'ผ่าน' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${test.status}</span>
      </td>
      <td class="px-4 py-2 text-sm text-gray-900">${formatDate(test.examDate)}</td>
    </tr>
  `).join('');

  // Grades detail
  const gradesTbody = document.getElementById('gradesDetailTable');
  gradesTbody.innerHTML = (studentGrades || []).map(grade => `
    <tr>
      <td class="px-4 py-2 text-sm text-gray-900">${grade.semester}</td>
      <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectCode}</td>
      <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectName}</td>
      <td class="px-4 py-2 text-sm text-gray-900">${grade.credits}</td>
      <td class="px-4 py-2 text-sm font-medium ${getGradeColor(grade.grade)}">${grade.grade}</td>
    </tr>
  `).join('');

  document.getElementById('individualData').classList.remove('hidden');
}
function calculateYearGPA(grades, year) {
  const yearGrades = (grades || []).filter(grade => String(grade.semester || '').startsWith(year));
  const { gpax } = calculateStudentGPAX(yearGrades);
  return gpax;
}

// ===== Grades table (Admin) — filter + pagination (single source of truth) =====
function applyGradesFilters() {
  const year = document.getElementById('gradeYearFilter')?.value || '';
  const q = (document.getElementById('searchGrade')?.value || '').trim().toLowerCase();

  return (gradesData || []).filter(g => {
    const hay = `${g.studentId || ''} ${g.studentName || ''} ${g.subjectCode || ''} ${g.subjectName || ''} ${g.semester || ''}`.toLowerCase();
    const okQ = q ? hay.includes(q) : true;

    // ถ้า backend ยังไม่มี year ในแต่ละแถว ให้ปล่อยผ่าน (okYear = true)
    const okYear = year ? String(g.year || g.studentYear || '') === String(year) : true;
    return okQ && okYear;
  });
}
function renderGradesPage() {
  const stuMap = new Map((studentsData || []).map(s => [String(s.id || s.studentId), s]));
  const list = applyGradesFilters();

  const perPage = gradesPerPage;
  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  currentGradesPage = Math.min(Math.max(1, currentGradesPage || 1), totalPages);
  const startIdx = (currentGradesPage - 1) * perPage;
  const endIdx = Math.min(startIdx + perPage, list.length);
  const pageRows = list.slice(startIdx, endIdx);

  const tbody = document.getElementById('gradesTable');
  if (tbody) {
    tbody.innerHTML = pageRows.map(g => {
      const sid = String(g.studentId || '');
      const name = g.studentName || stuMap.get(sid)?.name || '-';
      return `
        <tr>
          <td class="px-6 py-3 text-sm text-gray-900">${sid || '-'}</td>
          <td class="px-6 py-3 text-sm text-gray-900">${name}</td>
          <td class="px-6 py-3 text-sm text-gray-900">${g.semester || '-'}</td>
          <td class="px-6 py-3 text-sm text-gray-900">${(g.subjectCode || '')} ${(g.subjectName || '')}</td>
          <td class="px-6 py-3 text-sm text-gray-900 ${getGradeColor(g.grade)}">${g.grade || '-'}</td>
          <td class="px-6 py-3 text-sm text-gray-900">-</td>
        </tr>
      `;
    }).join('');
  }

  // อัปเดตตัวเลขสรุป
  const gStart = document.getElementById('gradesStart');
  const gEnd   = document.getElementById('gradesEnd');
  const gTotal = document.getElementById('gradesTotal');
  if (gStart) gStart.textContent = list.length ? (startIdx + 1) : 0;
  if (gEnd)   gEnd.textContent   = endIdx;
  if (gTotal) gTotal.textContent = list.length;
}
function loadGradesData() { currentGradesPage = 1; renderGradesPage(); }
function nextGradesPage() { currentGradesPage += 1; renderGradesPage(); }
function previousGradesPage() { currentGradesPage -= 1; renderGradesPage(); }
function filterGrades() { currentGradesPage = 1; renderGradesPage(); }

// ===== Utilities =====
function populateAcademicYears(selectId) {
  const years = ['2567', '2566', '2565', '2564']; // ปรับได้ตามจริง
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="">ทุกปีการศึกษา</option>' +
    years.map(year => `<option value="${year}">${year}</option>`).join('');
}
function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString('th-TH');
}

// ===== Placeholders for edit/delete (ยังไม่ผูก API ลบ/แก้) =====
function editStudent(studentId) {
  Swal.fire({ title: 'แก้ไขข้อมูลนักศึกษา', text: `แก้ไขข้อมูลนักศึกษา ${studentId}`, icon: 'info' });
}
function deleteStudent(studentId) {
  Swal.fire({
    title: 'ยืนยันการลบ', text: `ต้องการลบข้อมูลนักศึกษา ${studentId} หรือไม่?`,
    icon: 'warning', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      studentsData = (studentsData || []).filter(student => student.id !== studentId);
      displayStudents(); loadOverviewData();
      Swal.fire('ลบสำเร็จ!', 'ลบข้อมูลนักศึกษาเรียบร้อยแล้ว', 'success');
    }
  });
}
function editGrade(studentId, subjectCode) {
  Swal.fire({ title: 'แก้ไขผลการเรียน', text: `แก้ไขผลการเรียน ${studentId} - ${subjectCode}`, icon: 'info' });
}
function deleteGrade(studentId, subjectCode) {
  Swal.fire({
    title: 'ยืนยันการลบ', text: `ต้องการลบผลการเรียน ${studentId} - ${subjectCode} หรือไม่?`,
    icon: 'warning', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      gradesData = (gradesData || []).filter(g => !(g.studentId === studentId && g.subjectCode === subjectCode));
      renderGradesPage();
      Swal.fire('ลบสำเร็จ!', 'ลบผลการเรียนเรียบร้อยแล้ว', 'success');
    }
  });
}

