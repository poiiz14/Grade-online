/* =========================
 *  app.js  (JSONP client)
 * =========================
 * - รองรับ 3 บทบาท: admin / student / advisor
 * - ใช้ API ตาม code.gs: authenticate, bootstrap, searchStudents, getStudentDetail, addGrade, addEnglishTest, changePassword
 * - UI hook ตรงกับ index.html ที่ส่งให้
 */

/** ============ CONFIG ============ **/
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec'; // ← ใส่ URL ของ Web App ที่นี่
const PAGE_SIZE_ADMIN = 50; // ตามสเปค: แสดงไม่เกินหน้าละ 50 รายการ
const DEBOUNCE_MS = 300;

/** ============ GLOBAL STATE ============ **/
const state = {
  user: null,                 // {role, id/name/email...}
  datasets: {                 // จาก bootstrap()
    students: [],
    grades: [],
    englishTests: [],
    advisors: []
  },
  // Admin: รายชื่อนักศึกษา
  adminList: {
    items: [],
    page: 1,
    total: 0,
    query: '',
    year: ''
  },
  // Admin: รายบุคคล
  person: {
    selectedId: '',
    detail: null,             // {student, grades[], englishTests[], summary{gpax,creditsUnique,englishLatest}}
    options: []               // สำหรับ dropdown personSelect
  },
  // Student dashboard
  studentView: {
    detail: null,
    years: [],                // อ้างอิงจากชื่อชีตในเกรด (sheet)
    selectedYear: '',
    selectedTerm: 1           // 1/2/3
  },
  // Advisor dashboard
  advisorView: {
    advisees: [],             // นักศึกษาที่อยู่ในความดูแล (เทียบด้วยชื่ออาจารย์ในคอลัมน์ advisor)
    counts: { total: 0, y1:0, y2:0, y3:0, y4:0, engPassed: 0 },
    years: [],                // จาก englishTests.academicYear (distinct)
    selectedYear: ''
  }
};

/** ============ JSONP HELPER ============ **/
function jsonp(action, payload, cb) {
  const cbName = 'cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  window[cbName] = (res) => {
    try { cb && cb(res); } finally {
      delete window[cbName];
      script.remove();
    }
  };
  const url = GAS_URL
    + '?action=' + encodeURIComponent(action)
    + '&payload=' + encodeURIComponent(JSON.stringify(payload || {}))
    + '&callback=' + encodeURIComponent(cbName);

  const script = document.createElement('script');
  script.src = url;
  script.onerror = () => { delete window[cbName]; script.remove(); Swal.fire('ผิดพลาด', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error'); };
  document.body.appendChild(script);
}

/** ============ AUTH FLOW ============ **/
function login() {
  const role = document.getElementById('userType').value;
  let credentials = {};
  if (role === 'admin') {
    credentials.email = document.getElementById('adminEmail').value.trim();
    credentials.password = document.getElementById('adminPassword').value.trim();
  } else if (role === 'advisor') {
    credentials.email = document.getElementById('advisorEmail').value.trim();
    credentials.password = document.getElementById('advisorPassword').value.trim();
  } else {
    credentials.citizenId = document.getElementById('studentCitizenId').value.trim();
  }

  jsonp('authenticate', { userType: role, credentials }, (res) => {
    if (!res || !res.success) return Swal.fire('เข้าสู่ระบบไม่สำเร็จ', res && res.message ? res.message : 'กรุณาลองอีกครั้ง', 'error');

    state.user = { role, ...res.data };
    localStorage.setItem('sess', JSON.stringify(state.user));

    // UI header
    document.getElementById('userName').textContent = state.user.name || state.user.email || '-';
    window.updateRoleUI(role, state.user.name || state.user.email);

    // แสดง Overlay ระหว่าง bootstrap
showLoadingOverlay('กำลังโหลดข้อมูล...');

jsonp('bootstrap', {}, (boot) => {
  hideLoadingOverlay(); // ปิด overlay เมื่อโหลดเสร็จ

  if (!boot || !boot.success)
    return Swal.fire('โหลดข้อมูลไม่สำเร็จ', 'ลองใหม่อีกครั้ง', 'error');

  state.datasets = boot.data || state.datasets;

  // Show shell
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');

  // ไปยังหน้าตาม role
  if (role === 'admin') initAdmin();
  else if (role === 'student') initStudent();
  else initAdvisor();
});

  });
}

function logout() {
  localStorage.removeItem('sess');
  location.reload();
}

// Auto-login (ถ้ามี sesion)
(function autologin() {
  const s = localStorage.getItem('sess');
  if (!s) return;
  try {
    const u = JSON.parse(s);
    // กู้คืนเฉพาะ UI เบื้องต้น รอผู้ใช้กดรี-ล็อกอินเองถ้าต้องการ (เพื่อความปลอดภัย)
    state.user = u;
    document.getElementById('userType').value = u.role;
    const ev = new Event('change'); document.getElementById('userType').dispatchEvent(ev);
  } catch (e) {}
})();

/** ============ ADMIN ============ **/
function initAdmin() {
  // default tab
  document.querySelector('#adminNav .tab-btn[data-target="#adminStudents"]').click();

  // เตรียม dropdown รายชื่อนักศึกษาให้หน้า "ข้อมูลรายบุคคล"
  state.person.options = (state.datasets.students || []).map(s => ({ id: s.id, name: s.name }));
  const sel = document.getElementById('personSelect');
  sel.innerHTML = '<option value="">— เลือกนักศึกษา —</option>' + state.person.options.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)} (${escapeHtml(o.id)})</option>`).join('');

  // Render รายชื่อนักศึกษา (ผ่าน API search เพื่อความถูกต้อง)
  handleSearchStudents();
}

const debouncedAdminSearch = debounce(() => handleSearchStudents(), DEBOUNCE_MS);
function handleSearchStudents() {
  const query = document.getElementById('adminStudentSearch').value.trim();
  const year = document.getElementById('adminStudentYear').value;
  jsonp('searchStudents', { query, year }, (res) => {
    if (!res || !res.success) return;
    state.adminList.items = res.data || [];
    state.adminList.page = 1;
    state.adminList.total = state.adminList.items.length;
    renderAdminStudentList();
  });
}

function renderAdminStudentList() {
  const { items, page } = state.adminList;
  const start = (page - 1) * PAGE_SIZE_ADMIN;
  const end = Math.min(start + PAGE_SIZE_ADMIN, items.length);
  const pageItems = items.slice(start, end);

  const tb = document.getElementById('adminStudentTable');
  tb.innerHTML = pageItems.map(s => `
    <tr class="hover:bg-gray-50">
      <td class="td">${escapeHtml(s.id)}</td>
      <td class="td">${escapeHtml(s.name)}</td>
      <td class="td">${escapeHtml(s.year || '')}</td>
      <td class="td">${escapeHtml(s.advisor || '')}</td>
    </tr>
  `).join('');

  document.getElementById('adminStudentPageFrom').textContent = items.length ? (start + 1) : 0;
  document.getElementById('adminStudentPageTo').textContent = end;
  document.getElementById('adminStudentTotal').textContent = items.length;
}
function adminStudentPrev() {
  if (state.adminList.page > 1) { state.adminList.page--; renderAdminStudentList(); }
}
function adminStudentNext() {
  const maxPage = Math.ceil(state.adminList.items.length / PAGE_SIZE_ADMIN);
  if (state.adminList.page < maxPage) { state.adminList.page++; renderAdminStudentList(); }
}

/** ============ ADMIN: หน้ารายบุคคล ============ **/
const debouncedPersonSearch = debounce(() => {
  // ค้นหาแล้วไฮไลต์ option ที่ชื่อสอดคล้อง (ไม่ซับซ้อน)
  const q = normalize(document.getElementById('personSearch').value);
  const sel = document.getElementById('personSelect');
  if (!q) { sel.selectedIndex = 0; return; }
  const found = state.person.options.findIndex(o => normalize(o.name).includes(q));
  sel.selectedIndex = found >= 0 ? (found + 1) : 0;
  if (sel.value) openSelectedPerson();
}, DEBOUNCE_MS);

function openSelectedPerson() {
  const id = document.getElementById('personSelect').value;
  if (!id) return;
  openStudentDetail(id, true);
}

function openStudentDetail(studentId, isAdminPerson) {
  showLoadingOverlay('กำลังดึงข้อมูลรายบุคคล...');
  jsonp('getStudentDetail', { studentId }, (res) => {
    hideLoadingOverlay();
    if (!res || !res.success) return Swal.fire('ไม่สำเร็จ', res && res.message ? res.message : 'ไม่พบข้อมูล', 'error');
    state.person.selectedId = studentId;
    state.person.detail = res.data;
    
    // enable ปุ่ม
    ['btnEditStudent', 'btnAddGrade', 'btnAddEnglish'].forEach(id => document.getElementById(id).disabled = false);

    // render summary
    document.getElementById('personSumGpax').textContent = res.data.summary.gpax != null ? res.data.summary.gpax : '-';
    document.getElementById('personSumCredits').textContent = res.data.summary.creditsUnique != null ? res.data.summary.creditsUnique : '-';
    document.getElementById('personSumEng').textContent = res.data.summary.englishLatest ? `${res.data.summary.englishLatest.status} (${res.data.summary.englishLatest.score})` : '-';

    // render tables
    const gtb = document.getElementById('personGradeTable');
    gtb.innerHTML = (res.data.grades || []).map(g => `
      <tr class="hover:bg-gray-50">
        <td class="td">${escapeHtml(g.term || '')}</td>
        <td class="td">${escapeHtml(g.courseCode || '')}</td>
        <td class="td">${escapeHtml(g.courseTitle || '')}</td>
        <td class="td">${escapeHtml(g.credits || '')}</td>
        <td class="td">${escapeHtml(g.grade || '')}</td>
      </tr>
    `).join('');

    const etb = document.getElementById('personEnglishTable');
    etb.innerHTML = (res.data.englishTests || []).map(e => `
      <tr class="hover:bg-gray-50">
        <td class="td">${escapeHtml(e.academicYear || '')}</td>
        <td class="td">${escapeHtml(e.attempt || '')}</td>
        <td class="td">${escapeHtml(e.score || '')}</td>
        <td class="td">${escapeHtml(e.status || '')}</td>
        <td class="td">${escapeHtml(e.examDate || '')}</td>
      </tr>
    `).join('');

    if (isAdminPerson) {
      // สลับแท็บมาที่ "ข้อมูลรายบุคคล" ถ้ายังไม่ได้อยู่
      const btn = document.querySelector('#adminNav .tab-btn[data-target="#adminPerson"]');
      if (btn && !btn.classList.contains('active')) btn.click();
    }
  });
}

function openEditStudent() {
  Swal.fire('เร็ว ๆ นี้', 'แก้ไขข้อมูลนักศึกษา (โปรไฟล์) ยังไม่ได้เชื่อม API — หากต้องการเพิ่ม ฟีเจอร์นี้แจ้งผมได้เลย', 'info');
}

function openAddGrade() {
  if (!state.person.selectedId) return Swal.fire('กรุณาเลือกนักศึกษา', '', 'warning');
  document.getElementById('modalAddGrade').classList.remove('hidden');
}
function closeAddGrade() { document.getElementById('modalAddGrade').classList.add('hidden'); }

function submitAddGrade() {
  const studentId = state.person.selectedId;
  const yearLevel = +document.getElementById('agYearLevel').value;
  const term = document.getElementById('agTerm').value.trim();
  const courseCode = document.getElementById('agCourseCode').value.trim();
  const courseTitle = document.getElementById('agCourseTitle').value.trim();
  const credits = document.getElementById('agCredits').value.trim();
  const grade = document.getElementById('agGrade').value.trim();

  if (!studentId || !courseTitle || !credits || !grade) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอก รายวิชา/หน่วยกิต/เกรด', 'warning');

  jsonp('addGrade', { yearLevel, studentId, term, courseCode, courseTitle, credits, grade }, (res) => {
    if (!res || !res.success) return Swal.fire('บันทึกไม่สำเร็จ', res && res.message ? res.message : '', 'error');
    Swal.fire('สำเร็จ', 'เพิ่มเกรดเรียบร้อย', 'success');
    closeAddGrade();
    // refresh รายบุคคล
    openStudentDetail(studentId, true);
  });
}

function openAddEnglish() {
  if (!state.person.selectedId) return Swal.fire('กรุณาเลือกนักศึกษา', '', 'warning');
  document.getElementById('modalAddEnglish').classList.remove('hidden');
}
function closeAddEnglish() { document.getElementById('modalAddEnglish').classList.add('hidden'); }

function submitAddEnglish() {
  const studentId = state.person.selectedId;
  const yearLevel = +document.getElementById('aeYearLevel').value;
  const academicYear = document.getElementById('aeAcademicYear').value.trim();
  const attempt = document.getElementById('aeAttempt').value.trim();
  const score = document.getElementById('aeScore').value.trim();
  const status = document.getElementById('aeStatus').value.trim();
  const examDate = document.getElementById('aeExamDate').value.trim();

  if (!studentId || !academicYear || !attempt || !score || !status) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอก ปีการศึกษา/ครั้งที่สอบ/คะแนน/สถานะ', 'warning');

  jsonp('addEnglishTest', { yearLevel, studentId, academicYear, attempt, score, status, examDate }, (res) => {
    if (!res || !res.success) return Swal.fire('บันทึกไม่สำเร็จ', res && res.message ? res.message : '', 'error');
    Swal.fire('สำเร็จ', 'เพิ่มผลสอบภาษาอังกฤษแล้ว', 'success');
    closeAddEnglish();
    // refresh รายบุคคล
    openStudentDetail(studentId, true);
  });
}

/** ============ STUDENT ============ **/
function initStudent() {
  // โหลดรายละเอียดนักศึกษาปัจจุบัน
  const sid = state.user && state.user.id ? state.user.id : (state.user && state.user.citizenId) || '';
  if (!sid) return Swal.fire('ไม่พบรหัสนักศึกษา', '', 'error');
  showLoadingOverlay('กำลังเตรียมข้อมูลนักศึกษา...');
  jsonp('getStudentDetail', { studentId: sid }, (res) => {
    hideLoadingOverlay();
    if (!res || !res.success) return Swal.fire('โหลดข้อมูลไม่สำเร็จ', '', 'error');
    state.studentView.detail = res.data;

    // Summary
    document.getElementById('stuSumGpax').textContent = res.data.summary.gpax != null ? res.data.summary.gpax : '-';
    document.getElementById('stuSumCredits').textContent = res.data.summary.creditsUnique != null ? res.data.summary.creditsUnique : '-';
    document.getElementById('stuEngLatest').textContent = res.data.summary.englishLatest ? `${res.data.summary.englishLatest.status} (${res.data.summary.englishLatest.score})` : '-';

    // ปีการศึกษา: อนุมานจากชื่อชีตของเกรด (field: sheet) เพื่อใช้กรอง
    const sheets = Array.from(new Set((res.data.grades || []).map(g => g.sheet).filter(Boolean)));
    state.studentView.years = sheets.length ? sheets : ['ทั้งหมด'];
    state.studentView.selectedYear = state.studentView.years[0];

    const sel = document.getElementById('stuAcademicYear');
    sel.innerHTML = state.studentView.years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');

    // Render term 1 เป็นค่าเริ่มต้น
    studentTermChanged(1);
    document.getElementById('studentDashboard').classList.remove('hidden');
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
  });
}

function studentYearChanged() {
  const sel = document.getElementById('stuAcademicYear');
  state.studentView.selectedYear = sel.value;
  // คง term เดิม
  studentTermChanged(state.studentView.selectedTerm || 1);
}

function studentTermChanged(term) {
  state.studentView.selectedTerm = term;
  document.querySelectorAll('#studentDashboard .tab-mini').forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.term === +term);
  });

  const det = state.studentView.detail;
  if (!det) return;

  let rows = det.grades || [];
  if (state.studentView.selectedYear && state.studentView.selectedYear !== 'ทั้งหมด') {
    rows = rows.filter(r => (r.sheet || '') === state.studentView.selectedYear);
  }
  rows = rows.filter(r => (String(r.term || '') === String(term)));

  const tb = document.getElementById('stuTermGradeTable');
  tb.innerHTML = rows.map(g => `
    <tr class="hover:bg-gray-50">
      <td class="td">${escapeHtml(g.courseCode || '')}</td>
      <td class="td">${escapeHtml(g.courseTitle || '')}</td>
      <td class="td">${escapeHtml(g.credits || '')}</td>
      <td class="td">${escapeHtml(g.grade || '')}</td>
    </tr>
  `).join('');

  // ตารางผลอังกฤษ (ทุกปีการศึกษา) — แสดงคงที่
  const etb = document.getElementById('stuEnglishAllTable');
  etb.innerHTML = (det.englishTests || []).map(e => `
    <tr class="hover:bg-gray-50">
      <td class="td">${escapeHtml(e.academicYear || '')}</td>
      <td class="td">${escapeHtml(e.attempt || '')}</td>
      <td class="td">${escapeHtml(e.score || '')}</td>
      <td class="td">${escapeHtml(e.status || '')}</td>
      <td class="td">${escapeHtml(e.examDate || '')}</td>
    </tr>
  `).join('');
}

/** ============ ADVISOR ============ **/
function initAdvisor() {
  // เลือก advisees: เทียบชื่อนักศึกษา.s.advisor === ชื่ออาจารย์ (ผู้ล็อกอิน)
  const myName = (state.user && state.user.name) ? normalize(state.user.name) : '';
  const allStudents = state.datasets.students || [];
  state.advisorView.advisees = allStudents.filter(s => normalize(s.advisor) === myName);

  // นับจำนวนรวมและตามชั้นปี
  const c = { total: state.advisorView.advisees.length, y1:0, y2:0, y3:0, y4:0, engPassed: 0 };
  state.advisorView.advisees.forEach(s => {
    if (String(s.year) === '1') c.y1++;
    else if (String(s.year) === '2') c.y2++;
    else if (String(s.year) === '3') c.y3++;
    else if (String(s.year) === '4') c.y4++;
  });

  // นับผ่านอังกฤษ (ล่าสุด) ต่อคน
  const englishAll = state.datasets.englishTests || [];
  c.engPassed = state.advisorView.advisees.reduce((sum, s) => {
    const list = englishAll.filter(e => String(e.studentId) === String(s.id));
    const latest = latestEnglish(list);
    return sum + (latest && normalize(latest.status).includes('ผ่าน') ? 1 : 0);
  }, 0);

  state.advisorView.counts = c;
  // อัปเดต UI การ์ด
  document.getElementById('advTotalStudents').textContent = c.total;
  document.getElementById('advY1').textContent = c.y1;
  document.getElementById('advY2').textContent = c.y2;
  document.getElementById('advY3').textContent = c.y3;
  document.getElementById('advY4').textContent = c.y4;
  document.getElementById('advEnglishPassed').textContent = c.engPassed;

  // ปีการศึกษาสำหรับกรองป็อปอัป → จาก englishTests.academicYear (distinct)
  const years = Array.from(new Set(englishAll.map(e => e.academicYear).filter(Boolean)));
  state.advisorView.years = years.length ? years : ['ทั้งหมด'];
  state.advisorView.selectedYear = state.advisorView.years[0];
  const sel = document.getElementById('advAcademicYear');
  sel.innerHTML = state.advisorView.years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');

  // ตาราง advisees
  const tb = document.getElementById('advTable');
  tb.innerHTML = state.advisorView.advisees.map(s => `
    <tr class="hover:bg-gray-50">
      <td class="td">${escapeHtml(s.id)}</td>
      <td class="td">${escapeHtml(s.name)}</td>
      <td class="td">${escapeHtml(s.year || '')}</td>
      <td class="td">
        <button class="btn-blue !py-1 !px-2" onclick="advisorOpenView('${escapeJs(s.id)}', '${escapeJs(s.name)}', '${escapeJs(s.year || '')}')">ดู</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('advisorDashboard').classList.remove('hidden');
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
}

function advisorYearChanged() {
  const sel = document.getElementById('advAcademicYear');
  state.advisorView.selectedYear = sel.value;
}

function advisorOpenView(id, name, year) {
  // โหลด detail เฉพาะคน
  jsonp('getStudentDetail', { studentId: id }, (res) => {
    if (!res || !res.success) return Swal.fire('ไม่สำเร็จ', res && res.message ? res.message : '', 'error');
    const det = res.data;
    document.getElementById('advVName').textContent = name;
    document.getElementById('advVId').textContent = id;
    document.getElementById('advVYear').textContent = year;

    // กรองตามปีการศึกษาที่เลือก
    const ay = state.advisorView.selectedYear;
    // เกรด: ไม่มี field academicYear — ใช้ชื่อชีตเป็นตัวกรอง (ถ้าชื่อ sheet มีปี) ไม่งั้นแสดงทั้งหมด
    let grades = det.grades || [];
    if (ay && ay !== 'ทั้งหมด') {
      grades = grades.filter(g => (g.sheet || '').includes(String(ay)));
    }
    const gtb = document.getElementById('advVGradeTable');
    gtb.innerHTML = grades.map(g => `
      <tr class="hover:bg-gray-50">
        <td class="td">${escapeHtml(g.term || '')}</td>
        <td class="td">${escapeHtml(g.courseCode || '')}</td>
        <td class="td">${escapeHtml(g.courseTitle || '')}</td>
        <td class="td">${escapeHtml(g.credits || '')}</td>
        <td class="td">${escapeHtml(g.grade || '')}</td>
      </tr>
    `).join('');

    // อังกฤษ: มี academicYear → กรองตรง ๆ
    let eng = det.englishTests || [];
    if (ay && ay !== 'ทั้งหมด') {
      eng = eng.filter(e => String(e.academicYear) === String(ay));
    }
    const etb = document.getElementById('advVEnglishTable');
    etb.innerHTML = eng.map(e => `
      <tr class="hover:bg-gray-50">
        <td class="td">${escapeHtml(e.academicYear || '')}</td>
        <td class="td">${escapeHtml(e.attempt || '')}</td>
        <td class="td">${escapeHtml(e.score || '')}</td>
        <td class="td">${escapeHtml(e.status || '')}</td>
        <td class="td">${escapeHtml(e.examDate || '')}</td>
      </tr>
    `).join('');

    document.getElementById('modalAdvView').classList.remove('hidden');
  });
}
function closeAdvView() { document.getElementById('modalAdvView').classList.add('hidden'); }

/** ============ PASSWORD CHANGE (admin/advisor) ============ **/
function openChangePassword() {
  document.getElementById('modalChangePassword').classList.remove('hidden');
  document.getElementById('cpEmail').value = state.user?.email || '';
}
function closeChangePassword() { document.getElementById('modalChangePassword').classList.add('hidden'); }

function submitChangePassword() {
  const email = document.getElementById('cpEmail').value.trim();
  const oldPassword = document.getElementById('cpOld').value.trim();
  const newPassword = document.getElementById('cpNew').value.trim();
  const userType = state.user?.role || 'admin';
  if (!email || !oldPassword || !newPassword) return Swal.fire('ข้อมูลไม่ครบ', '', 'warning');

  jsonp('changePassword', { userType, email, oldPassword, newPassword }, (res) => {
    if (!res || !res.success) return Swal.fire('ไม่สำเร็จ', res && res.message ? res.message : 'เปลี่ยนรหัสผ่านล้มเหลว', 'error');
    Swal.fire('สำเร็จ', 'เปลี่ยนรหัสผ่านเรียบร้อย', 'success');
    closeChangePassword();
  });
}

/** ============ UTILS ============ **/
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
function normalize(s) { return String(s || '').trim().toLowerCase(); }
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escapeJs(s){ return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,'\\\'').replace(/"/g,'\\\"'); }

function latestEnglish(list) {
  if (!list || !list.length) return null;
  let best = null;
  list.forEach(r => {
    const d = Date.parse(String(r.examDate || '')) || 0;
    const a = Number(r.attempt || 0) || 0;
    if (!best) { best = { r, d, a }; return; }
    if (d > best.d || (d === best.d && a > best.a)) best = { r, d, a };
  });
  return best ? best.r : null;
}

function showLoadingOverlay(text){
  const ol = document.getElementById('appLoadingOverlay');
  if (!ol) return;
  if (text) {
    const el = ol.querySelector('.ol-title span:last-child');
    if (el) el.textContent = text;
  }
  ol.classList.remove('hidden');
}
function hideLoadingOverlay(){
  const ol = document.getElementById('appLoadingOverlay');
  if (!ol) return;
  ol.classList.add('hidden');
}

// Expose to window (ฟังก์ชันที่ผูกกับ HTML)
window.login = login;
window.logout = logout;
window.debouncedAdminSearch = debouncedAdminSearch;
window.handleSearchStudents = handleSearchStudents;
window.adminStudentPrev = adminStudentPrev;
window.adminStudentNext = adminStudentNext;

window.debouncedPersonSearch = debouncedPersonSearch;
window.openSelectedPerson = openSelectedPerson;
window.openStudentDetail = openStudentDetail;

window.openEditStudent = openEditStudent;
window.openAddGrade = openAddGrade;
window.closeAddGrade = closeAddGrade;
window.submitAddGrade = submitAddGrade;

window.openAddEnglish = openAddEnglish;
window.closeAddEnglish = closeAddEnglish;
window.submitAddEnglish = submitAddEnglish;

window.openChangePassword = openChangePassword;
window.closeChangePassword = closeChangePassword;
window.submitChangePassword = submitChangePassword;

window.studentYearChanged = studentYearChanged;
window.studentTermChanged = studentTermChanged;

window.advisorYearChanged = advisorYearChanged;
window.advisorOpenView = advisorOpenView;
window.closeAdvView = closeAdvView;


