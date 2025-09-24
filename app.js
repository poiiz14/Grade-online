
// ===== Utilities (Hotfix) =====
if (typeof groupBy !== 'function') {
  function groupBy(arr, keyFn) {
    const map = {}

/** เลือกผลสอบเพื่อ "แสดงผล" ตามกติกา:
 * - ถ้าเคย "ผ่าน" ให้แสดงรายการ "ผ่าน" ที่ใหม่ที่สุด
 * - ถ้าไม่เคยผ่านเลย ให้แสดง "คะแนน" ของรายการล่าสุดแทน
 */
function englishBestDisplay(tests){
  const arr = (tests||[]).slice();
  if (!arr.length) return '-';
  const key = t => `${t.academicYear||''}-${String(t.attempt||0).padStart(3,'0')}-${t.examDate||''}`;
  const passes = arr.filter(t => String(t.status||'').trim() === 'ผ่าน');
  if (passes.length){
    const latestPass = passes.sort((a,b)=> key(a).localeCompare(key(b)) ).pop();
    return `${latestPass.status || 'ผ่าน'} (${latestPass.score || '-'})`;
  }
  const latest = arr.sort((a,b)=> key(a).localeCompare(key(b)) ).pop();
  return latest ? `${latest.status || ''} (${latest.score || '-'})` : '-';
}

;
    (arr || []).forEach(x => {
      const k = keyFn(x);
      (map[k] || (map[k] = [])).push(x);
    });
    return map;
  }
}
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
  let raw = String(term || '').trim();
  if(!raw) return { year:'', sem:'' };
  // map ฤดูร้อน/summer → 3 (เฉพาะเพื่อประมวลผล)
  raw = raw.replace(/ฤดู\s*-?\s*ร้อน|ภาค\s*ฤดู\s*-?\s*ร้อน|summer/gi, '3');
  // ปี/ภาค เช่น 2567/1
  const m1 = raw.match(/^(\d{4})\s*[/\-]\s*(\d{1,2})$/);
  if(m1) return { year: m1[1], sem: String(parseInt(m1[2],10)) };
  // ภาค/ปี เช่น 1/2567
  const m2 = raw.match(/^(\d{1,2})\s*[/\-]\s*(\d{4})$/);
  if(m2) return { year: m2[2], sem: String(parseInt(m2[1],10)) };
  // ✅ ใหม่: ปีล้วน เช่น "2567"
  const m3 = raw.match(/^(\d{4})$/);
  if (m3) return { year: m3[1], sem: '' };
  // เลขภาคเดี่ยว
  if(['1','2','3'].includes(raw)) return { year:'', sem:raw };
  return { year:'', sem:'' };
}

/** แปลงค่า term เพื่อ "แสดงผล" เท่านั้น (ไม่กระทบโครงสร้างข้อมูล)
 * - ถ้า sem === '3' ให้แสดง "ฤดูร้อน" แทนเลข 3
 * - ถ้ากรอกเป็นคำอยู่แล้ว (มีอักษรที่ไม่ใช่ตัวเลขหรือ / -) ให้คงเดิม
 */
function formatTermForDisplay(term){
  const raw0 = String(term||'').trim();
  if(!raw0) return '-';
  // ถ้าผู้ใช้กรอกเป็นคำอยู่แล้ว เช่น "ฤดูร้อน" → คืนตามเดิม
  if(/[^\d/\-]/.test(raw0)) return raw0;

  const t = parseTerm(raw0);
  if (!t.year && !t.sem) return raw0;

  if (t.sem === '3') {
    return t.year ? `${t.year}/ฤดูร้อน` : 'ฤดูร้อน';
  }
  return t.year ? `${t.year}/${t.sem||''}`.replace(/\/$/, '') : (t.sem || raw0);
}
function termSortKey(term){
  const {year, sem} = parseTerm(term);
  const s = (sem || '0');              // ถ้า sem ว่าง ให้เป็น '0'
  return `${year.padStart(4,'0')}-${s.padStart(1,'0')}`;
}
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
function apiUpdateGrade(payload){
  return callAPI({ action: 'updateGrade', payload: JSON.stringify(payload) });
}
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

      // ตั้งค่า user จากผล authenticate
      appState.user = res.data || {};
      
      // ✅ Fallback: ถ้า backend ไม่ส่ง role มา ให้ใช้ role จาก userType ที่ผู้ใช้เลือกใน login form
      if (!appState.user.role) {
        appState.user.role = role;
      }
      // ให้ role เป็น lower-case เสมอเพื่อให้ router ทำงานคงที่
      appState.user.role = String(appState.user.role || '').toLowerCase();
      
      // อัปเดต label ผู้ใช้ (ใช้ role ที่ normalize แล้ว)
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

      // แสดง Dashboard หลัก
      byId('loginScreen').classList.add('hidden');
      byId('dashboard').classList.remove('hidden');
      
      // โหลดหน้า Dashboard ตามบทบาท ผ่าน Router กลาง (forceReload = true เพื่อดึงข้อมูลใหม่)
      await loadRoleDashboard(appState.user.role, { forceReload: true });
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
// เปิดโมดัลช่วยเหลือหน้า Login
window.openLoginHelp = function(){
  openModal('modalLoginHelp');
};

// เปิดโมดัลเปลี่ยนรหัสผ่าน (รีเซ็ตฟอร์มก่อน)
window.openChangePassword = function(){
  const o = byId('cp-old'), n = byId('cp-new'), c = byId('cp-confirm');
  if (o) o.value = ''; if (n) n.value = ''; if (c) c.value = '';
  openModal('modalChangePassword');
};

// ส่งฟอร์มเปลี่ยนรหัสผ่าน
window.handleChangePasswordSubmit = async function(e){
  e.preventDefault();
  const oldPw = (byId('cp-old')?.value || '').trim();
  const newPw = (byId('cp-new')?.value || '').trim();
  const cfPw  = (byId('cp-confirm')?.value || '').trim();

  if (!oldPw || !newPw || !cfPw) return false;
  if (newPw.length < 6){ Swal.fire('แจ้งเตือน','รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร','info'); return false; }
  if (newPw !== cfPw){ Swal.fire('แจ้งเตือน','รหัสผ่านใหม่และยืนยันไม่ตรงกัน','info'); return false; }

  const username = (appState?.user?.email || appState?.user?.id || '').trim();
  if (!username){ Swal.fire('ผิดพลาด','ไม่พบข้อมูลผู้ใช้ในระบบ','error'); return false; }

  try{
    // เรียก GAS route: changepassword (มีใน Router ของปอยแล้ว)
    const res = await callAPI({
      action: 'changePassword',
      payload: JSON.stringify({ username, old: oldPw, 'new': newPw })
    });
    if (!res?.success){
      Swal.fire('ไม่สำเร็จ', res?.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ', 'error');
      return false;
    }
    Swal.fire('สำเร็จ','เปลี่ยนรหัสผ่านเรียบร้อย','success');
    closeModal('modalChangePassword');
    return false;
  }catch(err){
    console.error(err);
    Swal.fire('ผิดพลาด', String(err), 'error');
    return false;
  }
};
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
function showAdminSection(name){
  const key = ({'admin-individual':'individual'})[name] || name; // map alias
  qsa('.admin-section').forEach(el => el.classList.add('hidden'));
  qsa('.tab-btn').forEach(el => el.classList.remove('is-active'));

  if(key === 'overview')  byId('adminOverview').classList.remove('hidden');
  if(key === 'students')  byId('adminStudents').classList.remove('hidden');
  if(key === 'individual')byId('adminIndividual').classList.remove('hidden');
  if(key === 'loginlogs'){ 
    byId('adminLoginLogs').classList.remove('hidden');
    loadAdminLoginLogs?.();
  }
  // ไฮไลต์ปุ่มแท็บให้ตรงกับ key
  const idx = {overview:0, students:1, individual:2, loginlogs:3}[key];
  if (typeof idx === 'number') qsa('.tab-btn')[idx]?.classList.add('is-active');
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
    const latestStr = englishBestDisplay(myEn);

    const detailId = `adv-detail-${s.id}`;
    const btnId = `adv-toggle-${s.id}`;

    return `
      <div class="py-3">
        <div class="flex items-center justify-between">
          <div class="font-medium">
            ${s.id} - ${s.name}
            <span class="text-sm text-gray-500">ชั้นปี ${s.year} · ที่ปรึกษา: ${s.advisor||'-'}</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-sm">
              <span class="text-gray-500">อังกฤษล่าสุด:</span>
              <span class="font-semibold">${latestStr}</span>
            </div>
            <button id="${btnId}" class="px-3 py-1 rounded border hover:bg-gray-50"
              onclick="toggleAdvisorDetail('${detailId}','${btnId}')">ขยาย</button>
          </div>
        </div>

        <div id="${detailId}" class="hidden mt-3 bg-gray-50 rounded-lg p-4">
          <!-- ✅ กล่องสรุป 4 ใบ -->
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
            <div class="bg-purple-50 p-3 rounded cursor-pointer hover:bg-purple-100 transition"
                 onclick="openAdvisorEnglishModal('${s.id}')" role="button" tabindex="0">
              <div class="text-xs text-gray-600">อังกฤษล่าสุด</div>
              <div class="text-lg font-semibold text-purple-800 underline decoration-dotted">${latestStr}</div>
              <div class="text-xs text-purple-700 mt-1">คลิกเพื่อดูรายละเอียด</div>
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
                ${
                  stuGrades
                    .sort((a,b)=> termSortKey(a.term).localeCompare(termSortKey(b.term)))
                    .map(g=>`
                      <tr>
                        <td class="px-3 py-2">${formatTermForDisplay(g.term)}</td>
                        <td class="px-3 py-2">${g.courseCode||'-'}</td>
                        <td class="px-3 py-2">${g.courseTitle||'-'}</td>
                        <td class="px-3 py-2">${g.credits||'-'}</td>
                        <td class="px-3 py-2">${g.grade||'-'}</td>
                      </tr>
                    `).join('')
                }
              </tbody>
            </table>
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

      window.openAdvisorEnglishModal = function(studentId){
        const sid = cleanId(studentId);
        const stu = appState.students.find(s => cleanId(s.id) === sid);
        const header = byId('advEngDetailHeader');
        if (header) header.textContent = stu ? `${stu.id || '-'} - ${stu.name || '-'}` : sid;
      
        // ดึงและเรียงรายการสอบของนักศึกษาคนนี้ (เก่า -> ใหม่)
        const rows = appState.englishTests
          .filter(t => cleanId(t.studentId) === sid)
          .sort((a,b)=>{
            const ka = `${a.academicYear || ''}-${String(a.attempt||0).padStart(3,'0')}-${a.examDate || ''}`;
            const kb = `${b.academicYear || ''}-${String(b.attempt||0).padStart(3,'0')}-${b.examDate || ''}`;
            return ka.localeCompare(kb);
          });
      
        const tb = byId('advEnglishDetailTable');
        if (!tb) return openModal('modalAdvisorEnglish');
      
        if(!rows.length){
          tb.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>`;
          return openModal('modalAdvisorEnglish');
        }
      
        const latest = rows[rows.length - 1]; // แถวล่าสุด
        tb.innerHTML = rows.map(t=>{
          const isLatest = t === latest;
          const badge = isLatest ? `<span class="ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">ล่าสุด</span>` : '';
          const status = String(t.status||'').trim();
          const statusCls = status === 'ผ่าน' ? 'text-emerald-700 bg-emerald-50'
                          : status === 'ไม่ผ่าน' ? 'text-rose-700 bg-rose-50'
                          : 'text-slate-700 bg-slate-50';
          return `
            <tr class="${isLatest ? 'bg-indigo-50/40' : ''}">
              <td class="px-3 py-2">${t.academicYear || '-'}</td>
              <td class="px-3 py-2">${t.attempt || '-'}</td>
              <td class="px-3 py-2">${t.score || '-'}</td>
              <td class="px-3 py-2">
                <span class="inline-block px-2 py-0.5 rounded ${statusCls}">${status || '-'}</span>
                ${badge}
              </td>
              <td class="px-3 py-2">${t.examDate ? String(t.examDate).substring(0,10) : '-'}</td>
              <td class="px-3 py-2">${t.note || ''}</td>
            </tr>
          `;
        }).join('');
      
        openModal('modalAdvisorEnglish');
      };


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
/* =========================
 * ADVISOR DASHBOARD (ใหม่)
 * ========================= */

// เก็บ state นักศึกษาที่ถูกเลือกในหน้า advisor
window._advisorSelectedStudentId = '';

function initAdvisorYearFilter() {
  const yearSel = byId('advisorYear');
  if (!yearSel) return;

  const years = unique(appState.grades.map(g => parseTerm(g.term).year).filter(Boolean)).sort();
  yearSel.innerHTML =
    '<option value="">ทุกปีการศึกษา</option>' +
    years.map(y => `<option value="${y}">${y}</option>`).join('');
}

function renderAdvisorList() {
  const tbody = byId('advisorStudentsList');
  const searchEl = byId('advisorSearch');
  const yearSel  = byId('advisorYear');
  const q = (searchEl?.value || '').trim();
  const y = (yearSel?.value || '').trim();

  // ระบุตัวที่ปรึกษา (ชื่อ หรืออีเมล) ให้รองรับ 2 เคส
  const meName  = (appState?.user?.name  || '').trim();
  const meEmail = (appState?.user?.email || '').trim().toLowerCase();

  let rows = appState.students.filter(s => {
    const adv = String(s.advisor || '').trim();
    return adv === meName || adv.toLowerCase() === meEmail;
  });

  // ค้นหา
  if (q) {
    rows = rows.filter(s =>
      String(s.id || '').includes(q) ||
      String(s.name || '').includes(q)
    );
  }

  // กรองปีการศึกษา: เอาเฉพาะนักศึกษาที่มีผลการเรียนในปีนั้น
  if (y) {
    const idsInYear = new Set(
      appState.grades
        .filter(g => parseTerm(g.term).year === y)
        .map(g => String(g.studentId).trim())
    );
    rows = rows.filter(s => idsInYear.has(String(s.id).trim()));
  }

  // เรียงรหัส
  rows.sort((a,b) => String(a.id).localeCompare(String(b.id)));

  tbody.innerHTML = rows.length
    ? rows.map(s => `
        <tr class="cursor-pointer hover:bg-gray-50"
            onclick="openAdvisorStudent('${s.id}')">
          <td class="px-4 py-2">${s.id || '-'}</td>
          <td class="px-4 py-2">${s.name || '-'}</td>
          <td class="px-4 py-2">${s.year || '-'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="3" class="px-4 py-8 text-center text-gray-400">ไม่พบนักศึกษา</td></tr>';
}

window.openAdvisorStudent = function(studentId){
  window._advisorSelectedStudentId = String(studentId || '').trim();
  renderAdvisorStudentDetail(window._advisorSelectedStudentId);
};

function renderAdvisorStudentDetail(studentId) {
  const id = String(studentId || '').trim();
  const yearSel = byId('advisorYear');
  const y = (yearSel?.value || '').trim();

  // โปรไฟล์
  const s = appState.students.find(x => String(x.id).trim() === id);
  byId('advisorStudentId').textContent       = s ? (s.id || '-')      : '-';
  byId('advisorStudentName').textContent     = s ? (s.name || '-')    : '-';
  byId('advisorStudentYear').textContent     = s ? (s.year || '-')    : '-';
  byId('advisorStudentAdvisor').textContent  = s ? (s.advisor || '-') : '-';

  // เกรดทั้งหมดของนักศึกษาคนนี้
  const all = appState.grades
    .filter(g => String(g.studentId).trim() === id)
    .sort((a,b) => termSortKey(a.term).localeCompare(termSortKey(b.term)));

  // กรองตามปี
  const filtered = y ? all.filter(g => parseTerm(g.term).year === y) : all;

  // KPI
  const yearly = computeGPA(filtered);
  const overall = computeGPA(all);
  byId('advisorYearGPA').textContent     = filtered.length ? yearly.gpa.toFixed(2) : '-';
  byId('advisorYearCredits').textContent = filtered.length ? yearly.credits : '-';
  byId('advisorGPAX').textContent        = all.length ? overall.gpa.toFixed(2) : '-';

  // ตารางเกรด
  const tbody = byId('advisorGradesTable');
  tbody.innerHTML = filtered.length
    ? filtered.map(g => `
        <tr>
          <td class="px-4 py-2">${g.term || '-'}</td>
          <td class="px-4 py-2">${g.courseCode || '-'}</td>
          <td class="px-4 py-2">${g.courseTitle || '-'}</td>
          <td class="px-4 py-2">${g.credits || '-'}</td>
          <td class="px-4 py-2">${g.grade || '-'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">ยังไม่มีข้อมูลในปีที่เลือก</td></tr>';
}

async function buildAdvisorDashboard(){
  // แสดงชื่อผู้ใช้มุมขวาในหน้า advisor
  const lbl = byId('advisorCurrentUser');
  if (lbl) lbl.textContent = `${appState.user?.name || ''} (${appState.user?.role || 'advisor'})`;

  // เตรียม filter + รายการ
  initAdvisorYearFilter();
  renderAdvisorList();

  // ผูก event
  const yearSel = byId('advisorYear');
  const searchEl = byId('advisorSearch');
  if (yearSel)  yearSel.onchange  = () => { renderAdvisorList(); if (window._advisorSelectedStudentId) renderAdvisorStudentDetail(window._advisorSelectedStudentId); };
  if (searchEl) searchEl.oninput  = () => { renderAdvisorList(); };

  // เคลียร์ panel รายละเอียดก่อนเลือก
  byId('advisorGradesTable').innerHTML =
    '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">โปรดเลือกรายชื่อนักศึกษาทางซ้าย</td></tr>';
}

/***********************
 * MODALS & STARTUP
 ***********************/
function openModal(id){
  const el = byId(id);
  if(!el) return console.warn('modal not found:', id);
  el.classList.remove('hidden');
}
function closeModal(id){
  const el = byId(id);
  if(!el) return;
  el.classList.add('hidden');
}
function openChangePassword(){
  openModal('modalChangePassword');
}

window.closeModal = closeModal;
window.addEventListener('DOMContentLoaded', ()=>{ initLogin(); });

async function handleChangePasswordSubmit(e){
  e.preventDefault();
  const oldPw = byId('cp-old').value.trim();
  const newPw = byId('cp-new').value.trim();
  const cfmPw = byId('cp-confirm').value.trim();

  if(newPw.length < 6) return Swal.fire('เตือน', 'รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร', 'warning');
  if(newPw !== cfmPw) return Swal.fire('เตือน', 'ยืนยันรหัสผ่านไม่ตรงกัน', 'warning');

  try{
    showLoading(true);
    // TODO: เรียก API hash+salt ที่ปอยจะปรับใน changePassword_()
    const res = await callAPI({ action:'changePassword', payload: JSON.stringify({
      userId: appState.user?.id, oldPassword: oldPw, newPassword: newPw
    })});
    if(!res.success) return Swal.fire('ไม่สำเร็จ', res.message || 'เปลี่ยนรหัสผ่านล้มเหลว','error');
    Swal.fire('สำเร็จ','เปลี่ยนรหัสผ่านเรียบร้อย','success');
    closeModal('modalChangePassword');
    e.target.reset();
  }catch(err){
    console.error(err);
    Swal.fire('ผิดพลาด', String(err),'error');
  }finally{
    showLoading(false);
  }
}
function getVisibleRoleFromUI(){
  const is = (id) => !byId(id)?.classList.contains('hidden');
  if (is('adminDashboard'))   return 'admin';
  if (is('studentDashboard')) return 'student';
  if (is('advisorDashboard')) return 'advisor';
  return '';
}
// Soft Refresh: โหลดข้อมูลใหม่โดยไม่รีโหลดหน้า/ไม่เด้งออกจาก Dashboard
// app.js
window.softRefresh = async function(silent = false){
  try {
    const btn = document.getElementById('btnSoftRefresh');
    const t = document.getElementById('lastRefreshed');
    if (btn && !silent) { btn.disabled = true; btn.classList.add('opacity-60','cursor-wait'); }

    let role = (window.appState?.user?.role || '').toLowerCase();
    if (!role) { role = getVisibleRoleFromUI(); if (!role) return; }

    // ⬇️ ดึงข้อมูลสดจาก backend (GAS)
    const boot = await apiBootstrap();
    if(!boot.success) throw new Error(boot.message || 'bootstrap failed');
    appState.students     = boot.data.students     || [];
    appState.grades       = boot.data.grades       || [];
    appState.englishTests = boot.data.englishTests || [];
    appState.advisors     = boot.data.advisors     || [];

    await loadRoleDashboard(role, { forceReload: true });

    const stamp = new Date().toLocaleString('th-TH',{hour12:false});
    if (t) t.textContent = `อัปเดตล่าสุด: ${stamp}`;
  } catch (err) {
    console.error(err);
    if (!silent) Swal?.fire?.('รีเฟรชไม่สำเร็จ', String(err), 'error');
  } finally {
    const btn = document.getElementById('btnSoftRefresh');
    if (btn) { btn.disabled = false; btn.classList.remove('opacity-60','cursor-wait'); }
  }
};


// (ทางเลือก) ช็อตคัต Ctrl+Shift+R เรียก Soft Refresh
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
    e.preventDefault();
    softRefresh();
  }
});
  // Router กลาง: โหลด Dashboard ตามบทบาท
window.loadRoleDashboard = async function(role, opts = {}){
  role = String(role || '').toLowerCase();
  // ⬇️ ดึงข้อมูลสดถ้าขอ forceReload
  if (opts.forceReload) {
    try{
      const boot = await apiBootstrap();
      if (boot?.success) {
        appState.students     = boot.data?.students     || [];
        appState.grades       = boot.data?.grades       || [];
        appState.englishTests = boot.data?.englishTests || [];
        appState.advisors     = boot.data?.advisors     || [];
      } else {
        console.warn('bootstrap failed:', boot?.message);
      }
    }catch(err){
      console.error('bootstrap error:', err);
    }
  }
  // ซ่อนทุก Dashboard ก่อน
  byId('adminDashboard')?.classList.add('hidden');
  byId('studentDashboard')?.classList.add('hidden');
  byId('advisorDashboard')?.classList.add('hidden');

  if (role === 'admin') {
    byId('adminDashboard')?.classList.remove('hidden');
    await buildAdminOverview?.();
    await buildAdminStudents?.();
    await buildAdminIndividual?.();
    showAdminSection?.('overview');
  } else if (role === 'student') {
    byId('studentDashboard')?.classList.remove('hidden');
    await buildStudentView?.();
  } else if (role === 'advisor') {
    byId('advisorDashboard')?.classList.remove('hidden');
    await buildAdvisorView?.();
  } else {
    console.warn('loadRoleDashboard: unknown role -> keep current view');
    return;
  }
};

// เปิด modal แก้ไข พร้อมเติมค่าจากแถวที่เลือก
window.openEditGrade = function(studentId, term, courseCode){
  const rec = appState.grades.find(g =>
    cleanId(g.studentId)===cleanId(studentId) &&
    String(g.term)===String(term) &&
    String(g.courseCode)===String(courseCode)
  );
  if(!rec) return Swal.fire('ผิดพลาด','ไม่พบรายการที่จะแก้ไข','error');

  byId('eg-studentId').value = rec.studentId;
  byId('eg-term-old').value  = rec.term;        // เก็บไว้ใช้อ้างอิง row เดิม
  byId('eg-code').value      = rec.courseCode;  // ล็อค primary key (ถ้าต้องการให้แก้ code ได้ ให้ปลด readonly ใน HTML)
  byId('eg-term').value      = rec.term;
  byId('eg-title').value     = rec.courseTitle || '';
  byId('eg-credits').value   = rec.credits || '';
  byId('eg-grade').value     = rec.grade || '';

  openModal('modalEditGrade');
};

// บันทึกการแก้ไข (เรียก GAS → อัปเดต state → วาดใหม่)
window.saveEditGrade = async function(e){
  e?.preventDefault?.();
  const payload = {
    studentId: byId('eg-studentId').value,
    termOld:   byId('eg-term-old').value,
    courseCode:byId('eg-code').value,
    // ค่าที่จะแก้
    term:      byId('eg-term').value,
    courseTitle: byId('eg-title').value,
    credits:     toNumber(byId('eg-credits').value),
    grade:       byId('eg-grade').value
  };

  try{
    showLoading(true);
    const res = await apiUpdateGrade(payload);
    if(!res?.success) return Swal.fire('ไม่สำเร็จ', res?.message || 'อัปเดตผลการเรียนไม่สำเร็จ', 'error');

    // sync state ฝั่ง client
    const idx = appState.grades.findIndex(g =>
      cleanId(g.studentId)===cleanId(payload.studentId) &&
      String(g.term)===String(payload.termOld) &&
      String(g.courseCode)===String(payload.courseCode)
    );
    if(idx>-1){
      appState.grades[idx] = {
        ...appState.grades[idx],
        term: payload.term,
        courseTitle: payload.courseTitle,
        credits: payload.credits,
        grade: payload.grade,
        recordedAt: new Date().toISOString()
      };
    }

    closeModal('modalEditGrade');
    Swal.fire('สำเร็จ','อัปเดตผลการเรียนเรียบร้อย','success');
    // รีเฟรชมุมมองที่เกี่ยวข้อง
    renderAdminIndividual();
    openManageGradesModal(); // เปิดใหม่เพื่อให้ตารางรีเรนเดอร์
  }catch(err){
    console.error(err);
    Swal.fire('ผิดพลาด', String(err), 'error');
  }finally{
    showLoading(false);
  }
};
