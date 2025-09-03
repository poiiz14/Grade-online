// === API base & JSONP helper ===
const API_BASE =
  'https://script.google.com/macros/s/AKfycbz7edo925YsuHCE6cTHw7npL69olAvnBVILIDE1pbVkBpptBgG0Uz6zFhnaqbEEe4AY/exec';

function callAPI(action, data = {}) {
  return new Promise((resolve, reject) => {
    const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    const payload = encodeURIComponent(JSON.stringify(data));
    window[cb] = (resp) => {
      try {
        resolve(resp);
      } finally {
        delete window[cb];
        script.remove();
      }
    };
    script.onerror = () => {
      delete window[cb];
      script.remove();
      reject(new Error('JSONP error'));
    };
    script.src = `${API_BASE}?action=${encodeURIComponent(
      action
    )}&data=${payload}&callback=${cb}`;
    document.body.appendChild(script);
  });
}

// ========================
// ตัวแปร global
// ========================
let currentUser = null;
let currentUserType = null;
// === Chart instances (global) ===
let _studentsChart = null;
let _englishChart  = null;
let studentsData = [];
let gradesData = [];
let englishTestData = [];
let advisorsData = [];
let currentStudentsPage = 1;
let currentGradesPage = 1;
let studentsPerPage = 20;
let gradesPerPage = 10;

 // Google Sheets configuration
        const SHEETS_CONFIG = {
            database: '1IxHHZ_I8SfUR-dgffruH5M0A4K8o6h3yDOwlZXsasIE',
            year1: '1SgfH9vNDJikq9FAU9eIHUE7kn493Rq90kWLkf25vDcM',
            year2: '1HNkU70E-mrVw20g4Qyxg-pvK_6qYBQTBOvahA9EaL64',
            year3: '1HJi3PZtfRxu6KvtJOzlB-gbA-fkX_203dhl_bhkjcxs',
            year4: '1wennsO79xTiTs_DKQwgiNvgZoXfmI-8DMR6xXwTHJv4',
            english: '1GYkqTZmvtU0GUjla477M9D3z_-i9CGd5iQj5E-inSp4'
        };

        // Initialize app
        document.addEventListener('DOMContentLoaded', function() {
            // Check if user is already logged in
            const savedUser = localStorage.getItem('currentUser');
            const savedUserType = localStorage.getItem('currentUserType');
            
            if (savedUser && savedUserType) {
                currentUser = JSON.parse(savedUser);
                currentUserType = savedUserType;
                showDashboard();
            }

            // Setup user type change handler
            document.getElementById('userType').addEventListener('change', function() {
                const userType = this.value;
                document.getElementById('adminLogin').classList.toggle('hidden', userType !== 'admin');
                document.getElementById('studentLogin').classList.toggle('hidden', userType !== 'student');
                document.getElementById('advisorLogin').classList.toggle('hidden', userType !== 'advisor');
            });

            // Setup search handlers
            document.getElementById('searchStudent')?.addEventListener('input', filterStudents);
            document.getElementById('yearFilter')?.addEventListener('change', filterStudents);
            document.getElementById('searchGrade')?.addEventListener('input', filterGrades);
            document.getElementById('gradeYearFilter')?.addEventListener('change', filterGrades);
        });

        // Authentication functions
        
    // ====== แทนที่ฟังก์ชัน login() เดิมทั้งก้อนด้วยโค้ดนี้ ======
    async function login() {
      const userType = document.getElementById('userType')?.value || 'admin';
    
      // เตรียม credentials ตามบทบาท
      let credentials = {};
      if (userType === 'admin') {
        credentials.email = (document.getElementById('adminEmail')?.value || '').trim();
        credentials.password = (document.getElementById('adminPassword')?.value || '').trim();
      } else if (userType === 'student') {
        // เข้าด้วยเลขบัตรประชาชน (ตัดช่องว่าง/ขีด เผื่อผู้ใช้พิมพ์มา)
        const rawCid = (document.getElementById('studentId')?.value || '').trim();
        credentials.citizenId = rawCid.replace(/\s|-/g, '');
      } else if (userType === 'advisor') {
        credentials.email = (document.getElementById('advisorEmail')?.value || '').trim();
        credentials.password = (document.getElementById('advisorPassword')?.value || '').trim();
      }
    
      try {
        // Loading UI
        if (typeof Swal !== 'undefined') {
          Swal.fire({
            title: 'กำลังเข้าสู่ระบบ...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
          });
        }
    
        // เรียก API authenticate (รองรับ JSONP ผ่าน callAPI)
        const resp = await callAPI('authenticate', { userType, credentials });
        console.log('AUTH RESP:', resp); // ช่วยดีบัก
    
        if (resp && resp.success && resp.data) {
          // เก็บสถานะผู้ใช้
          window.currentUser = resp.data;
          window.currentUserType = userType;
          try {
            localStorage.setItem('currentUser', JSON.stringify(resp.data));
            localStorage.setItem('currentUserType', userType);
          } catch (_) {}
    
          // โหลดข้อมูลก้อนแรกให้พร้อมก่อนขึ้น Dashboard
          try {
            if (typeof loadAdminData === 'function') {
              await loadAdminData(); // ภายในควรดึง students/grades/english/advisors
            } else {
              // เผื่อโปรเจ็กต์แยกเป็นฟังก์ชันย่อย
              await Promise.all([
                typeof loadStudentsFromSheets === 'function' ? loadStudentsFromSheets() : Promise.resolve(),
                typeof loadGradesFromSheets   === 'function' ? loadGradesFromSheets()   : Promise.resolve(),
                typeof loadEnglishTestFromSheets === 'function' ? loadEnglishTestFromSheets() : Promise.resolve(),
                typeof loadAdvisorsFromSheets === 'function' ? loadAdvisorsFromSheets() : Promise.resolve()
              ]);
            }
          } catch (err) {
            console.error('Initial load error:', err);
            // ไม่ fail login แต่แจ้งเตือนผู้ใช้
            if (typeof Swal !== 'undefined') {
              await Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'เข้าสู่ระบบสำเร็จ แต่โหลดข้อมูลบางส่วนไม่ครบ' });
            }
          }
    
          if (typeof Swal !== 'undefined') Swal.close();
    
          // แสดงหน้า Dashboard ตามบทบาท (ฟังก์ชันเดิมของโปรเจ็กต์)
          if (typeof showDashboard === 'function') {
            showDashboard();
          }
          return;
        }
    
        // กรณีไม่ผ่าน: แสดงข้อความจาก API ถ้ามี
        const msg = (resp && resp.message)
          ? resp.message
          : 'ข้อมูลการเข้าสู่ระบบไม่ถูกต้อง';
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'error', title: 'เข้าสู่ระบบไม่สำเร็จ', text: msg });
        }
      } catch (error) {
        console.error('Login error:', error);
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง' });
        }
      }
    }

        function logout() {
            localStorage.removeItem('currentUser');
            localStorage.removeItem('currentUserType');
            currentUser = null;
            currentUserType = null;
            
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('dashboard').classList.add('hidden');
            
            // Reset forms
            document.querySelectorAll('input').forEach(input => input.value = '');
        }

        function showDashboard() {
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');
            
            // Update user info
            document.getElementById('userName').textContent = currentUser.name;
            document.getElementById('userRole').textContent = currentUser.role || currentUser.position || `นักศึกษาชั้นปีที่ ${currentUser.year}`;
            
            // Show appropriate dashboard
            document.getElementById('adminDashboard').classList.toggle('hidden', currentUserType !== 'admin');
            document.getElementById('studentDashboard').classList.toggle('hidden', currentUserType !== 'student');
            document.getElementById('advisorDashboard').classList.toggle('hidden', currentUserType !== 'advisor');
            
            // Load initial data
            if (currentUserType === 'admin') {
                loadAdminData();
                showAdminSection('overview');
            } else if (currentUserType === 'student') {
                loadStudentData();
            } else if (currentUserType === 'advisor') {
                loadAdvisorData();
            }
        }

        // Admin functions
       // ปุ่มเมนูใน Admin Dashboard → ต้องเรียกแบบ onclick="showAdminSection('overview', this)"
        async function showAdminSection(section, el) {
          // 1) อัปเดตสไตล์ปุ่มนำทาง
          document.querySelectorAll('.admin-nav-btn').forEach(btn => {
            btn.classList.remove('border-blue-500', 'text-blue-600');
            btn.classList.add('border-transparent', 'text-gray-500');
          });
          if (el) {
            el.classList.remove('border-transparent', 'text-gray-500');
            el.classList.add('border-blue-500', 'text-blue-600');
          }
        
          // 2) โชว์/ซ่อน section
          document.querySelectorAll('.admin-section').forEach(sec => sec.classList.add('hidden'));
          const targetId = `admin${section.charAt(0).toUpperCase() + section.slice(1)}`;
          document.getElementById(targetId)?.classList.remove('hidden');
        
          // 3) โหลดข้อมูลให้พร้อม (ครั้งแรก/ยังไม่ครบ)
          try {
            const needsStudents = !Array.isArray(studentsData) || studentsData.length === 0;
            const needsGrades   = !Array.isArray(gradesData)   || gradesData.length === 0;
            const needsEnglish  = !Array.isArray(englishTestData) || englishTestData.length === 0;
            const needsAdvisors = !Array.isArray(advisorsData) || advisorsData.length === 0;
        
            if (needsStudents || needsGrades || needsEnglish || needsAdvisors) {
              // ถ้ามีฟังก์ชันรวม ให้เรียกอันเดียว
              if (typeof loadAdminData === 'function') {
                await loadAdminData();
              } else {
                // เผื่อโปรเจ็กต์แยกโหลดเป็นรายชุด
                await Promise.all([
                  typeof loadStudentsFromSheets === 'function' ? loadStudentsFromSheets() : Promise.resolve(),
                  typeof loadGradesFromSheets   === 'function' ? loadGradesFromSheets()   : Promise.resolve(),
                  typeof loadEnglishTestFromSheets === 'function' ? loadEnglishTestFromSheets() : Promise.resolve(),
                  typeof loadAdvisorsFromSheets === 'function' ? loadAdvisorsFromSheets() : Promise.resolve(),
                ]);
              }
            }
          } catch (e) {
            console.error('load data error:', e);
            Swal?.fire?.({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถโหลดข้อมูลได้' });
            return;
          }
        
          // 4) เรนเดอร์ตามส่วนที่เลือก
          try {
            if (section === 'overview'  && typeof loadOverviewData  === 'function') loadOverviewData();
            if (section === 'students'  && typeof loadStudentsData  === 'function') loadStudentsData();
            if (section === 'grades'    && typeof loadGradesData    === 'function') loadGradesData();
            if (section === 'individual'&& typeof loadIndividualData=== 'function') loadIndividualData();
          } catch (e) {
            console.error('render section error:', e);
          }
        }

    async function loadAdminData() {
        try {
            await Promise.all([
            loadStudentsFromSheets(),
            loadGradesFromSheets(),
            loadEnglishTestFromSheets(),
            loadAdvisorsFromSheets()
            ]);
        } catch (error) {
            console.error('Error loading admin data:', error);
            Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถโหลดข้อมูลได้' });
        }
        }
        async function loadOverviewData() {
            // Calculate overview statistics
            const totalStudents = studentsData.length;
            const studentsByYear = [0, 0, 0, 0];
            studentsData.forEach(student => {
                if (student.year >= 1 && student.year <= 4) {
                    studentsByYear[student.year - 1]++;
                }
            });

            // English test statistics
            const englishStats = calculateEnglishStats();
            const totalSubjects = calculateTotalSubjects();

            // Update UI
            document.getElementById('totalStudents').textContent = totalStudents;
            document.getElementById('passedEnglish').textContent = `${englishStats.passedPercent}% (${englishStats.passed})`;
            document.getElementById('failedEnglish').textContent = `${englishStats.failedPercent}% (${englishStats.failed})`;
            document.getElementById('totalSubjects').textContent = totalSubjects;

            // Update charts
            updateStudentsChart(studentsByYear);
            updateEnglishChart(englishStats);
        }

        function calculateEnglishStats() {
            const total = englishTestData.length;
            const passed = englishTestData.filter(test => test.status === 'ผ่าน').length;
            const failed = total - passed;
            
            return {
                passed,
                failed,
                passedPercent: total > 0 ? Math.round((passed / total) * 100) : 0,
                failedPercent: total > 0 ? Math.round((failed / total) * 100) : 0
            };
        }

        function calculateTotalSubjects() {
            const subjects = new Set();
            gradesData.forEach(grade => {
                subjects.add(grade.subjectCode);
            });
            return subjects.size;
        }

        function updateStudentsChart(dataArray) {
        const canvas = document.getElementById('studentsChart');
        if (!canvas) return; // กันกรณียังไม่ได้ mount UI
      
        const ctx = canvas.getContext('2d');
        if (_studentsChart) _studentsChart.destroy();
      
        _studentsChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ['ชั้นปี 1', 'ชั้นปี 2', 'ชั้นปี 3', 'ชั้นปี 4'],
            datasets: [{
              label: 'จำนวนนักศึกษา',
              data: Array.isArray(dataArray) ? dataArray : [0,0,0,0],
              backgroundColor: ['#3B82F6','#10B981','#F59E0B','#EF4444']
            }]
          },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
      }
      
      function updateEnglishChart(stats) {
        const canvas = document.getElementById('englishChart');
        if (!canvas) return;
      
        const ctx = canvas.getContext('2d');
        if (_englishChart) _englishChart.destroy();
      
        const passed = stats?.passed ?? 0;
        const failed = stats?.failed ?? 0;
      
        _englishChart = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: ['ผ่าน', 'ไม่ผ่าน'],
            datasets: [{ data: [passed, failed], backgroundColor: ['#10B981','#EF4444'] }]
          },
          options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });
      }

        // Mock data loading functions (replace with actual Google Sheets API calls)
        async function loadStudentsFromSheets() {
        const resp = await callAPI('getStudents', {});
        studentsData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
        }

        async function loadGradesFromSheets() {
        // ทั้งระบบ หรือจะระบุพารามิเตอร์ปีการศึกษาภายหลังได้
        const resp = await callAPI('getGrades', {}); 
        gradesData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
        }

        async function loadEnglishTestFromSheets() {
        const resp = await callAPI('getEnglishTests', {}); 
        englishTestData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
        }

        async function loadAdvisorsFromSheets() {
        // ต้องมี action 'getAdvisors' ฝั่ง Apps Script (ผมแนะนำให้ผูกไว้แล้ว)
        const resp = await callAPI('getAdvisors', {}); 
        advisorsData = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : [];
        }


        function loadStudentsData() {
            displayStudents();
        }

        function displayStudents() {
            const tbody = document.getElementById('studentsTable');
            const start = (currentStudentsPage - 1) * studentsPerPage;
            const end = start + studentsPerPage;
            const filteredStudents = getFilteredStudents();
            const pageStudents = filteredStudents.slice(start, end);

            tbody.innerHTML = pageStudents.map(student => `
                <tr>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${student.id}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${student.name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">ชั้นปีที่ ${student.year}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${student.advisor}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button onclick="editStudent('${student.id}')" class="text-blue-600 hover:text-blue-900 mr-3">
                            <i class="fas fa-edit"></i> แก้ไข
                        </button>
                        <button onclick="deleteStudent('${student.id}')" class="text-red-600 hover:text-red-900">
                            <i class="fas fa-trash"></i> ลบ
                        </button>
                    </td>
                </tr>
            `).join('');

            // Update pagination info
            document.getElementById('studentsStart').textContent = start + 1;
            document.getElementById('studentsEnd').textContent = Math.min(end, filteredStudents.length);
            document.getElementById('studentsTotal').textContent = filteredStudents.length;
        }

        function getFilteredStudents() {
            const yearFilter = document.getElementById('yearFilter').value;
            const searchTerm = document.getElementById('searchStudent').value.toLowerCase();

            return studentsData.filter(student => {
                const matchesYear = !yearFilter || student.year.toString() === yearFilter;
                const matchesSearch = !searchTerm || 
                    student.name.toLowerCase().includes(searchTerm) ||
                    student.id.toLowerCase().includes(searchTerm);
                return matchesYear && matchesSearch;
            });
        }

        function filterStudents() {
            currentStudentsPage = 1;
            displayStudents();
        }

        function previousStudentsPage() {
            if (currentStudentsPage > 1) {
                currentStudentsPage--;
                displayStudents();
            }
        }

        function nextStudentsPage() {
            const filteredStudents = getFilteredStudents();
            const totalPages = Math.ceil(filteredStudents.length / studentsPerPage);
            if (currentStudentsPage < totalPages) {
                currentStudentsPage++;
                displayStudents();
            }
        }

        // Modal functions
        function showAddStudentModal() {
            // Populate advisors dropdown
            const advisorSelect = document.getElementById('newStudentAdvisor');
            advisorSelect.innerHTML = '<option value="">เลือกอาจารย์ที่ปรึกษา</option>' +
                advisorsData.map(advisor => `<option value="${advisor.name}">${advisor.name}</option>`).join('');
            
            document.getElementById('addStudentModal').classList.remove('hidden');
            document.getElementById('addStudentModal').classList.add('flex');
        }

        function closeAddStudentModal() {
            document.getElementById('addStudentModal').classList.add('hidden');
            document.getElementById('addStudentModal').classList.remove('flex');
            document.getElementById('addStudentForm').reset();
        }

        function showAddGradeModal() {
            // Populate students dropdown
            const studentSelect = document.getElementById('gradeStudentSelect');
            studentSelect.innerHTML = '<option value="">เลือกนักศึกษา</option>' +
                studentsData.map(student => `<option value="${student.id}">${student.id} - ${student.name}</option>`).join('');
            
            document.getElementById('addGradeModal').classList.remove('hidden');
            document.getElementById('addGradeModal').classList.add('flex');
        }

        function closeAddGradeModal() {
            document.getElementById('addGradeModal').classList.add('hidden');
            document.getElementById('addGradeModal').classList.remove('flex');
            document.getElementById('addGradeForm').reset();
        }

        // Form handlers
        
document.getElementById('addStudentForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const formData = {
    id: document.getElementById('newStudentId').value.trim(),
    name: document.getElementById('newStudentName').value.trim(),
    year: parseInt(document.getElementById('newStudentYear').value, 10),
    citizenId: document.getElementById('newStudentCitizenId').value.trim(),
    advisor: document.getElementById('newStudentAdvisor').value
  };

  try {
    Swal.fire({ title: 'กำลังบันทึกข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const resp = await callAPI('addStudent', formData);
    if (resp && resp.success) {
      Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', text: 'เพิ่มข้อมูลนักศึกษาเรียบร้อยแล้ว' });
      closeAddStudentModal();
      await loadStudentsFromSheets();
      displayStudents();
      loadOverviewData();
    } else {
      throw new Error(resp && resp.message ? resp.message : 'ไม่สามารถบันทึกข้อมูลได้');
    }
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: String(error.message || error) });
  }
});


        
document.getElementById('addGradeForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const formData = {
    studentId: document.getElementById('gradeStudentSelect').value,
    semester: document.getElementById('gradeSemester').value.trim(),
    subjectCode: document.getElementById('gradeSubjectCode').value.trim(),
    subjectName: document.getElementById('gradeSubjectName').value.trim(),
    credits: parseInt(document.getElementById('gradeCredits').value, 10),
    grade: document.getElementById('gradeValue').value,
    date: new Date().toISOString().split('T')[0]
  };

  try {
    Swal.fire({ title: 'กำลังบันทึกข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const resp = await callAPI('addGrade', formData);
    if (resp && resp.success) {
      Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', text: 'เพิ่มผลการเรียนเรียบร้อยแล้ว' });
      closeAddGradeModal();
      await loadGradesFromSheets();
      if (document.getElementById('adminGrades').classList.contains('hidden') === false) {
        loadGradesData();
      }
    } else {
      throw new Error(resp && resp.message ? resp.message : 'ไม่สามารถบันทึกข้อมูลได้');
    }
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: String(error.message || error) });
  }
});

        // Student dashboard functions
        async function loadStudentData() {
            try {
                // Load student's academic data
                const studentGrades = gradesData.filter(grade => grade.studentId === currentUser.id);
                const studentEnglish = englishTestData.filter(test => test.studentId === currentUser.id);
                
                // Calculate GPAX and total credits
                const { gpax, totalCredits } = calculateStudentGPAX(studentGrades);
                const englishStatus = getLatestEnglishStatus(studentEnglish);
                
                // Update summary
                document.getElementById('studentGPAX').textContent = gpax.toFixed(2);
                document.getElementById('studentCredits').textContent = totalCredits;
                document.getElementById('studentEnglishStatus').textContent = englishStatus;
                
                // Populate academic year dropdown
                populateAcademicYears('studentAcademicYear');
                
                // Load semester data
                showSemester('1');
                loadStudentEnglishTests();
                
            } catch (error) {
                console.error('Error loading student data:', error);
            }
        }

        function calculateStudentGPAX(grades) {
            let totalPoints = 0;
            let totalCredits = 0;
            
            const gradePoints = {
                'A': 4.0, 'B+': 3.5, 'B': 3.0, 'C+': 2.5, 'C': 2.0,
                'D+': 1.5, 'D': 1.0, 'F': 0.0
            };
            
            grades.forEach(grade => {
                if (gradePoints.hasOwnProperty(grade.grade)) {
                    totalPoints += gradePoints[grade.grade] * grade.credits;
                    totalCredits += grade.credits;
                }
            });
            
            const gpax = totalCredits > 0 ? totalPoints / totalCredits : 0;
            return { gpax, totalCredits };
        }

        function getLatestEnglishStatus(englishTests) {
            if (englishTests.length === 0) return 'ยังไม่ได้สอบ';
            
            const latest = englishTests.reduce((latest, test) => 
                new Date(test.date) > new Date(latest.date) ? test : latest
            );
            
            return latest.status;
        }

      // ปุ่มแท็บภาคเรียนของนักศึกษา → ต้องเรียกแบบ onclick="showSemester('1', this)"
      async function showSemester(semester, el) {
        // 1) อัปเดตสไตล์แท็บภาคเรียน
        document.querySelectorAll('.semester-tab').forEach(tab => {
          tab.classList.remove('border-blue-500', 'text-blue-600');
          tab.classList.add('border-transparent', 'text-gray-500');
        });
        if (el) {
          el.classList.remove('border-transparent', 'text-gray-500');
          el.classList.add('border-blue-500', 'text-blue-600');
        }
      
        // 2) ให้แน่ใจว่าข้อมูลเกรดโหลดแล้ว
        try {
          if (!Array.isArray(gradesData) || gradesData.length === 0) {
            if (typeof loadGradesFromSheets === 'function') {
              await loadGradesFromSheets();
            }
          }
        } catch (e) {
          console.error('load grades error:', e);
          Swal?.fire?.({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถโหลดผลการเรียนได้' });
          return;
        }
      
        // 3) เรนเดอร์เกรดของภาคเรียน (ฟังก์ชันเดิมของโปรเจ็กต์)
        try {
          if (typeof loadSemesterGrades === 'function') {
            loadSemesterGrades(semester);
          }
        } catch (e) {
          console.error('render semester error:', e);
        }
      }

        function loadSemesterGrades(semester) {
          const academicYear = document.getElementById('studentAcademicYear').value;
          const semSuffix = '/' + String(semester);
        
          const studentGrades = (gradesData || []).filter(grade => {
            if (!grade) return false;
            // กันกรณีไม่มีค่า semester
            if (!grade.semester) return false;
        
            const matchesStudent = grade.studentId === currentUser.id;
            const matchesSemester = String(grade.semester).endsWith(semSuffix);
            const matchesYear = academicYear
              ? String(grade.semester).startsWith(academicYear)
              : true;
        
            return matchesStudent && matchesSemester && matchesYear;
          });
        
          const tbody = document.getElementById('studentGradesTable');
          tbody.innerHTML = studentGrades
            .map(grade => `
              <tr>
                <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectCode}</td>
                <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectName}</td>
                <td class="px-4 py-2 text-sm text-gray-900">${grade.credits}</td>
                <td class="px-4 py-2 text-sm font-medium ${getGradeColor(grade.grade)}">${grade.grade}</td>
              </tr>
            `)
            .join('');
        
          // คำนวณ GPA ภาคเรียน
          const semesterGPA = calculateSemesterGPA(studentGrades);
          document.getElementById('semesterGPA').textContent = semesterGPA.toFixed(2);
        }

        function calculateSemesterGPA(grades) {
            let totalPoints = 0;
            let totalCredits = 0;
            
            const gradePoints = {
                'A': 4.0, 'B+': 3.5, 'B': 3.0, 'C+': 2.5, 'C': 2.0,
                'D+': 1.5, 'D': 1.0, 'F': 0.0
            };
            
            grades.forEach(grade => {
                if (gradePoints.hasOwnProperty(grade.grade)) {
                    totalPoints += gradePoints[grade.grade] * grade.credits;
                    totalCredits += grade.credits;
                }
            });
            
            return totalCredits > 0 ? totalPoints / totalCredits : 0;
        }

        function getGradeColor(grade) {
            const colors = {
                'A': 'text-green-600',
                'B+': 'text-green-500',
                'B': 'text-blue-600',
                'C+': 'text-blue-500',
                'C': 'text-yellow-600',
                'D+': 'text-orange-500',
                'D': 'text-red-500',
                'F': 'text-red-600'
            };
            return colors[grade] || 'text-gray-600';
        }

        function loadStudentEnglishTests() {
            const studentEnglish = englishTestData.filter(test => test.studentId === currentUser.id);
            const tbody = document.getElementById('studentEnglishTable');
            
            tbody.innerHTML = studentEnglish.map(test => `
                <tr>
                    <td class="px-4 py-2 text-sm text-gray-900">${test.year}</td>
                    <td class="px-4 py-2 text-sm text-gray-900">${test.attempt}</td>
                    <td class="px-4 py-2 text-sm text-gray-900">${test.score}</td>
                    <td class="px-4 py-2 text-sm">
                        <span class="px-2 py-1 text-xs rounded-full ${test.status === 'ผ่าน' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                            ${test.status}
                        </span>
                    </td>
                    <td class="px-4 py-2 text-sm text-gray-900">${formatDate(test.date)}</td>
                </tr>
            `).join('');
        }

        // Advisor dashboard functions
        async function loadAdvisorData() {
            try {
                // Load advisor's students
                const advisorStudents = studentsData.filter(student => student.advisor === currentUser.name);
                
                // Populate academic year dropdown
                populateAcademicYears('advisorAcademicYear');
                
                // Display students
                displayAdvisorStudents(advisorStudents);
                
            } catch (error) {
                console.error('Error loading advisor data:', error);
            }
        }

        function displayAdvisorStudents(students) {
            const container = document.getElementById('advisorStudentsList');
            
            container.innerHTML = students.map(student => {
                const studentGrades = gradesData.filter(grade => grade.studentId === student.id);
                const studentEnglish = englishTestData.filter(test => test.studentId === student.id);
                const { gpax } = calculateStudentGPAX(studentGrades);
                
                return `
                    <div class="p-6">
                        <div class="flex justify-between items-center mb-4">
                            <div>
                                <h4 class="text-lg font-semibold text-gray-900">${student.name}</h4>
                                <p class="text-sm text-gray-600">รหัส: ${student.id} | ชั้นปีที่ ${student.year} | GPAX: ${gpax.toFixed(2)}</p>
                            </div>
                            <div class="flex space-x-2">
                                <button onclick="showStudentGrades('${student.id}')" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">
                                    ดูผลการเรียน
                                </button>
                                <button onclick="showStudentEnglish('${student.id}')" class="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700">
                                    ดูผลสอบภาษาอังกฤษ
                                </button>
                            </div>
                        </div>
                        <div id="student-${student.id}-details" class="hidden">
                            <div id="student-${student.id}-grades" class="mb-4"></div>
                            <div id="student-${student.id}-english"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function showStudentGrades(studentId) {
            const detailsDiv = document.getElementById(`student-${studentId}-details`);
            const gradesDiv = document.getElementById(`student-${studentId}-grades`);
            
            if (detailsDiv.classList.contains('hidden')) {
                const academicYear = document.getElementById('advisorAcademicYear').value;
                const studentGrades = gradesData.filter(grade => {
                    const matchesStudent = grade.studentId === studentId;
                    const matchesYear = !academicYear || grade.semester.startsWith(academicYear);
                    return matchesStudent && matchesYear;
                });
                
                gradesDiv.innerHTML = `
                    <h5 class="font-medium text-gray-900 mb-2">ผลการเรียน</h5>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-3 py-2 text-left">ภาคการศึกษา</th>
                                    <th class="px-3 py-2 text-left">รหัสวิชา</th>
                                    <th class="px-3 py-2 text-left">ชื่อวิชา</th>
                                    <th class="px-3 py-2 text-left">หน่วยกิต</th>
                                    <th class="px-3 py-2 text-left">เกรด</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-200">
                                ${studentGrades.map(grade => `
                                    <tr>
                                        <td class="px-3 py-2">${grade.semester}</td>
                                        <td class="px-3 py-2">${grade.subjectCode}</td>
                                        <td class="px-3 py-2">${grade.subjectName}</td>
                                        <td class="px-3 py-2">${grade.credits}</td>
                                        <td class="px-3 py-2 font-medium ${getGradeColor(grade.grade)}">${grade.grade}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                
                detailsDiv.classList.remove('hidden');
            } else {
                detailsDiv.classList.add('hidden');
            }
        }

        function showStudentEnglish(studentId) {
            const detailsDiv = document.getElementById(`student-${studentId}-details`);
            const englishDiv = document.getElementById(`student-${studentId}-english`);
            
            if (detailsDiv.classList.contains('hidden')) {
                const studentEnglish = englishTestData.filter(test => test.studentId === studentId);
                
                englishDiv.innerHTML = `
                    <h5 class="font-medium text-gray-900 mb-2">ผลสอบภาษาอังกฤษ สบช.</h5>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-3 py-2 text-left">ปีการศึกษา</th>
                                    <th class="px-3 py-2 text-left">ครั้งที่สอบ</th>
                                    <th class="px-3 py-2 text-left">คะแนน</th>
                                    <th class="px-3 py-2 text-left">สถานะ</th>
                                    <th class="px-3 py-2 text-left">วันที่สอบ</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-200">
                                ${studentEnglish.map(test => `
                                    <tr>
                                        <td class="px-3 py-2">${test.year}</td>
                                        <td class="px-3 py-2">${test.attempt}</td>
                                        <td class="px-3 py-2">${test.score}</td>
                                        <td class="px-3 py-2">
                                            <span class="px-2 py-1 text-xs rounded-full ${test.status === 'ผ่าน' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                                ${test.status}
                                            </span>
                                        </td>
                                        <td class="px-3 py-2">${formatDate(test.date)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                
                detailsDiv.classList.remove('hidden');
            } else {
                detailsDiv.classList.add('hidden');
            }
        }

        // Utility functions
        function populateAcademicYears(selectId) {
            const years = ['2567', '2566', '2565', '2564'];
            const select = document.getElementById(selectId);
            select.innerHTML = '<option value="">ทุกปีการศึกษา</option>' +
                years.map(year => `<option value="${year}">${year}</option>`).join('');
        }

        function formatDate(dateString) {
            const date = new Date(dateString);
            return date.toLocaleDateString('th-TH');
        }

        // Additional admin functions for grades management
        function loadGradesData() {
            displayGrades();
        }

        function displayGrades() {
            const tbody = document.getElementById('gradesTable');
            const start = (currentGradesPage - 1) * gradesPerPage;
            const end = start + gradesPerPage;
            const filteredGrades = getFilteredGrades();
            const pageGrades = filteredGrades.slice(start, end);

            tbody.innerHTML = pageGrades.map(grade => {
                const student = studentsData.find(s => s.id === grade.studentId);
                return `
                    <tr>
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${grade.studentId}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${student ? student.name : '-'}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${grade.semester}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${grade.subjectCode} - ${grade.subjectName}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium ${getGradeColor(grade.grade)}">${grade.grade}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <button onclick="editGrade('${grade.studentId}', '${grade.subjectCode}')" class="text-blue-600 hover:text-blue-900 mr-3">
                                <i class="fas fa-edit"></i> แก้ไข
                            </button>
                            <button onclick="deleteGrade('${grade.studentId}', '${grade.subjectCode}')" class="text-red-600 hover:text-red-900">
                                <i class="fas fa-trash"></i> ลบ
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            // Update pagination info
            document.getElementById('gradesStart').textContent = start + 1;
            document.getElementById('gradesEnd').textContent = Math.min(end, filteredGrades.length);
            document.getElementById('gradesTotal').textContent = filteredGrades.length;
        }

        function getFilteredGrades() {
            const yearFilter = document.getElementById('gradeYearFilter').value;
            const searchTerm = document.getElementById('searchGrade').value.toLowerCase();

            return gradesData.filter(grade => {
                const student = studentsData.find(s => s.id === grade.studentId);
                const matchesYear = !yearFilter || (student && student.year.toString() === yearFilter);
                const matchesSearch = !searchTerm || 
                    grade.studentId.toLowerCase().includes(searchTerm) ||
                    (student && student.name.toLowerCase().includes(searchTerm)) ||
                    grade.subjectCode.toLowerCase().includes(searchTerm) ||
                    grade.subjectName.toLowerCase().includes(searchTerm);
                return matchesYear && matchesSearch;
            });
        }

        function filterGrades() {
            currentGradesPage = 1;
            displayGrades();
        }

        function previousGradesPage() {
            if (currentGradesPage > 1) {
                currentGradesPage--;
                displayGrades();
            }
        }

        function nextGradesPage() {
            const filteredGrades = getFilteredGrades();
            const totalPages = Math.ceil(filteredGrades.length / gradesPerPage);
            if (currentGradesPage < totalPages) {
                currentGradesPage++;
                displayGrades();
            }
        }

        function loadIndividualData() {
            // Populate student dropdown
            const studentSelect = document.getElementById('individualStudent');
            studentSelect.innerHTML = '<option value="">เลือกนักศึกษา</option>' +
                studentsData.map(student => `<option value="${student.id}">${student.id} - ${student.name}</option>`).join('');
            
            // Populate academic years
            populateAcademicYears('academicYear');
            
            // Setup event listeners
            document.getElementById('individualStudent').addEventListener('change', loadIndividualStudentData);
            document.getElementById('academicYear').addEventListener('change', loadIndividualStudentData);
            document.getElementById('searchIndividual').addEventListener('input', function() {
                const searchTerm = this.value.toLowerCase();
                const filteredStudents = studentsData.filter(student => 
                    student.name.toLowerCase().includes(searchTerm) ||
                    student.id.toLowerCase().includes(searchTerm)
                );
                
                studentSelect.innerHTML = '<option value="">เลือกนักศึกษา</option>' +
                    filteredStudents.map(student => `<option value="${student.id}">${student.id} - ${student.name}</option>`).join('');
            });
        }

        function loadIndividualStudentData() {
            const studentId = document.getElementById('individualStudent').value;
            const academicYear = document.getElementById('academicYear').value;
            
            if (!studentId) {
                document.getElementById('individualData').classList.add('hidden');
                return;
            }
            
            const student = studentsData.find(s => s.id === studentId);
            if (!student) return;
            
            // Update student info
            document.getElementById('studentName').textContent = student.name;
            document.getElementById('studentCode').textContent = student.id;
            document.getElementById('advisorName').textContent = student.advisor;
            
            // Load grades
            const studentGrades = gradesData.filter(grade => {
                const matchesStudent = grade.studentId === studentId;
                const matchesYear = !academicYear || grade.semester.startsWith(academicYear);
                return matchesStudent && matchesYear;
            });
            
            // Calculate GPAs
            const { gpax, totalCredits } = calculateStudentGPAX(studentGrades);
            const yearGPA = academicYear ? calculateYearGPA(studentGrades, academicYear) : gpax;
            
            document.getElementById('yearGPA').textContent = yearGPA.toFixed(2);
            document.getElementById('cumulativeGPA').textContent = gpax.toFixed(2);
            document.getElementById('totalCredits').textContent = totalCredits;
            
            // Load English test results
            const studentEnglish = englishTestData.filter(test => test.studentId === studentId);
            const englishTbody = document.getElementById('englishTestTable');
            englishTbody.innerHTML = studentEnglish.map(test => `
                <tr>
                    <td class="px-4 py-2 text-sm text-gray-900">${test.year}</td>
                    <td class="px-4 py-2 text-sm text-gray-900">${test.attempt}</td>
                    <td class="px-4 py-2 text-sm text-gray-900">${test.score}</td>
                    <td class="px-4 py-2 text-sm">
                        <span class="px-2 py-1 text-xs rounded-full ${test.status === 'ผ่าน' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                            ${test.status}
                        </span>
                    </td>
                    <td class="px-4 py-2 text-sm text-gray-900">${formatDate(test.date)}</td>
                </tr>
            `).join('');
            
            // Load grades detail
            const gradesTbody = document.getElementById('gradesDetailTable');
            gradesTbody.innerHTML = studentGrades.map(grade => `
                <tr>
                    <td class="px-4 py-2 text-sm text-gray-900">${grade.semester}</td>
                    <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectCode}</td>
                    <td class="px-4 py-2 text-sm text-gray-900">${grade.subjectName}</td>
                    <td class="px-4 py-2 text-sm text-gray-900">${grade.credits}</td>
                    <td class="px-4 py-2 text-sm font-medium ${getGradeColor(grade.grade)}">${grade.grade}</td>
                </tr>
            `).join('');
            
            document.getElementById('individualData').classList.remove('hidden');
        }

        function calculateYearGPA(grades, year) {
            const yearGrades = grades.filter(grade => grade.semester.startsWith(year));
            const { gpax } = calculateStudentGPAX(yearGrades);
            return gpax;
        }

        // Placeholder functions for edit/delete operations
        function editStudent(studentId) {
            Swal.fire({
                title: 'แก้ไขข้อมูลนักศึกษา',
                text: `แก้ไขข้อมูลนักศึกษา ${studentId}`,
                icon: 'info'
            });
        }

        function deleteStudent(studentId) {
            Swal.fire({
                title: 'ยืนยันการลบ',
                text: `ต้องการลบข้อมูลนักศึกษา ${studentId} หรือไม่?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'ลบ',
                cancelButtonText: 'ยกเลิก'
            }).then((result) => {
                if (result.isConfirmed) {
                    // Remove from local data
                    studentsData = studentsData.filter(student => student.id !== studentId);
                    displayStudents();
                    loadOverviewData();
                    
                    Swal.fire('ลบสำเร็จ!', 'ลบข้อมูลนักศึกษาเรียบร้อยแล้ว', 'success');
                }
            });
        }

        function editGrade(studentId, subjectCode) {
            Swal.fire({
                title: 'แก้ไขผลการเรียน',
                text: `แก้ไขผลการเรียน ${studentId} - ${subjectCode}`,
                icon: 'info'
            });
        }

        function deleteGrade(studentId, subjectCode) {
            Swal.fire({
                title: 'ยืนยันการลบ',
                text: `ต้องการลบผลการเรียน ${studentId} - ${subjectCode} หรือไม่?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'ลบ',
                cancelButtonText: 'ยกเลิก'
            }).then((result) => {
                if (result.isConfirmed) {
                    // Remove from local data
                    gradesData = gradesData.filter(grade => 
                        !(grade.studentId === studentId && grade.subjectCode === subjectCode)
                    );
                    displayGrades();
                    
                    Swal.fire('ลบสำเร็จ!', 'ลบผลการเรียนเรียบร้อยแล้ว', 'success');
                }
            });
        }



