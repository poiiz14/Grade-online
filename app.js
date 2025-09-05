/******************** CONFIG ********************/
/** URL /exec ของ Apps Script */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

/******************** GLOBAL STATE ********************/
let CURRENT_USER = null;
let GLOBAL_DATA  = { students: [], grades: [], englishTests: [], advisors: [] };

/** Chart instances (admin overview) */
let studentsChartInst = null;
let englishChartInst  = null;

/******************** UTIL ********************/
const qs  = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));
const by  = (fn) => (a,b) => (fn(a)>fn(b)?1:fn(a)<fn(b)?-1:0);

function setText(id, v){ const el = document.getElementById(id); if (el) el.textContent = (v==null?'-':String(v)); }

function saveSession(data){ try{ localStorage.setItem('session', JSON.stringify(data||{})); }catch{} }
function loadSession(){ try{ return JSON.parse(localStorage.getItem('session')||'null'); }catch{ return null; } }
function clearSession(){ try{ localStorage.removeItem('session'); }catch{} }

/** JSONP call */
function callAPI(action, data={}, {timeoutMs=30000}={}){
  return new Promise((resolve, reject)=>{
    const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random()*1e6);
    const payloadStr = encodeURIComponent(JSON.stringify(data||{}));
    const url = `${API_BASE}?action=${encodeURIComponent(action)}&payload=${payloadStr}&callback=${cb}&_ts=${Date.now()}`;

    const s = document.createElement('script');
    let done=false;
    const cleanup = ()=>{ try{ delete window[cb]; }catch{} try{s.remove();}catch{} };

    const timer = setTimeout(()=>{ if(done) return; done=true; cleanup(); reject(new Error('API timeout')); }, timeoutMs);

    window[cb] = (res)=>{
      if(done) return; done=true; clearTimeout(timer); cleanup();
      if(!res || res.success===false){ reject(new Error(res?.message||'API error')); return; }
      resolve(res);
    };

    s.src = url;
    s.onerror = ()=>{ if(done) return; done=true; clearTimeout(timer); cleanup(); reject(new Error('Network error')); };
    document.body.appendChild(s);
  });
}

/** term helpers */
const academicYearOf = (term)=> {
  const s = String(term||'').split('/');
  return s[0] || '';
};
const semesterOf = (term)=> {
  const s = String(term||'').split('/');
  return s[1] || '';
};

/** grade helpers */
function gradePoint(g){
  const k = String(g||'').trim().toUpperCase();
  const map = {'A':4,'B+':3.5,'B':3,'C+':2.5,'C':2,'D+':1.5,'D':1,'F':0};
  return (k in map) ? map[k] : null; // W/I/S/U => null
}
function computeGPAX(rows){
  let pts=0, cr=0;
  (rows||[]).forEach(r=>{
    const gp=gradePoint(r.grade); const c=Number(r.credits||0);
    if(gp!=null && c){ pts+=gp*c; cr+=c; }
  });
  return cr ? (pts/cr) : 0;
}
function uniqueCreditsSum(rows){
  // นับหน่วยกิตแบบไม่ซ้ำรายวิชา (key จาก courseCode หรือ courseTitle)
  const seen = new Set(); let sum = 0;
  (rows||[]).forEach(r=>{
    const key = (r.courseCode || r.courseTitle || '').toString().trim();
    const c   = Number(r.credits||0);
    if(key && c && !seen.has(key)){ seen.add(key); sum += c; }
  });
  return sum;
}

/** english latest per student (ใช้ใน Student/Advisor/Admin overview) */
function latestEnglishMap(list){
  const map = {};
  (list||[]).forEach(r=>{
    const id = String(r.studentId||'').trim(); if(!id) return;
    const cur = map[id];
    const nowScore = {
      t: Date.parse(r.examDate||'') || 0,
      y: Number(r.academicYear||0) || 0,
      a: Number(r.attempt||0) || 0
    };
    const curScore = cur ? {
      t: Date.parse(cur.examDate||'') || 0,
      y: Number(cur.academicYear||0) || 0,
      a: Number(cur.attempt||0) || 0
    } : {t:-1,y:-1,a:-1};

    if (nowScore.t > curScore.t ||
       (nowScore.t === curScore.t && (nowScore.y > curScore.y ||
       (nowScore.y === curScore.y && nowScore.a >= curScore.a)))){
      map[id] = r;
    }
  });
  return map;
}

/******************** NAV ********************/
function goToDashboard(){ qs('#loginScreen')?.classList.add('hidden'); qs('#dashboard')?.classList.remove('hidden'); }
function goToLogin(){ qs('#dashboard')?.classList.add('hidden'); qs('#loginScreen')?.classList.remove('hidden'); }

function setActiveDashboard(role){
  ['adminDashboard','studentDashboard','advisorDashboard'].forEach(id=>qs('#'+id)?.classList.add('hidden'));
  if (role==='admin') qs('#adminDashboard')?.classList.remove('hidden');
  else if (role==='advisor') qs('#advisorDashboard')?.classList.remove('hidden');
  else qs('#studentDashboard')?.classList.remove('hidden');
}

function showOnlyDashboard(id){
  ['adminDashboard','studentDashboard','advisorDashboard'].forEach(x=>qs('#'+x)?.classList.add('hidden'));
  qs('#'+id)?.classList.remove('hidden');
}

/******************** AUTH ********************/
async function login(){
  try{
    const role = (qs('#userType')?.value || 'admin').toLowerCase();
    let credentials = {};

    if (role==='student'){
      const citizenId = (qs('#studentCitizenId')?.value||'').replace(/\s|-/g,'');
      if(!citizenId){ Swal.fire({icon:'warning',title:'กรอกเลขบัตรประชาชน'}); return; }
      credentials = { citizenId };
    }else{
      // ใช้ช่องเดียวสำหรับ Admin/Advisor ตาม UI
      const email = (qs('#adminEmail')?.value||'').trim();
      const password = qs('#adminPassword')?.value||'';
      if(!email || !password){ Swal.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
      credentials = { email, password };
    }

    Swal.fire({title:'กำลังเข้าสู่ระบบ...', allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
    const auth = await callAPI('authenticate', { userType: role, credentials });
    if(!auth?.success) throw new Error(auth?.message||'เข้าสู่ระบบไม่สำเร็จ');

    const boot = await callAPI('bootstrap', {});
    if(!boot?.success) throw new Error(boot?.message||'โหลดข้อมูลไม่สำเร็จ');

    CURRENT_USER = auth.data;
    GLOBAL_DATA  = boot.data || GLOBAL_DATA;
    saveSession({ role: CURRENT_USER.role, id: CURRENT_USER.id, name: CURRENT_USER.name, email: CURRENT_USER.email||'' });

    // ปรับ UI ตามบทบาท
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

function logout(){
  clearSession();
  CURRENT_USER = null;
  GLOBAL_DATA = { students: [], grades: [], englishTests: [], advisors: [] };
  goToLogin();
}

/******************** ADMIN ********************/
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

  // highlight nav
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

  // English latest pass/fail
  const engMap = latestEnglishMap(GLOBAL_DATA.englishTests||[]);
  let pass=0, fail=0;
  students.forEach(s=>{
    const r = engMap[String(s.id)];
    const st = String(r?.status||'').trim().toLowerCase();
    if (['ผ่าน','pass','passed','p'].includes(st)) pass++; else fail++;
  });
  setText('passedEnglish', pass);
  setText('failedEnglish', fail);

  // unique subjects
  const subj = new Set();
  grades.forEach(g=>{
    const key = (g.courseCode && String(g.courseCode).trim()) || (g.courseTitle && String(g.courseTitle).trim());
    if(key) subj.add(key);
  });
  setText('totalSubjects', subj.size);

  // chart per year
  const perYear = [1,2,3,4].map(y => students.filter(s=>String(s.year||'')===String(y)).length);
  const c1 = document.getElementById('studentsChart');
  if (studentsChartInst) { try{ studentsChartInst.destroy(); }catch{} }
  if (c1){
    studentsChartInst = new Chart(c1, {
      type: 'bar',
      data: { labels: ['ปี 1','ปี 2','ปี 3','ปี 4'], datasets: [{ label:'จำนวนนักศึกษา', data: perYear }] },
      options: { responsive:true, maintainAspectRatio:false }
    });
  }

  const c2 = document.getElementById('englishChart');
  if (englishChartInst) { try{ englishChartInst.destroy(); }catch{} }
  if (c2){
    englishChartInst = new Chart(c2, {
      type: 'doughnut',
      data: { labels: ['ผ่าน','ไม่ผ่าน'], datasets: [{ data: [pass, fail] }] },
      options: { responsive:true, maintainAspectRatio:true, aspectRatio:1, plugins:{ legend:{ position:'bottom' } } }
    });
  }
}

function buildAdminStudents(){
  const tb = qs('#studentsTable'); if(!tb) return;
  const kw = (qs('#adminStudentSearch')?.value||'').trim().toLowerCase();
  const yf = (qs('#adminStudentYearFilter')?.value||'').trim();

  let list = (GLOBAL_DATA.students||[]).slice();
  if (yf) list = list.filter(s=>String(s.year||'')===yf);
  if (kw) list = list.filter(s=>(s.name||'').toLowerCase().includes(kw));

  // เรียงตามรหัสนักศึกษา
  list.sort(by(s=>String(s.id||'')));

  tb.innerHTML = '';
  list.forEach(s=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-6 py-3 text-sm">${s.id||''}</td>
      <td class="px-6 py-3 text-sm">${s.name||''}</td>
      <td class="px-6 py-3 text-sm">${s.year||''}</td>
      <td class="px-6 py-3 text-sm">${s.advisor||''}</td>
      <td class="px-6 py-3 text-sm"><button class="text-blue-600 hover:underline" onclick="openIndividual('${s.id||''}')">รายละเอียด</button></td>`;
    tb.appendChild(tr);
  });

  // events
  const se = qs('#adminStudentSearch'); const ye = qs('#adminStudentYearFilter');
  if (se && !se._wired){ se._wired=true; se.addEventListener('input', buildAdminStudents); }
  if (ye && !ye._wired){ ye._wired=true; ye.addEventListener('change', buildAdminStudents); }
}

function buildAdminIndividual(){
  const search = qs('#adminIndSearch');
  const sel    = qs('#adminIndSelect');
  const yearSel= qs('#adminIndYear');

  function fillOptions(){
    if(!sel) return;
    const q = (search?.value||'').trim().toLowerCase();
    const list = (GLOBAL_DATA.students||[])
      .filter(s=>!q || (String(s.name||'').toLowerCase().includes(q) || String(s.id||'').includes(q)))
      .sort(by(s=>String(s.id||'')));
    sel.innerHTML = `<option value="">— เลือกนักศึกษา —</option>` + list.map(s=>`<option value="${s.id}">[${s.id}] ${s.name}</option>`).join('');
  }

  function fillYearOptions(studentId){
    if(!yearSel) return;
    const g = (GLOBAL_DATA.grades||[]).filter(x=>String(x.studentId)===String(studentId));
    const years = Array.from(new Set(g.map(x=>academicYearOf(x.term)).filter(Boolean))).sort();
    yearSel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  }

  function renderDetail(studentId){
    const s = (GLOBAL_DATA.students||[]).find(x=>String(x.id)===String(studentId));
    if(!s) return;

    // โปรไฟล์
    setText('detailStudentId', s.id||'-');
    setText('detailStudentName', s.name||'-');
    setText('detailStudentYear', s.year||'-');
    setText('detailStudentAdvisor', s.advisor||'-');

    // GPAX สะสม
    const all = (GLOBAL_DATA.grades||[]).filter(g=>String(g.studentId)===String(s.id));
    setText('adminIndGPAX', (computeGPAX(all)||0).toFixed(2));

    // เติมปีการศึกษา
    fillYearOptions(studentId);

    // ตารางผลสอบอังกฤษ (ทั้งหมด)
    const eAll = (GLOBAL_DATA.englishTests||[]).filter(t=>String(t.studentId)===String(studentId));
    const etb = qs('#englishTestTable'); if (etb){
      etb.innerHTML='';
      eAll.sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0) || (Number(b.attempt||0)-Number(a.attempt||0)));
      eAll.forEach(r=>{
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

    // ตารางผลการเรียน (ปีที่เลือก) + GPA(ปีที่เลือก) + Credits
    function renderGradesByYear(){
      const yf = yearSel?.value || '';
      const gtb = qs('#gradesDetailTable'); if(!gtb) return;
      gtb.innerHTML='';
      const rows = (yf ? all.filter(g=>academicYearOf(g.term)===yf) : all).sort(by(g=>g.term||''));

      let pts=0, cr=0;
      rows.forEach(g=>{
        const tr=document.createElement('tr');
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm">${g.term||''}</td>
          <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
          <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
          <td class="px-4 py-2 text-sm">${g.credits||''}</td>
          <td class="px-4 py-2 text-sm">${g.grade||''}</td>`;
        gtb.appendChild(tr);

        const gp=gradePoint(g.grade), c=Number(g.credits||0);
        if(gp!=null && c){ pts+=gp*c; cr+=c; }
      });

      setText('adminIndYearGPA', cr? (pts/cr).toFixed(2) : '-');
      const creditsYear = (yf ? uniqueCreditsSum(all.filter(g=>academicYearOf(g.term)===yf)) : uniqueCreditsSum(all));
      setText('adminIndYearCredits', creditsYear||0);
    }
    renderGradesByYear();
    if (yearSel && !yearSel._wired){ yearSel._wired=true; yearSel.addEventListener('change', renderGradesByYear); }

    // ปุ่ม action
    const btnEdit = qs('#btnEditStudent');
    const btnAddG = qs('#btnAddGrade');
    const btnAddE = qs('#btnAddEnglish');

    if (btnEdit && !btnEdit._wired){ btnEdit._wired=true; btnEdit.addEventListener('click', ()=>{
      qs('#editStudentId').value      = s.id||'';
      qs('#editStudentName').value    = s.name||'';
      qs('#editStudentAdvisor').value = s.advisor||'';
      qs('#editStudentYear').value    = s.year||'1';
      openModal('modalEditStudent');
    });}
    if (btnAddG && !btnAddG._wired){ btnAddG._wired=true; btnAddG.addEventListener('click', ()=>{
      qs('#gradeStudentId').value   = s.id||'';
      qs('#gradeTerm').value        = '';
      qs('#gradeCourseCode').value  = '';
      qs('#gradeCourseTitle').value = '';
      qs('#gradeCredits').value     = '';
      qs('#gradeGrade').value       = '';
      qs('#gradeRecordedAt').value  = '';
      openModal('modalAddGrade');
    });}
    if (btnAddE && !btnAddE._wired){ btnAddE._wired=true; btnAddE.addEventListener('click', ()=>{
      qs('#engStudentId').value     = s.id||'';
      qs('#engAcademicYear').value  = '';
      qs('#engAttempt').value       = '';
      qs('#engScore').value         = '';
      qs('#engStatus').value        = '';
      qs('#engExamDate').value      = '';
      openModal('modalAddEnglish');
    });}
  }

  // events
  fillOptions();
  if (sel && !sel._wired){ sel._wired=true; sel.addEventListener('change', ()=>renderDetail(sel.value)); }
  if (search && !search._wired){ search._wired=true; search.addEventListener('input', fillOptions); }

  // เรียกจากตารางรายชื่อ
  window.openIndividual = function(studentId){
    showAdminSection('individual');
    fillOptions();
    if (sel){
      sel.value = studentId||'';
      sel.dispatchEvent(new Event('change'));
    }
  };
}

/** WRITE: Admin actions */
async function saveEditStudent(){
  try{
    const id = qs('#editStudentId').value;
    const name = qs('#editStudentName').value;
    const advisor = qs('#editStudentAdvisor').value;
    const year = qs('#editStudentYear').value;

    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const res = await callAPI('updateStudent', { id, name, advisor, year });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');

    // sync local
    const s = (GLOBAL_DATA.students||[]).find(x=>String(x.id)===String(id));
    if(s){ s.name=name; s.advisor=advisor; s.year=year; }

    Swal.close(); closeModal('modalEditStudent');
    Swal.fire({icon:'success',title:'บันทึกแล้ว'});

    buildAdminStudents();
    buildAdminOverview();

    const sel = qs('#adminIndSelect'); if (sel?.value===id) sel.dispatchEvent(new Event('change'));
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

async function saveAddGrade(){
  try{
    const studentId = qs('#gradeStudentId').value;
    const term = qs('#gradeTerm').value;
    const courseCode = qs('#gradeCourseCode').value;
    const courseTitle= qs('#gradeCourseTitle').value;
    const credits = Number(qs('#gradeCredits').value||0);
    const grade = qs('#gradeGrade').value;
    const recordedAt = qs('#gradeRecordedAt').value || '';

    if(!studentId || !term || !courseTitle){
      Swal.fire({icon:'warning',title:'กรอกข้อมูลให้ครบ'}); return;
    }

    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const res = await callAPI('addGrade', { studentId, term, courseCode, courseTitle, credits, grade, recordedAt });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');

    (GLOBAL_DATA.grades||[]).push({ studentId, term, courseCode, courseTitle, credits, grade, recordedAt });

    Swal.close(); closeModal('modalAddGrade');
    Swal.fire({icon:'success',title:'เพิ่มเกรดแล้ว'});

    buildAdminOverview();

    const sel = qs('#adminIndSelect'); if (sel?.value===studentId) sel.dispatchEvent(new Event('change'));
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

    buildAdminOverview();

    const sel = qs('#adminIndSelect'); if (sel?.value===studentId) sel.dispatchEvent(new Event('change'));
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/******************** STUDENT ********************/
function showStudentDashboard(){
  showOnlyDashboard('studentDashboard');

  const me = CURRENT_USER || {};
  const my = (GLOBAL_DATA.students||[]).find(s=>String(s.id||'')===String(me.id||'')) || {};

  const myGrades = (GLOBAL_DATA.grades||[]).filter(g=>String(g.studentId||'')===String(my.id));
  const myEng    = (GLOBAL_DATA.englishTests||[]).filter(e=>String(e.studentId||'')===String(my.id));

  // Summary GPAX + credits
  setText('studentGPAX', (computeGPAX(myGrades)||0).toFixed(2));
  setText('studentCredits', uniqueCreditsSum(myGrades)||0);

  // English latest (status)
  const latest = latestEnglishMap(myEng);
  const last = latest[String(my.id)];
  setText('studentEnglishStatus', last ? `${last.status||'-'} (${last.score||'-'})` : '-');

  // Academic year dropdown
  const sel = qs('#studentAcademicYear');
  if (sel){
    const years = Array.from(new Set(myGrades.map(g=>academicYearOf(g.term)).filter(Boolean))).sort().reverse();
    sel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  }

  // Semester tabs + table
  const tb = qs('#studentSemesterTable');

  function updateStudentSemester(sem){
    if(!tb) return;
    tb.innerHTML = '';
    const yearF = sel?.value || '';
    let rows = myGrades.slice();

    if (yearF) rows = rows.filter(g=>academicYearOf(g.term)===yearF);
    if (sem==='1') rows = rows.filter(g=>semesterOf(g.term)==='1');
    else if (sem==='2') rows = rows.filter(g=>semesterOf(g.term)==='2');
    else rows = rows.filter(g=>semesterOf(g.term)==='3' || semesterOf(g.term)==='ฤดูร้อน');

    rows.sort(by(g=>g.term||''));
    rows.forEach(g=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-2 text-sm">${g.term||''}</td>
        <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
        <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
        <td class="px-4 py-2 text-sm">${g.credits||''}</td>
        <td class="px-4 py-2 text-sm">${g.grade||''}</td>`;
      tb.appendChild(tr);
    });
  }

  window.showSemester = function(sem){
    qsa('.semester-tab').forEach(b=>b.classList.remove('border-blue-500','text-blue-600'));
    const idx = {'1':0,'2':1,'3':2}[String(sem)] || 0;
    const btn = qsa('.semester-tab')[idx];
    if (btn){ btn.classList.add('border-blue-500','text-blue-600'); }
    updateStudentSemester(String(sem));
  };

  if (sel && !sel._wired){ sel._wired=true; sel.addEventListener('change', ()=> {
    // keep active tab
    const active = qsa('.semester-tab').find(b=>b.classList.contains('border-blue-500'));
    const sem = active ? (active.textContent.includes('2')?'2':(active.textContent.includes('ฤดูร้อน')?'3':'1')) : '1';
    updateStudentSemester(sem);
  });}

  // init default tab
  window.showSemester('1');

  // English table (all attempts)
  const etb = qs('#studentEnglishTable'); if (etb){
    etb.innerHTML = '';
    myEng.sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0) || (Number(b.attempt||0)-Number(a.attempt||0)));
    myEng.forEach(r=>{
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

/******************** ADVISOR ********************/
function showAdvisorDashboard(){
  showOnlyDashboard('advisorDashboard');

  // นักศึกษาที่อยู่ในความดูแล: ใช้ email ตรง ๆ จะนิ่งที่สุด
  const myEmail = (CURRENT_USER?.email||'').toLowerCase().trim();
  const advisees = (GLOBAL_DATA.students||[]).filter(s=>String(s.advisor||'').toLowerCase().trim() === myEmail);

  // Count summary (รวมในกรอบเดียว)
  setText('advTotal', advisees.length);
  setText('advY1', advisees.filter(s=>String(s.year)==='1').length);
  setText('advY2', advisees.filter(s=>String(s.year)==='2').length);
  setText('advY3', advisees.filter(s=>String(s.year)==='3').length);
  setText('advY4', advisees.filter(s=>String(s.year)==='4').length);

  // สรุปอังกฤษ "เฉพาะผลล่าสุด" ต่อคน
  const latest = latestEnglishMap((GLOBAL_DATA.englishTests||[]).filter(e=>advisees.some(s=>String(s.id)===String(e.studentId))));
  let pass=0; Object.values(latest).forEach(r=>{
    const st = String(r?.status||'').trim().toLowerCase();
    if (['ผ่าน','pass','passed','p'].includes(st)) pass++;
  });
  setText('advPassLatest', pass);

  // รายชื่อ advisees
  const list = qs('#advisorStudentsList'); if (list){
    list.innerHTML='';
    advisees.sort(by(s=>String(s.id||''))).forEach(s=>{
      const div=document.createElement('div'); div.className='p-4 flex items-center justify-between';
      div.innerHTML = `
        <div>
          <div class="font-medium">${s.name||''}</div>
          <div class="text-xs text-gray-500">[${s.id||''}] ปี ${s.year||'-'}</div>
        </div>
        <button class="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onclick="openAdvisorDetail('${s.id||''}')">ดูรายละเอียด</button>`;
      list.appendChild(div);
    });
  }

  // สรุปอังกฤษ (ล่าสุดต่อคน) ลงตาราง
  const etb = qs('#advisorEnglishTable'); if (etb){
    etb.innerHTML='';
    advisees.forEach(s=>{
      const r = latest[String(s.id)];
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-2 text-sm">${s.id||''}</td>
        <td class="px-4 py-2 text-sm">${s.name||''}</td>
        <td class="px-4 py-2 text-sm">${r?.status||'-'}</td>
        <td class="px-4 py-2 text-sm">${r?.examDate||'-'}</td>`;
      etb.appendChild(tr);
    });
  }

  // Year filter (สำหรับ modal รายละเอียด)
  const aySel = qs('#advisorAcademicYear');
  if (aySel){
    const years = Array.from(new Set((GLOBAL_DATA.grades||[])
      .filter(g=>advisees.some(s=>String(s.id)===String(g.studentId)))
      .map(g=>academicYearOf(g.term))
      .filter(Boolean))).sort();
    aySel.innerHTML = `<option value="">ทั้งหมด</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  }

  // Modal รายละเอียดทีละคน (กดจากปุ่มดูรายละเอียด)
  window.openAdvisorDetail = function(studentId){
    const s  = advisees.find(x=>String(x.id)===String(studentId));
    const gA = (GLOBAL_DATA.grades||[]).filter(x=>String(x.studentId)===String(studentId));
    const eA = (GLOBAL_DATA.englishTests||[]).filter(x=>String(x.studentId)===String(studentId));

    const yf = aySel?.value || '';
    const g  = yf ? gA.filter(x=>academicYearOf(x.term)===yf) : gA;
    const e  = yf ? eA.filter(x=>String(x.academicYear)===yf) : eA;

    const box = qs('#advisorDetailContent');
    if (box){
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
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">ชื่อวิชา</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">หน่วยกิต</th>
                  <th class="px-3 py-2 text-left text-xs text-gray-500 uppercase">เกรด</th>
                </tr>
              </thead>
              <tbody id="advisorDetailGrades" class="divide-y divide-gray-200"></tbody>
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
              <tbody id="advisorDetailEnglish" class="divide-y divide-gray-200"></tbody>
            </table>
          </div>
        </div>
      `;
    }

    const gtb = qs('#advisorDetailGrades');
    if (gtb){
      gtb.innerHTML='';
      g.sort(by(x=>x.term||'')).forEach(x=>{
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

    const etb2 = qs('#advisorDetailEnglish');
    if (etb2){
      etb2.innerHTML='';
      e.sort((a,b)=>(Date.parse(b.examDate||'')||0)-(Date.parse(a.examDate||'')||0) || (Number(b.attempt||0)-Number(a.attempt||0)))
       .forEach(r=>{
        const tr=document.createElement('tr');
        tr.innerHTML = `
          <td class="px-3 py-2 text-sm">${r.academicYear||''}</td>
          <td class="px-3 py-2 text-sm">${r.attempt||''}</td>
          <td class="px-3 py-2 text-sm">${r.score||''}</td>
          <td class="px-3 py-2 text-sm">${r.status||''}</td>
          <td class="px-3 py-2 text-sm">${r.examDate||''}</td>`;
        etb2.appendChild(tr);
      });
    }

    openModal('modalAdvisorDetail');
  };
}

/******************** CHANGE PASSWORD (SweetAlert) ********************/
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

/******************** INIT ********************/
document.addEventListener('DOMContentLoaded', async ()=>{
  // แสดง/ซ่อนฟิลด์ login ตามประเภทผู้ใช้ (เบา ๆ)
  const userType = qs('#userType');
  const adminEmail = qs('#adminEmail');
  const adminPassword = qs('#adminPassword');
  const studentCid = qs('#studentCitizenId');
  function updateLoginFields(){
    const role = (userType?.value||'admin').toLowerCase();
    if (role==='student'){
      adminEmail?.closest('div')?.classList.add('hidden');
      adminPassword?.closest('div')?.classList.add('hidden');
      studentCid?.closest('div')?.classList.remove('hidden');
    }else{
      adminEmail?.closest('div')?.classList.remove('hidden');
      adminPassword?.closest('div')?.classList.remove('hidden');
      studentCid?.closest('div')?.classList.remove('hidden'); // เผื่อใช้สลับได้
    }
  }
  if (userType && !userType._wired){ userType._wired=true; userType.addEventListener('change', updateLoginFields); updateLoginFields(); }

  // auto login session
  const sess = loadSession();
  if(!sess) return;
  try{
    const boot = await callAPI('bootstrap', {});
    CURRENT_USER = { role:sess.role, id:sess.id, name:sess.name, email:sess.email };
    GLOBAL_DATA  = boot?.data || GLOBAL_DATA;

    goToDashboard();
    setActiveDashboard(CURRENT_USER.role);

    if (CURRENT_USER.role==='admin') showAdminDashboard();
    else if (CURRENT_USER.role==='advisor') showAdvisorDashboard();
    else showStudentDashboard();
  }catch{
    clearSession();
  }
});

/******************** MODAL HELPERS ********************/
function openModal(id){ qs('#modalBackdrop')?.classList.remove('hidden'); qs('#'+id)?.classList.remove('hidden'); }
function closeModal(id){ qs('#'+id)?.classList.add('hidden'); qs('#modalBackdrop')?.classList.add('hidden'); }

/******************** EXPORT to window ********************/
window.login = login;
window.logout = logout;
window.showAdminSection = showAdminSection;
window.saveEditStudent = saveEditStudent;
window.saveAddGrade = saveAddGrade;
window.saveAddEnglish = saveAddEnglish;
window.openChangePasswordModal = openChangePasswordModal;
window.setActiveDashboard = setActiveDashboard;
window.showAdvisorDashboard = showAdvisorDashboard;
window.showAdminDashboard = showAdminDashboard;
window.showStudentDashboard = showStudentDashboard;
