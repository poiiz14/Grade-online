/* ===================== CONFIG ===================== */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

// เตือนถ้า API_BASE ไม่ใช่ /exec
(function(){
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_BASE);
  if (!ok) {
    console.error('[CONFIG] API_BASE ไม่ถูกต้อง:', API_BASE);
    alert('API_BASE ยังไม่ใช่ URL /exec ของ Apps Script');
  }
})();

/* ===================== JSONP CALLER ===================== */
function callAPI(action, data = {}, { timeoutMs = 30000, retries = 1, backoffMs = 800 } = {}) {
  function once(timeout) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const payloadStr = JSON.stringify(data || {});
      const payload = encodeURIComponent(payloadStr);
      const s = document.createElement('script');
      const url = `${API_BASE}?action=${encodeURIComponent(action)}&payload=${payload}&callback=${cb}&_ts=${Date.now()}`;

      const cleanup = () => { try{ delete window[cb]; }catch{} try{ s.remove(); }catch{} };

      const timer = setTimeout(() => {
        console.error('[API][timeout]', { action, timeoutMs: timeout, url, data });
        cleanup(); reject(new Error(`API timeout: ${action}`));
      }, timeout);

      window[cb] = (resp) => {
        clearTimeout(timer); cleanup();
        console.debug('[API][ok]', { action, resp });
        resolve(resp);
      };

      s.onerror = (ev) => {
        clearTimeout(timer); cleanup();
        console.error('[API][network-error]', { action, url, ev });
        reject(new Error(`API network error: ${action}`));
      };

      s.src = url;
      document.body.appendChild(s);
      console.debug('[API][send]', { action, url, payload: payloadStr });
    });
  }

  return new Promise(async (resolve, reject) => {
    let attempt = 0, lastErr;
    while (attempt <= retries) {
      try { return resolve(await once(timeoutMs)); }
      catch (e) {
        lastErr = e; attempt++;
        if (attempt > retries) break;
        const wait = backoffMs * Math.pow(2, attempt - 1);
        console.warn('[API][retry]', { action, attempt, waitMs: wait, error: String(e) });
        await new Promise(r => setTimeout(r, wait));
      }
    }
    reject(lastErr || new Error(`API failed: ${action}`));
  });
}

/* ===================== UI Helpers ===================== */
function showBlockingLoader(title = 'กำลังโหลด...', text = 'โปรดรอสักครู่') {
  if (!window.Swal) return;
  Swal.fire({ title, html: text, allowOutsideClick:false, allowEscapeKey:false, showConfirmButton:false, didOpen:() => Swal.showLoading() });
}
function hideBlockingLoader() { if (window.Swal?.isVisible()) Swal.close(); }

const SESSION_KEY = 'grade_online_session';
const saveSession = s => { try{ localStorage.setItem(SESSION_KEY, JSON.stringify(s||{})); }catch{} };
const loadSession = () => { try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||'{}'); }catch{ return {}; } };
const clearSession = () => { try{ localStorage.removeItem(SESSION_KEY); }catch{} };

function goToDashboard(){ document.getElementById('loginScreen')?.classList.add('hidden'); document.getElementById('dashboard')?.classList.remove('hidden'); }
function goToLogin(){ document.getElementById('dashboard')?.classList.add('hidden'); document.getElementById('loginScreen')?.classList.remove('hidden'); }
function logout(){ clearSession(); goToLogin(); Swal?.fire({icon:'success',title:'ออกจากระบบแล้ว',timer:1200,showConfirmButton:false}); }

/* ===================== API Wrappers ===================== */
async function authenticate(role, credentials){
  console.debug('[AUTH] start', { role, credentials: { ...credentials, password: '***' }});
  const resp = await callAPI('authenticate', { userType: role, credentials }, { timeoutMs: 30000, retries: 1 });
  if (!resp?.success) throw new Error(resp?.message || 'authenticate failed');
  return resp.data;
}
async function bootstrapAll(){
  const resp = await callAPI('bootstrap', {}, { timeoutMs: 45000, retries: 1 });
  if (!resp?.success) throw new Error(resp?.message || 'bootstrap failed');
  return resp.data;
}

/* ===================== LOGIN HANDLER (robust) ===================== */
async function handleLoginSubmit(ev){
  ev?.preventDefault?.();
  console.log('[LOGIN] submit triggered');

  const roleSel = document.getElementById('userType');
  const hiddenRole = document.getElementById('roleInput')?.value;
  const role = (roleSel?.value || hiddenRole || 'student').toLowerCase();

  // sync hidden
  const hidden = document.getElementById('roleInput'); if (hidden) hidden.value = role;

  let credentials = {};
  if (role === 'student') {
    const citizenId = (document.getElementById('studentId')?.value || '').replace(/\s|-/g,'');
    if (!citizenId || citizenId.length < 5) { Swal?.fire({icon:'warning',title:'กรอกเลขบัตรประชาชนให้ถูกต้อง'}); return; }
    credentials = { citizenId };
  } else if (role === 'admin') {
    const email = (document.getElementById('adminEmail')?.value || '').trim();
    const password = document.getElementById('adminPassword')?.value || '';
    if (!email || !password) { Swal?.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่านให้ครบ'}); return; }
    credentials = { email, password };
  } else if (role === 'advisor') {
    const email = (document.getElementById('advisorEmail')?.value || '').trim();
    const password = document.getElementById('advisorPassword')?.value || '';
    if (!email || !password) { Swal?.fire({icon:'warning',title:'กรอกอีเมลและรหัสผ่านให้ครบ'}); return; }
    credentials = { email, password };
  } else {
    Swal?.fire({icon:'error',title:'ประเภทผู้ใช้ไม่ถูกต้อง'}); return;
  }

  try {
    showBlockingLoader('กำลังเข้าสู่ระบบ','กำลังตรวจสอบผู้ใช้...');
    const user = await authenticate(role, credentials);
    saveSession({ role: user.role, name: user.name, id: user.id, email: user.email || '' });

    const data = await bootstrapAll();
    hideBlockingLoader();

    // อัปเดต header + ปุ่มเปลี่ยนรหัสผ่าน
    if (typeof window.updateRoleUI === 'function') window.updateRoleUI(user.role, user.name);
    goToDashboard();

    console.log('[READY] user & data', { user, counts:{
      students: data.students?.length||0,
      grades: data.grades?.length||0,
      englishTests: data.englishTests?.length||0,
      advisors: data.advisors?.length||0
    }});

    if (user.role==='admin') showAdminDashboard(data);
    else if (user.role==='advisor') showTeacherDashboard(data);
    else showStudentDashboard(data, user);

  } catch (err) {
    hideBlockingLoader();
    console.error('[LOGIN][error]', err);
    Swal?.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text:String(err?.message||err) });
  }
}
// เผื่อกรณี HTML ยังมี onclick เก่า
window.handleLoginSubmit = handleLoginSubmit;

/* bind ให้ครบทั้ง submit และปุ่ม */
document.addEventListener('DOMContentLoaded', () => {
  console.log('[BOOT] DOM ready');
  const form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', handleLoginSubmit);
    console.log('[BOOT] attach submit listener to #loginForm');
  } else {
    console.warn('[BOOT] #loginForm not found');
  }

  const loginBtn = document.querySelector('button[type="submit"], #loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', (e)=>{ 
      // ป้องกัน browser submit ปกติซ้ำซ้อน
      e.preventDefault(); handleLoginSubmit(e);
    });
    console.log('[BOOT] attach click listener to login button');
  }

  // อ่าน role จาก query ?role=
  const params = new URLSearchParams(location.search);
  const qRole = (params.get('role')||'').toLowerCase();
  if (qRole) {
    const sel = document.getElementById('userType');
    if (sel) { sel.value = qRole; sel.dispatchEvent(new Event('change')); }
    const hidden = document.getElementById('roleInput'); if (hidden) hidden.value = qRole;
    console.log('[BOOT] role from query:', qRole);
  }

  // เรียก updateRoleUI ถ้ามี session
  const sess = loadSession();
  if (sess?.role && sess?.name && typeof window.updateRoleUI === 'function') {
    window.updateRoleUI(sess.role, sess.name);
  }
});

/* ===================== DASHBOARDS (ย่อ/พร้อมใช้) ===================== */
function showOnlyDashboard(id){
  ['adminDashboard','studentDashboard','advisorDashboard'].forEach(x=>document.getElementById(x)?.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}
function showAdminDashboard(data){
  showOnlyDashboard('adminDashboard');
  // ถ้า index.html ยังไม่ได้แปะส่วน Admin เต็ม ให้โชว์ข้อความไว้ก่อน
  if (!document.getElementById('adminOverview')) {
    document.getElementById('adminDashboard').innerHTML =
      '<div class="p-8 text-center text-gray-600">เข้าสู่ระบบสำเร็จ (Admin) — ยังไม่ได้ใส่เนื้อหาแดชบอร์ด</div>';
  }
}
function showTeacherDashboard(data){
  showOnlyDashboard('advisorDashboard');
  if (!document.getElementById('advisorStudentsList')) {
    document.getElementById('advisorDashboard').innerHTML =
      '<div class="p-8 text-center text-gray-600">เข้าสู่ระบบสำเร็จ (Advisor) — ยังไม่ได้ใส่เนื้อหาแดชบอร์ด</div>';
  }
}
function showStudentDashboard(data, user){
  showOnlyDashboard('studentDashboard');
  if (!document.getElementById('studentGPAX')) {
    document.getElementById('studentDashboard').innerHTML =
      '<div class="p-8 text-center text-gray-600">เข้าสู่ระบบสำเร็จ (Student) — ยังไม่ได้ใส่เนื้อหาแดชบอร์ด</div>';
  }
}

/* ===================== Change Password ===================== */
async function openChangePasswordDialog(){
  const sess = loadSession();
  if (!sess?.role || !['admin','advisor'].includes(sess.role)) {
    return Swal?.fire({icon:'warning',title:'สำหรับผู้ดูแล/อาจารย์ที่ปรึกษาเท่านั้น'});
  }

  const { value: v } = await Swal.fire({
    title: 'เปลี่ยนรหัสผ่าน',
    html: `
      <input id="cp_email" class="swal2-input" placeholder="email" style="width:100%" value="${sess.email||''}">
      <input id="cp_old" class="swal2-input" type="password" placeholder="รหัสผ่านเดิม" style="width:100%">
      <input id="cp_new" class="swal2-input" type="password" placeholder="รหัสผ่านใหม่" style="width:100%">
    `,
    focusConfirm: false,
    preConfirm: () => ({
      email: (document.getElementById('cp_email').value||'').trim(),
      oldPw: document.getElementById('cp_old').value||'',
      newPw: document.getElementById('cp_new').value||''
    }),
    confirmButtonText: 'บันทึก',
    showCancelButton: true,
    cancelButtonText: 'ยกเลิก'
  });
  if (!v) return;

  try {
    showBlockingLoader('กำลังบันทึก...');
    const resp = await callAPI('changepassword', {
      userType: sess.role, email: v.email, oldPassword: v.oldPw, newPassword: v.newPw
    }, { timeoutMs: 45000, retries: 1 });
    hideBlockingLoader();
    if (!resp?.success) throw new Error(resp?.message || 'change password failed');
    Swal?.fire({ icon:'success', title:'สำเร็จ', text:'เปลี่ยนรหัสผ่านเรียบร้อย' });
  } catch (err) {
    hideBlockingLoader();
    console.error('[CP][error]', err);
    Swal?.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text:String(err?.message||err) });
  }
}
