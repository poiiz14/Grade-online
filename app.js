/* ===================== CONFIG ===================== */
/** ใส่ URL /exec ของ Apps Script ที่ deploy แล้ว */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

/** ตรวจ URL ให้ชัดเจน */
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

/* Charts (ทำลายก่อนสร้างใหม่ เพื่อกันซ้ำ) */
let studentsChartInst = null;
let englishChartInst = null;

/* ===================== UTIL ===================== */
const qs  = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const by  = (proj) => (a,b) => (proj(a) < proj(b) ? -1 : (proj(a) > proj(b) ? 1 : 0));
const toInt = v => (v==null || v==='') ? 0 : parseInt(v,10);

/** JSONP call (รองรับ timeout/retry) */
function callAPI(action, data = {}, { timeoutMs = 30000, retries = 1, backoffMs = 700 } = {}) {
  function once(t) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const payloadStr = JSON.stringify(data || {});
      const s = document.createElement('script');
      const url = `${API_BASE}?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(payloadStr)}&callback=${cb}&_ts=${Date.now()}`;

      const cleanup = () => {
        try { delete window[cb]; } catch {}
        try { s.remove(); } catch {}
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('API timeout'));
      }, t);

      window[cb] = (res) => {
        clearTimeout(timer);
        cleanup();
        if (!res || res.success === false) {
          reject(new Error(res?.message || 'API error'));
          return;
        }
        resolve(res);
      };

      s.src = url;
      s.onerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('Network error'));
      };
      document.body.appendChild(s);
    });
  }

  return new Promise(async (resolve, reject) => {
    let n = 0; let last;
    while (n <= retries) {
      try {
        const out = await once(timeoutMs);
        resolve(out);
        return;
      } catch (e) {
        last = e; n++;
        if (n <= retries) await new Promise(r => setTimeout(r, backoffMs * n));
      }
    }
    reject(last || new Error('API failed'));
  });
}

/** Session */
function saveSession(data){ try{ localStorage.setItem('session', JSON.stringify(data||{})); }catch{} }
function loadSession(){ try{ return JSON.parse(localStorage.getItem('session')||'null'); }catch{ return null; } }
function clearSession(){ try{ localStorage.removeItem('session'); }catch{} }

/** แปลงเกรดเป็นคะแนน (สำหรับ GPA) */
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
  return null; // W/I/S/U/ฯลฯ ไม่นับ
}

/** group ล่าสุดของผลสอบอังกฤษต่อ studentId */
function latestEnglishMap(tests){
  const map = {};
  (tests||[]).forEach(t => {
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

/** คืนเกรดทั้งหมดของนักศึกษาคนหนึ่ง */
function gradesOf(grades, studentId){
  const sid = String(studentId||'').trim();
  return (grades||[]).filter(g => String(g.studentId||'').trim() === sid);
}

/** หน่วยกิตสะสมแบบไม่ซ้ำรายวิชา (ใช้ courseCode เป็นคีย์ ถ้าไม่มี ใช้ courseTitle) */
function uniqueCreditsSum(grades){
  const seen = new Map();
  (grades||[]).forEach(g=>{
    const key = (g.courseCode && String(g.courseCode).trim()) || (g.courseTitle && String(g.courseTitle).trim()) || '';
    if(!key) return;
    if(!seen.has(key)) seen.set(key, Number(g.credits||0));
  });
  let sum = 0; for (const v of seen.values()) sum += Number(v||0);
  return sum;
}

/** คำนวณ GPAX จากเกรดทั้งหมด (ภาพรวมทุกปี) */
function computeGPAX(allGrades){
  let totCred=0, totPts=0;
  (allGrades||[]).forEach(g=>{
    const gp = gradePoint(g.grade);
    const cr = Number(g.credits||0);
    if (gp==null || !cr) return;
    totCred += cr;
    totPts  += cr*gp;
  });
  return totCred ? (totPts/totCred) : 0;
}

/** ปีการศึกษา (ดึงจาก term รูป 2568/1) */
function academicYearOf(termStr){
  if(!termStr) return '';
  const s = String(termStr).split('/');
  return s[0] || '';
}

/** ภาค (1/2/3) จาก term (เช่น 2568/1 ⇒ 1) */
function semesterOf(termStr){
  if(!termStr) return '';
  const s = String(termStr).split('/');
  return s[1] || '';
}

/** modal helpers */
function openModal(id){ qs('#modalBackdrop')?.classList.remove('hidden'); qs(`#${id}`)?.classList.remove('hidden'); }
function closeModal(id){ qs(`#${id}`)?.classList.add('hidden'); qs('#modalBackdrop')?.classList.add('hidden'); }

/* ===================== AUTH / BOOTSTRAP ===================== */
async function login(){
  try{
    const role = (qs('#userType')?.value || 'admin').toLowerCase();
    let credentials = {};

    if (role==='admin'){
      const email = (qs('#adminEmail')?.value||'').trim();
      const password = qs('#adminPassword')?.value||'';
      if(!email||!password) { Swal.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
      credentials = { email, password };
    } else if (role==='student'){
      const citizenId = (qs('#studentCitizenId')?.value||'').replace(/\s|-/g,'');
      if(!citizenId) { Swal.fire({icon:'warning',title:'กรอกเลขบัตรประชาชน'}); return; }
      credentials = { citizenId };
    } else if (role==='advisor'){
      const email = (qs('#advisorEmail')?.value||'').trim();
      const password = qs('#advisorPassword')?.value||'';
      if(!email||!password) { Swal.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
      credentials = { email, password };
    }

    Swal.fire({title:'กำลังเข้าสู่ระบบ...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});

    const auth = await callAPI('authenticate', { userType: role, credentials });
    if(!auth?.success) throw new Error(auth?.message || 'เข้าสู่ระบบไม่สำเร็จ');

    const boot = await callAPI('bootstrap', {});
    if(!boot?.success) throw new Error(boot?.message || 'โหลดข้อมูลไม่สำเร็จ');

    CURRENT_USER = auth.data;
    GLOBAL_DATA = boot.data || GLOBAL_DATA;
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

function goToDashboard(){
  qs('#loginScreen')?.classList.add('hidden');
  qs('#dashboard')?.classList.remove('hidden');
}
function goToLogin(){
  qs('#dashboard')?.classList.add('hidden');
  qs('#loginScreen')?.classList.remove('hidden');
}
function logout(){
  clearSession();
  CURRENT_USER=null;
  GLOBAL_DATA={ students:[], grades:[], englishTests:[], advisors:[] };
  goToLogin();
}

/** NEW: เปิด dashboard ตามบทบาท (กันหน้าขาว) */
function setActiveDashboard(role){
  ['adminDashboard','studentDashboard','advisorDashboard'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  if (role === 'admin') {
    document.getElementById('adminDashboard')?.classList.remove('hidden');
  } else if (role === 'advisor') {
    document.getElementById('advisorDashboard')?.classList.remove('hidden');
  } else {
    document.getElementById('studentDashboard')?.classList.remove('hidden');
  }
}

/* ===================== ADMIN ===================== */
function showAdminDashboard(){
  showAdminSection('overview');
  buildAdminOverview();
  buildAdminStudents();
  ;
}

/** nav สลับ section */
function showAdminSection(name){
  ['adminOverview','adminStudents','adminIndividual'].forEach(id=>qs('#'+id)?.classList.add('hidden'));
  const map = { overview:'adminOverview', students:'adminStudents', individual:'adminIndividual' };
  qs('#'+(map[name]||'adminOverview'))?.classList.remove('hidden');

  // เน้นปุ่มเมนู
  qsa('.admin-nav').forEach(btn=>{
    btn.classList.remove('border-blue-500','text-blue-600');
    btn.classList.add('border-transparent','text-gray-600');
  });
  const order = ['overview','students','individual'];
  const idx = order.indexOf(name);
  const btn = qsa('.admin-nav')[idx];
  if (btn){
    btn.classList.add('border-blue-500','text-blue-600');
    btn.classList.remove('border-transparent','text-gray-600');
  }
}

/** ภาพรวม: จำนวน นศ., ผ่าน/ไม่ผ่านล่าสุด, จำนวนรายวิชาทั้งหมด + charts */
function buildAdminOverview(){
  const students = GLOBAL_DATA.students||[];
  const grades   = GLOBAL_DATA.grades||[];
  const engMap   = latestEnglishMap(GLOBAL_DATA.englishTests||[]);

  qs('#totalStudents').textContent = students.length.toString();

  let pass=0, fail=0;
  students.forEach(s=>{
    const r = engMap[String(s.id)];
    const st = String(r?.status||'').trim();
    if (/^ผ่าน$/i.test(st) || /^pass(ed)?$/i.test(st)) pass++; else fail++;
  });
  qs('#passedEnglish').textContent = pass.toString();
  qs('#failedEnglish').textContent = fail.toString();

  const seen = new Set();
  (grades||[]).forEach(g=>{
    const key = (g.courseCode && String(g.courseCode).trim()) || (g.courseTitle && String(g.courseTitle).trim());
    if (key) seen.add(key);
  });
  qs('#totalSubjects').textContent = seen.size.toString();

  const perYear = [1,2,3,4].map(y => students.filter(s=>String(s.year||'')==String(y)).length);
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

/** รายชื่อนักศึกษา: ค้นหาชื่อ + filter ชั้นปี + ปุ่มดู */
function buildAdminStudents(){
  const input = qs('#adminStudentSearch');
  const sel   = qs('#adminStudentYearFilter');
  const tbody = qs('#studentsTable');

  function render(){
    if(!tbody) return;
    tbody.innerHTML = '';
    const kw = (input?.value||'').trim().toLowerCase();
    const yf = (sel?.value||'').trim();

    const list = (GLOBAL_DATA.students||[])
      .filter(s => !kw || String(s.name||'').toLowerCase().includes(kw))
      .filter(s => !yf || String(s.year||'')===yf)
      .sort(by(s=>s.id));

    list.forEach(s=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-6 py-3 text-sm text-gray-700">${s.id||'-'}</td>
        <td class="px-6 py-3 text-sm text-gray-700">${s.name||'-'}</td>
        <td class="px-6 py-3 text-sm text-gray-700">${s.year||'-'}</td>
        <td class="px-6 py-3 text-sm text-gray-700">${s.advisor||'-'}</td>
        <td class="px-6 py-3">
          <button class="text-blue-600 hover:underline" onclick="openIndividual('${s.id||''}')">ดู</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  input?.addEventListener('input', render);
  sel?.addEventListener('change', render);
  render();
}

/** หน้า “ข้อมูลรายบุคคล” — ค้นหา + เลือกชื่อ + ปุ่มจัดการ + ตารางเกรด/อังกฤษ + เลือกปี & GPA ปีนั้น */
function buildAdminIndividual(){
    // bind buttons (แก้ไข/เพิ่มเกรด/เพิ่มอังกฤษ)
  const btnEdit = qs('#btnEditStudent');
  const btnAddG = qs('#btnAddGrade');
  const btnAddE = qs('#btnAddEnglish');

  btnEdit?.onclick = () => {
    if (!s) return;
    qs('#editStudentId').value       = s.id || '';
    qs('#editStudentName').value     = s.name || '';
    qs('#editStudentAdvisor').value  = s.advisor || '';
    qs('#editStudentYear').value     = s.year || '1';
    openModal('modalEditStudent');
  };

  btnAddG?.onclick = () => {
    if (!s) return;
    qs('#gradeStudentId').value   = s.id || '';
    qs('#gradeTerm').value        = '';
    qs('#gradeCourseCode').value  = '';
    qs('#gradeCourseTitle').value = '';
    qs('#gradeCredits').value     = '';
    qs('#gradeGrade').value       = '';
    qs('#gradeRecordedAt').value  = '';
    openModal('modalAddGrade');
  };

  btnAddE?.onclick = () => {
    if (!s) return;
    qs('#engStudentId').value     = s.id || '';
    qs('#engAcademicYear').value  = '';
    qs('#engAttempt').value       = '';
    qs('#engScore').value         = '';
    qs('#engStatus').value        = '';
    qs('#engExamDate').value      = '';
    openModal('modalAddEnglish');
  };
  
  function fillOptions(){
    if(!sel) return;
    const kw = (search?.value||'').trim().toLowerCase();
    const list = (GLOBAL_DATA.students||[])
      .filter(s => !kw || String(s.name||'').toLowerCase().includes(kw))
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

    // profile
    qs('#detailStudentId').textContent = s?.id||'-';
    qs('#detailStudentName').textContent = s?.name||'-';
    qs('#detailStudentYear').textContent = s?.year||'-';
    qs('#detailStudentAdvisor').textContent = s?.advisor||'-';

    // year dropdown
    fillYearOptions(studentId);

    // english table (ทุกปี)
    const etb = qs('#englishTestTable'); if(etb){ etb.innerHTML = '';
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

    // grades table (กรองตามปีที่เลือก) + คำนวณ GPA ปีนั้น + หน่วยกิตปีนั้น
    function renderGradesByYear(){
      const yf = yearSel?.value || '';
      const gtb = qs('#gradesDetailTable'); if(!gtb) return;
      gtb.innerHTML='';
      const rows = (yf ? allG.filter(g=>academicYearOf(g.term)===yf) : allG).sort(by(g=>g.term||''));
      let cr=0, pts=0;
      const seenKey = new Set(); // นับหน่วยกิตโดยไม่ซ้ำรายวิชาในปีนั้น
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
        if (gp!=null && c) { cr += c; pts += gp*c; }
        const key = (g.courseCode||g.courseTitle||'').toString().trim();
        if (key && !seenKey.has(key)) seenKey.add(key);
      });
      qs('#adminIndYearGPA').textContent = cr? (pts/cr).toFixed(2) : '-';
      // หน่วยกิตปีนี้ (ไม่นับซ้ำรายวิชาในปีนั้น)
      const creditsYear = (yf ? uniqueCreditsSum(allG.filter(g=>academicYearOf(g.term)===yf)) : uniqueCreditsSum(allG));
      qs('#adminIndYearCredits').textContent = String(creditsYear || 0);
    }
    renderGradesByYear();

    // bind change
    yearSel?.addEventListener('change', renderGradesByYear, { once:true }); // ผูกครั้งแรก
    // rebind ทุกครั้งที่เรียก renderDetail ใหม่
    yearSel?.addEventListener('change', renderGradesByYear);

    // bind buttons (แก้ไข/เพิ่มเกรด/เพิ่มอังกฤษ)
    const btnEdit = qs('#btnEditStudent');
    const btnAddG = qs('#btnAddGrade');
    const btnAddE = qs('#btnAddEnglish');

    btnEdit?.onclick = ()=>{
      if(!s) return;
      qs('#editStudentId').value    = s.id||'';
      qs('#editStudentName').value  = s.name||'';
      qs('#editStudentAdvisor').value = s.advisor||'';
      qs('#editStudentYear').value  = s.year||'1';
      openModal('modalEditStudent');
    };
    btnAddG?.onclick = ()=>{
      if(!s) return;
      qs('#gradeStudentId').value = s.id||'';
      qs('#gradeTerm').value=''; qs('#gradeCourseCode').value='';
      qs('#gradeCourseTitle').value=''; qs('#gradeCredits').value='';
      qs('#gradeGrade').value=''; qs('#gradeRecordedAt').value='';
      openModal('modalAddGrade');
    };
    btnAddE?.onclick = ()=>{
      if(!s) return;
      qs('#engStudentId').value = s.id||'';
      qs('#engAcademicYear').value=''; qs('#engAttempt').value='';
      qs('#engScore').value=''; qs('#engStatus').value=''; qs('#engExamDate').value='';
      openModal('modalAddEnglish');
    };
  }

  search?.addEventListener('input', fillOptions);
  sel?.addEventListener('change', ()=> renderDetail(sel.value));
  fillOptions();

  // เผยแพร่ให้ตารางรายชื่อเรียกมาเปิด
  window.openIndividual = function(studentId){
    showAdminSection('individual');
    fillOptions();
    if (sel){
      sel.value = studentId||'';
      sel.dispatchEvent(new Event('change'));
    }
  };
}

/* ===== Admin: Save actions (เรียก code.gs) ===== */
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
    if (s){ s.name=name; s.advisor=advisor; s.year=year; }

    Swal.close(); closeModal('modalEditStudent');
    Swal.fire({icon:'success',title:'บันทึกแล้ว'});
    buildAdminStudents();
    const sel = qs('#adminIndSelect'); if (sel?.value===id) sel.dispatchEvent(new Event('change'));
    buildAdminOverview();
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
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
    const sel = qs('#adminIndSelect'); if (sel?.value===studentId) sel.dispatchEvent(new Event('change'));
    buildAdminOverview();
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
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
    const sel = qs('#adminIndSelect'); if (sel?.value===studentId) sel.dispatchEvent(new Event('change'));
    buildAdminOverview();
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/* ===================== STUDENT ===================== */
function showStudentDashboard(){
  const me = CURRENT_USER || {};
  const myGrades = gradesOf(GLOBAL_DATA.grades||[], me.id);
  const myTests  = (GLOBAL_DATA.englishTests||[]).filter(t=>String(t.studentId)===String(me.id));

  // GPAX (ทุกปี)
  const gpax = computeGPAX(myGrades);
  qs('#studentGPAX').textContent = gpax ? gpax.toFixed(2) : '0.00';

  // หน่วยกิตสะสมไม่นับซ้ำรายวิชา
  qs('#studentCredits').textContent = uniqueCreditsSum(myGrades).toString();

  // ภาษาอังกฤษ (ล่าสุดเท่านั้น)
  const latest = latestEnglishMap(myTests||[])[String(me.id)];
  qs('#studentEnglishStatus').textContent = latest ? `${latest.status||'-'} (${latest.score||'-'})` : '-';

  // dropdown ปีการศึกษา (แสดงเฉพาะปี เช่น 2567, 2568)
  const aySel = qs('#studentAcademicYear');
  if (aySel){
    const years = Array.from(new Set((myGrades||[])
      .map(g=>academicYearOf(g.term))
      .filter(Boolean))).sort();
    aySel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  }

  // ตารางภาคเรียน + GPA ภาคเรียน
  const table = qs('#studentSemesterTable');
  let currentSem = '1';

  window.showSemester = function(sem){
    currentSem = String(sem||'1');
    qsa('.semester-tab').forEach(btn=>{
      const active = (sem==='1' && btn.textContent.includes('ที่ 1')) ||
                     (sem==='2' && btn.textContent.includes('ที่ 2')) ||
                     (sem==='3' && btn.textContent.includes('ฤดูร้อน'));
      btn.classList.toggle('border-blue-500', active);
      btn.classList.toggle('text-blue-600', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('text-gray-700', !active);
    });
    updateStudentSemester(currentSem);
  };

  function updateStudentSemester(sem){
    if (!table) return;
    table.innerHTML = '';
    const yearFilter = aySel?.value || '';

    const rows = (myGrades||[])
      .filter(g => String(semesterOf(g.term))===String(sem))
      .filter(g => !yearFilter || academicYearOf(g.term)===yearFilter)
      .sort(by(g=>g.courseCode||g.courseTitle||''));

    let cr=0, pts=0;
    rows.forEach(g=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
        <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
        <td class="px-4 py-2 text-sm">${g.credits||''}</td>
        <td class="px-4 py-2 text-sm">${g.grade||''}</td>`;
      table.appendChild(tr);

      const gp = gradePoint(g.grade);
      const c  = Number(g.credits||0);
      if (gp!=null && c) { cr += c; pts += gp*c; }
    });

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm font-semibold" colspan="2">สรุป GPA ภาคเรียน</td>
      <td class="px-4 py-2 text-sm font-semibold" colspan="2">${cr? (pts/cr).toFixed(2) : '-'}</td>`;
    table.appendChild(tr);
  }

  aySel?.addEventListener('change', ()=> updateStudentSemester(currentSem));
  window.showSemester('1');
}

/* ===================== ADVISOR ===================== */
function showAdvisorDashboard(){
  const meEmail = (CURRENT_USER?.email||'').toLowerCase().trim();
  const myStudents = (GLOBAL_DATA.students||[]).filter(s => String((s.advisor||'').toLowerCase())===meEmail || String((s.advisor||'').trim())===CURRENT_USER.name);

  // Summary: total + แจกชั้นปี (ทั้งหมดในกรอบเดียว)
  qs('#advTotal').textContent = myStudents.length.toString();
  const y1 = myStudents.filter(s=>String(s.year)==='1').length;
  const y2 = myStudents.filter(s=>String(s.year)==='2').length;
  const y3 = myStudents.filter(s=>String(s.year)==='3').length;
  const y4 = myStudents.filter(s=>String(s.year)==='4').length;
  qs('#advY1').textContent = y1.toString();
  qs('#advY2').textContent = y2.toString();
  qs('#advY3').textContent = y3.toString();
  qs('#advY4').textContent = y4.toString();

  // ผ่าน สบช. (ล่าสุด)
  const latest = latestEnglishMap((GLOBAL_DATA.englishTests||[]).filter(t=>myStudents.some(s=>String(s.id)===String(t.studentId))));
  let pass=0; Object.keys(latest).forEach(k=>{
    const st = String(latest[k]?.status||'').trim();
    if (/^ผ่าน$/i.test(st) || /^pass(ed)?$/i.test(st)) pass++;
  });
  qs('#advPassAll').textContent = pass.toString();

  // ปุ่มเลือกปีการศึกษา (แสดงเฉพาะปี เช่น 2567)
  const aySel = qs('#advisorAcademicYear');
  if (aySel){
    const years = Array.from(new Set((GLOBAL_DATA.grades||[])
      .filter(g=>myStudents.some(s=>String(s.id)===String(g.studentId)))
      .map(g=>academicYearOf(g.term))
      .filter(Boolean))).sort();
    aySel.innerHTML = `<option value="">ทั้งหมด</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
    aySel.addEventListener('change', renderAdvisorLists);
  }

  function renderAdvisorLists(){
    const yearFilter = aySel?.value || '';

    // รายการคลิกรายคน
    const list = qs('#advisorStudentsList'); if(list){ list.innerHTML='';
      myStudents.sort(by(s=>s.name||'')).forEach(s=>{
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

    // ตารางสรุปผลอังกฤษล่าสุด (ยังคงเป็น "ล่าสุด" ตาม requirement)
    const etb = qs('#advisorEnglishTable'); if(etb){ etb.innerHTML='';
      myStudents.forEach(s=>{
        const latestS = latest[String(s.id)];
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm">${s.id||''}</td>
          <td class="px-4 py-2 text-sm">${s.name||''}</td>
          <td class="px-4 py-2 text-sm">${s.year||''}</td>
          <td class="px-4 py-2 text-sm">${latestS?.status||'-'}</td>
          <td class="px-4 py-2 text-sm">${latestS?.score||'-'}</td>`;
        etb.appendChild(tr);
      });
    }

    // expose modal opener (ข้อมูลอ้างอิง "ปีการศึกษา" ที่เลือก)
    window.openAdvisorDetail = function(studentId){
      const s = myStudents.find(x=>String(x.id)===String(studentId));
      const g = (GLOBAL_DATA.grades||[]).filter(x=>String(x.studentId)===String(studentId));
      const e = (GLOBAL_DATA.englishTests||[]).filter(x=>String(x.studentId)===String(studentId));

      const yf = yearFilter;
      const gY = yf ? g.filter(x=>academicYearOf(x.term)===yf) : g;
      const eY = yf ? e.filter(x=>String(x.academicYear)===yf)   : e;

      // ป้องกันเคสที่ "รายวิชา" เผลอเป็นรหัสวิชา ให้ไม่โชว์ซ้ำ
      function cleanTitle(x){
        const t = (x?.courseTitle||'').trim();
        const code = (x?.courseCode||'').trim();
        if (!t) return '';
        if (t===code) return '';                          // ถ้าเท่ากันไม่โชว์ซ้ำ
        if (/^[A-Za-z]{2,}\d{2,}$/i.test(t)) return '';   // ถ้าดูเหมือนรหัส ก็ไม่ใส่ในคอลัมน์ "รายวิชา"
        return t;
      }

      const box = qs('#advisorDetailContent'); if (box){
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

/* ===================== CHANGE PASSWORD (ใช้ SweetAlert) ===================== */
async function openChangePasswordModal(){
  const { value: formValues } = await Swal.fire({
    title: 'เปลี่ยนรหัสผ่าน',
    html:
      '<input id="swal-old" class="swal2-input" placeholder="รหัสผ่านเดิม" type="password">' +
      '<input id="swal-new" class="swal2-input" placeholder="รหัสผ่านใหม่" type="password">',
    focusConfirm: false,
    preConfirm: () => {
      return [
        document.getElementById('swal-old').value,
        document.getElementById('swal-new').value
      ]
    },
    confirmButtonText: 'บันทึก',
    showCancelButton: true,
    cancelButtonText: 'ยกเลิก'
  });
  if (!formValues) return;

  const [oldPass, newPass] = formValues;
  if (!oldPass || !newPass) { Swal.fire({icon:'warning',title:'กรอกข้อมูลให้ครบ'}); return; }

  try{
    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const role = CURRENT_USER?.role || 'admin';
    const res = await callAPI('changePassword', { role, oldPass, newPass, email: CURRENT_USER?.email||'' });
    if(!res?.success) throw new Error(res?.message||'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    Swal.close();
    Swal.fire({icon:'success',title:'เปลี่ยนรหัสผ่านแล้ว'});
  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/* ===================== INIT (auto-login ถ้ามี session) ===================== */
document.addEventListener('DOMContentLoaded', async () => {
  const sess = loadSession();
  if (!sess){ return; }
  try{
    const boot = await callAPI('bootstrap', {});
    CURRENT_USER = { role:sess.role, id:sess.id, name:sess.name, email:sess.email };
    GLOBAL_DATA = boot?.data || GLOBAL_DATA;
    if (typeof window.updateRoleUI === 'function') window.updateRoleUI(CURRENT_USER.role, CURRENT_USER.name);
    goToDashboard();
    setActiveDashboard(CURRENT_USER.role);
    if (CURRENT_USER.role==='admin') showAdminDashboard();
    else if (CURRENT_USER.role==='advisor') showAdvisorDashboard();
    else showStudentDashboard();
  }catch{
    clearSession();
  }
});

/* ===================== EXPORT GLOBAL (ให้ index.html เรียกได้) ===================== */
window.login = login;
window.logout = logout;
window.showAdminSection = showAdminSection;
window.saveEditStudent = saveEditStudent;
window.saveAddGrade = saveAddGrade;
window.saveAddEnglish = saveAddEnglish;
window.openChangePasswordModal = openChangePasswordModal;
window.setActiveDashboard = setActiveDashboard;

