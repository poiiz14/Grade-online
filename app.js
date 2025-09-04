/* ===================== CONFIG & JSONP ===================== */
/** ใส่ URL ของ Apps Script Web App ( /exec ) */
const API_BASE = 'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

/*
  JSONP with timeout + retries + verbose logging
  - ใช้พารามิเตอร์ 'payload='
  - กัน cache ด้วย &_ts=
  - log: [API][send] / [API][ok] / [API][network-error] / [API][timeout] / [API][retry]
*/
function callAPI(action, data = {}, { timeoutMs = 30000, retries = 2, backoffMs = 800 } = {}) {
  function once(timeout) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const payloadStr = JSON.stringify(data || {});
      const payload = encodeURIComponent(payloadStr);
      const s = document.createElement('script');
      const url = `${API_BASE}?action=${encodeURIComponent(action)}&payload=${payload}&callback=${cb}&_ts=${Date.now()}`;

      const cleanup = () => {
        try { delete window[cb]; } catch {}
        try { s.remove(); } catch {}
      };

      const timer = setTimeout(() => {
        console.error('[API][timeout]', { action, timeoutMs: timeout, url, data });
        cleanup();
        reject(new Error(`API timeout: ${action}`));
      }, timeout);

      window[cb] = (resp) => {
        clearTimeout(timer);
        cleanup();
        console.debug('[API][ok]', { action, url, resp });
        resolve(resp);
      };

      s.onerror = (ev) => {
        clearTimeout(timer);
        cleanup();
        console.error('[API][network-error]', { action, url, ev });
        reject(new Error(`API network error: ${action}`));
      };

      // fire
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
        lastErr = e;
        attempt++;
        if (attempt > retries) break;
        const wait = backoffMs * Math.pow(2, attempt - 1);
        console.warn('[API][retry]', { action, attempt, waitMs: wait, error: String(e) });
        await new Promise(r => setTimeout(r, wait));
      }
    }
    reject(lastErr || new Error(`API failed: ${action}`));
  });
}

/* ============== Loader (blocking) ============== */
function showBlockingLoader(title = 'กำลังโหลดข้อมูล...', text = 'โปรดรอสักครู่') {
  if (typeof Swal === 'undefined') return;
  Swal.fire({
    title, html: text,
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    didOpen: () => Swal.showLoading()
  });
}
function hideBlockingLoader() {
  if (typeof Swal !== 'undefined' && Swal.isVisible()) Swal.close();
}

/* ===================== Session Utils ===================== */
const SESSION_KEY = 'grade_online_session';
function saveSession(s){ try{ localStorage.setItem(SESSION_KEY, JSON.stringify(s||{})); }catch{} }
function loadSession(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||'{}'); }catch{return {}} }
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch{} }

/* ===================== Auth Flow ===================== */
async function authenticate(role, credentials){
  console.debug('[AUTH] start', { role, credentials: { ...credentials, password: '***' }});
  const resp = await callAPI('authenticate', { userType: role, credentials }, { timeoutMs: 30000, retries: 1 });
  console.debug('[AUTH] resp', resp);
  if (!resp?.success) throw new Error(resp?.message || 'authenticate failed');
  return resp.data;
}

/* ===================== Bootstrap (load dashboard data) ===================== */
async function bootstrapAll(){
  console.debug('[BOOTSTRAP] start');
  const resp = await callAPI('bootstrap', {}, { timeoutMs: 45000, retries: 1 });
  console.debug('[BOOTSTRAP] resp', resp);
  if (!resp?.success) throw new Error(resp?.message || 'bootstrap failed');
  return resp.data; // {students, grades, englishTests, advisors}
}

/* ===================== UI helpers ===================== */
function goToDashboard() {
  const login = document.getElementById('loginScreen');
  const dash  = document.getElementById('dashboard');
  login?.classList.add('hidden');
  dash?.classList.remove('hidden');
}
function goToLogin() {
  const login = document.getElementById('loginScreen');
  const dash  = document.getElementById('dashboard');
  dash?.classList.add('hidden');
  login?.classList.remove('hidden');
}

/* ===================== Logout (ใช้จากปุ่ม header) ===================== */
function logout(){
  clearSession();
  goToLogin();
  Swal.fire({ icon:'success', title:'ออกจากระบบแล้ว', timer:1200, showConfirmButton:false });
}

/* ===================== Login UI Handlers ===================== */
async function handleLoginSubmit(ev){
  ev?.preventDefault?.();

  // อ่านบทบาทจาก hidden input ที่ index.html เซตไว้
  const role = document.getElementById('roleInput')?.value || 'student';

  // อ่านช่องกรอกตามบทบาท (อิง id จาก index.html ใหม่)
  let credentials = {};
  if (role === 'student') {
    const citizenId = (document.getElementById('studentId')?.value || '').replace(/\s|-/g,'');
    credentials = { citizenId };
  } else if (role === 'admin') {
    const email = (document.getElementById('adminEmail')?.value || '').trim();
    const password = document.getElementById('adminPassword')?.value || '';
    credentials = { email, password };
  } else if (role === 'advisor') {
    const email = (document.getElementById('advisorEmail')?.value || '').trim();
    const password = document.getElementById('advisorPassword')?.value || '';
    credentials = { email, password };
  }

  try {
    showBlockingLoader('กำลังเข้าสู่ระบบ', 'โปรดรอซักครู่...');
    const user = await authenticate(role, credentials);
    saveSession({ role: user.role, name: user.name, id: user.id, email: user.email || '' });

    const data = await bootstrapAll();
    hideBlockingLoader();

    // 👉 อัปเดต Header + ปุ่มเปลี่ยนรหัสผ่าน ตาม role (index.html เตรียม window.updateRoleUI ไว้แล้ว)
    if (typeof window.updateRoleUI === 'function') {
      window.updateRoleUI(user.role, user.name);
    }

    // สลับจอไป Dashboard
    goToDashboard();

    // Debug count
    console.log('[READY] user & data', { user, counts:{
      students: data.students?.length||0,
      grades: data.grades?.length||0,
      englishTests: data.englishTests?.length||0,
      advisors: data.advisors?.length||0
    }});

    // เรียกแดชบอร์ดตามบทบาท (ฟังก์ชันเดิมของปอย)
    if (role==='admin'   && typeof showAdminDashboard==='function')   showAdminDashboard(data);
    else if (role==='advisor' && typeof showTeacherDashboard==='function') showTeacherDashboard(data);
    else if (role==='student' && typeof showStudentDashboard==='function') showStudentDashboard(data);

  } catch (err) {
    hideBlockingLoader();
    console.error('[LOGIN][error]', err);
    Swal.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text: String(err && err.message || err || 'Login error') });
  }
}

/* ===================== Change Password (Admin/Advisor) ===================== */
async function openChangePasswordDialog(){
  const sess = loadSession();
  if (!sess?.role || !['admin','advisor'].includes(sess.role)) {
    return Swal.fire({icon:'warning',title:'สำหรับผู้ดูแล/อาจารย์ที่ปรึกษาเท่านั้น'});
  }

  const { value: formValues } = await Swal.fire({
    title: 'เปลี่ยนรหัสผ่าน',
    html: `
      <div class="space-y-3 text-left">
        <div><label class="block text-sm mb-1">อีเมล</label>
          <input id="cp_email" class="swal2-input" placeholder="email" style="width:100%" value="${sess.email||''}">
        </div>
        <div><label class="block text-sm mb-1">รหัสผ่านเดิม</label>
          <input id="cp_old" class="swal2-input" type="password" style="width:100%">
        </div>
        <div><label class="block text-sm mb-1">รหัสผ่านใหม่</label>
          <input id="cp_new" class="swal2-input" type="password" style="width:100%">
        </div>
      </div>
    `,
    focusConfirm: false,
    preConfirm: () => {
      return {
        email: (document.getElementById('cp_email').value || '').trim(),
        oldPw: document.getElementById('cp_old').value || '',
        newPw: document.getElementById('cp_new').value || ''
      };
    },
    confirmButtonText: 'บันทึก',
    showCancelButton: true,
    cancelButtonText: 'ยกเลิก'
  });

  if (!formValues) return;

  try {
    showBlockingLoader('กำลังบันทึก...', 'โปรดรอสักครู่');
    const resp = await callAPI('changepassword', {
      userType: sess.role, email: formValues.email,
      oldPassword: formValues.oldPw, newPassword: formValues.newPw
    }, { timeoutMs: 45000, retries: 1 });

    hideBlockingLoader();
    if (!resp?.success) throw new Error(resp?.message || 'change password failed');
    Swal.fire({ icon:'success', title:'สำเร็จ', text:'เปลี่ยนรหัสผ่านเรียบร้อย' });
  } catch (err) {
    hideBlockingLoader();
    console.error('[CP][error]', err);
    Swal.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text:String(err && err.message || err) });
  }
}

/* ===================== Boot handlers ===================== */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  if (form) form.addEventListener('submit', handleLoginSubmit);

  // auto-fill จาก session (ถ้าต้องการ auto-login เพิ่ม logic ตรงนี้)
  const sess = loadSession();
  if (sess?.role && sess?.name) {
    // ถ้าจะ auto-login จริง ๆ ให้เรียก bootstrap แล้วไป dashboard
    // แต่ตอนนี้แค่ตั้งชื่อหัวมุมไว้ก่อน
    if (typeof window.updateRoleUI === 'function') {
      window.updateRoleUI(sess.role, sess.name);
    }
  }
});



