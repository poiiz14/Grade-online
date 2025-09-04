/* ===================== CONFIG ===================== */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';
(function () {
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_BASE);
  if (!ok) { console.error('[CONFIG] API_BASE ไม่ถูกต้อง:', API_BASE); alert('API_BASE ยังไม่ใช่ URL /exec ของ Apps Script'); }
})();

/* ===================== STATE ===================== */
let GLOBAL_DATA = { students: [], grades: [], englishTests: [], advisors: [] };
let CURRENT_USER = null;

/* ===================== JSONP ===================== */
function callAPI(action, data = {}, { timeoutMs = 30000, retries = 1, backoffMs = 800 } = {}) {
  function once(t) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const payloadStr = JSON.stringify(data || {});
      const s = document.createElement('script');
      const url = `${API_BASE}?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(payloadStr)}&callback=${cb}&_ts=${Date.now()}`;
      const cleanup = () => { try { delete window[cb]; } catch { } try { s.remove(); } catch { } };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`API timeout: ${action}`)); }, t);
      window[cb] = (resp) => { clearTimeout(timer); cleanup(); resolve(resp); };
      s.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error(`API network error: ${action}`)); };
      s.src = url; document.body.appendChild(s);
    });
  }
  return new Promise(async (resolve, reject) => {
    let n = 0, last;
    while (n <= retries) {
      try { resolve(await once(timeoutMs)); return; }
      catch (e) { last = e; n++; if (n > retries) break; await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, n - 1))); }
    }
    reject(last);
  });
}

/* ===================== HELPERS ===================== */
const SESSION_KEY = 'grade_online_session';
const saveSession = (s) => { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s || {})); } catch { } };
const loadSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); } catch { return {}; } };
const clearSession = () => { try { localStorage.removeItem(SESSION_KEY); } catch { } };
const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v == null ? '' : String(v)); };
const by = (fn) => (a, b) => fn(a) < fn(b) ? -1 : fn(a) > fn(b) ? 1 : 0;

/* extract year/sem from either term or sheet name */
function parseYearSem(g) {
  const src = String(g.term || g.sheet || '').trim();
  const yearMatch = src.match(/(25\d{2}|\d{4})/); // 256x / 202x
  const year = yearMatch ? yearMatch[1] : '';
  let sem = '';
  if (/ฤดูร้อน|summer|\/3\b/i.test(src)) sem = '3';
  else if (/\/\s*1\b|ภาคการศึกษาที่\s*1/.test(src)) sem = '1';
  else if (/\/\s*2\b|ภาคการศึกษาที่\s*2/.test(src)) sem = '2';
  return { year, sem, termNorm: year ? `${year}/${sem || ''}` : src };
}
function latestEnglishMap(tests) {
  const map = {};
  (tests || []).forEach(r => {
    const id = String(r.studentId || '');
    const d = Date.parse(r.examDate || '') || 0;
    const att = Number(r.attempt || 0);
    const cur = map[id];
    if (!cur || d > cur._d || (d === cur._d && att > cur._a)) map[id] = { ...r, _d: d, _a: att };
  });
  return map;
}
function uniqueSubjectsCount(grades) {
  const set = new Set();
  (grades || []).forEach(g => { const key = (g.courseCode || '').trim() || (g.courseTitle || '').trim(); if (key) set.add(key); });
  return set.size;
}
function studentGrades(grades, studentId) { return (grades || []).filter(g => String(g.studentId || '') === String(studentId || '')); }

/* ===================== UI Switch ===================== */
function goToDashboard() { document.getElementById('loginScreen')?.classList.add('hidden'); document.getElementById('dashboard')?.classList.remove('hidden'); }
function goToLogin() { document.getElementById('dashboard')?.classList.add('hidden'); document.getElementById('loginScreen')?.classList.remove('hidden'); }
function logout() { clearSession(); goToLogin(); Swal?.fire({ icon: 'success', title: 'ออกจากระบบแล้ว', timer: 1200, showConfirmButton: false }); }

/* ===================== API Wrappers ===================== */
async function authenticate(role, credentials) {
  const resp = await callAPI('authenticate', { userType: role, credentials }, { timeoutMs: 30000, retries: 1 });
  if (!resp?.success) throw new Error(resp?.message || 'authenticate failed');
  return resp.data;
}
async function bootstrapAll() {
  const resp = await callAPI('bootstrap', {}, { timeoutMs: 45000 });
  if (!resp?.success) throw new Error(resp?.message || 'bootstrap failed');
  return resp.data;
}

/* ===================== LOGIN ===================== */
async function handleLoginSubmit(ev) {
  ev?.preventDefault?.();
  const role = (document.getElementById('userType')?.value || document.getElementById('roleInput')?.value || 'student').toLowerCase();
  let credentials = {};

  if (role === 'student') {
    const citizenId = (document.getElementById('studentId')?.value || '').replace(/\s|-/g, '');
    if (!citizenId) { Swal?.fire({ icon: 'warning', title: 'กรอกเลขบัตรประชาชน' }); return; }
    credentials = { citizenId };
  } else if (role === 'admin') {
    const email = (document.getElementById('adminEmail')?.value || '').trim();
    const password = document.getElementById('adminPassword')?.value || '';
    if (!email || !password) { Swal?.fire({ icon: 'warning', title: 'กรอกอีเมลและรหัสผ่าน' }); return; }
    credentials = { email, password };
  } else {
    const email = (document.getElementById('advisorEmail')?.value || '').trim();
    const password = document.getElementById('advisorPassword')?.value || '';
    if (!email || !password) { Swal?.fire({ icon: 'warning', title: 'กรอกอีเมลและรหัสผ่าน' }); return; }
    credentials = { email, password };
  }

  Swal.fire({ title: 'กำลังเข้าสู่ระบบ', allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });

  try {
    const user = await authenticate(role, credentials);
    const data = await bootstrapAll();
    Swal.close();

    CURRENT_USER = user; GLOBAL_DATA = data;
    saveSession({ role: user.role, name: user.name, id: user.id, email: user.email || '' });
    if (typeof window.updateRoleUI === 'function') window.updateRoleUI(user.role, user.name);
    goToDashboard();

    if (user.role === 'admin') showAdminDashboard();
    else if (user.role === 'advisor') showTeacherDashboard();
    else showStudentDashboard();
  } catch (e) {
    Swal.close();
    Swal?.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: String(e?.message || e) });
  }
}
window.handleLoginSubmit = handleLoginSubmit;

document.addEventListener('DOMContentLoaded', () => {
  const f = document.getElementById('loginForm');
  f?.addEventListener('submit', handleLoginSubmit);
  const btn = document.querySelector('button[type="submit"]');
  btn?.addEventListener('click', e => { e.preventDefault(); handleLoginSubmit(e); });
});

/* ===================== ADMIN ===================== */
function showOnlyDashboard(id) {
  ['adminDashboard', 'studentDashboard', 'advisorDashboard'].forEach(x => document.getElementById(x)?.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}

function showAdminDashboard() {
  showOnlyDashboard('adminDashboard');
  showAdminSection('overview');

  const { students, grades, englishTests } = GLOBAL_DATA;
  const engLatest = latestEnglishMap(englishTests);

  setText('totalStudents', students.length);
  let pass = 0, fail = 0;
  Object.values(engLatest).forEach(r => { const s = (r.status || '').toString().trim().toLowerCase(); if (['ผ่าน', 'pass', 'passed', 'p'].includes(s)) pass++; else fail++; });
  setText('passedEnglish', pass); setText('failedEnglish', fail);
  setText('totalSubjects', uniqueSubjectsCount(grades));

  // Render initial pages
  setupAdminStudentsUI();
  setupAdminGradesUI();
  renderAdminCharts(students, engLatest);
}

window.showAdminSection = showAdminSection;
function showAdminSection(name) {
  ['adminOverview', 'adminStudents', 'adminGrades', 'adminIndividual'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  const map = { overview: 'adminOverview', students: 'adminStudents', grades: 'adminGrades', individual: 'adminIndividual' };
  document.getElementById(map[name] || 'adminOverview')?.classList.remove('hidden');

  document.querySelectorAll('.admin-nav-btn').forEach(btn => { btn.classList.remove('border-blue-500', 'text-blue-600'); btn.classList.add('border-transparent', 'text-gray-600'); });
  const tabs = ['overview', 'students', 'grades', 'individual']; const idx = tabs.indexOf(name);
  const navBtns = [...document.querySelectorAll('.admin-nav-btn')]; if (idx >= 0 && navBtns[idx]) { navBtns[idx].classList.add('border-blue-500', 'text-blue-600'); navBtns[idx].classList.remove('border-transparent', 'text-gray-600'); }
}

/* ---------- Admin: Students with pagination ---------- */
let _astPage = 1;
function getFilteredStudents() {
  const q = (document.getElementById('adminStudentSearch')?.value || '').trim().toLowerCase();
  const y = (document.getElementById('adminStudentYearFilter')?.value || '').trim();
  return (GLOBAL_DATA.students || []).filter(s => {
    const okName = !q || (s.name || '').toLowerCase().includes(q);
    const okYear = !y || String(s.year) === y;
    return okName && okYear;
  });
}
function renderStudentsTablePaged() {
  const per = 50;
  const list = getFilteredStudents();
  const total = list.length;
  const maxPage = Math.max(1, Math.ceil(total / per));
  _astPage = Math.min(Math.max(1, _astPage), maxPage);

  const start = (_astPage - 1) * per;
  const pageItems = list.slice(start, start + per);

  const tb = document.getElementById('studentsTable'); tb.innerHTML = '';
  pageItems.forEach(st => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-6 py-3 text-sm text-gray-700">${st.id || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.name || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.year || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.advisor || '-'}</td>`;
    tb.appendChild(tr);
  });

  document.getElementById('adminStudentsPageInfo').textContent = `หน้า ${_astPage}/${maxPage} (รวม ${total} รายการ)`;
}
function setupAdminStudentsUI() {
  document.getElementById('adminStudentSearch')?.addEventListener('input', () => { _astPage = 1; renderStudentsTablePaged(); });
  document.getElementById('adminStudentYearFilter')?.addEventListener('change', () => { _astPage = 1; renderStudentsTablePaged(); });
  document.getElementById('adminStudentsPrev')?.addEventListener('click', () => { _astPage--; renderStudentsTablePaged(); });
  document.getElementById('adminStudentsNext')?.addEventListener('click', () => { _astPage++; renderStudentsTablePaged(); });
  renderStudentsTablePaged();
}

/* ---------- Admin: Grades with pagination ---------- */
let _agrPage = 1;
function getFilteredGrades() {
  const q = (document.getElementById('adminGradesSearch')?.value || '').trim().toLowerCase();
  const y = (document.getElementById('adminGradesYearFilter')?.value || '').trim();
  const yearOf = (g) => {
    // year from student year (Students.year), not academic year
    const stu = (GLOBAL_DATA.students || []).find(s => String(s.id) === String(g.studentId));
    return stu?.year ? String(stu.year) : '';
  };
  return (GLOBAL_DATA.grades || []).filter(g => {
    const okYear = !y || yearOf(g) === y;
    const text = `${g.studentId||''} ${g.courseCode||''} ${g.courseTitle||''}`.toLowerCase();
    const okQ = !q || text.includes(q);
    return okQ && okYear;
  });
}
function renderGradesTablePaged() {
  const per = 50;
  const list = getFilteredGrades();
  const total = list.length;
  const maxPage = Math.max(1, Math.ceil(total / per));
  _agrPage = Math.min(Math.max(1, _agrPage), maxPage);

  const start = (_agrPage - 1) * per;
  const pageItems = list.slice(start, start + per);

  const tb = document.getElementById('gradesTable'); tb.innerHTML = '';
  pageItems.forEach(g => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-6 py-3 text-sm text-gray-700">${g.studentId || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.courseCode || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.courseTitle || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.credits || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.grade || ''}</td>`;
    tb.appendChild(tr);
  });

  document.getElementById('adminGradesPageInfo').textContent = `หน้า ${_agrPage}/${maxPage} (รวม ${total} แถว)`;
}
function setupAdminGradesUI() {
  document.getElementById('adminGradesSearch')?.addEventListener('input', () => { _agrPage = 1; renderGradesTablePaged(); });
  document.getElementById('adminGradesYearFilter')?.addEventListener('change', () => { _agrPage = 1; renderGradesTablePaged(); });
  document.getElementById('adminGradesPrev')?.addEventListener('click', () => { _agrPage--; renderGradesTablePaged(); });
  document.getElementById('adminGradesNext')?.addEventListener('click', () => { _agrPage++; renderGradesTablePaged(); });
  renderGradesTablePaged();
}

/* ---------- Admin: Charts ---------- */
let _chart1, _chart2;
function renderAdminCharts(students, engLatest) {
  const byYear = { 1: 0, 2: 0, 3: 0, 4: 0 }; (students || []).forEach(s => { const y = String(s.year || ''); if (byYear[y] != null) byYear[y]++; });

  const c1 = document.getElementById('studentsChart');
  if (c1) { _chart1?.destroy(); _chart1 = new Chart(c1, { type: 'bar', data: { labels: ['ปี1', 'ปี2', 'ปี3', 'ปี4'], datasets: [{ label: 'จำนวนนักศึกษา', data: [byYear[1], byYear[2], byYear[3], byYear[4]] }] }, options: { responsive: true, maintainAspectRatio: true, aspectRatio: 2.2, plugins: { legend: { display: false } } } }); }

  let p = 0, f = 0; Object.values(engLatest).forEach(r => { const s = (r.status || '').toString().toLowerCase(); if (['ผ่าน', 'pass', 'passed', 'p'].includes(s)) p++; else f++; });
  const c2 = document.getElementById('englishChart');
  if (c2) { _chart2?.destroy(); _chart2 = new Chart(c2, { type: 'doughnut', data: { labels: ['ผ่าน', 'ไม่ผ่าน'], datasets: [{ data: [p, f] }] }, options: { responsive: true, maintainAspectRatio: true, aspectRatio: 1, plugins: { legend: { position: 'bottom' } } } }); }
}

/* ---------- Admin: individual ---------- */
window.openIndividual = function (studentId) {
  showAdminSection('individual');
  const st = (GLOBAL_DATA.students || []).find(s => String(s.id || '') === String(studentId));
  if (!st) { setText('studentName', '-'); setText('studentCode', '-'); setText('advisorName', '-'); return; }
  setText('studentName', st.name || '-'); setText('studentCode', st.id || '-'); setText('advisorName', st.advisor || '-');

  // english
  const etb = document.getElementById('englishTestTable'); etb.innerHTML = '';
  const myEng = (GLOBAL_DATA.englishTests || []).filter(e => String(e.studentId || '') === String(st.id));
  myEng.sort((a, b) => (Date.parse(b.examDate || '') || 0) - (Date.parse(a.examDate || '') || 0) || Number(b.attempt || 0) - Number(a.attempt || 0));
  myEng.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="px-4 py-2 text-sm">${r.academicYear || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.attempt || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.score || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.status || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.examDate || ''}</td>`;
    etb.appendChild(tr);
  });

  // grades + GPA
  const gtb = document.getElementById('gradesDetailTable'); gtb.innerHTML = '';
  const myGrades = studentGrades(GLOBAL_DATA.grades, st.id);
  myGrades.sort(by(g => g.term || g.sheet || ''));
  myGrades.forEach(g => {
    const pr = parseYearSem(g);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="px-4 py-2 text-sm">${pr.termNorm || ''}</td>
                    <td class="px-4 py-2 text-sm">${g.courseCode || ''}</td>
                    <td class="px-4 py-2 text-sm">${g.courseTitle || ''}</td>
                    <td class="px-4 py-2 text-sm">${g.credits || ''}</td>
                    <td class="px-4 py-2 text-sm">${g.grade || ''}</td>`;
    gtb.appendChild(tr);
  });

  const gpMap = { 'A': 4, 'B+': 3.5, 'B': 3, 'C+': 2.5, 'C': 2, 'D+': 1.5, 'D': 1, 'F': 0 };
  let tp = 0, tc = 0;
  myGrades.forEach(g => { const c = +g.credits || 0; const gr = (g.grade || '').toUpperCase(); if (gpMap[gr] != null) { tp += gpMap[gr] * c; tc += c; } });
  setText('indGpax', tc ? (tp / tc).toFixed(2) : '-'); setText('indCredits', tc || 0); setText('indCourseCount', myGrades.length);

  const yt = {}; // {year:{sem:{tp,tc}}}
  myGrades.forEach(g => {
    const { year, sem } = parseYearSem(g);
    if (!year || !sem) return;
    yt[year] = yt[year] || {};
    yt[year][sem] = yt[year][sem] || { tp: 0, tc: 0 };
    const c = +g.credits || 0; const gr = (g.grade || '').toUpperCase(); if (gpMap[gr] != null) { yt[year][sem].tp += gpMap[gr] * c; yt[year][sem].tc += c; }
  });
  const t = document.getElementById('indGpaTable'); t.innerHTML = '';
  Object.keys(yt).sort().forEach(y => {
    ['1', '2', '3'].forEach(s => {
      const rec = yt[y][s]; if (!rec) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="px-3 py-2 text-sm">${y}</td><td class="px-3 py-2 text-sm">${s==='3'?'ฤดูร้อน':s}</td><td class="px-3 py-2 text-sm">${rec.tc ? (rec.tp / rec.tc).toFixed(2) : '-'}</td>`;
      t.appendChild(tr);
    });
  });
};

// search box for individual
document.addEventListener('DOMContentLoaded', () => {
  const box = document.getElementById('individualSearch');
  if (box) {
    box.addEventListener('input', () => {
      const q = (box.value || '').trim().toLowerCase();
      const wrap = document.getElementById('individualSearchResults'); wrap.innerHTML = '';
      if (q.length < 2) return;
      (GLOBAL_DATA.students || []).filter(s => (s.name || '').toLowerCase().includes(q)).slice(0, 20).forEach(s => {
        const a = document.createElement('button'); a.className = 'px-3 py-2 rounded bg-gray-100 hover:bg-gray-200 w-full text-left';
        a.textContent = `${s.name} (รหัส ${s.id})`; a.onclick = () => openIndividual(s.id);
        wrap.appendChild(a);
      });
    });
  }
});

/* ===================== STUDENT ===================== */
function showStudentDashboard() {
  showOnlyDashboard('studentDashboard');

  const user = CURRENT_USER;
  const me = (GLOBAL_DATA.students || []).find(s => String(s.id || '') === String(user.id || '') || String(s.citizenId || '') === String(user.citizenId || '')) || {};
  const myGrades = studentGrades(GLOBAL_DATA.grades, me.id);
  const myEng = (GLOBAL_DATA.englishTests || []).filter(e => String(e.studentId || '') === String(me.id));

  const gp = { 'A': 4, 'B+': 3.5, 'B': 3, 'C+': 2.5, 'C': 2, 'D+': 1.5, 'D': 1, 'F': 0 };
  let tp = 0, tc = 0; myGrades.forEach(g => { const c = +g.credits || 0; const gr = (g.grade || '').toUpperCase(); if (gp[gr] != null) { tp += gp[gr] * c; tc += c; } });
  setText('studentGPAX', tc ? (tp / tc).toFixed(2) : '-'); setText('studentCredits', tc || 0);

  const latest = latestEnglishMap(myEng); const meLatest = latest[me.id]; setText('studentEnglishStatus', meLatest?.status || '-');

  // fill year list (academic year)
  const years = [...new Set(myGrades.map(g => parseYearSem(g).year).filter(Boolean))].sort().reverse();
  const sel = document.getElementById('studentAcademicYear'); sel.innerHTML = '<option value="">ทุกปีการศึกษา</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  sel.onchange = () => updateStudentSemester();

  window.showSemester = function (sem) {
    document.querySelectorAll('.semester-tab').forEach(b => b.classList.remove('border-blue-500', 'text-blue-600'));
    const idx = { '1': 0, '2': 1, '3': 2 }[sem] || 0; document.querySelectorAll('.semester-tab')[idx].classList.add('border-blue-500', 'text-blue-600'); updateStudentSemester(sem);
  };
  showSemester('1');

  // english table
  const etb = document.getElementById('studentEnglishTable'); etb.innerHTML = '';
  myEng.sort((a, b) => (Date.parse(b.examDate || '') || 0) - (Date.parse(a.examDate || '') || 0) || Number(b.attempt || 0) - Number(a.attempt || 0));
  myEng.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="px-4 py-2 text-sm">${r.academicYear || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.attempt || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.score || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.status || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.examDate || ''}</td>`;
    etb.appendChild(tr);
  });

  function updateStudentSemester(sem) {
    const activeBtn = document.querySelector('.semester-tab.border-blue-500');
    let semester = sem;
    if (!semester && activeBtn) {
      if (activeBtn.textContent.includes('2')) semester = '2';
      else if (activeBtn.textContent.includes('ฤดูร้อน')) semester = '3';
      else semester = '1';
    }
    const year = sel.value;
    const tb = document.getElementById('studentGradesTable'); tb.innerHTML = '';

    let list = myGrades.slice();
    if (year) list = list.filter(g => parseYearSem(g).year === year);
    if (semester === '1') list = list.filter(g => parseYearSem(g).sem === '1');
    else if (semester === '2') list = list.filter(g => parseYearSem(g).sem === '2');
    else list = list.filter(g => parseYearSem(g).sem === '3');

    list.forEach(g => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="px-4 py-2 text-sm">${g.courseCode || ''}</td>
                      <td class="px-4 py-2 text-sm">${g.courseTitle || ''}</td>
                      <td class="px-4 py-2 text-sm">${g.credits || ''}</td>
                      <td class="px-4 py-2 text-sm">${g.grade || ''}</td>`;
      tb.appendChild(tr);
    });

    const gp = { 'A': 4, 'B+': 3.5, 'B': 3, 'C+': 2.5, 'C': 2, 'D+': 1.5, 'D': 1, 'F': 0 };
    let tp = 0, tc = 0; list.forEach(g => { const c = +g.credits || 0; const gr = (g.grade || '').toUpperCase(); if (gp[gr] != null) { tp += gp[gr] * c; tc += c; } });
    setText('semesterGPA', tc ? (tp / tc).toFixed(2) : '-');
  }
}

/* ===================== ADVISOR ===================== */
function showTeacherDashboard() {
  showOnlyDashboard('advisorDashboard');
  const sess = loadSession();

  const advisees = (GLOBAL_DATA.students || []).filter(s => {
    const adv = (s.advisor || '').toString().trim();
    return adv && (adv === sess.name || adv.includes(sess.name));
  });

  // year cards (1-4)
  setText('advTotal', advisees.length);
  setText('advY1', advisees.filter(s => String(s.year) === '1').length);
  setText('advY2', advisees.filter(s => String(s.year) === '2').length);
  setText('advY3', advisees.filter(s => String(s.year) === '3').length);
  setText('advY4', advisees.filter(s => String(s.year) === '4').length);

  // year filter (academic year from grades of advisees)
  const advGrades = (GLOBAL_DATA.grades || []).filter(g => advisees.some(s => String(s.id) === String(g.studentId)));
  const years = [...new Set(advGrades.map(g => parseYearSem(g).year).filter(Boolean))].sort().reverse();
  const sel = document.getElementById('advisorYearFilter'); sel.innerHTML = '<option value="">ทุกปีการศึกษา</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  sel.onchange = () => renderAdvisorLists();

  function renderAdvisorLists() {
    const year = sel.value;
    const listDiv = document.getElementById('advisorStudentsList'); listDiv.innerHTML = '';
    advisees.forEach(s => {
      const div = document.createElement('div'); div.className = 'p-4';
      div.innerHTML = `<div class="flex justify-between">
        <div><div class="font-medium text-gray-900">${s.name || '-'}</div>
        <div class="text-sm text-gray-500">รหัส: ${s.id || '-'} | ชั้นปี: ${s.year || '-'}</div></div>
        <button class="text-blue-600 hover:underline" onclick="openIndividual('${s.id || ''}')">รายละเอียด</button>
      </div>`;
      listDiv.appendChild(div);
    });

    const etb = document.getElementById('advisorEnglishTable'); etb.innerHTML = '';
    const myTests = (GLOBAL_DATA.englishTests || []).filter(e => advisees.some(s => String(s.id) === String(e.studentId)));
    let tests = myTests;
    if (year) tests = tests.filter(t => String(t.academicYear || '').includes(year));
    const latest = latestEnglishMap(tests);
    advisees.sort(by(s => s.id)).forEach(s => {
      const r = latest[String(s.id)];
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="px-4 py-2 text-sm">${s.id || ''}</td>
                      <td class="px-4 py-2 text-sm">${s.name || ''}</td>
                      <td class="px-4 py-2 text-sm">${r?.status || '-'}</td>
                      <td class="px-4 py-2 text-sm">${r?.examDate || '-'}</td>`;
      etb.appendChild(tr);
    });
  }
  renderAdvisorLists();
}
