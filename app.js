/* ===================== CONFIG ===================== */
/** ใส่ URL /exec ของ Apps Script ที่ deploy แล้ว (แก้เป็นของปอยเอง) */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

/* ===================== STATE ===================== */
let GLOBAL_DATA = { students: [], grades: [], englishTests: [], advisors: [] };
let CURRENT_USER = null;

// charts
let studentsChartInst = null;
let englishChartInst = null;

/* ===================== UTIL ===================== */
const qs  = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const by  = (proj) => (a,b) => (proj(a) < proj(b) ? -1 : (proj(a) > proj(b) ? 1 : 0));
const toInt = v => (v==null || v==='') ? 0 : parseInt(v,10);

function setText(id, v){ const el = document.getElementById(id); if (el) el.textContent = (v==null ? '' : String(v)); }

/** JSONP call */
function callAPI(action, data = {}, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random()*1e6);
    const payloadStr = encodeURIComponent(JSON.stringify(data||{}));
    const url = `${API_BASE}?action=${encodeURIComponent(action)}&payload=${payloadStr}&callback=${cb}&_ts=${Date.now()}`;

    const s = document.createElement('script');
    let done = false;
    const cleanup = () => { try{ delete window[cb]; }catch{} try{s.remove();}catch{} };

    const timer = setTimeout(()=>{ if(done) return; done=true; cleanup(); reject(new Error('API timeout')); }, timeoutMs);

    window[cb] = (res) => {
      if(done) return; done=true; clearTimeout(timer); cleanup();
      if(!res || res.success===false){ reject(new Error(res?.message||'API error')); return; }
      resolve(res);
    };

    s.src = url;
    s.onerror = () => { if(done) return; done=true; clearTimeout(timer); cleanup(); reject(new Error('Network error')); };
    document.body.appendChild(s);
  });
}

/** Session helpers */
function saveSession(data){ try{ localStorage.setItem('session', JSON.stringify(data||{})); }catch{} }
function loadSession(){ try{ return JSON.parse(localStorage.getItem('session')||'null'); }catch{ return null; } }
function clearSession(){ try{ localStorage.removeItem('session'); }catch{} }

/** GPA helpers */
function gradePoint(g){
  const x = String(g||'').toUpperCase().trim();
  if (x==='A') return 4;
  if (x==='B+') return 3.5;
  if (x==='B') return 3;
  if (x==='C+') return 2.5;
  if (x==='C') return 2;
  if (x==='D+') return 1.5;
  if (x==='D') return 1;
  if (x==='F') return 0;
  return null; // W/I/S/U etc.
}
function uniqueCreditsSum(grades){
  const seen = new Map();
  (grades||[]).forEach(g=>{
    const key = (g.courseCode && String(g.courseCode).trim()) || (g.courseTitle && String(g.courseTitle).trim());
    if(!key) return;
    if(!seen.has(key)) seen.set(key, Number(g.credits||0));
  });
  let sum=0; for(const v of seen.values()) sum += Number(v||0);
  return sum;
}
function computeGPAX(allGrades){
  let totCred=0, totPts=0;
  (allGrades||[]).forEach(g=>{
    const gp = gradePoint(g.grade);
    const cr = Number(g.credits||0);
    if (gp==null || !cr) return;
    totCred += cr;
    totPts  += gp*cr;
  });
  return totCred ? (totPts/totCred) : 0;
}

/** term helpers */
function academicYearOf(term){ if(!term) return ''; const s=String(term).split('/'); return s[0]||''; }
function semesterOf(term){ if(!term) return ''; const s=String(term).split('/'); return s[1]||''; }

/** english latest per student */
function latestEnglishMap(tests){
  const map = {};
  (tests||[]).forEach(t=>{
    const sid = String(t.studentId||'').trim();
    if(!sid) return;
    const cur = map[sid];
    const curTime = cur && Date.parse(cur.examDate) ? Date.parse(cur.examDate) : -1;
    const nowTime = Date.parse(t.examDate) ? Date.parse(t.examDate) : -1;
    if (nowTime > curTime) { map[sid] = t; return; }
    if (nowTime===-1 && curTime===-1) {
      const ca = toInt(cur?.attempt||0), na = toInt(t.attempt||0);
      if (na >= ca) map[sid] = t;
    }
  });
  return map;
}

function gradesOf(grades, studentId){
  const sid = String(studentId||'').trim();
  return (grades||[]).filter(g => String(g.studentId||'').trim() === sid);
}

/* ===================== UI NAV ===================== */
function goToDashboard(){ qs('#loginScreen')?.classList.add('hidden'); qs('#dashboard')?.classList.remove('hidden'); }
function goToLogin(){ qs('#dashboard')?.classList.add('hidden'); qs('#loginScreen')?.classList.remove('hidden'); }
function logout(){ clearSession(); CURRENT_USER=null; GLOBAL_DATA={ students:[], grades:[], englishTests:[], advisors:[] }; goToLogin(); }

/** เปิด dashboard ตามบทบาท */
function setActiveDashboard(role){
  ['adminDashboard','studentDashboard','advisorDashboard'].forEach(id=>qs('#'+id)?.classList.add('hidden'));
  if (role==='admin') qs('#adminDashboard')?.classList.remove('hidden');
  else if (role==='advisor') qs('#advisorDashboard')?.classList.remove('hidden');
  else qs('#studentDashboard')?.classList.remove('hidden');
}

/* ===================== AUTH ===================== */
async function login(){
  try{
    const role = (qs('#userType')?.value || 'admin').toLowerCase();
    let credentials = {};
    if (role==='admin'){
      const email = (qs('#adminEmail')?.value||'').trim();
      const password = qs('#adminPassword')?.value||'';
      if(!email||!password){ Swal.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
      credentials = { email, password };
    } else if (role==='student'){
      const citizenId = (qs('#studentCitizenId')?.value||'').replace(/\s|-/g,'');
      if(!citizenId){ Swal.fire({icon:'warning',title:'กรอกเลขบัตรประชาชน'}); return; }
      credentials = { citizenId };
    } else if (role==='advisor'){
      const email = (qs('#advisorEmail')?.value||'').trim();
      const password = qs('#advisorPassword')?.value||'';
      if(!email||!password){ Swal.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
      credentials = { email, password };
    }

    Swal.fire({title:'กำลังเข้าสู่ระบบ...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const auth = await callAPI('authenticate', { userType: role, credentials });
    if(!auth?.success) throw new Error(auth?.message||'เข้าสู่ระบบไม่สำเร็จ');

    const boot = await callAPI('bootstrap', {});
    if(!boot?.success) throw new Error(boot?.message||'โหลดข้อมูลไม่สำเร็จ');

    CURRENT_USER = auth.data;
    GLOBAL_DATA  = boot.data || GLOBAL_DATA;
    saveSession({ role: CURRENT_USER.role, id: CURRENT_USER.id, name: CURRENT_USER.name, email: CURRENT_USER.email||'' });

    if (typeof window.updateRoleUI === 'function') window.updateRoleUI(CURRENT_USER.role, CURRENT_USER.name);

    Swal.close();
    goToDashboard();
    setActiveDashboard(CURRENT_USER.role);

    if (CURRENT_USER.role==='admin') showAdminDashboard();
    else if (CURRENT_USER.role==='advisor') showAdvisorDashboard();
    else showStudentDashboard();

  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'เกิดข้อผิดพลาด',text:String(err?.message||err)});
  }
}

/* ===================== ADMIN ===================== */
function showAdminDashboard(){
  showAdminSection('overview');
  buildAdminOverview();
  buildAdminStudents();
  buildAdminIndividual();
}

function showAdminSection(name){
  ['adminOverview','adminStudents','adminIndividual'].forEach(id=>qs('#'+id)?.classList.add('hidden'));
  const map = { overview:'adminOverview', students:'adminStudents', individual:'adminIndividual' };
  qs('#'+(map[name]||'adminOverview'))?.classList.remove('hidden');

  // highlight nav buttons (ตามลำดับที่วางไว้ใน index.html)
  const order = ['overview','students','individual'];
  qsa('.admin-nav').forEach((btn,i)=>{
    const active = (order[i]===name);
    btn.classList.toggle('border-blue-500', active);
    btn.classList.toggle('text-blue-600', active);
    btn.classList.toggle('border-transparent', !active);
    btn.classList.toggle('text-gray-600', !active);
  });
}

function buildAdminOverview(){
  const students = GLOBAL_DATA.students||[];
  const grades   = GLOBAL_DATA.grades||[];

  setText('totalStudents', students.length);

  const engMap = latestEnglishMap(GLOBAL_DATA.englishTests||[]);
  let pass=0, fail=0;
  students.forEach(s=>{
    const r = engMap[String(s.id)];
    const st = String(r?.status||'').trim();
    if (/^ผ่าน$/i.test(st) || /^pass(ed)?$/i.test(st)) pass++; else fail++;
  });
  setText('passedEnglish', pass);
  setText('failedEnglish', fail);

  const subj = new Set();
  grades.forEach(g=>{
    const key = (g.courseCode && String(g.courseCode).trim()) || (g.courseTitle && String(g.courseTitle).trim());
    if(key) subj.add(key);
  });
  setText('totalSubjects', subj.size);

  const perYear = [1,2,3,4].map(y => students.filter(s=>String(s.year||'')===String(y)).length);
  if (studentsChartInst){ try{ studentsChartInst.destroy(); }catch{} }
  if (qs('#studentsChart')){
    studentsChartInst = new Chart(qs('#studentsChart'), {
      type:'bar',
      data:{ labels:['ปี 1','ปี 2','ปี 3','ปี 4'], datasets:[{ label:'จำนวนนักศึกษา', data:perYear }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
  if (englishChartInst){ try{ englishChartInst.destroy(); }catch{} }
  if (qs('#englishChart')){
    englishChartInst = new Chart(qs('#englishChart'), {
      type:'doughnut',
      data:{ labels:['ผ่าน','ไม่ผ่าน'], datasets:[{ data:[pass, fail] }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
}

function buildAdminStudents(){
  const input = qs('#adminStudentSearch');
  const sel   = qs('#adminStudentYearFilter');
  const tbody = qs('#studentsTable');

  function render(){
    if(!tbody) return;
    tbody.innerHTML='';
    const kw = (input?.value||'').trim().toLowerCase();
    const yf = (sel?.value||'').trim();
    const list = (GLOBAL_DATA.students||[])
      .filter(s=>!kw || String(s.name||'').toLowerCase().includes(kw))
      .filter(s=>!yf || String(s.year||'')===yf)
      .sort(by(s=>s.id));
    list.forEach(s=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-6 py-3 text-sm text-gray-700">${s.id||'-'}</td>
        <td class="px-6 py-3 text-sm text-gray-700">${s.name||'-'}</td>
        <td class="px-6 py-3 text-sm text-gray-700">${s.year||'-'}</td>
        <td class="px-6 py-3 text-sm text-gray-700">${s.advisor||'-'}</td>
        <td class="px-6 py-3"><button class="text-blue-600 hover:underline" onclick="openIndividual('${s.id||''}')">ดู</button></td>`;
      tbody.appendChild(tr);
    });
  }
  input?.addEventListener('input', render);
  sel?.addEventListener('change', render);
  render();
}

function buildAdminIndividual(){
  const search = qs('#adminIndSearch');
  const sel    = qs('#adminIndSelect');
  const yearSel= qs('#adminIndYear');

  function fillOptions(){
    if(!sel) return;
    const kw = (search?.value||'').trim().toLowerCase();
    const list = (GLOBAL_DATA.students||[])
      .filter(s=>!kw || String(s.name||'').toLowerCase().includes(kw))
      .sort(by(s=>s.name||''));
    sel.innerHTML = `<option value="">-- เลือกนักศึกษา --</option>`;
    list.forEach(s=>{
      const opt = document.createElement('option');
      opt.value = s.id; opt.textContent = `[${s.id}] ${s.name}`;
      sel.appendChild(opt);
    });
  }

  function fillYearOptions(studentId){
    if(!yearSel) return;
    const g = gradesOf(GLOBAL_DATA.grades||[], studentId);
    const years = Array.from(new Set(g.map(x=>academicYearOf(x.term)).filter(Boolean))).sort();
    yearSel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  }

  function renderDetail(studentId){
    const s = (GLOBAL_DATA.students||[]).find(x=>String(x.id)===String(studentId));
    const allG = gradesOf(GLOBAL_DATA.grades||[], studentId);
    const allE = (GLOBAL_DATA.englishTests||[]).filter(t=>String(t.studentId)===String(studentId));

    setText('detailStudentId', s?.id||'-');
    setText('detailStudentName', s?.name||'-');
    setText('detailStudentYear', s?.year||'-');
    setText('detailStudentAdvisor', s?.advisor||'-');

    fillYearOptions(studentId);

    const etb = qs('#englishTestTable'); if(etb){ etb.innerHTML='';
      allE.sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0))
          .forEach(r=>{
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td class="px-4 py-2 text-sm">${r.academicYear||''}</td>
              <td class="px-4 py-2 text-sm">${r.attempt||''}</td>
              <td class="px-4 py-2 text-sm">${r.score||''}</td>
              <td class="px-4 py-2 text-sm">${r.status||''}</td>
              <td class="px-4 py-2 text-sm">${r.examDate||''}</td>`;
            etb.appendChild(tr);
          });
    }

    function renderGradesByYear(){
      const yf = yearSel?.value || '';
      const gtb = qs('#gradesDetailTable'); if(!gtb) return;
      gtb.innerHTML='';
      const rows = (yf ? allG.filter(g=>academicYearOf(g.term)===yf) : allG).sort(by(g=>g.term||''));
      let cr=0, pts=0;
      const seenKey=new Set();
      rows.forEach(g=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm">${g.term||''}</td>
          <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
          <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
          <td class="px-4 py-2 text-sm">${g.credits||''}</td>
          <td class="px-4 py-2 text-sm">${g.grade||''}</td>`;
        gtb.appendChild(tr);

        const gp = gradePoint(g.grade);
        const c  = Number(g.credits||0);
        if (gp!=null && c){ cr += c; pts += gp*c; }
        const key=(g.courseCode||g.courseTitle||'').toString().trim(); if(key) seenKey.add(key);
      });
      setText('adminIndYearGPA', cr? (pts/cr).toFixed(2) : '-');
      const creditsYear = (yf ? uniqueCreditsSum(allG.filter(g=>academicYearOf(g.term)===yf)) : uniqueCreditsSum(allG));
      setText('adminIndYearCredits', creditsYear||0);
    }
    renderGradesByYear();

    yearSel?.onchange = renderGradesByYear;

    // buttons
    const btnEdit = qs('#btnEditStudent');
    const btnAddG = qs('#btnAddGrade');
    const btnAddE = qs('#btnAddEnglish');

    btnEdit && (btnEdit.onclick = () => {
      if(!s) return;
      qs('#editStudentId').value      = s.id||'';
      qs('#editStudentName').value    = s.name||'';
      qs('#editStudentAdvisor').value = s.advisor||'';
      qs('#editStudentYear').value    = s.year||'1';
      openModal('modalEditStudent');
    });
    btnAddG && (btnAddG.onclick = () => {
      if(!s) return;
      qs('#gradeStudentId').value   = s.id||'';
      qs('#gradeTerm').value        = '';
      qs('#gradeCourseCode').value  = '';
      qs('#gradeCourseTitle').value = '';
      qs('#gradeCredits').value     = '';
      qs('#gradeGrade').value       = '';
      qs('#gradeRecordedAt').value  = '';
      openModal('modalAddGrade');
    });
    btnAddE && (btnAddE.onclick = () => {
      if(!s) return;
      qs('#engStudentId').value     = s.id||'';
      qs('#engAcademicYear').value  = '';
      qs('#engAttempt').value       = '';
      qs('#engScore').value         = '';
      qs('#engStatus').value        = '';
      qs('#engExamDate').value      = '';
      openModal('modalAddEnglish');
    });
  }

  search?.addEventListener('input', fillOptions);
  sel?.addEventListener('change', ()=> renderDetail(sel.value));
  fillOptions();

  window.openIndividual = function(studentId){
    showAdminSection('individual');
    fillOptions();
    if (sel){
      sel.value = studentId||'';
      sel.dispatchEvent(new Event('change'));
    }
  };
}

/* ===== Admin Save ===== */
async function saveEditStudent(){
  try{
    const id = qs('#editStudentId').value;
    const name = qs('#editStudentName').value;
    const advisor = qs('#editStudentAdvisor').value;
    const year = qs('#editStudentYear').value;

    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const res = await callAPI('updateStudent', { id, name, advisor, year });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');

    const s = (GLOBAL_DATA.students||[]).find(x=>String(x.id)===String(id));
    if(s){ s.name=name; s.advisor=advisor; s.year=year; }

    Swal.close(); closeModal('modalEditStudent');
    Swal.fire({icon:'success',title:'บันทึกแล้ว'});
    buildAdminStudents();
    const sel = qs('#adminIndSelect'); if(sel?.value===id) sel.dispatchEvent(new Event('change'));
    buildAdminOverview();
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

async function saveAddGrade(){
  try{
    const studentId = qs('#gradeStudentId').value;
    const term = qs('#gradeTerm').value;
    const courseCode = qs('#gradeCourseCode').value;
    const courseTitle = qs('#gradeCourseTitle').value;
    const credits = Number(qs('#gradeCredits').value||0);
    const grade = qs('#gradeGrade').value;
    const recordedAt = qs('#gradeRecordedAt').value || '';

    if(!studentId || !term || !courseTitle){ Swal.fire({icon:'warning',title:'กรอกข้อมูลให้ครบ'}); return; }

    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const res = await callAPI('addGrade', { studentId, term, courseCode, courseTitle, credits, grade, recordedAt });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');

    (GLOBAL_DATA.grades||[]).push({ studentId, term, courseCode, courseTitle, credits, grade, recordedAt });

    Swal.close(); closeModal('modalAddGrade');
    Swal.fire({icon:'success',title:'เพิ่มเกรดแล้ว'});
    const sel = qs('#adminIndSelect'); if(sel?.value===studentId) sel.dispatchEvent(new Event('change'));
    buildAdminOverview();
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

async function saveAddEnglish(){
  try{
    const studentId    = qs('#engStudentId').value;
    const academicYear = qs('#engAcademicYear').value;
    const attempt      = qs('#engAttempt').value;
    const score        = qs('#engScore').value;
    const status       = qs('#engStatus').value;
    const examDate     = qs('#engExamDate').value || '';

    if(!studentId || !academicYear || !attempt || !score || !status){
      Swal.fire({icon:'warning',title:'กรอกข้อมูลให้ครบ'}); return;
    }

    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const res = await callAPI('addEnglishTest', { studentId, academicYear, attempt, score, status, examDate });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');

    (GLOBAL_DATA.englishTests||[]).push({ studentId, academicYear, attempt, score, status, examDate });

    Swal.close(); closeModal('modalAddEnglish');
    Swal.fire({icon:'success',title:'เพิ่มผลสอบแล้ว'});
    const sel = qs('#adminIndSelect'); if(sel?.value===studentId) sel.dispatchEvent(new Event('change'));
    buildAdminOverview();
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/* ===================== STUDENT ===================== */
function showStudentDashboard(){
  const me = CURRENT_USER || {};
  const myGrades = gradesOf(GLOBAL_DATA.grades||[], me.id);
  const myEng    = (GLOBAL_DATA.englishTests||[]).filter(t=>String(t.studentId)===String(me.id));

  // GPAX & credits
  setText('studentGPAX', (computeGPAX(myGrades)||0).toFixed(2));
  setText('studentCredits', uniqueCreditsSum(myGrades)||0);

  // English latest
  const latest = latestEnglishMap(myEng||{});
  const meLatest = latest[String(me.id)];
  setText('studentEnglishStatus', meLatest ? `${meLatest.status||'-'} (${meLatest.score||'-'})` : '-');

  // year dropdown (only years)
  const aySel = qs('#studentAcademicYear');
  if(aySel){
    const years = Array.from(new Set((myGrades||[]).map(g=>academicYearOf(g.term)).filter(Boolean))).sort();
    aySel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  }

  const table = qs('#studentSemesterTable');
  let currentSem = '1';

  function updateStudentSemester(sem){
    if(!table) return;
    const yf = aySel?.value || '';
    const rows = (myGrades||[])
      .filter(g=>String(semesterOf(g.term))===String(sem))
      .filter(g=>!yf || academicYearOf(g.term)===yf)
      .sort(by(g=>g.courseCode||g.courseTitle||''));

    table.innerHTML='';
    let cr=0, pts=0;
    rows.forEach(g=>{
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
        <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
        <td class="px-4 py-2 text-sm">${g.credits||''}</td>
        <td class="px-4 py-2 text-sm">${g.grade||''}</td>`;
      table.appendChild(tr);

      const gp=gradePoint(g.grade); const c=Number(g.credits||0);
      if(gp!=null && c){ cr+=c; pts+=gp*c; }
    });
    const tr=document.createElement('tr');
    tr.innerHTML = `<td class="px-4 py-2 text-sm font-semibold" colspan="2">สรุป GPA ภาคเรียน</td>
                    <td class="px-4 py-2 text-sm font-semibold" colspan="2">${cr? (pts/cr).toFixed(2) : '-'}</td>`;
    table.appendChild(tr);
  }

  window.showSemester = function(sem){
    currentSem = String(sem||'1');
    qsa('.semester-tab').forEach((btn,idx)=>{
      const active = (idx===({ '1':0,'2':1,'3':2 }[currentSem]||0));
      btn.classList.toggle('border-blue-500', active);
      btn.classList.toggle('text-blue-600', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('text-gray-700', !active);
    });
    updateStudentSemester(currentSem);
  };

  aySel?.addEventListener('change', ()=> updateStudentSemester(currentSem));
  window.showSemester('1');
}

/* ===================== ADVISOR ===================== */
function showAdvisorDashboard(){
  const meEmail = (CURRENT_USER?.email||'').toLowerCase().trim();
  const advisees = (GLOBAL_DATA.students||[]).filter(s=>{
    const adv = String(s.advisor||'').toLowerCase().trim();
    return adv && (adv===meEmail || adv.includes(meEmail) || adv.includes(String(CURRENT_USER?.name||'').toLowerCase()));
  });

  setText('advTotal', advisees.length);
  setText('advY1', advisees.filter(s=>String(s.year)==='1').length);
  setText('advY2', advisees.filter(s=>String(s.year)==='2').length);
  setText('advY3', advisees.filter(s=>String(s.year)==='3').length);
  setText('advY4', advisees.filter(s=>String(s.year)==='4').length);

  const latest = latestEnglishMap((GLOBAL_DATA.englishTests||[]).filter(e=>advisees.some(s=>String(s.id)===String(e.studentId))));
  let pass=0; Object.keys(latest).forEach(k=>{
    const st = String(latest[k]?.status||'').trim();
    if (/^ผ่าน$/i.test(st) || /^pass(ed)?$/i.test(st)) pass++;
  });
  setText('advPassAll', pass);

  const aySel = qs('#advisorAcademicYear');
  if(aySel){
    const years = Array.from(new Set((GLOBAL_DATA.grades||[])
      .filter(g=>advisees.some(s=>String(s.id)===String(g.studentId)))
      .map(g=>academicYearOf(g.term))
      .filter(Boolean))).sort();
    aySel.innerHTML = `<option value="">ทั้งหมด</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
    aySel.onchange = renderAdvisorLists;
  }

  function renderAdvisorLists(){
    const yearFilter = aySel?.value || '';

    const list = qs('#advisorStudentsList'); if(list){ list.innerHTML='';
      advisees.sort(by(s=>s.name||'')).forEach(s=>{
        const div = document.createElement('div');
        div.className = 'p-4 flex items-center justify-between';
        div.innerHTML = `
          <div>
            <div class="font-medium">${s.name||''}</div>
            <div class="text-xs text-gray-500">[${s.id||''}] ปี ${s.year||'-'}</div>
          </div>
          <button class="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            onclick="openAdvisorDetail('${s.id||''}')">ดูรายละเอียด</button>`;
        list.appendChild(div);
      });
    }

    const etb = qs('#advisorEnglishTable'); if(etb){ etb.innerHTML='';
      advisees.forEach(s=>{
        const le = latest[String(s.id)];
        const tr=document.createElement('tr');
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm">${s.id||''}</td>
          <td class="px-4 py-2 text-sm">${s.name||''}</td>
          <td class="px-4 py-2 text-sm">${s.year||''}</td>
          <td class="px-4 py-2 text-sm">${le?.status||'-'}</td>
          <td class="px-4 py-2 text-sm">${le?.score||'-'}</td>`;
        etb.appendChild(tr);
      });
    }

    window.openAdvisorDetail = function(studentId){
      const s = advisees.find(x=>String(x.id)===String(studentId));
      const g = (GLOBAL_DATA.grades||[]).filter(x=>String(x.studentId)===String(studentId));
      const e = (GLOBAL_DATA.englishTests||[]).filter(x=>String(x.studentId)===String(studentId));

      const yf = yearFilter;
      const gY = yf ? g.filter(x=>academicYearOf(x.term)===yf) : g;
      const eY = yf ? e.filter(x=>String(x.academicYear)===yf) : e;

      function cleanTitle(x){
        const t=(x?.courseTitle||'').trim();
        const code=(x?.courseCode||'').trim();
        if(!t) return '';
        if (t===code) return '';
        if (/^[A-Za-z]{2,}\d{2,}$/i.test(t)) return '';
        return t;
      }

      const box = qs('#advisorDetailContent'); if(box){
        box.innerHTML = `
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><p class="text-xs text-gray-500">รหัส</p><p class="font-semibold">${s?.id||'-'}</p></div>
            <div><p class="text-xs text-gray-500">ชื่อ</p><p class="font-semibold">${s?.name||'-'}</p></div>
            <div><p class="text-xs text-gray-500">ชั้นปี</p><p class="font-semibold">${s?.year||'-'}</p></div>
            <div><p class="text-xs text-gray-500">อาจารย์ที่ปรึกษา</p><p class="font-semibold">${s?.advisor||'-'}</p></div>
          </div>

          <div class="mt-4">
            <h4 class="font-semibold mb-2">ผลการเรียน ${yf?`(ปี ${yf})`:''}</h4>
            <div class="overflow-x-auto">
              <table class="w-full">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">ภาค</th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">รหัสวิชา</th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">รายวิชา</th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">หน่วยกิต</th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">เกรด</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    gY.sort(by(x=>x.term||'')).map(x=>`
                      <tr>
                        <td class="px-3 py-2 text-sm">${x.term||''}</td>
                        <td class="px-3 py-2 text-sm">${x.courseCode||''}</td>
                        <td class="px-3 py-2 text-sm">${cleanTitle(x)}</td>
                        <td class="px-3 py-2 text-sm">${x.credits||''}</td>
                        <td class="px-3 py-2 text-sm">${x.grade||''}</td>
                      </tr>`).join('') || `<tr><td class="px-3 py-2 text-sm" colspan="5">-</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="mt-6">
            <h4 class="font-semibold mb-2">ผลสอบภาษาอังกฤษ ${yf?`(ปี ${yf})`:''}</h4>
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
                <tbody>
                  ${
                    eY.sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0))
                      .map(x=>`
                        <tr>
                          <td class="px-3 py-2 text-sm">${x.academicYear||''}</td>
                          <td class="px-3 py-2 text-sm">${x.attempt||''}</td>
                          <td class="px-3 py-2 text-sm">${x.score||''}</td>
                          <td class="px-3 py-2 text-sm">${x.status||''}</td>
                          <td class="px-3 py-2 text-sm">${x.examDate||''}</td>
                        </tr>`).join('') || `<tr><td class="px-3 py-2 text-sm" colspan="5">-</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        `;
      }
      openModal('advisorDetailModal');
    };
  }

  renderAdvisorLists();
}

/* ===================== CHANGE PASSWORD (SweetAlert) ===================== */
async function openChangePasswordModal(){
  const { value: vals } = await Swal.fire({
    title: 'เปลี่ยนรหัสผ่าน',
    html: '<input id="swal-old" class="swal2-input" placeholder="รหัสผ่านเดิม" type="password">' +
          '<input id="swal-new" class="swal2-input" placeholder="รหัสผ่านใหม่" type="password">',
    focusConfirm: false,
    preConfirm: () => [ document.getElementById('swal-old').value, document.getElementById('swal-new').value ],
    confirmButtonText: 'บันทึก',
    showCancelButton: true,
    cancelButtonText: 'ยกเลิก'
  });
  if(!vals) return;
  const [oldPass, newPass] = vals;
  if(!oldPass || !newPass){ Swal.fire({icon:'warning',title:'กรอกข้อมูลให้ครบ'}); return; }

  try{
    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const role = CURRENT_USER?.role || 'admin';
    const res = await callAPI('changePassword', { role, oldPassword: oldPass, newPassword: newPass, email: CURRENT_USER?.email||'' });
    if(!res?.success) throw new Error(res?.message||'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    Swal.close(); Swal.fire({icon:'success',title:'เปลี่ยนรหัสผ่านแล้ว'});
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/* ===================== INIT ===================== */
document.addEventListener('DOMContentLoaded', async () => {
  const sess = loadSession();
  if(!sess) return;
  try{
    const boot = await callAPI('bootstrap', {});
    CURRENT_USER = { role:sess.role, id:sess.id, name:sess.name, email:sess.email };
    GLOBAL_DATA  = boot?.data || GLOBAL_DATA;
    if (typeof window.updateRoleUI === 'function') window.updateRoleUI(CURRENT_USER.role, CURRENT_USER.name);
    goToDashboard(); setActiveDashboard(CURRENT_USER.role);
    if (CURRENT_USER.role==='admin') showAdminDashboard();
    else if (CURRENT_USER.role==='advisor') showAdvisorDashboard();
    else showStudentDashboard();
  }catch{
    clearSession();
  }
});

/* ===================== MODAL helpers (index.html uses) ===================== */
function openModal(id){ qs('#modalBackdrop')?.classList.remove('hidden'); qs('#'+id)?.classList.remove('hidden'); }
function closeModal(id){ qs('#'+id)?.classList.add('hidden'); qs('#modalBackdrop')?.classList.add('hidden'); }

/* ===================== EXPORT GLOBAL ===================== */
window.login = login;
window.logout = logout;
window.showAdminSection = showAdminSection;
window.saveEditStudent = saveEditStudent;
window.saveAddGrade = saveAddGrade;
window.saveAddEnglish = saveAddEnglish;
window.openChangePasswordModal = openChangePasswordModal;
window.setActiveDashboard = setActiveDashboard;
