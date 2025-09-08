/***********************
 * CONFIG & GLOBALS
 ***********************/
const GAS_URL = window.GAS_URL || 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';
const JSONP = true;
const GRADE_POINTS = { 'A': 4.0, 'B+': 3.5, 'B': 3.0, 'C+': 2.5, 'C': 2.0, 'D+': 1.5, 'D': 1.0, 'F': 0.0 };
const NON_GPA_GRADES = new Set(['S','U','P','W','I','NP','NR','AU','TR']);

const appState = {
  user: null,
  students: [],
  advisors: [],
  grades: [],
  englishTests: [],
  ui: {
    semesterTab: '1',
    adminSection: 'overview',
    adminIndSelectedId: '',
    adminIndYear: '',
    advisorYear: '',
    advisorSearch: '',
  }
};

/***********************
 * UTILITIES
 ***********************/
function byId(id){ return document.getElementById(id); }
function qs(sel, root=document){ return root.querySelector(sel); }
function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
function toNumber(x, def=0){ const n = Number(x); return isNaN(n) ? def : n; }
function cleanId(id){ return String(id||'').trim(); }
function parseTerm(term){
  const raw = String(term || '').trim();
  if(!raw) return { year:'', sem:'' };
  const m1 = raw.match(/^(\d{4})\s*[/\-]\s*(\d{1,2})$/);
  if(m1) return { year: m1[1], sem: String(parseInt(m1[2],10)) };
  const m2 = raw.match(/^(\d{1,2})\s*[/\-]\s*(\d{4})$/);
  if(m2) return { year: m2[2], sem: String(parseInt(m2[1],10)) };
  if(['1','2','3'].includes(raw)) return { year:'', sem:raw };
  return { year:'', sem:'' };
}
function termSortKey(term){ const {year,sem}=parseTerm(term); return `${year.padStart(4,'0')}-${sem.padStart(1,'0')}`; }
function sortByStudentIdAsc(a,b){ const A=cleanId(a.id||a.value||a); const B=cleanId(b.id||b.value||b); return A<B?-1:A>B?1:0; }
function gradeToPoint(grade){ const g=String(grade||'').toUpperCase().trim(); if(NON_GPA_GRADES.has(g)) return null; return GRADE_POINTS[g] ?? null; }
function computeGPA(grades){ let cr=0, pt=0; grades.forEach(g=>{ const p=gradeToPoint(g.grade); const c=toNumber(g.credits); if(p!=null && c>0){ cr+=c; pt+=p*c; }}); return { gpa: cr>0? Math.round((pt/cr+Number.EPSILON)*100)/100 : 0, credits: cr }; }
function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
function latestBy(list, keyFn){ if(!list||!list.length) return null; let best=list[0], bk=keyFn(best)||''; for(let i=1;i<list.length;i++){ const k=keyFn(list[i])||''; if(k>bk){ best=list[i]; bk=k; } } return best; }
function unique(arr){ return Array.from(new Set(arr)); }

/* Loading overlay helpers */
function showLoading(on=true){
  const el = document.getElementById('loadingOverlay');
  if(!el) return;
  if(on){ el.classList.remove('hidden'); } else { el.classList.add('hidden'); }
}

/***********************
 * JSON/JSONP CALLER
 ***********************/
function callAPI(params){
  if(!GAS_URL) return Promise.reject('ยังไม่ได้ตั้งค่า GAS_URL');
  if(!JSONP){
    const url = GAS_URL + '?' + new URLSearchParams(params).toString();
    return fetch(url).then(r=>r.json());
  }
  return new Promise((resolve,reject)=>{
    const cb = 'cb_'+Date.now()+'_'+Math.floor(Math.random()*1e6);
    params.callback = cb;
    const url = GAS_URL + '?' + new URLSearchParams(params).toString();
    const s = document.createElement('script');
    window[cb] = (data)=>{ resolve(data); cleanup(); };
    s.onerror = (e)=>{ reject(e); cleanup(); };
    function cleanup(){ try{ delete window[cb]; }catch(_){ } document.body.removeChild(s); }
    s.src = url;
    document.body.appendChild(s);
  });
}
function apiAuthenticate(role, credentials){ return callAPI({action:'authenticate', payload: JSON.stringify({userType: role, credentials})}); }
function apiBootstrap(){ return callAPI({action:'bootstrap'}); }
function apiUpdateStudent(payload){ return callAPI({action:'updateStudent', payload: JSON.stringify(payload)}); }
function apiAddGrade(payload){ return callAPI({action:'addGrade', payload: JSON.stringify(payload)}); }
function apiAddEnglish(payload){ return callAPI({action:'addEnglishTest', payload: JSON.stringify(payload)}); }

/***********************
 * LOGIN FLOW
 ***********************/
function initLogin(){
  const userTypeEl = byId('userType');
  const adminLogin = byId('adminLogin');
  const studentLogin = byId('studentLogin');
  const advisorLogin = byId('advisorLogin');

  userTypeEl.addEventListener('change', ()=>{
    const role = userTypeEl.value;
    adminLogin.classList.add('hidden');
    studentLogin.classList.add('hidden');
    advisorLogin.classList.add('hidden');
    if(role==='admin') adminLogin.classList.remove('hidden');
    if(role==='student') studentLogin.classList.remove('hidden');
    if(role==='advisor') advisorLogin.classList.remove('hidden');
  });

  byId('loginForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const role = userTypeEl.value;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn){ submitBtn.disabled = true; submitBtn.classList.add('opacity-60','cursor-not-allowed'); }
    showLoading(true);

    try{
      let res;
      if(role==='admin'){
        res = await apiAuthenticate('admin', {
          email: byId('adminEmail').value,
          password: byId('adminPassword').value
        });
      }else if(role==='student'){
        res = await apiAuthenticate('student', {
          citizenId: byId('studentCitizenId').value
        });
      }else{
        res = await apiAuthenticate('advisor', {
          email: byId('advisorEmail').value,
          password: byId('advisorPassword').value
        });
      }

      if(!res.success){
        showLoading(false);
        if (submitBtn){ submitBtn.disabled = false; submitBtn.classList.remove('opacity-60','cursor-not-allowed'); }
        return Swal.fire('ไม่สำเร็จ', res.message || 'เข้าสู่ระบบล้มเหลว', 'error');
      }

      appState.user = res.data;
      byId('currentUserLabel').textContent = `${appState.user.name || ''} (${appState.user.role})`;

      const boot = await apiBootstrap();
      if(!boot.success){
        showLoading(false);
        if (submitBtn){ submitBtn.disabled = false; submitBtn.classList.remove('opacity-60','cursor-not-allowed'); }
        return Swal.fire('ผิดพลาด', boot.message || 'โหลดข้อมูลล้มเหลว', 'error');
      }

      appState.students = boot.data.students || [];
      appState.grades = boot.data.grades || [];
      appState.englishTests = boot.data.englishTests || [];
      appState.advisors = boot.data.advisors || [];

      byId('loginScreen').classList.add('hidden');
      byId('dashboard').classList.remove('hidden');

      if(appState.user.role==='admin'){
        byId('adminDashboard').classList.remove('hidden');
        buildAdminOverview();
        buildAdminStudents();
        buildAdminIndividual();
        showAdminSection('overview');
      }else if(appState.user.role==='student'){
        byId('studentDashboard').classList.remove('hidden');
        buildStudentView();
      }else{
        byId('advisorDashboard').classList.remove('hidden');
        buildAdvisorView();
      }

      showLoading(false);
    }catch(err){
      console.error(err);
      showLoading(false);
      Swal.fire('ผิดพลาด', String(err), 'error');
    }finally{
      if (submitBtn){ submitBtn.disabled = false; submitBtn.classList.remove('opacity-60','cursor-not-allowed'); }
    }
  });

  byId('btnLogout').addEventListener('click', ()=>{ location.reload(); });
}

/***********************
 * ADMIN: NAV & SECTIONS
 ***********************/
function showAdminSection(key){
  appState.ui.adminSection = key;
  qsa('.admin-section').forEach(el=>el.classList.add('hidden'));
  qsa('.tab-btn').forEach(el=>el.classList.remove('is-active'));
  if(key==='overview'){ byId('adminOverview').classList.remove('hidden'); qsa('.tab-btn')[0].classList.add('is-active'); }
  else if(key==='students'){ byId('adminStudents').classList.remove('hidden'); qsa('.tab-btn')[1].classList.add('is-active'); }
  else { byId('adminIndividual').classList.remove('hidden'); qsa('.tab-btn')[2].classList.add('is-active'); }
}

/***********************
 * ADMIN: OVERVIEW
 ***********************/
function buildAdminOverview(){
  byId('overviewTotalStudents').textContent = appState.students.length;
  byId('overviewTotalAdvisors').textContent = appState.advisors.length;
  const allCourses = unique(appState.grades.map(g=>String(g.courseCode||'').trim()).filter(Boolean));
  byId('overviewTotalCourses').textContent = allCourses.length;

  // นับ “ผ่าน/ไม่ผ่าน (จากรายการล่าสุดของแต่ละคน)”
  const byStu = groupBy(appState.englishTests, t => t.studentId);
  let passCount = 0;
  let failCount = 0;
  
  Object.keys(byStu).forEach(id => {
    const latest = latestBy(
      byStu[id],
      t => `${t.academicYear}-${String(t.attempt).padStart(3,'0')}-${t.examDate||''}`
    );
    if (!latest) return;
  
    const status = String(latest.status || '').trim();
    if (status === 'ผ่าน') {
      passCount++;
    } else if (status === 'ไม่ผ่าน') {
      failCount++;
    }
    // ถ้าเป็นค่าอื่น เช่น '' หรือ 'ยังไม่สอบ' → ไม่เอามานับ
  });
  
  byId('overviewEnglishLatestPass').textContent = passCount;
  const elFail = byId('overviewEnglishLatestFail');
  if (elFail) elFail.textContent = failCount;
  
  // วาดกราฟ
  renderStudentByYearBar();
  renderEnglishPassPie();
}
function groupBy(arr, keyFn){ const m={}; arr.forEach(x=>{ const k=keyFn(x); (m[k]||(m[k]=[])).push(x); }); return m; }
/* Bar: จำนวนนักศึกษาแต่ละชั้นปี */
function renderStudentByYearBar(){
  const ctx = byId('gradeDistributionChart').getContext('2d');
  const years = ['1','2','3','4'];
  const counts = { '1':0, '2':0, '3':0, '4':0 };
  appState.students.forEach(s=>{ const y=String(s.year||''); if(counts[y]!=null) counts[y]++; });

  const labels = years.map(y=>`ปี ${y}`);
  const data   = years.map(y=>counts[y]);

  if(window._studentYearBar) window._studentYearBar.destroy();
  window._studentYearBar = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'จำนวนนักศึกษา', data }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}
/* Pie: สรุปผลสอบอังกฤษ (ผ่าน/ไม่ผ่าน) – รวมทั้งระบบ */
function renderEnglishPassPie(){
  const el = byId('englishPassPie');
  if(!el) return;
  const ctx = el.getContext('2d');

  const byStu = groupBy(appState.englishTests, t=>t.studentId);
  let pass = 0, fail = 0;

  Object.keys(byStu).forEach(id=>{
    const latest = latestBy(byStu[id], t=>`${t.academicYear}-${String(t.attempt).padStart(3,'0')}-${t.examDate||''}`);
    if(!latest) return;

    const status = String(latest.status || '').trim();
    if (status === 'ผ่าน') pass++;
    else if (status === 'ไม่ผ่าน') fail++;
  });

  if(window._englishPie) window._englishPie.destroy();
  window._englishPie = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['ผ่าน','ไม่ผ่าน'],
      datasets: [{ data: [pass, fail] }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}
/***********************
 * ADMIN: STUDENTS
 ***********************/
function buildAdminStudents(){
  const tbody = byId('adminStudentsTable');
  const yearFilter = byId('adminStudentYearFilter');
  const searchEl = byId('adminStudentSearch');

  function render(){
    const yearSel = yearFilter.value;
    const q = searchEl.value.trim();
    const rows = appState.students
      .filter(s=>!yearSel || String(s.year)===yearSel)
      .filter(s=>!q || String(s.id||'').includes(q) || String(s.name||'').includes(q))
      .sort(sortByStudentIdAsc);

    tbody.innerHTML = rows.map(s=>`
      <tr>
        <td class="px-4 py-2">${s.id||'-'}</td>
        <td class="px-4 py-2">${s.name||'-'}</td>
        <td class="px-4 py-2">${s.year||'-'}</td>
        <td class="px-4 py-2">${s.advisor||'-'}</td>
        <td class="px-4 py-2 text-right">
          <button class="text-blue-600 hover:underline" data-id="${s.id}" onclick="gotoAdminIndividual('${s.id}')">ดูรายบุคคล</button>
        </td>
      </tr>
    `).join('');
  }

  yearFilter.onchange = render;
  searchEl.oninput = render;
  render();
}
window.gotoAdminIndividual = function(id){
  showAdminSection('admin-individual');
  const sel = byId('adminIndSelect');
  sel.value = id;
  sel.dispatchEvent(new Event('change'));
};

/***********************
 * ADMIN: INDIVIDUAL
 ***********************/
function buildAdminIndividual(){
  const sel = byId('adminIndSelect');
  const search = byId('adminIndSearch');
  const yearSel = byId('adminIndYear');

  const allYears = unique(appState.grades.map(g=>parseTerm(g.term).year).filter(Boolean)).sort();
  yearSel.innerHTML =
    '<option value="">ทุกปีการศึกษา</option>' +
    allYears.map(y => `<option value="${y}">${y}</option>`).join('');

  function fillSelect(){
    const q = search.value.trim();
    const list = appState.students
      .filter(s=>!q || String(s.id||'').includes(q) || String(s.name||'').includes(q))
      .sort(sortByStudentIdAsc);

    sel.innerHTML =
      '<option value="">-- เลือกนักศึกษา --</option>' +
      list.map(s => `<option value="${s.id}">${s.id} - ${s.name}</option>`).join('');
  }
  fillSelect();
  search.addEventListener('input', fillSelect);

  // ⬇️ เรียก render เมื่อมีการเปลี่ยนค่า
  sel.addEventListener('change', ()=>{
    appState.ui.adminIndSelectedId = sel.value;
    renderAdminIndividual();
  });
  yearSel.addEventListener('change', ()=>{
    appState.ui.adminIndYear = yearSel.value;
    renderAdminIndividual();
  });

  byId('btnEditStudent').onclick = openEditStudentModal;
  byId('btnAddGrade').onclick = ()=>openModal('modalAddGrade');
  byId('btnAddEnglish').onclick = ()=>openModal('modalAddEnglish');
  byId('btnManageGrades').onclick = openManageGradesModal;

  // ⬇️ เรียกครั้งแรกให้ขึ้น placeholder
  renderAdminIndividual();
}

function renderAdminIndividual() {
  const id = cleanId(appState.ui.adminIndSelectedId);
  const yearFilter = appState.ui.adminIndYear;
  // ยังไม่เลือกนักศึกษา -> เคลียร์ทุกช่องและขึ้นข้อความแนะให้เลือกก่อน
  if (!id) {
    byId('detailStudentId').textContent = '';
    byId('detailStudentName').textContent = '';
    byId('detailStudentYear').textContent = '';
    byId('detailStudentAdvisor').textContent = '';

    byId('adminIndYearGPA').textContent = '';
    byId('adminIndYearCredits').textContent = '';
    byId('adminIndGPAX').textContent = '';

    byId('adminIndGradesTable').innerHTML =
      '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">โปรดเลือกนักศึกษา</td></tr>';

    byId('adminIndEnglishTable').innerHTML =
      '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">โปรดเลือกนักศึกษา</td></tr>';
    return;
  }
  // แสดงโปรไฟล์นักศึกษาที่เลือก
  const std = appState.students.find(s => cleanId(s.id) === id);
  byId('detailStudentId').textContent = std ? (std.id || '-') : '-';
  byId('detailStudentName').textContent = std ? (std.name || '-') : '-';
  byId('detailStudentYear').textContent = std ? (std.year || '-') : '-';
  byId('detailStudentAdvisor').textContent = std ? (std.advisor || '-') : '-';

  // เกรด: ดึงเฉพาะของนักศึกษาคนนี้
  const grades = appState.grades
    .filter(g => cleanId(g.studentId) === id)
    .sort((a, b) => termSortKey(a.term).localeCompare(termSortKey(b.term)));
  const filtered = yearFilter
    ? grades.filter(g => parseTerm(g.term).year === yearFilter)
    : grades;
  const { gpa, credits } = computeGPA(filtered);
  byId('adminIndYearGPA').textContent = filtered.length ? gpa.toFixed(2) : '-';
  byId('adminIndYearCredits').textContent = filtered.length ? credits : '-';
  const overall = computeGPA(grades);
  byId('adminIndGPAX').textContent = grades.length ? overall.gpa.toFixed(2) : '-';
  const gradeTbody = byId('adminIndGradesTable');
  gradeTbody.innerHTML = filtered.length
    ? filtered
        .map(g => `
          <tr>
            <td class="px-4 py-2">${g.term || '-'}</td>
            <td class="px-4 py-2">${g.courseCode || '-'}</td>
            <td class="px-4 py-2">${g.courseTitle || '-'}</td>
            <td class="px-4 py-2">${g.credits || '-'}</td>
            <td class="px-4 py-2">${g.grade || '-'}</td>
          </tr>
        `)
        .join('')
    : '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">ยังไม่มีข้อมูลในปีที่เลือก</td></tr>';
  // ผลสอบภาษาอังกฤษของนักศึกษาคนนี้
  const englishTests = appState.englishTests
    .filter(t => cleanId(t.studentId) === id)
    .sort((a, b) => {
      const ka = `${a.academicYear || ''}-${String(a.attempt || 0).padStart(3, '0')}-${a.examDate || ''}`;
      const kb = `${b.academicYear || ''}-${String(b.attempt || 0).padStart(3, '0')}-${b.examDate || ''}`;
      return ka.localeCompare(kb);
    });
  const engTbody = byId('adminIndEnglishTable');
  engTbody.innerHTML = englishTests.length
    ? englishTests
        .map(t => `
          <tr>
            <td class="px-4 py-2">${t.academicYear || '-'}</td>
            <td class="px-4 py-2">${t.attempt || '-'}</td>
            <td class="px-4 py-2">${t.score || '-'}</td>
            <td class="px-4 py-2">${t.status || '-'}</td>
            <td class="px-4 py-2">${t.examDate ? String(t.examDate).substring(0, 10) : '-'}</td>
          </tr>
        `)
        .join('')
    : '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>';
}
/***********************
 * ADMIN: EDIT STUDENT
 ***********************/
function openEditStudentModal(){
  const id = appState.ui.adminIndSelectedId;
  if(!id) return Swal.fire('แจ้งเตือน','กรุณาเลือกนักศึกษา','info');
  const s = appState.students.find(x=>cleanId(x.id)===cleanId(id));
  if(!s) return Swal.fire('ผิดพลาด','ไม่พบนักศึกษา','error');

  byId('editStudentId').value = s.id||'';
  byId('editStudentNewId').value = '';
  byId('editStudentName').value = s.name||'';
  byId('editStudentAdvisor').value = s.advisor||'';
  byId('editStudentYear').value = s.year||'';

  openModal('modalEditStudent');
}
window.saveEditStudent = async function(){
  const id = byId('editStudentId').value;
  const payload = {
    id,
    newId: cleanId(byId('editStudentNewId').value) || undefined,
    name: byId('editStudentName').value,
    advisor: byId('editStudentAdvisor').value,
    year: byId('editStudentYear').value
  };
  try{
    const res = await apiUpdateStudent(payload);
    if(!res.success) return Swal.fire('ไม่สำเร็จ', res.message || 'บันทึกล้มเหลว', 'error');

    const s = appState.students.find(x=>cleanId(x.id)===cleanId(id));
    const newId = payload.newId && payload.newId!==id ? payload.newId : id;
    if(s){ s.id=newId; s.name=payload.name; s.advisor=payload.advisor; s.year=payload.year; }
    appState.grades.forEach(g=>{ if(cleanId(g.studentId)===cleanId(id)) g.studentId = newId; });
    appState.englishTests.forEach(t=>{ if(cleanId(t.studentId)===cleanId(id)) t.studentId = newId; });

    closeModal('modalEditStudent');
    Swal.fire('สำเร็จ','บันทึกข้อมูลเรียบร้อย','success');

    buildAdminStudents();
    buildAdminIndividual();
    byId('adminIndSelect').value = newId;
    byId('adminIndSelect').dispatchEvent(new Event('change'));
  }catch(err){
    console.error(err);
    Swal.fire('ผิดพลาด', String(err), 'error');
  }
};

/***********************
 * ADMIN: ADD GRADE / ENGLISH
 ***********************/
window.submitAddGrade = async function(){
  const id = appState.ui.adminIndSelectedId;
  if(!id) return Swal.fire('แจ้งเตือน','กรุณาเลือกนักศึกษา','info');
  const std = appState.students.find(s=>cleanId(s.id)===cleanId(id));
  if(!std) return Swal.fire('ผิดพลาด','ไม่พบนักศึกษา','error');

  const payload = {
    studentId: id,
    term: byId('addGradeTerm').value,
    courseCode: byId('addGradeCourseCode').value,
    courseTitle: byId('addGradeCourseTitle').value,
    credits: toNumber(byId('addGradeCredits').value),
    grade: byId('addGradeGrade').value,
    yearOfStudy: std.year
  };
  try{
    const res = await apiAddGrade(payload);
    if(!res.success) return Swal.fire('ไม่สำเร็จ', res.message || 'บันทึกล้มเหลว', 'error');

    appState.grades.push({ studentId: payload.studentId, term: payload.term, courseCode: payload.courseCode, courseTitle: payload.courseTitle, credits: payload.credits, grade: payload.grade, recordedAt: new Date().toISOString() });

    closeModal('modalAddGrade');
    Swal.fire('สำเร็จ','เพิ่มผลการเรียนแล้ว','success');
    renderAdminIndividual();
  }catch(err){
    console.error(err);
    Swal.fire('ผิดพลาด', String(err), 'error');
  }
};
window.submitAddEnglish = async function(){
  const id = appState.ui.adminIndSelectedId;
  if(!id) return Swal.fire('แจ้งเตือน','กรุณาเลือกนักศึกษา','info');
  const std = appState.students.find(s=>cleanId(s.id)===cleanId(id));
  if(!std) return Swal.fire('ผิดพลาด','ไม่พบนักศึกษา','error');

  const payload = {
    studentId: id,
    academicYear: byId('addEngAcademicYear').value,
    attempt: byId('addEngAttempt').value,
    score: byId('addEngScore').value,
    status: byId('addEngStatus').value,
    examDate: byId('addEngDate').value || undefined,
    yearOfStudy: std.year
  };
  try{
    const res = await apiAddEnglish(payload);
    if(!res.success) return Swal.fire('ไม่สำเร็จ', res.message || 'บันทึกล้มเหลว', 'error');

    appState.englishTests.push({ studentId: payload.studentId, academicYear: payload.academicYear, attempt: payload.attempt, score: payload.score, status: payload.status, examDate: payload.examDate || new Date().toISOString() });

    closeModal('modalAddEnglish');
    Swal.fire('สำเร็จ','เพิ่มผลสอบอังกฤษแล้ว','success');
    renderAdminIndividual();
  }catch(err){
    console.error(err);
    Swal.fire('ผิดพลาด', String(err), 'error');
  }
};

/***********************
 * ADMIN: MANAGE GRADES
 ***********************/
function openManageGradesModal(){
  const id = appState.ui.adminIndSelectedId;
  if(!id) return Swal.fire('แจ้งเตือน','กรุณาเลือกนักศึกษา','info');

  const rows = appState.grades
    .filter(g=>cleanId(g.studentId)===cleanId(id))
    .sort((a,b)=> termSortKey(a.term).localeCompare(termSortKey(b.term)));

  const tbody = byId('manageGradesTable');
  tbody.innerHTML = rows.map(g=>`
    <tr>
      <td class="px-3 py-2">${g.term||'-'}</td>
      <td class="px-3 py-2">${g.courseCode||'-'}</td>
      <td class="px-3 py-2">${g.courseTitle||'-'}</td>
      <td class="px-3 py-2">${g.credits||'-'}</td>
      <td class="px-3 py-2">${g.grade||'-'}</td>
      <td class="px-3 py-2 text-right">
        <button class="px-2 py-1 text-sm rounded border text-gray-500 cursor-not-allowed" title="ยังไม่เปิดใช้งาน">แก้ไข</button>
      </td>
    </tr>
  `).join('');

  openModal('modalManageGrades');
}

/***********************
 * STUDENT VIEW
 ***********************/
function buildStudentView(){
  const meId = cleanId(appState.user.id);
  const myGrades = appState.grades.filter(g=>cleanId(g.studentId)===meId);
  const myEnglish = appState.englishTests.filter(t=>cleanId(t.studentId)===meId);

  const overall = computeGPA(myGrades);
  byId('studentGPAX').textContent = myGrades.length ? overall.gpa.toFixed(2) : '-';
  byId('studentCredits').textContent = overall.credits || 0;

  const latest = latestBy(myEnglish, t=>`${t.academicYear}-${String(t.attempt).padStart(3,'0')}-${t.examDate||''}`);
  byId('studentEnglishStatus').textContent = latest ? `${latest.status} (${latest.score})` : '-';

  const yearSel = byId('studentAcademicYear');
  const years = unique(myGrades.map(g=>parseTerm(g.term).year).filter(Boolean)).sort();
  yearSel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  yearSel.onchange = renderStudentGrades;

  // ปุ่มแท็บใน HTML ใช้ onclick="showSemester('1')" ฯลฯ → สร้างฟังก์ชันให้เรียกได้
  // (เผื่อผู้ใช้ไม่กด ปรับค่าเริ่มต้นเป็น '1')
  appState.ui.semesterTab = '1';
  ;

  // ตารางอังกฤษรวมทุกปี
  const tbody = byId('studentEnglishTable');
  const sorted = myEnglish.sort((a,b)=>{
    const ka = `${a.academicYear}-${String(a.attempt).padStart(3,'0')}-${a.examDate||''}`;
    const kb = `${b.academicYear}-${String(b.attempt).padStart(3,'0')}-${b.examDate||''}`;
    return ka.localeCompare(kb);
  });
  tbody.innerHTML = sorted.map(t=>`
    <tr>
      <td class="px-4 py-2">${t.academicYear||'-'}</td>
      <td class="px-4 py-2">${t.attempt||'-'}</td>
      <td class="px-4 py-2">${t.score||'-'}</td>
      <td class="px-4 py-2">${t.status||'-'}</td>
      <td class="px-4 py-2">${t.examDate ? String(t.examDate).substring(0,10) : '-'}</td>
    </tr>
  `).join('');
}
function renderStudentGrades() {
  const meId = cleanId(appState.user.id);
  const y = byId('studentAcademicYear').value; // ปีที่กรอง (ว่าง = ทุกปี)
  const sem = appState.ui.semesterTab; // '1' | '2' | '3'

  // เคลียร์ทุกภาคด้วยข้อความเริ่มต้น
  ['studentGradesSem1','studentGradesSem2','studentGradesSem3'].forEach(id=>{
    const el = byId(id);
    if (el) el.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>';
  });

  // เกรดทั้งหมดของฉัน (ไว้คำนวณ GPAX)
  const allMy = appState.grades.filter(g => cleanId(g.studentId) === meId);

  // กรองตามปี (ถ้าเลือก) แล้วจัดเรียง
  const myRows = allMy
    .filter(g => !y || parseTerm(g.term).year === y)
    .sort((a,b)=> termSortKey(a.term).localeCompare(termSortKey(b.term)));

  // กระจายลง 3 ภาค
  myRows.forEach(g=>{
    const t = parseTerm(g.term);
    const tb = byId(`studentGradesSem${t.sem}`);
    if (!tb || !t.sem) return;
    if (tb.innerHTML.includes('ยังไม่มีข้อมูล')) tb.innerHTML = '';
    tb.innerHTML += `
      <tr>
        <td class="px-4 py-2">${g.term || '-'}</td>
        <td class="px-4 py-2">${g.courseCode || '-'}</td>
        <td class="px-4 py-2">${g.courseTitle || '-'}</td>
        <td class="px-4 py-2">${g.credits || '-'}</td>
        <td class="px-4 py-2">${g.grade || '-'}</td>
      </tr>
    `;
  });

  // โชว์เฉพาะภาคที่เลือก
  ['1','2','3'].forEach(s=>{
    const el = byId(`studentGradesSem${s}`);
    if (!el) return;
    (s === sem) ? el.classList.remove('hidden') : el.classList.add('hidden');
  });

  // ── สรุปบนหัวแท็บ ──
  // 1) GPA/เครดิตของภาคที่เลือก
  const rowsThisSem = myRows.filter(g => parseTerm(g.term).sem === sem);
  const { gpa: semGPA, credits: semCredits } = computeGPA(rowsThisSem);
  byId('studentSemGPA').textContent = rowsThisSem.length ? semGPA.toFixed(2) : '-';
  byId('studentSemCredits').textContent = rowsThisSem.length ? semCredits : '-';
  
  // 2) GPA ทั้งปีที่เลือก (รวมทุกภาคในปีนั้น)
  if (y) {
    const yearAgg = computeGPA(myRows); // myRows ถูกกรองปีแล้ว
    byId('studentYearGPA').textContent = myRows.length ? yearAgg.gpa.toFixed(2) : '-';
  } else {
    byId('studentYearGPA').textContent = '-';
  }

  // 3) GPA ทั้งปีที่เลือก (รวมทุกภาคในปีนั้น)
  if (y) {
    const yearAgg = computeGPA(myRows); // myRows ถูกกรองปีแล้ว
    byId('studentYearGPA').textContent = myRows.length ? yearAgg.gpa.toFixed(2) : '-';
  } else {
    byId('studentYearGPA').textContent = '-';
  }
}
window.showSemester = function(sem){
  appState.ui.semesterTab = String(sem || '1');
  const tabs = qsa('#studentDashboard .semester-tab');
  tabs.forEach(t=>t.classList.remove('is-active'));
  const idx = appState.ui.semesterTab==='1'?0:appState.ui.semesterTab==='2'?1:2;
  if (tabs[idx]) tabs[idx].classList.add('is-active');
  renderStudentGrades();
};
/***********************
 * ADVISOR VIEW
 ***********************/
function buildAdvisorView(){
  const myName = appState.user.name || '';
  const list = appState.students.filter(s=> (String(s.advisor||'').trim() === String(myName).trim()) );
  renderAdvisorFilters(list);
  renderAdvisorStudents(list);
  renderAdvisorEnglishSummary(list); // << สรุป Pie เฉพาะนักศึกษาที่ดูแล
}
function renderAdvisorFilters(myStudents){
  const yearFilter = byId('advisorYearFilter');
  const searchEl = byId('advisorSearch');
  const aySel = byId('advisorAcademicYear');

  const years = unique(appState.grades.map(g=>parseTerm(g.term).year).filter(Boolean)).sort();
  aySel.innerHTML = `<option value="">ทั้งหมด</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');

  yearFilter.onchange = ()=>renderAdvisorStudents(myStudents);
  searchEl.oninput = ()=>renderAdvisorStudents(myStudents);
  aySel.onchange = ()=>renderAdvisorStudents(myStudents);
}
function renderAdvisorStudents(myStudents){
  const wrap = byId('advisorStudentsList');
  const yearFilter = byId('advisorYearFilter').value;
  const q = byId('advisorSearch').value.trim();
  const ay = byId('advisorAcademicYear').value;

  const rows = myStudents
    .filter(s=>!yearFilter || String(s.year)===yearFilter)
    .filter(s=>!q || String(s.id||'').includes(q) || String(s.name||'').includes(q))
    .sort(sortByStudentIdAsc);

  wrap.innerHTML = rows.map(s=>{
    const stuGrades = appState.grades.filter(g=>cleanId(g.studentId)===cleanId(s.id));
    const filteredByAy = ay ? stuGrades.filter(g=>parseTerm(g.term).year===ay) : stuGrades;
    const gpax = computeGPA(stuGrades).gpa || 0;
    const gpaThisYear = computeGPA(filteredByAy).gpa || 0;

    const myEn = appState.englishTests.filter(t=>cleanId(t.studentId)===cleanId(s.id));
    const latest = latestBy(myEn, t=>`${t.academicYear}-${String(t.attempt).padStart(3,'0')}-${t.examDate||''}`);
    const latestStr = latest ? `${latest.status} (${latest.score})` : '-';

    const detailId = `adv-detail-${s.id}`;
    const btnId = `adv-toggle-${s.id}`;

    return `
         <div class="py-3">
        <div class="flex items-center justify-between">
          <div class="font-medium">${s.id} - ${s.name} <span class="text-sm text-gray-500">ชั้นปี ${s.year} · ที่ปรึกษา: ${s.advisor||'-'}</span></div>
          <div class="flex items-center gap-3">
            <div class="text-sm"><span class="text-gray-500">อังกฤษล่าสุด:</span> <span class="font-semibold">${latestStr}</span></div>
            <button id="${btnId}" class="px-3 py-1 rounded border hover:bg-gray-50" onclick="toggleAdvisorDetail('${detailId}','${btnId}')">ขยาย</button>
          </div>
        </div>
    
        <div id="${detailId}" class="hidden mt-3 bg-gray-50 rounded-lg p-4">
          <!-- สรุป -->
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div class="bg-indigo-50 p-3 rounded">
              <div class="text-xs text-gray-600">GPAX (ตลอดหลักสูตร)</div>
              <div class="text-xl font-semibold text-indigo-800">${gpax ? gpax.toFixed(2): '-'}</div>
            </div>
            <div class="bg-blue-50 p-3 rounded">
              <div class="text-xs text-gray-600">GPA (ตามตัวกรองปี)</div>
              <div class="text-xl font-semibold text-blue-800">${gpaThisYear ? gpaThisYear.toFixed(2): '-'}</div>
            </div>
            <div class="bg-green-50 p-3 rounded">
              <div class="text-xs text-gray-600">หน่วยกิตรวม</div>
              <div class="text-xl font-semibold text-green-800">${computeGPA(stuGrades).credits || 0}</div>
            </div>
            <div class="bg-purple-50 p-3 rounded">
              <div class="text-xs text-gray-600">อังกฤษล่าสุด</div>
              <div class="text-lg font-semibold text-purple-800">${latestStr}</div>
            </div>
          </div>
    
          <!-- ตารางผลการเรียน -->
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-white">
                <tr>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">ปี/ภาค</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">รหัสวิชา</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">รายวิชา</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">หน่วยกิต</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">เกรด</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                ${stuGrades
                  .sort((a,b)=> termSortKey(a.term).localeCompare(termSortKey(b.term)))
                  .map(g=>`
                    <tr>
                      <td class="px-3 py-2">${g.term||'-'}</td>
                      <td class="px-3 py-2">${g.courseCode||'-'}</td>
                      <td class="px-3 py-2">${g.courseTitle||'-'}</td>
                      <td class="px-3 py-2">${g.credits||'-'}</td>
                      <td class="px-3 py-2">${g.grade||'-'}</td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
          <!-- อังกฤษ: ล่าสุด + ปุ่มเลื่อนลง (เดิมคงไว้) -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-semibold">ผลสอบภาษาอังกฤษ</h4>
              <button class="px-2 py-1 text-sm rounded border hover:bg-white" onclick="toggleEnglishAll('${detailId}-en')">แสดง/ซ่อน รายการที่เหลือ</button>
            </div>
            <div>
              ${latest ? `
                <div class="p-3 rounded bg-white border mb-2">
                  <div class="text-sm text-gray-600 mb-1">ล่าสุด</div>
                  <div class="font-medium">ปี ${latest.academicYear} ครั้งที่ ${latest.attempt} คะแนน ${latest.score} (${latest.status})</div>
                </div>
              `: '<div class="text-sm text-gray-500">ไม่มีข้อมูล</div>'}
              <div id="${detailId}-en" class="hidden">
                ${(myEn
                  .filter(t=>t!==latest)
                  .sort((a,b)=>{
                    const ka = `${a.academicYear}-${String(a.attempt).padStart(3,'0')}-${a.examDate||''}`;
                    const kb = `${b.academicYear}-${String(b.attempt).padStart(3,'0')}-${b.examDate||''}`;
                    return kb.localeCompare(ka);
                  })
                  .map(t=>`
                    <div class="p-3 rounded bg-white border mb-2">
                      <div class="font-medium">ปี ${t.academicYear} ครั้งที่ ${t.attempt} คะแนน ${t.score} (${t.status})</div>
                      <div class="text-sm text-gray-500">${t.examDate? String(t.examDate).substring(0,10): '-'}</div>
                    </div>
                  `).join('')) || ''
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}
      window.toggleAdvisorDetail = function(detailId, btnId){
        const box = byId(detailId);
        const btn = byId(btnId);
        const isHidden = box.classList.contains('hidden');
        qsa('#advisorStudentsList > div > div + div').forEach(el=>el.classList.add('hidden'));
        box.classList.toggle('hidden', !isHidden ? true : false);
        if(isHidden){ box.classList.remove('hidden'); btn.textContent='ย่อ'; }
        else { box.classList.add('hidden'); btn.textContent='ขยาย'; }
      };
      window.toggleEnglishAll = function(id){ byId(id).classList.toggle('hidden'); };
      /* Summary Pie เฉพาะนักศึกษาที่ดูแล */
      function renderAdvisorEnglishSummary(myStudents){
        // เก็บ studentIds ที่อาจารย์ดูแล
        const myIds = new Set(myStudents.map(s => cleanId(s.id)));
      
        // group ข้อมูลสอบเฉพาะนักศึกษาที่ดูแล
        const myTests = appState.englishTests.filter(t => myIds.has(cleanId(t.studentId)));
        const byStu = groupBy(myTests, t => cleanId(t.studentId));
      
        let pass = 0, fail = 0;
      
        Object.keys(byStu).forEach(id => {
          const latest = latestBy(
            byStu[id],
            t => `${t.academicYear}-${String(t.attempt).padStart(3,'0')}-${t.examDate || ''}`
          );
          if(!latest) return;
      
          const status = String(latest.status || '').trim();
          if (status === 'ผ่าน') pass++;
          else if (status === 'ไม่ผ่าน') fail++;
          // อื่นๆ เช่น '' 'ยังไม่สอบ' ไม่นับ
        });
      
        const total = pass + fail;
      
        const elP = byId('advEngPass');
        const elF = byId('advEngFail');
        const elT = byId('advEngTotal');
        if (elP) elP.textContent = pass;
        if (elF) elF.textContent = fail;
        if (elT) elT.textContent = total;
      }
/***********************
 * MODALS & STARTUP
 ***********************/
function openModal(id){ byId('modalBackdrop').classList.remove('hidden'); byId(id).classList.remove('hidden'); }
function closeModal(id){ byId('modalBackdrop').classList.add('hidden'); byId(id).classList.add('hidden'); }
window.closeModal = closeModal;
window.addEventListener('DOMContentLoaded', ()=>{ initLogin(); });













