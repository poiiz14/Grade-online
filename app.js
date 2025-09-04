/* ===================== CONFIG & JSONP ===================== */
const API_BASE = 'https://script.google.com/macros/s/PUT-YOUR-EXEC-URL-HERE/exec';

/* 
  JSONP with timeout + retries + verbose logging
  - ใช้พารามิเตอร์ 'payload=' (ฝั่ง server รองรับทั้ง payload และ data อยู่แล้ว)
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

/* ===========================================================
   ที่เหลือคือโค้ดเดิมของปอย — ผมไม่แก้ไขโครง UI/flow อื่น ๆ
   วางทับไฟล์เดิมได้เลย
   =========================================================== */

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

/* ===================== Login UI Handlers ===================== */
async function handleLoginSubmit(ev){
  ev?.preventDefault?.();
  const role = document.querySelector('input[name="role"]:checked')?.value || 'student';

  const email = document.getElementById('email')?.value?.trim() || '';
  const password = document.getElementById('password')?.value || '';
  const citizenId = document.getElementById('citizenId')?.value?.replace(/\s|-/g,'') || '';

  let credentials = {};
  if (role === 'student') credentials = { citizenId };
  else credentials = { email, password };

  try {
    showBlockingLoader('กำลังเข้าสู่ระบบ', 'โปรดรอซักครู่...');
    const user = await authenticate(role, credentials);
    saveSession({ role: user.role, name: user.name, id: user.id, email: user.email || '' });

    const data = await bootstrapAll();
    hideBlockingLoader();

    // TODO: เรียก render dashboard ตาม role เดิมของปอย (คงไว้ตามไฟล์เก่า)
    console.log('[READY] user & data', { user, counts:{
      students: data.students?.length||0,
      grades: data.grades?.length||0,
      englishTests: data.englishTests?.length||0,
      advisors: data.advisors?.length||0
    }});
    // call your existing showXxxDashboard(data)
    if (role==='admin' && typeof showAdminDashboard==='function') showAdminDashboard(data);
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
  // อื่น ๆ ตามไฟล์เดิมของปอย…
});
