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
function show(el){ el?.classList?.remove('hidden'); }
function hide(el){ el?.classList?.add('hidden'); }

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

/** ดึงปีการศึกษาจาก term รูปแบบ "YYYY/ภาค" */
function academicYearOf(term){
  const t = String(term||'').trim();
  const m = t.match(/^(\d{4})\s*\/\s*([123])$/);
  return m ? m[1] : '';
}

/** รวมรายวิชาที่สอบซ้ำ ให้เหลือ attempt ล่าสุด (เทียบจากปี/ภาค แล้ว attempt สุดท้าย) */
function collapseRetaken(grades){
  const best = new Map(); // key=courseCode|courseTitle ; value=grade obj (ล่าสุด)
  (grades||[]).forEach(g=>{
    const key = (g.courseCode && String(g.courseCode).trim()) || (g.courseTitle && String(g.courseTitle).trim());
    if(!key) return;
    const at = academicYearOf(g.term);
    const sem = (String(g.term||'').split('/')[1]||'').padStart(1,'0');
    const stamp = `${at}/${sem}/${String(g.recordedAt||'').padStart(20,' ')}`;
    if(!best.has(key) || best.get(key).__stamp < stamp){
      best.set(key, {...g, __stamp: stamp});
    }
  });
  return Array.from(best.values());
}

/** SUM credits (รายวิชาที่เหลือหลัง collapse) */
function totalCredits(grs){
  return (grs||[]).reduce((s,g)=> s + (Number(g.credits||0)||0), 0);
}

/** คำนวณ GPA จากชุดรายวิชา */
function computeGPA(grs){
  let pts=0, cr=0;
  (grs||[]).forEach(g=>{
    const gp = gradePoint(g.grade);
    const c  = Number(g.credits||0);
    if (gp!=null && c){ pts += gp*c; cr += c; }
  });
  return { gpa: (cr? (pts/cr): null), credits: cr };
}

/** ดึงเกรดเฉพาะของนักศึกษา */
function gradesOf(grades, studentId){
  const sid = String(studentId||'').trim();
  return (grades||[]).filter(g => String(g.studentId||'').trim() === sid);
}

/** สร้างรายการปีการศึกษาที่มีอยู่ (เรียงจากน้อยไปมาก) */
function academicYearsFromGrades(grades){
  return Array.from(new Set((grades||[])
    .map(g=>academicYearOf(g.term))
    .filter(Boolean))).sort();
}

/** หา English ล่าสุด (เทียบปี > attempt > วันที่) */
function latestEnglish(tests){
  if(!tests || !tests.length) return null;
  const sorted = [...tests].sort((a,b)=>{
    const ay = (toInt(b.academicYear) - toInt(a.academicYear));
    if (ay!==0) return ay;
    const at = (toInt(b.attempt) - toInt(a.attempt));
    if (at!==0) return at;
    return String(b.examDate||'').localeCompare(String(a.examDate||''));
  });
  return sorted[0];
}

/* ===================== NAV/SECTIONS ===================== */
function goToLogin(){
  hide(qs('#adminSection')); hide(qs('#studentSection')); hide(qs('#advisorSection'));
  show(qs('#loginSection'));
}
function goToRole(role){
  hide(qs('#loginSection'));
  hide(qs('#adminSection')); hide(qs('#studentSection')); hide(qs('#advisorSection'));
  if(role==='admin') show(qs('#adminSection'));
  else if(role==='advisor') show(qs('#advisorSection'));
  else show(qs('#studentSection'));
}
function logout(){
  clearSession(); CURRENT_USER=null; GLOBAL_DATA = { students:[], grades:[], englishTests:[], advisors:[] };
  setText('currentUserName','');
  goToLogin();
}

/* ===================== AUTH ===================== */
async function login(){
  try{
    const role = (qs('#loginType')?.value || 'admin').toLowerCase();
    let credentials = {};
    if (role==='admin'){
      const email = (qs('#adminEmail')?.value||'').trim();
      const password = qs('#adminPassword')?.value||'';
      if(!email||!password){ Swal.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
      credentials = { email, password };
    }else if (role==='student'){
      const citizenId = (qs('#studentCitizenId')?.value||'').replace(/\s|-/g,'');
      if(!citizenId){ Swal.fire({icon:'warning',title:'กรอกเลขบัตรประชาชน'}); return; }
      credentials = { citizenId };
    }else{
      const email = (qs('#advisorEmail')?.value||'').trim();
      const password = qs('#advisorPassword')?.value||'';
      if(!email||!password){ Swal.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่าน'}); return; }
      credentials = { email, password };
    }

    Swal.fire({title:'กำลังเข้าสู่ระบบ...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const res = await callAPI('authenticate', { userType: role, credentials });
    if(!res?.success) throw new Error(res?.message||'เข้าสู่ระบบไม่สำเร็จ');
    CURRENT_USER = { ...(res.data||{}), role };
    saveSession(CURRENT_USER);

    // bootstrap data
    const boot = await callAPI('bootstrap', {});
    GLOBAL_DATA = boot?.data || GLOBAL_DATA;

    Swal.close();
    setText('currentUserName', `${CURRENT_USER?.name||CURRENT_USER?.email||''} (${role})`);
    goToRole(role);

    if (role==='admin'){ initAdmin(); }
    else if (role==='student'){ initStudent(); }
    else { initAdvisor(); }

  }catch(err){
    Swal.close();
    Swal.fire({icon:'error',title:'ผิดพลาด', text: String(err?.message||err)});
  }
}

/* ===================== ADMIN ===================== */
function initAdmin(){
  // nav tabs
  qsa('.navtab').forEach(btn=>{
    btn.onclick = ()=>{
      qsa('.navtab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      qsa('.admin-section').forEach(sec=>sec.classList.add('hidden'));
      show(qs('#'+tab));
      if(tab==='adminOverview') buildAdminOverview();
      if(tab==='adminStudents') buildAdminStudents();
      if(tab==='adminIndividual') buildAdminIndividual();
    };
  });
  // default
  buildAdminOverview();
}

function buildAdminOverview(){
  const students = (GLOBAL_DATA.students||[]);
  const advisors = (GLOBAL_DATA.advisors||[]);
  const english  = (GLOBAL_DATA.englishTests||[]);
  const grades   = (GLOBAL_DATA.grades||[]);

  setText('totalStudents', students.length);
  setText('totalAdvisors', advisors.length);
  setText('totalEnglish', new Set(english.map(e=>String(e.studentId))).size);
  setText('totalSubjects', new Set(grades.map(g=>(g.courseCode||g.courseTitle||'').toString().trim())).size);

  // Chart: students by year
  const perYearCount = [1,2,3,4].map(y=>students.filter(s=>String(s.year)===String(y)).length);
  if(studentsChartInst){ try{ studentsChartInst.destroy(); }catch{} }
  const c1 = qs('#chartByYear');
  if (c1){
    studentsChartInst = new Chart(c1, {
      type: 'bar',
      data: { labels: ['ปี 1','ปี 2','ปี 3','ปี 4'], datasets:[{ label:'จำนวนนักศึกษา', data: perYearCount }] },
      options: { responsive:true, maintainAspectRatio:false }
    });
  }

  // Chart: english latest pass/fail
  const latestByStu = {};
  (english||[]).forEach(t=>{
    const sid = String(t.studentId);
    latestByStu[sid] = latestEnglish([...(latestByStu[sid]? [latestByStu[sid]]:[]), t]);
  });
  let pass=0, fail=0;
  Object.values(latestByStu).forEach(t=>{
    if(!t) return;
    const st = String(t.status||'').trim();
    if (/^ผ่าน$/i.test(st) || /^pass$/i.test(st)) pass++;
    else fail++;
  });
  if(englishChartInst){ try{ englishChartInst.destroy(); }catch{} }
  const c2 = qs('#chartEnglish');
  if (c2){
    englishChartInst = new Chart(c2, {
      type: 'doughnut',
      data: { labels: ['ผ่าน','ไม่ผ่าน'], datasets:[{ data: [pass, fail] }] },
      options: { responsive: true, maintainAspectRatio: true, aspectRatio: 1, plugins:{ legend:{ position:'bottom' } } }
    });
  }
}

function buildAdminStudents(){
  const input = qs('#studentsSearch');
  const sel   = qs('#studentsYearFilter');
  const tbody = qs('#studentsTable');

  function render(){
    const term = (input?.value||'').trim().toLowerCase();
    const y    = (sel?.value||'').trim();
    const rows = (GLOBAL_DATA.students||[])
      .filter(s=>{
        const match = !term || String(s.id).toLowerCase().includes(term) || String(s.name).toLowerCase().includes(term);
        const yok   = !y || String(s.year)===y;
        return match && yok;
      })
      .sort(by(s=>String(s.id||'').padStart(20,'0')));

    setText('studentsCount', rows.length);
    if(tbody){ tbody.innerHTML='';
      rows.forEach(s=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="px-6 py-3 text-sm">${s.id||''}</td>
          <td class="px-6 py-3 text-sm">${s.name||''}</td>
          <td class="px-6 py-3 text-sm">${s.year||''}</td>
          <td class="px-6 py-3 text-sm">${s.advisor||''}</td>
          <td class="px-6 py-3 text-right">
            <button class="px-3 py-1 rounded-lg border" data-id="${s.id}">เลือก</button>
          </td>`;
        const btn = tr.querySelector('button');
        btn.onclick = ()=>{
          const sel = qs('#adminIndSelect');
          if(sel){ sel.value = s.id; sel.dispatchEvent(new Event('change')); }
          // jump tab
          qsa('.navtab').forEach(b=>{
            if(b.getAttribute('data-tab')==='adminIndividual'){ b.click(); }
          });
        };
        tbody.appendChild(tr);
      });
    }
  }
  input && input.addEventListener('input', render);
  sel && sel.addEventListener('change', render);
  render();
}

function buildAdminIndividual(){
  const sel   = qs('#adminIndSelect');
  const yearSel = qs('#adminIndYear');

  // เติม select “นักศึกษา” — เรียงตาม “รหัสนักศึกษา”
  if(sel){
    sel.innerHTML = `<option value="">-- เลือกนักศึกษา --</option>` +
      (GLOBAL_DATA.students||[])
        .slice()
        .sort(by(s=>String(s.id||'').padStart(20,'0')))
        .map(s=>`<option value="${s.id}">[${s.id}] ${s.name}</option>`).join('');
    sel.onchange = renderDetail;
  }

  function renderDetail(){
    const sid = sel?.value || '';
    const s = (GLOBAL_DATA.students||[]).find(x=>String(x.id)===String(sid));
    setText('detailStudentId', s?.id||'-');
    setText('detailStudentName', s?.name||'-');
    setText('detailStudentYear', s?.year||'-');
    setText('detailStudentAdvisor', s?.advisor||'-');

    // เติมตัวเลือกปีการศึกษา
    const myGrades = gradesOf(GLOBAL_DATA.grades||[], sid);
    const years = academicYearsFromGrades(myGrades);
    if(yearSel){
      yearSel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
      yearSel.onchange = renderGradesByYear;
    }

    // GPAX รวมทุกปี
    const collapsedAll = collapseRetaken(myGrades);
    const { gpa:gpax, credits:crx } = computeGPA(collapsedAll);
    setText('adminIndGPAX', gpax!=null ? gpax.toFixed(2) : '-');

    // เกรดรายปี + ตาราง
    function renderGradesByYear(){
      const yf = yearSel?.value || '';
      const list = myGrades.filter(g=>!yf || academicYearOf(g.term)===yf)
                           .sort(by(g=>String(g.term||'')));

      // คำนวณ GPA เฉพาะปีที่กรอง
      const collapsedY = collapseRetaken(list);
      const { gpa, credits } = computeGPA(collapsedY);
      setText('adminIndYearGPA', g!=null ? g.toFixed(2) : (g===0?'0.00':'-'));
      setText('adminIndYearCredits', credits||0);

      // ตารางรายวิชา + ปุ่มแก้ไข
      const gtb = qs('#adminIndGradesBody');
      setText('adminIndGradesCount', list.length);
      if(gtb){ gtb.innerHTML='';
        list.forEach(g=>{
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="px-4 py-2 text-sm">${g.term||''}</td>
            <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
            <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
            <td class="px-4 py-2 text-sm">${g.credits||''}</td>
            <td class="px-4 py-2 text-sm">${g.grade||''}</td>
            <td class="px-4 py-2 text-right">
              <button class="px-2 py-1 rounded-lg border text-xs" data-edit="1">แก้ไข</button>
            </td>`;
          tr.querySelector('button[data-edit]')?.addEventListener('click', ()=> openEditGradeDialog(g));
          gtb.appendChild(tr);
        });
      }

      // ตารางอังกฤษ (ทั้งหมด)
      const etb = qs('#adminIndEnglishBody');
      const myEng = (GLOBAL_DATA.englishTests||[]).filter(t=>String(t.studentId)===String(sid))
                     .filter(t=>!yf || String(t.academicYear)===String(yf))
                     .sort(by(t=>`${t.academicYear}`));
      setText('adminIndEnglishCount', myEng.length);
      if(etb){ etb.innerHTML='';
        myEng.forEach(t=>{
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="px-4 py-2 text-sm">${t.academicYear||''}</td>
            <td class="px-4 py-2 text-sm">${t.attempt||''}</td>
            <td class="px-4 py-2 text-sm">${t.score||''}</td>
            <td class="px-4 py-2 text-sm">${t.status||''}</td>
            <td class="px-4 py-2 text-sm">${t.examDate||''}</td>`;
          etb.appendChild(tr);
        });
      }
    }
    renderGradesByYear();

    // ปุ่มแก้ไข/เพิ่มข้อมูล
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
      qs('#addGradeStudentId').value = s.id||'';
      openModal('modalAddGrade');
    });

    btnAddE && (btnAddE.onclick = () => {
      if(!s) return;
      qs('#addEngStudentId').value = s.id||'';
      openModal('modalAddEnglish');
    });
  }

  // หากยังไม่เลือก ให้ render ครั้งแรก (clear ตาราง)
  sel && renderDetail();
}

/** SweetAlert: แก้ไขผลการเรียนรายวิชา */
async function openEditGradeDialog(g){
  const html = `
    <input id="eg-term" class="swal2-input" placeholder="ภาค (เช่น 2568/1)" value="${g.term||''}">
    <input id="eg-code" class="swal2-input" placeholder="รหัสวิชา" value="${g.courseCode||''}">
    <input id="eg-title" class="swal2-input" placeholder="รายวิชา" value="${g.courseTitle||''}">
    <input id="eg-credits" class="swal2-input" type="number" step="0.5" placeholder="หน่วยกิต" value="${g.credits||''}">
    <input id="eg-grade" class="swal2-input" placeholder="เกรด" value="${g.grade||''}">
  `;
  const { value: ok } = await Swal.fire({
    title: 'แก้ไขผลการเรียน',
    html, focusConfirm:false, showCancelButton:true,
    confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
    preConfirm: ()=>true
  });
  if(!ok) return;
  const term    = document.getElementById('eg-term').value;
  const codeNew = document.getElementById('eg-code').value;
  const titleNew= document.getElementById('eg-title').value;
  const credits = document.getElementById('eg-credits').value;
  const grade   = document.getElementById('eg-grade').value;

  try{
    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const res = await callAPI('updateGrade', {
      studentId: g.studentId,
      term: g.term,
      courseCode: g.courseCode,
      courseTitle: g.courseTitle,
      newTerm: term,
      newCourseCode: codeNew,
      newCourseTitle: titleNew,
      credits, grade
    });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');

    // อัปเดตในหน่วยความจำ
    const arr = GLOBAL_DATA.grades || [];
    const idx = arr.findIndex(x =>
      String(x.studentId)===String(g.studentId) &&
      String(x.term)===String(g.term) &&
      (String(x.courseCode||'')===String(g.courseCode||'') || String(x.courseTitle||'')===String(g.courseTitle||''))
    );
    if(idx>-1){
      arr[idx] = { ...arr[idx], term, courseCode: codeNew, courseTitle: titleNew, credits, grade };
    }
    Swal.close(); Swal.fire({icon:'success',title:'แก้ไขแล้ว'});
    // refresh detail
    const sel = qs('#adminIndSelect'); sel && sel.dispatchEvent(new Event('change'));
    buildAdminOverview();
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/** บันทึกแก้ไขข้อมูลนักศึกษา (modal) */
async function saveEditStudent(){
  const oldId   = qs('#detailStudentId')?.textContent?.trim();
  const idText  = qs('#editStudentId')?.value || '';
  const name    = qs('#editStudentName')?.value || '';
  const advisor = qs('#editStudentAdvisor')?.value || '';
  const year    = qs('#editStudentYear')?.value || '';

  if(!oldId){ Swal.fire({icon:'warning',title:'ยังไม่เลือกนักศึกษา'}); return; }
  if(!idText || !name || !year){ Swal.fire({icon:'warning',title:'กรอกข้อมูลให้ครบ'}); return; }

  try{
    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const payload = { id: oldId, name, advisor, year };
    if (String(idText)!==String(oldId)) payload.newId = idText;

    const res = await callAPI('updateStudent', payload);
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');

    // sync ในหน่วยความจำ (Students)
    const sIdx = (GLOBAL_DATA.students||[]).findIndex(s=>String(s.id)===String(oldId));
    if(sIdx>-1){
      GLOBAL_DATA.students[sIdx] = { ...GLOBAL_DATA.students[sIdx], id: (payload.newId||oldId), name, advisor, year };
    }
    // เปลี่ยน id ใน grades / English ในหน่วยความจำ (เผื่อแสดงผลต่อเนื่อง)
    if(payload.newId){
      (GLOBAL_DATA.grades||[]).forEach(g=>{ if(String(g.studentId)===String(oldId)) g.studentId = payload.newId; });
      (GLOBAL_DATA.englishTests||[]).forEach(t=>{ if(String(t.studentId)===String(oldId)) t.studentId = payload.newId; });
    }

    closeModal('modalEditStudent');
    Swal.close(); Swal.fire({icon:'success',title:'บันทึกแล้ว'});

    // refresh
    buildAdminOverview();
    buildAdminIndividual();
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/** เพิ่มผลการเรียน (modal) */
async function saveAddGrade(){
  const studentId  = qs('#addGradeStudentId').value;
  const term       = qs('#addGradeTerm').value;
  const courseCode = qs('#addGradeCourseCode').value;
  const courseTitle= qs('#addGradeCourseTitle').value;
  const credits    = qs('#addGradeCredits').value;
  const grade      = qs('#addGradeGrade').value;

  if(!studentId || !term || !courseTitle){ Swal.fire({icon:'warning',title:'กรอกข้อมูลให้ครบ (อย่างน้อย รหัส, ภาค, รายวิชา)'}); return; }

  try{
    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const res = await callAPI('addGrade', { studentId, term, courseCode, courseTitle, credits, grade });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');

    (GLOBAL_DATA.grades||[]).push({ studentId, term, courseCode, courseTitle, credits, grade, recordedAt: new Date().toISOString() });

    closeModal('modalAddGrade');
    Swal.close(); Swal.fire({icon:'success',title:'เพิ่มผลการเรียนแล้ว'});

    const sel = qs('#adminIndSelect'); if(sel?.value===studentId) sel.dispatchEvent(new Event('change'));
    buildAdminOverview();
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/** เพิ่มผลสอบอังกฤษ (modal) */
async function saveAddEnglish(){
  const studentId    = qs('#addEngStudentId').value;
  const academicYear = qs('#addEngYear').value;
  const attempt      = qs('#addEngAttempt').value;
  const score        = qs('#addEngScore').value;
  const status       = qs('#addEngStatus').value;
  const examDate     = qs('#addEngDate').value || '';

  if(!studentId || !academicYear || !attempt || !score || !status){
    Swal.fire({icon:'warning',title:'กรอกข้อมูลให้ครบ'}); return;
  }

  try{
    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const res = await callAPI('addEnglishTest', { studentId, academicYear, attempt, score, status, examDate });
    if(!res?.success) throw new Error(res?.message||'บันทึกไม่สำเร็จ');

    (GLOBAL_DATA.englishTests||[]).push({ studentId, academicYear, attempt, score, status, examDate });

    closeModal('modalAddEnglish');
    Swal.close(); Swal.fire({icon:'success',title:'เพิ่มผลสอบแล้ว'});
    const sel = qs('#adminIndSelect'); if(sel?.value===studentId) sel.dispatchEvent(new Event('change'));
    buildAdminOverview();
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/* ===================== STUDENT ===================== */
function initStudent(){ showStudentDashboard(); }

function showStudentDashboard(){
  const me = CURRENT_USER || {};
  const myGrades = gradesOf(GLOBAL_DATA.grades||[], me.id);
  const myEng    = (GLOBAL_DATA.englishTests||[]).filter(t=>String(t.studentId)===String(me.id));

  // GPAX & credits สะสม
  const collapsedAll = collapseRetaken(myGrades);
  const { gpa:gpax, credits:creditsAll } = computeGPA(collapsedAll);
  setText('studentGPAX', gpax!=null ? gpax.toFixed(2) : '-');
  setText('studentCredits', creditsAll||0);

  // “ล่าสุด” ภาษาอังกฤษ
  const lastE = latestEnglish(myEng);
  setText('studentEnglishLatest', lastE ? `${lastE.status||'-'} (${lastE.score||'-'})` : '-');

  // ตัวเลือกปี
  const yearSel = qs('#studentYearFilter');
  const years = academicYearsFromGrades(myGrades);
  if(yearSel){
    yearSel.innerHTML = `<option value="">ทุกปีการศึกษา</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
    yearSel.onchange = renderByYear;
  }

  function renderByYear(){
    const yf = yearSel?.value || '';
    const list = myGrades.filter(g=>!yf || academicYearOf(g.term)===yf).sort(by(g=>String(g.term||'')));

    // GPA ปีนี้
    const collapsedY = collapseRetaken(list);
    const { gpa, credits } = computeGPA(collapsedY);
    setText('studentYearGPA', gpa!=null ? gpa.toFixed(2) : '-');
    setText('studentYearCredits', credits||0);

    // ตารางรายวิชา
    const gtb = qs('#studentGradesBody');
    setText('studentGradesCount', list.length);
    if(gtb){ gtb.innerHTML='';
      list.forEach(g=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm">${g.term||''}</td>
          <td class="px-4 py-2 text-sm">${g.courseCode||''}</td>
          <td class="px-4 py-2 text-sm">${g.courseTitle||''}</td>
          <td class="px-4 py-2 text-sm">${g.credits||''}</td>
          <td class="px-4 py-2 text-sm">${g.grade||''}</td>`;
        gtb.appendChild(tr);
      });
    }

    // ตารางอังกฤษ (แก้บั๊ก: แสดงแน่นอน)
    const etb = qs('#studentEnglishBody');
    const em  = myEng.filter(t=>!yf || String(t.academicYear)===String(yf))
                     .sort(by(t=>`${t.academicYear}`));
    setText('studentEnglishCount', em.length);
    if(etb){ etb.innerHTML='';
      em.forEach(t=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm">${t.academicYear||''}</td>
          <td class="px-4 py-2 text-sm">${t.attempt||''}</td>
          <td class="px-4 py-2 text-sm">${t.score||''}</td>
          <td class="px-4 py-2 text-sm">${t.status||''}</td>
          <td class="px-4 py-2 text-sm">${t.examDate||''}</td>`;
        etb.appendChild(tr);
      });
    }
  }
  renderByYear();
}

/* ===================== ADVISOR ===================== */
function initAdvisor(){
  buildAdvisorDashboard();
}

function buildAdvisorDashboard(){
  const me = CURRENT_USER || {};
  const advisees = (GLOBAL_DATA.students||[]).filter(s=>String(s.advisor||'').trim() === String(me.name||me.email||'').trim());

  // KPI
  setText('advTotalStudents', advisees.length);

  // GPAX เฉลี่ยในที่ปรึกษา
  let gpaxSum=0, cnt=0, passLatest=0, passAll=0;
  const latestByStu = {};
  advisees.forEach(s=>{
    const gs = gradesOf(GLOBAL_DATA.grades||[], s.id);
    const collapsed = collapseRetaken(gs);
    const { gpa } = computeGPA(collapsed);
    if (gpa!=null){ gpaxSum += gpa; cnt++; }

    const engs = (GLOBAL_DATA.englishTests||[]).filter(t=>String(t.studentId)===String(s.id));
    const le = latestEnglish(engs);
    if(le){
      const ok = /^ผ่าน$/i.test(String(le.status||'')) || /^pass$/i.test(String(le.status||''));
      if(ok) passLatest++;
    }
    // ผ่านทั้งหมด (นับคนที่มีประวัติใดผ่านสักครั้ง)
    if(engs.some(t=>/^ผ่าน$/i.test(String(t.status||'')) || /^pass$/i.test(String(t.status||'')))) passAll++;

    latestByStu[String(s.id)] = le || null;
  });
  setText('advAvgGPAX', cnt? (gpaxSum/cnt).toFixed(2) : '-');
  setText('advPassLatest', passLatest);
  setText('advPassAll', passAll);

  // ปีการศึกษา filter
  const aySel = qs('#advisorAcademicYear');
  if(aySel){
    const years = academicYearsFromGrades((GLOBAL_DATA.grades||[])
      .filter(g=>advisees.some(s=>String(s.id)===String(g.studentId))));
    aySel.innerHTML = `<option value="">ทั้งหมด</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  }

  // รายชื่อนักศึกษาแบบพับ/ขยาย
  const list = qs('#advisorStudentsList');
  const tpl  = qs('#advisorStudentRowTemplate');
  function renderList(){
    const yf = aySel?.value || '';
    if(list){ list.innerHTML='';
      advisees
        .slice()
        .sort(by(s=>String(s.id).padStart(20,'0')))
        .forEach(s=>{
          const node = tpl.content.cloneNode(true);
          node.querySelector('.stu-id').textContent = s.id||'';
          node.querySelector('.stu-name').textContent = s.name||'';
          node.querySelector('.stu-year').textContent = s.year||'';
          node.querySelector('.stu-advisor').textContent = s.advisor||'';

          const detail = node.querySelector('.detail');
          const btnTgl = node.querySelector('.toggle-detail');
          btnTgl.onclick = ()=>{
            detail.classList.toggle('hidden');
            btnTgl.innerHTML = detail.classList.contains('hidden') ? `<i class="fas fa-chevron-down mr-1"></i> ขยาย` : `<i class="fas fa-chevron-up mr-1"></i> ย่อ`;
          };

          // คำนวณ GPA ปีที่เลือก + GPAX
          const sgAll = gradesOf(GLOBAL_DATA.grades||[], s.id);
          const sgFilter = sgAll.filter(g=>!yf || academicYearOf(g.term)===yf);
          const { gpa } = computeGPA(collapseRetaken(sgFilter));
          const { gpa: gpax } = computeGPA(collapseRetaken(sgAll));
          node.querySelector('.val-gpa').textContent  = (g!=null ? g.toFixed(2) : (g===0?'0.00':'-')).replace('NaN','-');
          node.querySelector('.val-gpax').textContent = (gpax!=null ? gpax.toFixed(2) : '-');

          // อังกฤษล่าสุด + ประวัติ (พับ/ขยาย)
          const engs = (GLOBAL_DATA.englishTests||[]).filter(t=>String(t.studentId)===String(s.id))
                        .filter(t=>!yf || String(t.academicYear)===String(yf));
          const latest = latestEnglish(engs);
          node.querySelector('.val-eng-latest').textContent = latest ? `${latest.status||'-'} (${latest.score||'-'}) • ปี ${latest.academicYear||'-'} • ครั้ง ${latest.attempt||'-'}` : '-';
          const btnHist = node.querySelector('.toggle-eng-history');
          const histBox = node.querySelector('.eng-history');
          const histBody= node.querySelector('.eng-history-body');
          btnHist.onclick = ()=>{
            histBox.classList.toggle('hidden');
            if(!histBox.classList.contains('hidden')){
              histBody.innerHTML = '';
              engs.sort(by(t=>`${t.academicYear}/${t.attempt}`)).forEach(t=>{
                const tr = document.createElement('tr');
                tr.innerHTML = `
                  <td class="px-2 py-1">${t.academicYear||''}</td>
                  <td class="px-2 py-1">${t.attempt||''}</td>
                  <td class="px-2 py-1">${t.score||''}</td>
                  <td class="px-2 py-1">${t.status||''}</td>
                  <td class="px-2 py-1">${t.examDate||''}</td>`;
                histBody.appendChild(tr);
              });
            }
          };

          list.appendChild(node);
        });
    }

    // ตาราง “ล่าสุด” ด้านล่าง
    const latestBody = qs('#advisorEnglishLatestBody');
    if(latestBody){ latestBody.innerHTML='';
      advisees.forEach(s=>{
        const le = latestByStu[String(s.id)] || latestEnglish((GLOBAL_DATA.englishTests||[]).filter(t=>String(t.studentId)===String(s.id)));
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm">${s.id||''}</td>
          <td class="px-4 py-2 text-sm">${s.name||''}</td>
          <td class="px-4 py-2 text-sm">${s.year||''}</td>
          <td class="px-4 py-2 text-sm">${le? (le.status||'-'):'-'}</td>
          <td class="px-4 py-2 text-sm">${le? (le.score||'-'):'-'}</td>
          <td class="px-4 py-2 text-sm">${le? (le.academicYear||'-'):'-'}</td>
          <td class="px-4 py-2 text-sm">${le? (le.attempt||'-'):'-'}</td>
          <td class="px-4 py-2 text-sm">${le? (le.examDate||'-'):'-'}</td>`;
        latestBody.appendChild(tr);
      });
    }
  }
  aySel && (aySel.onchange = renderList);
  renderList();
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
  const [oldPassword, newPassword] = vals;
  if(!oldPassword || !newPassword){ Swal.fire({icon:'warning',title:'กรอกข้อมูลให้ครบ'}); return; }

  try{
    Swal.fire({title:'กำลังบันทึก...', didOpen:()=>Swal.showLoading(), allowOutsideClick:false});
    const userType = CURRENT_USER?.role || 'admin';
    const email = CURRENT_USER?.email || '';
    const res = await callAPI('changePassword', { userType, email, oldPassword, newPassword });
    if(!res?.success) throw new Error(res?.message||'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    Swal.close(); Swal.fire({icon:'success',title:'อัปเดตรหัสผ่านแล้ว'});
  }catch(err){
    Swal.close(); Swal.fire({icon:'error',title:'ผิดพลาด',text:String(err?.message||err)});
  }
}

/* ===================== MODAL helpers ===================== */
function openModal(id){ qs('#'+id)?.classList.remove('hidden'); }
function closeModal(id){ qs('#'+id)?.classList.add('hidden'); }

/* ===================== BOOTSTRAP (restore session) ===================== */
(async function(){
  const sess = loadSession();
  if(sess && sess.role){
    CURRENT_USER = sess;
    try{
      const boot = await callAPI('bootstrap', {});
      GLOBAL_DATA = boot?.data || GLOBAL_DATA;
      setText('currentUserName', `${CURRENT_USER?.name||CURRENT_USER?.email||''} (${CURRENT_USER.role})`);
      goToRole(CURRENT_USER.role);
      if (CURRENT_USER.role==='admin') initAdmin();
      else if (CURRENT_USER.role==='student') initStudent();
      else initAdvisor();
    }catch{
      goToLogin();
    }
  }else{
    goToLogin();
  }
})();

/* ===================== EXPORT GLOBAL ===================== */
window.login = login;
window.logout = logout;
window.saveEditStudent = saveEditStudent;
window.saveAddGrade = saveAddGrade;
window.saveAddEnglish = saveAddEnglish;
window.openChangePasswordModal = openChangePasswordModal;
