/* ===================== CONFIG ===================== */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

// ตรวจ URL ให้ชัดเจน
(function () {
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_BASE);
  if (!ok) {
    console.error('[CONFIG] API_BASE ไม่ถูกต้อง:', API_BASE);
    alert('API_BASE ยังไม่ใช่ URL /exec ของ Apps Script');
  }
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
      const url =
        `${API_BASE}?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(payloadStr)}&callback=${cb}&_ts=${Date.now()}`;

      const cleanup = () => {
        try { delete window[cb]; } catch { }
        try { s.remove(); } catch { }
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
    let n = 0;
    let last;
    while (n <= retries) {
      try {
        const out = await once(timeoutMs);
        resolve(out);
        return;
      } catch (e) {
        last = e;
        n++;
        if (n > retries) break;
        await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, n - 1)));
      }
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

/* latest english per student */
function latestEnglishMap(tests) {
  const map = {};
  (tests || []).forEach(r => {
    const id = String(r.studentId || '');
    const d = Date.parse(r.examDate || '') || 0;
    const att = Number(r.attempt || 0);
    const cur = map[id];
    if (!cur || d > cur._d || (d === cur._d && att > cur._a)) {
      map[id] = { ...r, _d: d, _a: att };
    }
  });
  return map;
}
/* unique subjects count */
function uniqueSubjectsCount(grades) {
  const set = new Set();
  (grades || []).forEach(g => {
    const key = (g.courseCode || '').trim() || (g.courseTitle || '').trim();
    if (key) set.add(key);
  });
  return set.size;
}
/* group by student id */
function studentGrades(grades, studentId) {
  return (grades || []).filter(g => String(g.studentId || '') === String(studentId || ''));
}

/* ===================== UI Switch ===================== */
function goToDashboard() {
  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('dashboard')?.classList.remove('hidden');
}
function goToLogin() {
  document.getElementById('dashboard')?.classList.add('hidden');
  document.getElementById('loginScreen')?.classList.remove('hidden');
}
function logout() {
  clearSession();
  goToLogin();
  Swal?.fire({ icon: 'success', title: 'ออกจากระบบแล้ว', timer: 1200, showConfirmButton: false });
}

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

  Swal.fire({
    title: 'กำลังเข้าสู่ระบบ',
    allowOutsideClick: false,
    showConfirmButton: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const user = await authenticate(role, credentials);
    const data = await bootstrapAll();
    Swal.close();

    CURRENT_USER = user;
    GLOBAL_DATA = data;

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

  // pass/fail จากผลล่าสุดต่อคน
  let pass = 0, fail = 0;
  Object.values(engLatest).forEach(r => {
    const s = (r.status || '').toString().trim().toLowerCase();
    if (['ผ่าน', 'pass', 'passed', 'p'].includes(s)) pass++; else fail++;
  });
  setText('passedEnglish', pass);
  setText('failedEnglish', fail);

  setText('totalSubjects', uniqueSubjectsCount(grades));

  renderStudentsTable(students);
  renderGradesTable(grades);
  renderAdminCharts(students, engLatest);
}

window.showAdminSection = showAdminSection;
function showAdminSection(name) {
  ['adminOverview', 'adminStudents', 'adminGrades', 'adminIndividual'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  const map = { overview: 'adminOverview', students: 'adminStudents', grades: 'adminGrades', individual: 'adminIndividual' };
  document.getElementById(map[name] || 'adminOverview')?.classList.remove('hidden');

  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.classList.remove('border-blue-500', 'text-blue-600');
    btn.classList.add('border-transparent', 'text-gray-600');
  });
  const tabs = ['overview', 'students', 'grades', 'individual'];
  const idx = tabs.indexOf(name);
  const navBtns = [...document.querySelectorAll('.admin-nav-btn')];
  if (idx >= 0 && navBtns[idx]) {
    navBtns[idx].classList.add('border-blue-500', 'text-blue-600');
    navBtns[idx].classList.remove('border-transparent', 'text-gray-600');
  }
}

function renderStudentsTable(students) {
  const tb = document.getElementById('studentsTable'); if (!tb) return;
  tb.innerHTML = '';
  (students || []).forEach(st => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-6 py-3 text-sm text-gray-700">${st.id || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.name || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.year || '-'}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${st.advisor || '-'}</td>
      <td class="px-6 py-3 text-sm text-blue-600">
        <button class="hover:underline" onclick="openIndividual('${st.id || ''}')">ดู</button>
      </td>`;
    tb.appendChild(tr);
  });
}

function renderGradesTable(grades) {
  const tb = document.getElementById('gradesTable'); if (!tb) return;
  tb.innerHTML = '';
  (grades || []).slice(0, 200).forEach(g => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-6 py-3 text-sm text-gray-700">${g.studentId || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.term || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.courseCode || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.courseTitle || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.credits || ''}</td>
      <td class="px-6 py-3 text-sm text-gray-700">${g.grade || ''}</td>`;
    tb.appendChild(tr);
  });
}

/* Charts */
let _chart1, _chart2;
function renderAdminCharts(students, engLatest) {
  const byYear = { 1: 0, 2: 0, 3: 0, 4: 0 };
  (students || []).forEach(s => {
    const y = String(s.year || '');
    if (byYear[y] != null) byYear[y]++;
  });

  const c1 = document.getElementById('studentsChart');
  if (c1) {
    _chart1?.destroy();
    _chart1 = new Chart(c1, {
      type: 'bar',
      data: {
        labels: ['ปี1', 'ปี2', 'ปี3', 'ปี4'],
        datasets: [{ label: 'จำนวนนักศึกษา', data: [byYear[1], byYear[2], byYear[3], byYear[4]] }]
      },
      options: { responsive: true, maintainAspectRatio: true, aspectRatio: 2.2, plugins: { legend: { display: false } } }
    });
  }

  let p = 0, f = 0;
  Object.values(engLatest).forEach(r => {
    const s = (r.status || '').toString().toLowerCase();
    if (['ผ่าน', 'pass', 'passed', 'p'].includes(s)) p++; else f++;
  });
  const c2 = document.getElementById('englishChart');
  if (c2) {
    _chart2?.destroy();
    _chart2 = new Chart(c2, {
      type: 'doughnut',
      data: { labels: ['ผ่าน', 'ไม่ผ่าน'], datasets: [{ data: [p, f] }] },
      options: { responsive: true, maintainAspectRatio: true, aspectRatio: 1, plugins: { legend: { position: 'bottom' } } }
    });
  }
}

/* รายบุคคล */
window.openIndividual = function (studentId) {
  showAdminSection('individual');
  const st = (GLOBAL_DATA.students || []).find(s => String(s.id || '') === String(studentId));
  if (!st) {
    setText('studentName', '-'); setText('studentCode', '-'); setText('advisorName', '-');
    return;
  }
  setText('studentName', st.name || '-');
  setText('studentCode', st.id || '-');
  setText('advisorName', st.advisor || '-');

  // english
  const etb = document.getElementById('englishTestTable'); etb.innerHTML = '';
  const myEng = (GLOBAL_DATA.englishTests || []).filter(e => String(e.studentId || '') === String(st.id));
  myEng.sort((a, b) =>
    (Date.parse(b.examDate || '') || 0) - (Date.parse(a.examDate || '') || 0) ||
    Number(b.attempt || 0) - Number(a.attempt || 0)
  );
  myEng.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="px-4 py-2 text-sm">${r.academicYear || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.attempt || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.score || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.status || ''}</td>
                    <td class="px-4 py-2 text-sm">${r.examDate || ''}</td>`;
    etb.appendChild(tr);
  });

  // grades
  const gtb = document.getElementById('gradesDetailTable'); gtb.innerHTML = '';
  const myGrades = studentGrades(GLOBAL_DATA.grades, st.id);
  myGrades.sort(by(g => g.term || ''));
  myGrades.forEach(g => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="px-4 py-2 text-sm">${g.term || ''}</td>
                    <td class="px-4 py-2 text-sm">${g.courseCode || ''}</td>
                    <td class="px-4 py-2 text-sm">${g.courseTitle || ''}</td>
                    <td class="px-4 py-2 text-sm">${g.credits || ''}</td>
                    <td class="px-4 py-2 text-sm">${g.grade || ''}</td>`;
    gtb.appendChild(tr);
  });
};

/* ===================== STUDENT ===================== */
function showStudentDashboard() {
  showOnlyDashboard('studentDashboard');

  const user = CURRENT_USER;
  const me = (GLOBAL_DATA.students || []).find(s =>
    String(s.id || '') === String(user.id || '') ||
    String(s.citizenId || '') === String(user.citizenId || '')
  ) || {};

  const myGrades = studentGrades(GLOBAL_DATA.grades, me.id);
  const myEng = (GLOBAL_DATA.englishTests || []).filter(e => String(e.studentId || '') === String(me.id));

  // summary
  const gp = { 'A': 4, 'B+': 3.5, 'B': 3, 'C+': 2.5, 'C': 2, 'D+': 1.5, 'D': 1, 'F': 0 };
  let tp = 0, tc = 0;
  myGrades.forEach(g => {
    const c = +g.credits || 0;
    const gr = (g.grade || '').toUpperCase();
    if (gp[gr] != null) { tp += gp[gr] * c; tc += c; }
  });
  setText('studentGPAX', tc ? (tp / tc).toFixed(2) : '-');
  setText('studentCredits', tc || 0);

  const latest = latestEnglishMap(myEng);
  const meLatest = latest[me.id];
  setText('studentEnglishStatus', meLatest?.status || '-');

  // academic year list for filter
  const years = [...new Set(myGrades.map(g => String(g.term || '').split('/')[0]).filter(Boolean))].sort().reverse();
  const sel = document.getElementById('studentAcademicYear');
  sel.innerHTML = '<option value="">ทุกปีการศึกษา</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  sel.onchange = () => updateStudentSemester();

  window.showSemester = function (sem) {
    document.querySelectorAll('.semester-tab').forEach(b => b.classList.remove('border-blue-500', 'text-blue-600'));
    const idx = { '1': 0, '2': 1, '3': 2 }[sem] || 0;
    document.querySelectorAll('.semester-tab')[idx].classList.add('border-blue-500', 'text-blue-600');
    updateStudentSemester(sem);
  };
  showSemester('1');

  // english table
  const etb = document.getElementById('studentEnglishTable'); etb.innerHTML = '';
  myEng.sort((a, b) =>
    (Date.parse(b.examDate || '') || 0) - (Date.parse(a.examDate || '') || 0) ||
    Number(b.attempt || 0) - Number(a.attempt || 0)
  );
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
    const year = sel.value; // '' = all
    const tb = document.getElementById('studentGradesTable'); tb.innerHTML = '';
    let list = myGrades.slice();
    if (year) list = list.filter(g => String(g.term || '').startsWith(year + '/'));
    if (semester === '1') list = list.filter(g => String(g.term || '').endsWith('/1'));
    else if (semester === '2') list = list.filter(g => String(g.term || '').endsWith('/2'));
    else list = list.filter(g => String(g.term || '').includes('ฤดูร้อน') || String(g.term || '').endsWith('/3'));
    list.forEach(g => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="px-4 py-2 text-sm">${g.courseCode || ''}</td>
                      <td class="px-4 py-2 text-sm">${g.courseTitle || ''}</td>
                      <td class="px-4 py-2 text-sm">${g.credits || ''}</td>
                      <td class="px-4 py-2 text-sm">${g.grade || ''}</td>`;
      tb.appendChild(tr);
    });
    // semester GPA quick
    const gp = { 'A': 4, 'B+': 3.5, 'B': 3, 'C+': 2.5, 'C': 2, 'D+': 1.5, 'D': 1, 'F': 0 };
    let tp = 0, tc = 0;
    list.forEach(g => {
      const c = +g.credits || 0;
      const gr = (g.grade || '').toUpperCase();
      if (gp[gr] != null) { tp += gp[gr] * c; tc += c; }
    });
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

  // summary
  setText('advTotal', advisees.length);
  const y1 = advisees.filter(s => String(s.year) === '1').length;
  const y234 = advisees.length - y1;
  setText('advY1', y1);
  setText('advY2', y234);

  const latest = latestEnglishMap(GLOBAL_DATA.englishTests.filter(e => advisees.some(s => String(s.id) === String(e.studentId))));
  let pass = 0;
  Object.values(latest).forEach(r => {
    const s = (r.status || '').toString().toLowerCase();
    if (['ผ่าน', 'pass', 'passed', 'p'].includes(s)) pass++;
  });
  setText('advPassLatest', pass);

  // list
  const list = document.getElementById('advisorStudentsList'); list.innerHTML = '';
  advisees.forEach(s => {
    const div = document.createElement('div'); div.className = 'p-4';
    div.innerHTML = `<div class="flex justify-between">
      <div>
        <div class="font-medium text-gray-900">${s.name || '-'}</div>
        <div class="text-sm text-gray-500">รหัส: ${s.id || '-'} | ชั้นปี: ${s.year || '-'}</div>
      </div>
      <button class="text-blue-600 hover:underline" onclick="openIndividual('${s.id || ''}')">รายละเอียด</button>
    </div>`;
    list.appendChild(div);
  });

  // english per student table (latest)
  const etb = document.getElementById('advisorEnglishTable'); etb.innerHTML = '';
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
