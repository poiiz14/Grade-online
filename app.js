/* ===================== CONFIG ===================== */
/** ใส่ URL /exec ของ Apps Script ที่ deploy แล้ว (แก้เป็นของปอยเอง) */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';
const API_TIMEOUT = 20000;

/* ===================== GLOBAL STATE ===================== */
let GLOBAL_DATA = { students: [], grades: [], englishTests: [], advisors: [] };
let CURRENT_USER = null; // {role,id,name,email}

/* ===================== DOM UTIL ===================== */
const qs  = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const by  = (proj) => (a,b) => (proj(a) < proj(b) ? -1 : (proj(a) > proj(b) ? 1 : 0));

function setText(id, txt){ const el=qs('#'+id); if(el) el.textContent = (txt ?? ''); }
function setHTML(id, html){ const el=qs('#'+id); if(el) el.innerHTML = html; }
function show(id){ qs('#'+id)?.classList.remove('hidden'); }
function hide(id){ qs('#'+id)?.classList.add('hidden'); }

/* ===================== SESSION (คงหน้าเดิมหลังรีเฟรช) ===================== */
function saveSession(data){ try{ localStorage.setItem('session', JSON.stringify(data||{})); }catch{} }
function loadSession(){ try{ return JSON.parse(localStorage.getItem('session')||'null'); }catch{ return null; } }
function clearSession(){ try{ localStorage.removeItem('session'); localStorage.removeItem('activeTab'); localStorage.removeItem('activeRole'); }catch{} }
function saveActiveTab(tab){ try{ localStorage.setItem('activeTab', tab||'adminOverview'); }catch{} }
function loadActiveTab(){ try{ return localStorage.getItem('activeTab')||'adminOverview'; }catch{ return 'adminOverview'; } }
function saveActiveRole(role){ try{ localStorage.setItem('activeRole', role||''); }catch{} }
function loadActiveRole(){ try{ return localStorage.getItem('activeRole')||''; }catch{ return ''; } }

/* ===================== API (JSONP) ===================== */
function callAPI(action, payload={}, timeoutMs=API_TIMEOUT){
  return new Promise((resolve, reject)=>{
    const cb = 'CB_'+Math.random().toString(36).slice(2);
    const url = API_BASE + `?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(JSON.stringify(payload))}&callback=${cb}`;

    const s = document.createElement('script');
    let done=false;
    const cleanup=()=>{ try{ delete window[cb]; }catch{} try{s.remove();}catch{} };
    const timer = setTimeout(()=>{ if(done) return; done=true; cleanup(); reject(new Error('timeout')); }, timeoutMs);

    window[cb] = (res)=>{
      if(done) return; done=true; clearTimeout(timer); cleanup();
      if(!res || res.success===false){ reject(new Error(res?.message||'API error')); return; }
      resolve(res);
    };
    s.onerror = ()=>{ if(done) return; done=true; clearTimeout(timer); cleanup(); reject(new Error('network error')); };
    s.src = url;
    document.body.appendChild(s);
  });
}

/* ===================== GPA / GPAX ===================== */
function gradePoint(g){
  const x = String(g||'').trim().toUpperCase();
  if (x==='A') return 4; if (x==='B+') return 3.5; if (x==='B') return 3;
  if (x==='C+') return 2.5; if (x==='C') return 2; if (x==='D+') return 1.5;
  if (x==='D') return 1; if (x==='F') return 0;
  return null; // W/I/S/U/ฯลฯ ไม่คิด
}
function computeGPA(grades){ // ตามภาค/ปีที่เลือก
  let c=0,p=0;
  (grades||[]).forEach(g=>{
    const gp=gradePoint(g.grade); const cr=Number(g.credits||0);
    if(gp==null || !cr) return; c+=cr; p+=gp*cr;
  });
  return c? (p/c) : 0;
}
function computeGPAX(allGrades){ return computeGPA(allGrades); } // GPAX = รวมทุกปี

function academicYearOf(term){
  const t=String(term||'').trim();
  if(!t) return '';
  const parts=t.split('/');
  return parts.length? parts[0] : '';
}

/* ===================== BOOTSTRAP & REFRESH ONLY DATA ===================== */
async function bootstrapAndRender(keepWhereYouAre=true){
  // โหลดข้อมูลใหม่ แต่คงหน้า/แท็บเดิม
  const boot = await callAPI('bootstrap', {});
  GLOBAL_DATA = boot?.data || GLOBAL_DATA;

  // วาดตามบทบาทที่อยู่
  const role = CURRENT_USER?.role || loadActiveRole();
  setActiveDashboard(role);

  if(role==='admin'){
    const tab = keepWhereYouAre ? loadActiveTab() : 'adminOverview';
    activateAdminTab(tab.replace('#',''));
    if(tab==='adminOverview') buildAdminOverview();
    if(tab==='adminIndividual') buildAdminIndividual();
  }else if(role==='student'){
    buildStudentView();
  }else if(role==='advisor'){
    buildAdvisorView();
  }
}

/* ===================== NAV / ROUTING ===================== */
function goToDashboard(){ hide('loginPage'); show('dashboard'); }
function goToLogin(){ hide('dashboard'); show('loginPage'); }
function setActiveDashboard(role){
  ['adminDashboard','studentDashboard','advisorDashboard'].forEach(id=>hide(id));
  if(role==='admin') show('adminDashboard');
  else if(role==='advisor') show('advisorDashboard');
  else show('studentDashboard');
  saveActiveRole(role||'');
  qs('#dashboardTitle') && (qs('#dashboardTitle').textContent =
    role==='admin' ? 'แดชบอร์ดผู้ดูแลระบบ' :
    role==='advisor' ? 'แดชบอร์ดอาจารย์ที่ปรึกษา' : 'แดชบอร์ดนักศึกษา');
  // topbar
  qs('#btnChangePassword')?.classList.toggle('hidden', !(role==='admin'||role==='advisor'));
}

/* ===================== AUTH ===================== */
async function login(){
  try{
    const role = (qs('#userType')?.value || 'admin').toLowerCase();
    let credentials = {};
    if(role==='admin' || role==='advisor'){
      const email = (qs('#email')?.value||'').trim();
      const password = (qs('#password')?.value||'').trim();
      if(!email || !password){ Swal.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
      credentials = { email, password };
    }else if(role==='student'){
      const citizenId = (qs('#citizenId')?.value||'').replace(/\s|-/g,'');
      if(!citizenId){ Swal.fire({icon:'warning',title:'กรอกเลขบัตรประชาชน'}); return; }
      credentials = { citizenId };
    }

    Swal.fire({title:'กำลังเข้าสู่ระบบ...', allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
    const auth = await callAPI('authenticate', { userType: role, credentials });
    if(!auth?.success) throw new Error(auth?.message||'เข้าสู่ระบบไม่สำเร็จ');

    const boot = await callAPI('bootstrap', {});
    GLOBAL_DATA = boot?.data || GLOBAL_DATA;
    CURRENT_USER = auth.data;

    saveSession({ role: CURRENT_USER.role, id: CURRENT_USER.id, name: CURRENT_USER.name, email: CURRENT_USER.email||'' });
    saveActiveRole(CURRENT_USER.role);
    Swal.close();

    goToDashboard();
    setActiveDashboard(CURRENT_USER.role);
    if(role==='admin'){ activateAdminTab('adminOverview'); buildAdminOverview(); }
    else if(role==='advisor'){ buildAdvisorView(); }
    else { buildStudentView(); }

  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}
function logout(){ clearSession(); CURRENT_USER=null; GLOBAL_DATA={students:[],grades:[],englishTests:[],advisors:[]}; goToLogin(); }

/* ===================== ADMIN: Tabs ===================== */
function wireAdminTabs(){
  qsa('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      qsa('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab') || 'adminOverview';
      activateAdminTab(tab);
      saveActiveTab(tab);
    });
  });
}
function activateAdminTab(tab){
  ['adminOverview','adminIndividual','adminData'].forEach(id=>hide(id));
  show(tab);
  if(tab==='adminOverview') buildAdminOverview();
  if(tab==='adminIndividual') buildAdminIndividual();
}

/* ===================== ADMIN: Overview ===================== */
function buildAdminOverview(){
  const students = GLOBAL_DATA.students||[];
  const grades   = GLOBAL_DATA.grades||[];
  const english  = GLOBAL_DATA.englishTests||[];

  // KPI
  setText('totalStudents', students.length);
  const passLatestMap = latestEnglishMap(english);
  const passed = Object.values(passLatestMap).filter(x=>String(x.status||'').includes('ผ่าน')).length;
  setText('passedEnglish', passed);

  // จำนวนวิชา (unique by courseCode or courseTitle)
  const unique = new Set();
  (grades||[]).forEach(g=>{
    const key = (g.courseCode && String(g.courseCode).trim()) || (g.courseTitle && String(g.courseTitle).trim());
    if(key) unique.add(key);
  });
  setText('totalSubjects', unique.size);

  // Chart: สัดส่วนชั้นปี (ใช้ Chart.js จาก index.html แล้ว)
  const byYear = [1,2,3,4].map(y=>students.filter(s=>String(s.year)===String(y)).length);
  const ctx = qs('#studentsChart');
  if(!ctx) return;
  if(window.studentsChartInst){ window.studentsChartInst.destroy(); }
  window.studentsChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['ปี1','ปี2','ปี3','ปี4'], datasets:[{ data: byYear }] },
    options: { responsive:true, maintainAspectRatio:false }
  });
}

/* ===================== ADMIN: Individual ===================== */
function buildAdminIndividual(){
  // เติมรายชื่อนักศึกษา — เรียงตาม "รหัสนักศึกษา"
  const sel = qs('#adminIndSelect');
  const search = qs('#adminIndSearch');
  const yearSel= qs('#adminIndYear');

  function fillStudentOptions(){
    if(!sel) return;
    const kw = (search?.value||'').trim().toLowerCase();
    const list = (GLOBAL_DATA.students||[])
      .filter(s=>!kw || String(s.name||'').toLowerCase().includes(kw) || String(s.id||'').includes(kw))
      .sort(by(s=>String(s.id||''))); // <-- เรียงตามรหัสนักศึกษา
    sel.innerHTML = `<option value="">-- เลือกนักศึกษา --</option>`;
    list.forEach(s=>{
      const opt=document.createElement('option');
      opt.value = s.id; opt.textContent = `[${s.id}] ${s.name}`;
      sel.appendChild(opt);
    });
  }

  function fillYearOptions(studentId){
    if(!yearSel) return;
    const gs = (GLOBAL_DATA.grades||[]).filter(g=>String(g.studentId)===String(studentId));
    const years = Array.from(new Set(gs.map(g=>academicYearOf(g.term)).filter(Boolean))).sort();
    yearSel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  }

  function renderStudentDetail(studentId){
    if(!studentId){ // clear
      setText('detailStudentId','-'); setText('detailStudentName','-'); setText('detailStudentYear','-'); setText('detailStudentAdvisor','-');
      setText('adminIndYearGPA','-'); setText('adminIndYearCredits','-'); setText('adminIndGPAX','-');
      setHTML('englishTestTable',''); setHTML('gradesDetailTable','');
      return;
    }
    const s = (GLOBAL_DATA.students||[]).find(x=>String(x.id)===String(studentId));
    const allG = (GLOBAL_DATA.grades||[]).filter(g=>String(g.studentId)===String(studentId));
    const allE = (GLOBAL_DATA.englishTests||[]).filter(e=>String(e.studentId)===String(studentId));

    setText('detailStudentId', s?.id||'-');
    setText('detailStudentName', s?.name||'-');
    setText('detailStudentYear', s?.year||'-');
    setText('detailStudentAdvisor', s?.advisor||'-');

    // GPAX รวมทุกปี
    setText('adminIndGPAX', (computeGPAX(allG)||0).toFixed(2));

    // เติมตัวเลือกปี
    fillYearOptions(studentId);
    updateYearKPIs();

    // English table (แก้ปัญหาไม่แสดง)
    const etb = qs('#englishTestTable');
    if(etb){
      etb.innerHTML='';
      allE
        .sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0))
        .forEach(r=>{
          const tr=document.createElement('tr');
          tr.innerHTML = `
            <td class="px-4 py-2 text-sm">${r.academicYear||''}</td>
            <td class="px-4 py-2 text-sm">${r.attempt||''}</td>
            <td class="px-4 py-2 text-sm">${r.score||''}</td>
            <td class="px-4 py-2 text-sm">${r.status||''}</td>
            <td class="px-4 py-2 text-sm">${r.examDate||''}</td>
            <td class="px-4 py-2 text-right">
              <button class="text-blue-600 hover:underline" onclick="openEditEnglish('${s.id}','${guessYearSheet(s.year)}','${r.academicYear}','${r.attempt}','${r.score||''}','${r.status||''}','${r.examDate||''}')">แก้ไข</button>
            </td>`;
          etb.appendChild(tr);
        });
    }

    // Grades table
    const gtb = qs('#gradesDetailTable');
    if(gtb){
      gtb.innerHTML='';
      allG
        .sort(by(g=>String(g.term||'')))
        .forEach(g=>{
          const tr=document.createElement('tr');
          const fileId = g.fileId||''; const sheet = g.sheet||'';
          tr.innerHTML = `
            <td class="px-4 py-2 text-sm">${g.term||''}</td>
            <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
            <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
            <td class="px-4 py-2 text-sm">${g.credits||''}</td>
            <td class="px-4 py-2 text-sm">${g.grade||''}</td>
            <td class="px-4 py-2 text-right">
              <button class="text-blue-600 hover:underline"
                onclick="openEditGrade('${s.id}','${fileId}','${sheet}','${g.term||''}','${(g.courseCode||'').replace(/"/g,'&quot;')}','${(g.courseTitle||'').replace(/"/g,'&quot;')}','${g.credits||''}','${g.grade||''}','${g.recordedAt||''}')">แก้ไข</button>
            </td>`;
          gtb.appendChild(tr);
        });
    }

    // ปุ่ม modal: แก้ไขข้อมูลนักศึกษา / เพิ่มรายการ
    const btnEdit = qs('#btnEditStudent');
    const btnAddG = qs('#btnAddGrade');
    const btnAddE = qs('#btnAddEnglish');

    btnEdit && (btnEdit.onclick = ()=>{
      qs('#editStudentId').value      = s?.id||'';
      qs('#editStudentName').value    = s?.name||'';
      qs('#editStudentAdvisor').value = s?.advisor||'';
      qs('#editStudentNewId').value   = '';
      qs('#editStudentYear').value    = s?.year||'1';
      openModal('modalEditStudent');
    });

    btnAddG && (btnAddG.onclick = ()=>{
      qs('#gradeStudentId').value   = s?.id||'';
      qs('#gradeTerm').value        = '';
      qs('#gradeCourseCode').value  = '';
      qs('#gradeCourseTitle').value = '';
      qs('#gradeCredits').value     = '';
      qs('#gradeGrade').value       = '';
      qs('#gradeRecordedAt').value  = '';
      openModal('modalAddGrade');
    });

    btnAddE && (btnAddE.onclick = ()=>{
      qs('#engStudentId').value     = s?.id||'';
      qs('#engAcademicYear').value  = '';
      qs('#engAttempt').value       = '';
      qs('#engScore').value         = '';
      qs('#engStatus').value        = '';
      qs('#engExamDate').value      = '';
      openModal('modalAddEnglish');
    });

    function updateYearKPIs(){
      const y = yearSel?.value || '';
      const gy = y ? allG.filter(g=>academicYearOf(g.term)===y) : allG;
      const gpa = computeGPA(gy)||0;
      const credits = (gy||[]).reduce((acc,g)=>acc + Number(g.credits||0), 0);
      setText('adminIndYearGPA', gpa.toFixed(2));
      setText('adminIndYearCredits', credits||0);
    }

    yearSel && (yearSel.onchange = updateYearKPIs);
  }

  function onSelectChanged(){
    const sid = sel?.value || '';
    renderStudentDetail(sid);
  }

  search && (search.oninput = ()=>fillStudentOptions());
  sel && (sel.onchange = onSelectChanged);

  fillStudentOptions();
  // ถ้ามีค่าที่เลือกไว้ก่อน (refresh)
  if(sel && sel.value){ renderStudentDetail(sel.value); }
}

/* ===================== ADMIN: Modals & Actions ===================== */
async function saveEditStudent(){
  try{
    const id      = qs('#editStudentId').value.trim();
    const name    = qs('#editStudentName').value.trim();
    const advisor = qs('#editStudentAdvisor').value.trim();
    const newId   = qs('#editStudentNewId').value.trim();
    const year    = (qs('#editStudentYear').value||'').trim();

    Swal.fire({title:'กำลังบันทึก...',allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
    const res = await callAPI('updatestudent', { id, name, advisor, newId, year });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');
    Swal.close(); closeModal('modalEditStudent');

    await bootstrapAndRender(true);
    Swal.fire({icon:'success',title:'บันทึกแล้ว'});
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

async function saveAddGrade(){
  try{
    const studentId   = (qs('#gradeStudentId').value||'').trim();
    const term        = (qs('#gradeTerm').value||'').trim();
    const courseCode  = (qs('#gradeCourseCode').value||'').trim();
    const courseTitle = (qs('#gradeCourseTitle').value||'').trim();
    const credits     = Number(qs('#gradeCredits').value||0);
    const grade       = (qs('#gradeGrade').value||'').trim();
    const recordedAt  = qs('#gradeRecordedAt').value ? new Date(qs('#gradeRecordedAt').value).toISOString() : '';

    Swal.fire({title:'กำลังเพิ่ม...',allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
    const res = await callAPI('addgrade', { studentId, term, courseCode, courseTitle, credits, grade, recordedAt });
    if(!res?.success) throw new Error(res?.message||'เพิ่มไม่สำเร็จ');
    Swal.close(); closeModal('modalAddGrade');

    await bootstrapAndRender(true);
    Swal.fire({icon:'success',title:'เพิ่มแล้ว'});
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

async function saveAddEnglish(){
  try{
    const studentId   = (qs('#engStudentId').value||'').trim();
    const academicYear= (qs('#engAcademicYear').value||'').trim();
    const attempt     = (qs('#engAttempt').value||'').trim();
    const score       = (qs('#engScore').value||'').trim();
    const status      = (qs('#engStatus').value||'').trim();
    const examDate    = qs('#engExamDate').value ? new Date(qs('#engExamDate').value).toISOString() : '';

    Swal.fire({title:'กำลังเพิ่ม...',allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
    const res = await callAPI('addenglishtest', { studentId, academicYear, attempt, score, status, examDate });
    if(!res?.success) throw new Error(res?.message||'เพิ่มไม่สำเร็จ');
    Swal.close(); closeModal('modalAddEnglish');

    await bootstrapAndRender(true);
    Swal.fire({icon:'success',title:'เพิ่มแล้ว'});
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

// Edit Grade
function openEditGrade(studentId,fileId,sheet,term,code,title,credits,grade,recordedAt){
  qs('#editGradeStudentId').value = studentId||'';
  qs('#editGradeFileId').value    = fileId||'';
  qs('#editGradeSheet').value     = sheet||'';
  qs('#editGradeOldTerm').value   = term||'';
  qs('#editGradeOldCode').value   = code||'';
  qs('#editGradeOldTitle').value  = title||'';

  qs('#editGradeTerm').value        = term||'';
  qs('#editGradeCourseCode').value  = code||'';
  qs('#editGradeCourseTitle').value = title||'';
  qs('#editGradeCredits').value     = credits||'';
  qs('#editGradeGrade').value       = grade||'';
  qs('#editGradeRecordedAt').value  = recordedAt ? (new Date(recordedAt)).toISOString().slice(0,10) : '';
  openModal('modalEditGrade');
}
qs('#btnSaveEditGrade')?.addEventListener('click', async ()=>{
  try{
    const studentId = qs('#editGradeStudentId').value||'';
    const fileId = qs('#editGradeFileId').value||'';
    const sheet  = qs('#editGradeSheet').value||'';
    const old = {
      term: qs('#editGradeOldTerm').value||'',
      courseCode: qs('#editGradeOldCode').value||'',
      courseTitle: qs('#editGradeOldTitle').value||''
    };
    const nu  = {
      term: qs('#editGradeTerm').value||'',
      courseCode: qs('#editGradeCourseCode').value||'',
      courseTitle: qs('#editGradeCourseTitle').value||'',
      credits: Number(qs('#editGradeCredits').value||0),
      grade: qs('#editGradeGrade').value||'',
      recordedAt: qs('#editGradeRecordedAt').value ? new Date(qs('#editGradeRecordedAt').value).toISOString() : ''
    };
    Swal.fire({title:'กำลังบันทึก...',allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
    const res = await callAPI('updategrade', { studentId, fileId, sheet, old, new: nu });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');
    closeModal('modalEditGrade'); Swal.close();
    await bootstrapAndRender(true);
    Swal.fire({icon:'success',title:'บันทึกแล้ว'});
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
});

// Edit English
function openEditEnglish(studentId,sheet,academicYear,attempt,score,status,examDate){
  qs('#editEngStudentId').value = studentId||'';
  qs('#editEngSheet').value     = sheet||'';
  qs('#editEngOldYear').value   = academicYear||'';
  qs('#editEngOldAttempt').value= attempt||'';

  qs('#editEngAcademicYear').value = academicYear||'';
  qs('#editEngAttempt').value      = attempt||'';
  qs('#editEngScore').value        = score||'';
  qs('#editEngStatus').value       = status||'';
  qs('#editEngExamDate').value     = examDate ? (new Date(examDate)).toISOString().slice(0,10) : '';
  openModal('modalEditEnglish');
}
qs('#btnSaveEditEnglish')?.addEventListener('click', async ()=>{
  try{
    const studentId = qs('#editEngStudentId').value||'';
    const sheet     = qs('#editEngSheet').value||'';
    const old = { academicYear: qs('#editEngOldYear').value||'', attempt: qs('#editEngOldAttempt').value||'' };
    const nu  = {
      academicYear: qs('#editEngAcademicYear').value||'',
      attempt: qs('#editEngAttempt').value||'',
      score: qs('#editEngScore').value||'',
      status: qs('#editEngStatus').value||'',
      examDate: qs('#editEngExamDate').value ? new Date(qs('#editEngExamDate').value).toISOString() : ''
    };
    Swal.fire({title:'กำลังบันทึก...',allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
    const res = await callAPI('updateenglishtest', { studentId, sheet, old, new: nu });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');
    closeModal('modalEditEnglish'); Swal.close();
    await bootstrapAndRender(true);
    Swal.fire({icon:'success',title:'บันทึกแล้ว'});
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
});

function guessYearSheet(studentYear){
  const y=String(studentYear||'').trim();
  if(['1','2','3','4'].includes(y)) return 'Year'+y;
  // เดาไม่ได้ก็คืน Year1 ไปก่อน
  return 'Year1';
}

/* ===================== STUDENT VIEW ===================== */
function buildStudentView(){
  const me = CURRENT_USER || loadSession() || {};
  const myId = me.id;
  const myGrades = (GLOBAL_DATA.grades||[]).filter(g=>String(g.studentId)===String(myId));
  const myEng    = (GLOBAL_DATA.englishTests||[]).filter(e=>String(e.studentId)===String(myId));

  setText('studentGPAX', (computeGPAX(myGrades)||0).toFixed(2));
  const credits = (myGrades||[]).reduce((acc,g)=>acc + Number(g.credits||0), 0);
  setText('studentCredits', credits||0);

  // English latest
  const latest = latestEnglishMap(myEng);
  const meLatest = latest[String(myId)];
  setText('studentEnglishStatus', meLatest ? `${meLatest.status||'-'} (${meLatest.score||'-'})` : '-');

  // Year filter
  const aySel = qs('#studentAcademicYear');
  if(aySel){
    const years = Array.from(new Set((myGrades||[]).map(g=>academicYearOf(g.term)).filter(Boolean))).sort();
    aySel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
    aySel.onchange = ()=>renderStudentTables(aySel.value);
  }
  renderStudentTables('');
}
function renderStudentTables(yearFilter){
  const me = CURRENT_USER || loadSession() || {};
  const myId = me.id;
  const myGrades = (GLOBAL_DATA.grades||[]).filter(g=>String(g.studentId)===String(myId) && (!yearFilter || academicYearOf(g.term)===yearFilter));
  const myEng    = (GLOBAL_DATA.englishTests||[]).filter(e=>String(e.studentId)===String(myId));

  const gtb = qs('#studentGradesTable');
  if(gtb){
    gtb.innerHTML='';
    myGrades.sort(by(g=>String(g.term||''))).forEach(g=>{
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-2 text-sm">${g.term||''}</td>
        <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
        <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
        <td class="px-4 py-2 text-sm">${g.credits||''}</td>
        <td class="px-4 py-2 text-sm">${g.grade||''}</td>`;
      gtb.appendChild(tr);
    });
  }

  const etb = qs('#studentEnglishTable');
  if(etb){
    etb.innerHTML='';
    myEng
      .sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0))
      .forEach(r=>{
        const tr=document.createElement('tr');
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm">${r.academicYear||''}</td>
          <td class="px-4 py-2 text-sm">${r.attempt||''}</td>
          <td class="px-4 py-2 text-sm">${r.score||''}</td>
          <td class="px-4 py-2 text-sm">${r.status||''}</td>
          <td class="px-4 py-2 text-sm">${r.examDate||''}</td>`;
        etb.appendChild(tr);
      });
  }
}

/* ===================== ADVISOR VIEW (accordion + latest English) ===================== */
function latestEnglishMap(englishArr){
  const map={}; // id -> latestObj
  (englishArr||[]).forEach(x=>{
    const id=String(x.studentId||'');
    const t = Date.parse(x.examDate||'')||0;
    if(!map[id] || (Date.parse(map[id].examDate||'')||0) < t){ map[id]=x; }
  });
  return map;
}

function buildAdvisorView(){
  const me = CURRENT_USER || loadSession() || {};
  const myEmail = (me.email||'').trim().toLowerCase();
  // นักศึกษาที่ที่ปรึกษาดูแล
  const advisees = (GLOBAL_DATA.students||[]).filter(s=>String(s.advisor||'').trim().toLowerCase()===myEmail || String(s.advisor||'').includes(me.name||''));
  setText('advTotal', advisees.length);
  setText('advY1', advisees.filter(s=>String(s.year)==='1').length);
  setText('advY2', advisees.filter(s=>String(s.year)==='2').length);
  setText('advY3', advisees.filter(s=>String(s.year)==='3').length);
  setText('advY4', advisees.filter(s=>String(s.year)==='4').length);

  const latestAll = latestEnglishMap(GLOBAL_DATA.englishTests||[]);
  // Chart รวมสถานะล่าสุด
  const statusCount = {};
  advisees.forEach(s=>{
    const le = latestAll[String(s.id)];
    const st = le ? (le.status||'-') : 'ไม่มีข้อมูล';
    statusCount[st] = (statusCount[st]||0)+1;
  });
  const ctx = qs('#englishChart');
  if(ctx){
    if(window.englishChartInst) window.englishChartInst.destroy();
    window.englishChartInst = new Chart(ctx, {
      type:'bar',
      data:{ labels:Object.keys(statusCount), datasets:[{ data:Object.values(statusCount) }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }

  // dropdown ปีการศึกษา (filter สำหรับรายการล่าง)
  const aySel = qs('#advisorAcademicYear');
  if(aySel){
    const years = Array.from(new Set((GLOBAL_DATA.grades||[])
      .filter(g=>advisees.some(s=>String(s.id)===String(g.studentId)))
      .map(g=>academicYearOf(g.term))
      .filter(Boolean))).sort();
    aySel.innerHTML = `<option value="">ทั้งหมด</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
    aySel.onchange = renderAdvisorList;
  }

  renderAdvisorList();

  // ตารางสรุปอังกฤษล่าสุด (หัวตารางด้านล่าง)
  const etb = qs('#advisorEnglishTable');
  if(etb){
    etb.innerHTML='';
    advisees.forEach(s=>{
      const le = latestAll[String(s.id)];
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-2 text-sm">${s.id||''}</td>
        <td class="px-4 py-2 text-sm">${s.name||''}</td>
        <td class="px-4 py-2 text-sm">${s.year||''}</td>
        <td class="px-4 py-2 text-sm">${le? (le.status||'-') : '-'}</td>
        <td class="px-4 py-2 text-sm">${le? (le.score||'-') : '-'}</td>`;
      etb.appendChild(tr);
    });
  }

  function renderAdvisorList(){
    const yearFilter = aySel?.value || '';
    const list = qs('#advisorStudentsList'); if(!list) return;
    list.innerHTML='';

    advisees.sort(by(s=>s.name||'')).forEach(s=>{
      // header (คลิกเพื่อขยาย)
      const le = latestAll[String(s.id)];
      const item = document.createElement('div');
      item.className = 'border-b';

      const header = document.createElement('button');
      header.className = 'w-full text-left p-4 flex items-center justify-between hover:bg-gray-50';
      header.innerHTML = `
        <div>
          <div class="font-medium">${s.name||''}</div>
          <div class="text-xs text-gray-500">รหัส: ${s.id||''} • ชั้นปี: ${s.year||'-'} • อาจารย์ที่ปรึกษา: ${s.advisor||'-'}</div>
          <div class="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="bg-blue-50 rounded-lg p-2 text-sm"><div class="text-gray-600">GPA (ปีที่เลือก)</div><div class="font-semibold" id="gpa-${s.id}">-</div></div>
            <div class="bg-purple-50 rounded-lg p-2 text-sm"><div class="text-gray-600">GPAX (รวม)</div><div class="font-semibold" id="gpax-${s.id}">-</div></div>
            <div class="bg-green-50 rounded-lg p-2 text-sm"><div class="text-gray-600">หน่วยกิต (ปีที่เลือก)</div><div class="font-semibold" id="cr-${s.id}">-</div></div>
            <div class="bg-amber-50 rounded-lg p-2 text-sm"><div class="text-gray-600">อังกฤษ (ล่าสุด)</div><div class="font-semibold">${le? (le.status||'-') : '-'}</div></div>
          </div>
        </div>
        <i class="fa fa-chevron-down ml-4"></i>`;
      item.appendChild(header);

      const body = document.createElement('div');
      body.className = 'hidden px-4 pb-4';
      body.innerHTML = `
        <div class="mt-4">
          <h4 class="font-semibold mb-2">ผลการเรียน ${yearFilter?`(ปี ${yearFilter})`:''}</h4>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">ภาคการศึกษา</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">รหัสวิชา</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">รายวิชา</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">หน่วยกิต</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">เกรด</th>
                </tr>
              </thead>
              <tbody id="adg-${s.id}"></tbody>
            </table>
          </div>
        </div>

        <div class="mt-6">
          <h4 class="font-semibold mb-2">ผลสอบภาษาอังกฤษ (ขยายเพื่อดูทั้งหมด)</h4>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">ปีการศึกษา</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">ครั้งที่สอบ</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">คะแนน</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">สถานะ</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">วันที่สอบ</th>
                </tr>
              </thead>
              <tbody id="aeng-${s.id}"></tbody>
            </table>
          </div>
        </div>`;
      item.appendChild(body);

      header.addEventListener('click', ()=>{
        body.classList.toggle('hidden');
        // render เมื่อเปิด
        if(!body.classList.contains('hidden')){
          const sgAll = (GLOBAL_DATA.grades||[]).filter(g=>String(g.studentId)===String(s.id));
          const sg = yearFilter? sgAll.filter(g=>academicYearOf(g.term)===yearFilter) : sgAll;
          const se = (GLOBAL_DATA.englishTests||[]).filter(e=>String(e.studentId)===String(s.id));

          const gpa = computeGPA(sg)||0;
          const gpax = computeGPAX(sgAll)||0;
          const cr = (sg||[]).reduce((acc,g)=>acc+Number(g.credits||0),0);
          setText(`gpa-${s.id}`, gpa.toFixed(2));
          setText(`gpax-${s.id}`, gpax.toFixed(2));
          setText(`cr-${s.id}`, cr||0);

          const gtb = qs(`#adg-${s.id}`); if(gtb){
            gtb.innerHTML='';
            sg.sort(by(g=>String(g.term||''))).forEach(x=>{
              const tr=document.createElement('tr');
              tr.innerHTML = `
                <td class="px-3 py-2 text-sm">${x.term||''}</td>
                <td class="px-3 py-2 text-sm">${x.courseCode||''}</td>
                <td class="px-3 py-2 text-sm">${x.courseTitle||''}</td>
                <td class="px-3 py-2 text-sm">${x.credits||''}</td>
                <td class="px-3 py-2 text-sm">${x.grade||''}</td>`;
              gtb.appendChild(tr);
            });
          }
          const etb = qs(`#aeng-${s.id}`); if(etb){
            etb.innerHTML='';
            se
              .sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0))
              .forEach(r=>{
                const tr=document.createElement('tr');
                tr.innerHTML = `
                  <td class="px-3 py-2 text-sm">${r.academicYear||''}</td>
                  <td class="px-3 py-2 text-sm">${r.attempt||''}</td>
                  <td class="px-3 py-2 text-sm">${r.score||''}</td>
                  <td class="px-3 py-2 text-sm">${r.status||''}</td>
                  <td class="px-3 py-2 text-sm">${r.examDate||''}</td>`;
                etb.appendChild(tr);
              });
          }
        }
      });

      list.appendChild(item);
    });
  }
}

/* ===================== CHANGE PASSWORD (admin / advisor) ===================== */
function openChangePasswordModal(mode){
  if(mode==='submit'){
    changePassword(); return;
  }
  const me = CURRENT_USER || loadSession() || {};
  qs('#cpEmail').value = me.email||'';
  openModal('modalChangePassword');
}
async function changePassword(){
  try{
    const me = CURRENT_USER || loadSession() || {};
    const userType = me.role;
    const email = (qs('#cpEmail').value||'').trim();
    const oldPassword = (qs('#cpOld').value||'').trim();
    const newPassword = (qs('#cpNew').value||'').trim();
    if(!email||!oldPassword||!newPassword){ Swal.fire({icon:'warning',title:'ข้อมูลไม่ครบ'}); return; }
    Swal.fire({title:'กำลังบันทึก...',allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
    const res = await callAPI('changepassword', { userType, email, oldPassword, newPassword });
    if(!res?.success) throw new Error(res?.message||'ไม่สำเร็จ');
    closeModal('modalChangePassword'); Swal.close();
    Swal.fire({icon:'success',title:'บันทึกรหัสผ่านแล้ว'});
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/* ===================== MODAL HELPERS ===================== */
function openModal(id){ show('modalBackdrop'); show(id); }
function closeModal(id){ hide(id); hide('modalBackdrop'); }

/* ===================== BOOT (persist page after refresh) ===================== */
document.addEventListener('DOMContentLoaded', async ()=>{
  // toggle login inputs by userType
  const userTypeSel = qs('#userType');
  const adminAdvisor = qs('#adminAdvisorLogin');
  const stuLogin = qs('#studentLogin');
  if(userTypeSel){
    userTypeSel.onchange = ()=>{
      const v = userTypeSel.value;
      if(v==='student'){ adminAdvisor.classList.add('hidden'); stuLogin.classList.remove('hidden'); }
      else { stuLogin.classList.add('hidden'); adminAdvisor.classList.remove('hidden'); }
    };
  }

  wireAdminTabs();

  const sess = loadSession();
  if(sess && sess.role){
    // keep current screen & refresh data only
    CURRENT_USER = sess;
    goToDashboard();
    await bootstrapAndRender(true);
  }else{
    goToLogin();
  }
});

/* ===================== EXPORTS ===================== */
window.login = login;
window.logout = logout;
window.openChangePasswordModal = openChangePasswordModal;
window.saveEditStudent = saveEditStudent;
window.saveAddGrade = saveAddGrade;
window.saveAddEnglish = saveAddEnglish;
window.setActiveDashboard = setActiveDashboard;
window.openEditGrade = openEditGrade;
window.openEditEnglish = openEditEnglish;
