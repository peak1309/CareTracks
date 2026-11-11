// app.js - Logic & Controllers for CareTrack Edu

let appState = {
  currentTab: 'dashboard',
  selectedClassFilter: 'all',
  selectedRiskFilter: 'all',
  searchQuery: '',
  selectedStudentForCare: null,
  selectedStudentForDetail: null,
  activeClassroomForAttendance: 'auto_v1',
  activeCourseForAttendance: 'ENG201',
  currentAttendanceDate: new Date().toISOString().split('T')[0],
  currentAttendanceState: {}, // studentId -> 'present' | 'late' | 'leave' | 'absent'
  charts: {}
};

// Data holder
let data = loadAppData();

// Sound effect using Web Audio API
function playAlertBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // A5
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
  } catch (e) {
    // Audio might be blocked by browser autoplay policy until interaction
  }
}

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  const bgClass = type === 'danger' ? 'bg-red-600' :
                  type === 'warning' ? 'bg-amber-600' :
                  type === 'success' ? 'bg-emerald-600' : 'bg-blue-600';
  const icon = type === 'danger' ? 'fa-triangle-exclamation' :
               type === 'warning' ? 'fa-bell' :
               type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
               
  toast.className = `flex items-center gap-3 px-4 py-3 text-white ${bgClass} rounded-xl shadow-lg shadow-black/10 transform transition-all duration-300 translate-y-4 opacity-0 text-sm max-w-md`;
  toast.innerHTML = `
    <i class="fa-solid ${icon} text-lg"></i>
    <div class="flex-1 font-medium">${message}</div>
    <button onclick="this.parentElement.remove()" class="text-white/80 hover:text-white ml-2">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;
  container.appendChild(toast);
  
  // Animation in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-4', 'opacity-0');
  });
  
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// Risk calculation helper
function calculateStudentMetrics(student) {
  const total = student.totalClasses || 15;
  const absent = student.absent || 0;
  const late = student.late || 0;
  const attended = student.attended || (total - absent);
  
  // Attendance percentage (late counts as half presence or full presence depending on rules, standard is full presence but penalty)
  const attendanceRate = Math.max(0, Math.min(100, Math.round(((total - absent) / total) * 100)));
  
  let riskLevel = 'safe';
  if (student.caseStatus === 'resolved') {
    riskLevel = 'resolved';
  } else if (absent >= 4 || student.consecutiveAbsent >= 3 || attendanceRate < 80) {
    riskLevel = 'danger';
  } else if (absent >= 2 || late >= 3 || student.consecutiveAbsent >= 2 || (attendanceRate >= 80 && attendanceRate < 85)) {
    riskLevel = 'warning';
  }
  
  return { attendanceRate, riskLevel };
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  renderNavbar();
  initAttendanceDefaults();
  switchTab('dashboard');
  setupEventListeners();
  updateNotificationBadge();
  if (typeof initSupabase === 'function') {
    await initSupabase();
  }
});

// Setup Events
function setupEventListeners() {
  // Global search input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      appState.searchQuery = e.target.value.toLowerCase().trim();
      if (appState.currentTab === 'students') renderStudentsTab();
      if (appState.currentTab === 'dashboard') renderDashboardTab();
    });
  }

  // Close modals on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });
}

function switchTab(tabName) {
  appState.currentTab = tabName;
  
  // Update Nav links
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    const target = btn.getAttribute('data-tab');
    if (target === tabName) {
      btn.classList.add('bg-blue-600', 'text-white', 'shadow-md', 'shadow-blue-600/30');
      btn.classList.remove('text-slate-600', 'hover:bg-slate-100');
    } else {
      btn.classList.remove('bg-blue-600', 'text-white', 'shadow-md', 'shadow-blue-600/30');
      btn.classList.add('text-slate-600', 'hover:bg-slate-100');
    }
  });

  const contentArea = document.getElementById('main-content');
  if (!contentArea) return;

  if (tabName === 'dashboard') {
    renderDashboardTab();
  } else if (tabName === 'students') {
    renderStudentsTab();
  } else if (tabName === 'attendance') {
    renderAttendanceTab();
  } else if (tabName === 'care_logs') {
    renderCareLogsTab();
  } else if (tabName === 'report') {
    renderReportTab();
  }
}

// -------------------------------------------------------------
// TAB 1: DASHBOARD
// -------------------------------------------------------------
function renderDashboardTab() {
  const container = document.getElementById('main-content');
  
  // Recalculate metrics
  let totalStudents = data.students.length;
  let dangerCount = 0;
  let warningCount = 0;
  let inProgressCount = 0;
  let resolvedCount = 0;

  data.students.forEach(st => {
    const { riskLevel } = calculateStudentMetrics(st);
    if (riskLevel === 'danger') dangerCount++;
    else if (riskLevel === 'warning') warningCount++;
    else if (riskLevel === 'resolved') resolvedCount++;

    if (st.caseStatus === 'in_progress' || st.caseStatus === 'escalated') {
      inProgressCount++;
    }
  });

  // Filter urgent action queue (danger or unassigned warnings)
  const urgentStudents = data.students.filter(st => {
    const { riskLevel } = calculateStudentMetrics(st);
    return (riskLevel === 'danger') || (riskLevel === 'warning' && st.caseStatus === 'unassigned');
  });

  container.innerHTML = `
    <div class="space-y-6">
      <!-- Welcome & Alert Banner -->
      <div class="bg-gradient-to-r from-blue-700 via-indigo-700 to-sky-700 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 bg-white/20 rounded-full text-xs font-medium mb-2 backdrop-blur-sm">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            ${data.schoolName} • ${data.semester} | ระบบเปิดเฝ้าระวังเรียลไทม์
          </div>
          <h1 class="text-2xl md:text-3xl font-bold tracking-tight">ศูนย์เฝ้าระวังและป้องกันนักศึกษาหลุดจากระบบ</h1>
          <p class="text-blue-100 text-sm mt-1">
            ตรวจจับสัญญาณเตือนก่อนหมดสิทธิ์สอบ (มส.) พร้อมเชื่อมต่อครูที่ปรึกษาและผู้ปกครอง วิทยาลัยการอาชีพเวียงสระ
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button onclick="openAttendanceTabQuick()" class="px-4 py-2.5 bg-white text-blue-800 rounded-xl font-semibold text-sm shadow hover:bg-blue-50 transition flex items-center gap-2">
            <i class="fa-solid fa-clipboard-check text-blue-600"></i> เช็คชื่อเข้าเรียนวันนี้
          </button>
          <button onclick="openLineNotifyModalSim()" class="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-semibold text-sm shadow transition flex items-center gap-2">
            <i class="fa-brands fa-line text-lg"></i> ทดสอบส่ง LINE แจ้งเตือน
          </button>
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <!-- Total -->
        <div class="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center gap-3.5">
          <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl shrink-0">
            <i class="fa-solid fa-users"></i>
          </div>
          <div>
            <div class="text-2xl font-bold text-slate-800">${totalStudents}</div>
            <div class="text-xs text-slate-500 font-medium">นักศึกษาในระบบ</div>
          </div>
        </div>

        <!-- Danger -->
        <div onclick="filterByRiskAndSwitch('danger')" class="bg-white rounded-2xl p-4 border border-red-200 shadow-sm flex items-center gap-3.5 cursor-pointer hover:border-red-400 hover:shadow-md transition">
          <div class="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center text-xl shrink-0 pulse-danger">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <div>
            <div class="text-2xl font-bold text-red-600 flex items-center gap-1.5">
              ${dangerCount}
              <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-normal">วิกฤต</span>
            </div>
            <div class="text-xs text-slate-500 font-medium">เสี่ยงหลุด/หมดสิทธิ์สอบ</div>
          </div>
        </div>

        <!-- Warning -->
        <div onclick="filterByRiskAndSwitch('warning')" class="bg-white rounded-2xl p-4 border border-amber-200 shadow-sm flex items-center gap-3.5 cursor-pointer hover:border-amber-400 hover:shadow-md transition">
          <div class="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-xl shrink-0">
            <i class="fa-solid fa-clock-rotate-left"></i>
          </div>
          <div>
            <div class="text-2xl font-bold text-amber-600 flex items-center gap-1.5">
              ${warningCount}
              <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-normal">เฝ้าระวัง</span>
            </div>
            <div class="text-xs text-slate-500 font-medium">ขาดสะสม 2-3 ครั้ง</div>
          </div>
        </div>

        <!-- In Progress -->
        <div onclick="switchTab('care_logs')" class="bg-white rounded-2xl p-4 border border-purple-200 shadow-sm flex items-center gap-3.5 cursor-pointer hover:border-purple-400 hover:shadow-md transition">
          <div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-xl shrink-0">
            <i class="fa-solid fa-user-nurse"></i>
          </div>
          <div>
            <div class="text-2xl font-bold text-purple-600">${inProgressCount}</div>
            <div class="text-xs text-slate-500 font-medium">อยู่ระหว่างติดตามดูแล</div>
          </div>
        </div>

        <!-- Resolved -->
        <div onclick="filterByRiskAndSwitch('resolved')" class="bg-white rounded-2xl p-4 border border-emerald-200 shadow-sm flex items-center gap-3.5 cursor-pointer hover:border-emerald-400 hover:shadow-md transition col-span-2 lg:col-span-1">
          <div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl shrink-0">
            <i class="fa-solid fa-circle-check"></i>
          </div>
          <div>
            <div class="text-2xl font-bold text-emerald-600">${resolvedCount}</div>
            <div class="text-xs text-slate-500 font-medium">ดูแลสำเร็จ/กลับมาเรียน</div>
          </div>
        </div>
      </div>

      <!-- Urgent Action Queue (เคสด่วนที่ต้องดำเนินการ) -->
      <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2.5">
            <span class="flex h-3 w-3 relative">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </span>
            <h2 class="text-base font-bold text-slate-800">เคสด่วนที่ครูที่ปรึกษาต้องติดต่อติดตาม (Urgent Care Queue)</h2>
          </div>
          <span class="text-xs text-slate-500 font-medium">พบกลุ่มเสี่ยงเร่งด่วน ${urgentStudents.length} รายการ</span>
        </div>

        <div class="space-y-3">
          ${urgentStudents.length === 0 ? `
            <div class="text-center py-8 text-slate-400">
              <i class="fa-solid fa-face-smile text-3xl mb-2 text-emerald-500"></i>
              <p>ยอดเยี่ยม! ไม่มีเคสที่มีความเสี่ยงวิกฤตคั่งค้างในขณะนี้</p>
            </div>
          ` : urgentStudents.map(st => {
            const { attendanceRate } = calculateStudentMetrics(st);
            const isDanger = st.riskLevel === 'danger' || st.absent >= 4;
            return `
              <div class="flex flex-col md:flex-row md:items-center justify-between p-3.5 rounded-xl border ${isDanger ? 'border-red-200 bg-red-50/40' : 'border-amber-200 bg-amber-50/40'} gap-3 hover:shadow-sm transition">
                <div class="flex items-start gap-3">
                  <div class="w-10 h-10 rounded-full ${st.avatarBg} text-white flex items-center justify-center font-bold text-sm shrink-0 mt-0.5">
                    ${st.firstName.charAt(0)}
                  </div>
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-bold text-slate-800">${st.prefix}${st.firstName} ${st.lastName}</span>
                      <span class="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">${st.studentCode}</span>
                      <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${isDanger ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">
                        ${isDanger ? '🚨 วิกฤต: เสี่ยงหมดสิทธิ์สอบ' : '⚠️ เฝ้าระวัง'}
                      </span>
                    </div>
                    <div class="text-xs text-slate-600 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      <span><i class="fa-solid fa-graduation-cap text-slate-400 mr-1"></i>${st.classroom}</span>
                      <span><i class="fa-solid fa-user-tie text-slate-400 mr-1"></i>ครูที่ปรึกษา: <strong class="text-slate-700">${st.advisorName}</strong></span>
                      <span><i class="fa-solid fa-phone text-slate-400 mr-1"></i>ผู้ปกครอง: <strong class="text-slate-700">${st.parentPhone}</strong> (${st.parentName})</span>
                    </div>
                    <div class="text-xs font-medium mt-1 flex flex-wrap items-center gap-1.5">
                      <span class="text-red-600"><i class="fa-solid fa-triangle-exclamation mr-1"></i>สาเหตุเบื้องต้น:</span>
                      ${st.primaryRiskReason && st.primaryRiskReason !== '-' ? `
                        <span class="px-2.5 py-0.5 rounded-full bg-red-100 text-red-800 font-bold">${st.primaryRiskReason}</span>
                      ` : `
                        <button onclick="openCareLogModal('${st.id}')" class="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-0.5 rounded-full border border-blue-200 font-bold transition">
                          <i class="fa-solid fa-pen-to-square mr-1"></i> ยังไม่ระบุสาเหตุ (คลิกเพื่อบันทึก)
                        </button>
                      `}
                      <span class="text-slate-500">(ขาดแล้ว ${st.absent} คาบ, เวลาเรียนเหลือ ${attendanceRate}%)</span>
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-2 shrink-0 self-end md:self-center">
                  <a href="tel:${st.parentPhone}" class="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-sm transition">
                    <i class="fa-solid fa-phone-volume text-emerald-600"></i> โทรหาผู้ปกครอง
                  </a>
                  <button onclick="openCareLogModal('${st.id}')" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition">
                    <i class="fa-solid fa-notes-medical"></i> บันทึกการดูแล
                  </button>
                  <button onclick="sendLineAlertDirect('${st.id}')" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition" title="ส่ง LINE แจ้งเตือนครูที่ปรึกษา">
                    <i class="fa-brands fa-line"></i> แจ้ง LINE
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Analytics Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Root causes chart -->
        <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
              <i class="fa-solid fa-chart-pie text-blue-600"></i> ปัจจัยและสาเหตุการขาดเรียนหลักที่พบ
            </h3>
            <span class="text-xs text-slate-400">จากการลงพื้นที่และโทรติดตาม</span>
          </div>
          <div class="relative h-64 flex items-center justify-center">
            <canvas id="chart-causes"></canvas>
          </div>
        </div>

        <!-- Risk distribution by classroom -->
        <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
              <i class="fa-solid fa-chart-simple text-indigo-600"></i> นักศึกษากลุ่มเสี่ยงจำแนกตามแผนก/ห้องเรียน
            </h3>
            <span class="text-xs text-slate-400">เปรียบเทียบระดับความเสี่ยง</span>
          </div>
          <div class="relative h-64">
            <canvas id="chart-departments"></canvas>
          </div>
        </div>
      </div>

      <!-- Quick Tips & Early Warning Guidelines -->
      <div class="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-5">
        <h3 class="font-bold text-amber-900 text-sm flex items-center gap-2 mb-2">
          <i class="fa-solid fa-lightbulb text-amber-600"></i> เกณฑ์มาตรฐานการส่งต่อและช่วยเหลือ (Standard Early Warning Protocol)
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-amber-950 mt-3">
          <div class="bg-white/80 p-3 rounded-xl border border-amber-200">
            <div class="font-bold text-amber-800 flex items-center gap-1.5 mb-1">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span> 1. ระดับเฝ้าระวัง (ขาด 2-3 ครั้ง)
            </div>
            <p class="text-slate-600">ครูที่ปรึกษาทักทายพูดคุยส่วนตัว สังเกตพฤติกรรม สอบถามปัญหาการเดินทาง หรือติดธุระส่วนตัว</p>
          </div>
          <div class="bg-white/80 p-3 rounded-xl border border-red-200">
            <div class="font-bold text-red-800 flex items-center gap-1.5 mb-1">
              <span class="w-2.5 h-2.5 rounded-full bg-red-500"></span> 2. ระดับวิกฤต (ขาด 4 ครั้งขึ้นไป)
            </div>
            <p class="text-slate-600">โทรแจ้งผู้ปกครองโดยตรง ทำบันทึกการดูแล ประสานงานพิจารณาทุน กยศ./ทุนอาหารกลางวันฉุกเฉิน</p>
          </div>
          <div class="bg-white/80 p-3 rounded-xl border border-purple-200">
            <div class="font-bold text-purple-800 flex items-center gap-1.5 mb-1">
              <span class="w-2.5 h-2.5 rounded-full bg-purple-500"></span> 3. ระดับส่งต่อพิเศษ (ติดต่อไม่ได้ 3 วัน)
            </div>
            <p class="text-slate-600">ส่งต่อฝ่ายกิจการนักเรียนและทีมจิตวิทยาแนะแนว พร้อมวางแผนลงพื้นที่เยี่ยมบ้านด่วน</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render Charts
  setTimeout(() => {
    initDashboardCharts();
  }, 100);
}

function initDashboardCharts() {
  // Chart 1: Root causes (Dynamically calculated from real students & care logs)
  const ctxCauses = document.getElementById('chart-causes');
  if (ctxCauses) {
    if (appState.charts.causes) appState.charts.causes.destroy();

    const causeCounts = {};
    data.students.forEach(s => {
      let cause = s.primaryRiskReason;

      // หากยังไม่ได้ระบุ ให้ลองค้นหาจากบันทึกการดูแลของนักศึกษาคนนี้
      if (!cause || cause === '-' || cause === '') {
        const relatedLog = data.careLogs.find(l => l.studentId === s.id || l.studentCode === s.studentCode);
        if (relatedLog && relatedLog.details && relatedLog.details !== '-') {
          cause = relatedLog.details;
          s.primaryRiskReason = cause; // อัปเดตคืนให้นักศึกษา
        } else if (s.riskLevel === 'danger' || s.riskLevel === 'warning') {
          cause = 'รอระบุสาเหตุ (อยู่ระหว่างติดตาม)';
        }
      }

      if (cause && cause !== '-' && cause !== '') {
        causeCounts[cause] = (causeCounts[cause] || 0) + 1;
      }
    });

    let labels = Object.keys(causeCounts);
    let values = Object.values(causeCounts);
    const hasData = labels.length > 0;

    if (!hasData) {
      labels = ['รอการบันทึกข้อมูลสาเหตุ'];
      values = [1];
    }

    const defaultColors = ['#ef4444', '#8b5cf6', '#f59e0b', '#3b82f6', '#ec4899', '#10b981', '#06b6d4'];

    appState.charts.causes = new Chart(ctxCauses, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: hasData ? defaultColors.slice(0, labels.length) : ['#e2e8f0'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: window.innerWidth < 640 ? 'bottom' : 'right',
            onClick: null, // ปิดการคลิกที่ป้ายชื่อ ป้องกันผู้ใช้สับสน
            onHover: (event) => {
              if (event && event.native && event.native.target) {
                event.native.target.style.cursor = 'default';
              }
            },
            labels: {
              font: { family: "'Prompt', sans-serif", size: 11 },
              boxWidth: 12,
              padding: 10,
              usePointStyle: true
            }
          }
        },
        cutout: '65%'
      }
    });
  }

  // Chart 2: Department risk distribution (Dynamically calculated from real data)
  const ctxDepts = document.getElementById('chart-departments');
  if (ctxDepts) {
    if (appState.charts.depts) appState.charts.depts.destroy();

    const classLabels = data.classrooms.map(c => c.name);
    const dangerData = [];
    const warningData = [];
    const resolvedData = [];

    data.classrooms.forEach(c => {
      const classStudents = data.students.filter(s => s.classId === c.id);
      let dCount = 0;
      let wCount = 0;
      let rCount = 0;

      classStudents.forEach(st => {
        const { riskLevel } = calculateStudentMetrics(st);
        if (riskLevel === 'danger') dCount++;
        else if (riskLevel === 'warning') wCount++;
        else if (riskLevel === 'resolved') rCount++;
      });

      dangerData.push(dCount);
      warningData.push(wCount);
      resolvedData.push(rCount);
    });

    appState.charts.depts = new Chart(ctxDepts, {
      type: 'bar',
      data: {
        labels: classLabels,
        datasets: [
          {
            label: 'กลุ่มวิกฤต (คน)',
            data: dangerData,
            backgroundColor: '#ef4444',
            borderRadius: 6
          },
          {
            label: 'กลุ่มเฝ้าระวัง (คน)',
            data: warningData,
            backgroundColor: '#f59e0b',
            borderRadius: 6
          },
          {
            label: 'ดูแลสำเร็จแล้ว (คน)',
            data: resolvedData,
            backgroundColor: '#10b981',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            ticks: { font: { family: "'Prompt', sans-serif", size: 11 } },
            grid: { display: false }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { stepSize: 1, font: { family: "'Prompt', sans-serif" } },
            grid: { color: '#f1f5f9' }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            onClick: null, // ปิดการคลิกเพื่อไม่ให้สับสน
            onHover: (event) => {
              if (event && event.native && event.native.target) {
                event.native.target.style.cursor = 'default';
              }
            },
            labels: { font: { family: "'Prompt', sans-serif", size: 11 }, boxWidth: 12 }
          }
        }
      }
    });
  }
}

// -------------------------------------------------------------
// TAB 2: STUDENTS MONITOR & CASE DIRECTORY
// -------------------------------------------------------------
function renderStudentsTab() {
  const container = document.getElementById('main-content');

  // Filter students
  const filteredStudents = data.students.filter(st => {
    const { riskLevel } = calculateStudentMetrics(st);
    
    // Class filter
    if (appState.selectedClassFilter !== 'all' && st.classId !== appState.selectedClassFilter) {
      return false;
    }

    // Risk filter
    if (appState.selectedRiskFilter !== 'all') {
      if (appState.selectedRiskFilter === 'danger' && riskLevel !== 'danger') return false;
      if (appState.selectedRiskFilter === 'warning' && riskLevel !== 'warning') return false;
      if (appState.selectedRiskFilter === 'safe' && riskLevel !== 'safe') return false;
      if (appState.selectedRiskFilter === 'resolved' && riskLevel !== 'resolved') return false;
    }

    // Search query
    if (appState.searchQuery) {
      const q = appState.searchQuery;
      const fullName = `${st.prefix}${st.firstName} ${st.lastName}`.toLowerCase();
      const code = st.studentCode.toLowerCase();
      const adv = st.advisorName.toLowerCase();
      const room = st.classroom.toLowerCase();
      if (!fullName.includes(q) && !code.includes(q) && !adv.includes(q) && !room.includes(q)) {
        return false;
      }
    }

    return true;
  });

  container.innerHTML = `
    <div class="space-y-6">
      <!-- Header & Action controls -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-slate-800">รายชื่อนักศึกษาและสถานะความเสี่ยง</h1>
          <p class="text-sm text-slate-500">ระบบคัดกรองนักศึกษาที่ขาดเรียนบ่อยรายบุคคล พร้อมบันทึกการส่งต่อความช่วยเหลือ</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="exportStudentsCSV()" class="px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold shadow-sm transition flex items-center gap-2">
            <i class="fa-solid fa-file-excel text-emerald-600"></i> ส่งออกข้อมูล CSV
          </button>
          <button onclick="openAddStudentModal()" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition flex items-center gap-2">
            <i class="fa-solid fa-user-plus"></i> เพิ่มนักศึกษาใหม่
          </button>
        </div>
      </div>

      <!-- Filters Bar -->
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <!-- Search -->
        <div class="relative flex-1">
          <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
          <input 
            type="text" 
            placeholder="ค้นหาชื่อ, รหัสนักศึกษา, ครูที่ปรึกษา..." 
            value="${appState.searchQuery}"
            oninput="appState.searchQuery = this.value.toLowerCase().trim(); renderStudentsTab();"
            class="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
          />
        </div>

        <!-- Class Filter -->
        <div class="flex items-center gap-2">
          <label class="text-xs text-slate-500 font-medium shrink-0">ห้องเรียน:</label>
          <select 
            onchange="appState.selectedClassFilter = this.value; renderStudentsTab();"
            class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-700"
          >
            <option value="all" ${appState.selectedClassFilter === 'all' ? 'selected' : ''}>ทุกห้องเรียน</option>
            ${data.classrooms.map(c => `
              <option value="${c.id}" ${appState.selectedClassFilter === c.id ? 'selected' : ''}>${c.name}</option>
            `).join('')}
          </select>
        </div>

        <!-- Risk Filter Buttons -->
        <div class="flex flex-wrap items-center gap-1.5">
          <button 
            onclick="appState.selectedRiskFilter = 'all'; renderStudentsTab();"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${appState.selectedRiskFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
          >
            ทั้งหมด (${data.students.length})
          </button>
          <button 
            onclick="appState.selectedRiskFilter = 'danger'; renderStudentsTab();"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${appState.selectedRiskFilter === 'danger' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'}"
          >
            🚨 วิกฤต
          </button>
          <button 
            onclick="appState.selectedRiskFilter = 'warning'; renderStudentsTab();"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${appState.selectedRiskFilter === 'warning' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}"
          >
            ⚠️ เฝ้าระวัง
          </button>
          <button 
            onclick="appState.selectedRiskFilter = 'resolved'; renderStudentsTab();"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${appState.selectedRiskFilter === 'resolved' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}"
          >
            ✅ คลี่คลายแล้ว
          </button>
        </div>
      </div>

      <!-- Students Table -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm text-slate-600">
            <thead class="bg-slate-50/80 text-xs text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200">
              <tr>
                <th class="px-5 py-4">ข้อมูลนักศึกษา</th>
                <th class="px-4 py-4">ห้องเรียน & ครูที่ปรึกษา</th>
                <th class="px-4 py-4">เวลาเรียนสะสม</th>
                <th class="px-4 py-4 text-center">สถิติ (ขาด/สาย)</th>
                <th class="px-4 py-4">ระดับความเสี่ยง</th>
                <th class="px-4 py-4">สถานะการดูแล</th>
                <th class="px-5 py-4 text-right">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${filteredStudents.length === 0 ? `
                <tr>
                  <td colspan="7" class="px-5 py-12 text-center text-slate-400">
                    <i class="fa-solid fa-user-slash text-3xl mb-2 text-slate-300"></i>
                    <p>ไม่พบข้อมูลนักศึกษาตรงตามเงื่อนไขที่ค้นหา</p>
                  </td>
                </tr>
              ` : filteredStudents.map(st => {
                const { attendanceRate, riskLevel } = calculateStudentMetrics(st);
                
                // Risk Badge styling
                let riskBadge = '';
                if (riskLevel === 'danger') {
                  riskBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200"><span class="w-2 h-2 rounded-full bg-red-600"></span> วิกฤตเสี่ยงหลุด</span>`;
                } else if (riskLevel === 'warning') {
                  riskBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200"><span class="w-2 h-2 rounded-full bg-amber-500"></span> เฝ้าระวัง</span>`;
                } else if (riskLevel === 'resolved') {
                  riskBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"><span class="w-2 h-2 rounded-full bg-emerald-600"></span> คลี่คลายแล้ว</span>`;
                } else {
                  riskBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700"><span class="w-2 h-2 rounded-full bg-slate-400"></span> ปกติ</span>`;
                }

                // Case status
                let caseStatusBadge = '';
                if (st.caseStatus === 'in_progress') {
                  caseStatusBadge = `<span class="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold"><i class="fa-solid fa-spinner fa-spin-pulse mr-1"></i>กำลังติดตาม</span>`;
                } else if (st.caseStatus === 'escalated') {
                  caseStatusBadge = `<span class="text-xs px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold"><i class="fa-solid fa-arrow-up-right-dots mr-1"></i>ส่งต่อฝ่ายวิชาการ</span>`;
                } else if (st.caseStatus === 'resolved') {
                  caseStatusBadge = `<span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold"><i class="fa-solid fa-check mr-1"></i>ดูแลสำเร็จ</span>`;
                } else {
                  caseStatusBadge = `<span class="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">ยังไม่ได้ติดตาม</span>`;
                }

                // Progress Bar Color
                const barColor = attendanceRate < 80 ? 'bg-red-500' :
                                 attendanceRate < 85 ? 'bg-amber-500' : 'bg-emerald-500';

                return `
                  <tr class="hover:bg-slate-50/70 transition">
                    <!-- Student details -->
                    <td class="px-5 py-4">
                      <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full ${st.avatarBg} text-white flex items-center justify-center font-bold text-sm shrink-0">
                          ${st.firstName.charAt(0)}
                        </div>
                        <div>
                          <div class="font-bold text-slate-800 hover:text-blue-600 cursor-pointer" onclick="openStudentProfileModal('${st.id}')">
                            ${st.prefix}${st.firstName} ${st.lastName}
                          </div>
                          <div class="text-xs font-mono text-slate-400">${st.studentCode}</div>
                        </div>
                      </div>
                    </td>

                    <!-- Classroom & Advisor -->
                    <td class="px-4 py-4">
                      <div class="font-medium text-slate-800">${st.classroom}</div>
                      <div class="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <i class="fa-solid fa-user-tie text-slate-400"></i> ${st.advisorName}
                      </div>
                    </td>

                    <!-- Attendance Rate -->
                    <td class="px-4 py-4 w-44">
                      <div class="flex items-center justify-between text-xs font-semibold mb-1">
                        <span class="${attendanceRate < 80 ? 'text-red-600 font-bold' : 'text-slate-700'}">${attendanceRate}%</span>
                        <span class="text-[11px] text-slate-400">${st.attended}/${st.totalClasses} คาบ</span>
                      </div>
                      <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div class="${barColor} h-2 rounded-full" style="width: ${attendanceRate}%"></div>
                      </div>
                      ${attendanceRate < 80 ? '<div class="text-[10px] text-red-600 font-semibold mt-0.5">ต่ำกว่า 80% เสี่ยง มส.</div>' : ''}
                    </td>

                    <!-- Counts -->
                    <td class="px-4 py-4 text-center">
                      <div class="inline-flex items-center gap-2 text-xs">
                        <span class="px-2 py-0.5 rounded ${st.absent > 0 ? 'bg-red-100 text-red-700 font-bold' : 'bg-slate-100 text-slate-600'}">
                          ขาด ${st.absent}
                        </span>
                        <span class="px-2 py-0.5 rounded ${st.late > 0 ? 'bg-amber-100 text-amber-700 font-medium' : 'bg-slate-100 text-slate-500'}">
                          สาย ${st.late}
                        </span>
                      </div>
                      ${st.consecutiveAbsent > 1 ? `
                        <div class="text-[10px] text-red-600 font-bold mt-1">ขาดติดกัน ${st.consecutiveAbsent} วัน!</div>
                      ` : ''}
                    </td>

                    <!-- Risk level -->
                    <td class="px-4 py-4">
                      ${riskBadge}
                    </td>

                    <!-- Case status -->
                    <td class="px-4 py-4">
                      ${caseStatusBadge}
                    </td>

                    <!-- Actions -->
                    <td class="px-5 py-4 text-right">
                      <div class="flex items-center justify-end gap-1.5">
                        <button onclick="openStudentProfileModal('${st.id}')" class="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="ดูประวัติครบถ้วน">
                          <i class="fa-solid fa-id-card"></i>
                        </button>
                        <button onclick="openCareLogModal('${st.id}')" class="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-700 rounded-lg text-xs font-semibold transition flex items-center gap-1">
                          <i class="fa-solid fa-notes-medical"></i> ดูแล
                        </button>
                        <button onclick="sendLineAlertDirect('${st.id}')" class="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="ส่ง LINE แจ้งครูที่ปรึกษา">
                          <i class="fa-brands fa-line text-lg"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// TAB 3: ATTENDANCE CHECK-IN (ระบบเช็คชื่อเข้าเรียน)
// -------------------------------------------------------------
function initAttendanceDefaults() {
  // Populate attendance initial status
  const studentsInClass = data.students.filter(st => st.classId === appState.activeClassroomForAttendance);
  studentsInClass.forEach(st => {
    if (!appState.currentAttendanceState[st.id]) {
      appState.currentAttendanceState[st.id] = 'present';
    }
  });
}

function renderAttendanceTab() {
  const container = document.getElementById('main-content');
  const studentsInClass = data.students.filter(st => st.classId === appState.activeClassroomForAttendance);
  const selectedCourse = data.courses.find(c => c.id === appState.activeCourseForAttendance) || data.courses[0];
  const selectedClass = data.classrooms.find(c => c.id === appState.activeClassroomForAttendance) || data.classrooms[0];

  container.innerHTML = `
    <div class="space-y-6">
      <!-- Title & Classroom Selector -->
      <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h1 class="text-2xl font-bold text-slate-800">ระบบบันทึกเวลาเรียนประจำคาบ</h1>
            <p class="text-sm text-slate-500">เช็คชื่อเข้าเรียนเพื่อตรวจจับนักศึกษาขาดเรียน และแจ้งเตือนครูที่ปรึกษาโดยอัตโนมัติ</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-semibold">
              <i class="fa-solid fa-shield-halved"></i> ระบบแจ้งเตือนอัตโนมัติเปิดใช้งานอยู่
            </span>
          </div>
        </div>

        <!-- Selection Controls -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Select Class -->
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1.5">ห้องเรียน / ระดับชั้น</label>
            <select 
              id="att-class-select"
              onchange="onAttendanceClassChange(this.value)"
              class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              ${data.classrooms.map(c => `
                <option value="${c.id}" ${c.id === appState.activeClassroomForAttendance ? 'selected' : ''}>${c.name}</option>
              `).join('')}
            </select>
          </div>

          <!-- Select Course -->
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1.5">รายวิชา</label>
            <select 
              id="att-course-select"
              onchange="appState.activeCourseForAttendance = this.value; renderAttendanceTab();"
              class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              ${data.courses.map(c => `
                <option value="${c.id}" ${c.id === appState.activeCourseForAttendance ? 'selected' : ''}>${c.code} - ${c.name}</option>
              `).join('')}
            </select>
          </div>

          <!-- Select Date -->
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1.5">วันที่เช็คชื่อ</label>
            <input 
              type="date" 
              value="${appState.currentAttendanceDate}"
              onchange="appState.currentAttendanceDate = this.value;"
              class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <!-- Instructor banner -->
        <div class="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
          <div class="flex items-center gap-3">
            <span><i class="fa-solid fa-chalkboard-user text-blue-500 mr-1"></i>อาจารย์ผู้สอน: <strong>${selectedCourse.instructor}</strong></span>
            <span><i class="fa-solid fa-clock text-indigo-500 mr-1"></i>สัปดาห์ที่: <strong>${selectedCourse.currentWeek} จาก ${selectedCourse.totalHours} สัปดาห์</strong></span>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="markAllAttendance('present')" class="px-3 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg font-semibold transition">
              <i class="fa-solid fa-check-double mr-1"></i> มาครบทุกคน
            </button>
            <button onclick="markAllAttendance('absent')" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition">
              รีเซ็ต
            </button>
          </div>
        </div>
      </div>

      <!-- Attendance Sheet Table -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
          <span class="font-bold text-slate-700 text-sm">
            รายชื่อนักศึกษาในห้อง (${studentsInClass.length} คน)
          </span>
          <span class="text-xs text-slate-500">คลิกสถานะเพื่อสลับ มา / สาย / ลา / ขาด</span>
        </div>

        <div class="divide-y divide-slate-100">
          ${studentsInClass.length === 0 ? `
            <div class="p-8 text-center text-slate-400">
              ไม่พบนักศึกษาในห้องเรียนนี้
            </div>
          ` : studentsInClass.map((st, idx) => {
            const currentStatus = appState.currentAttendanceState[st.id] || 'present';
            const { attendanceRate } = calculateStudentMetrics(st);
            return `
              <div class="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50 transition">
                <div class="flex items-center gap-3">
                  <span class="text-xs font-mono text-slate-400 w-6">${idx + 1}.</span>
                  <div class="w-9 h-9 rounded-full ${st.avatarBg} text-white flex items-center justify-center font-bold text-xs shrink-0">
                    ${st.firstName.charAt(0)}
                  </div>
                  <div>
                    <div class="font-bold text-slate-800 text-sm flex items-center gap-2">
                      ${st.prefix}${st.firstName} ${st.lastName}
                      <span class="text-xs font-mono font-normal text-slate-400">(${st.studentCode})</span>
                    </div>
                    <div class="text-xs text-slate-500 flex items-center gap-3 mt-0.5">
                      <span>เวลาเรียนสะสมเดิม: <strong class="${attendanceRate < 80 ? 'text-red-600' : 'text-slate-700'}">${attendanceRate}%</strong> (ขาด ${st.absent} คาบ)</span>
                      ${st.consecutiveAbsent > 0 ? `<span class="text-red-500 font-semibold"><i class="fa-solid fa-triangle-exclamation"></i> ขาดมาแล้ว ${st.consecutiveAbsent} วัน</span>` : ''}
                    </div>
                  </div>
                </div>

                <!-- Status Buttons -->
                <div class="flex items-center gap-1.5 self-end md:self-center">
                  <!-- Present -->
                  <button 
                    type="button"
                    onclick="setStudentAttendance('${st.id}', 'present')"
                    class="att-btn px-3 py-1.5 rounded-xl text-xs font-bold border transition ${currentStatus === 'present' ? 'active-present' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-emerald-50'}"
                  >
                    <i class="fa-solid fa-check mr-1"></i> มา
                  </button>

                  <!-- Late -->
                  <button 
                    type="button"
                    onclick="setStudentAttendance('${st.id}', 'late')"
                    class="att-btn px-3 py-1.5 rounded-xl text-xs font-bold border transition ${currentStatus === 'late' ? 'active-late' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-amber-50'}"
                  >
                    <i class="fa-solid fa-clock mr-1"></i> สาย
                  </button>

                  <!-- Leave -->
                  <button 
                    type="button"
                    onclick="setStudentAttendance('${st.id}', 'leave')"
                    class="att-btn px-3 py-1.5 rounded-xl text-xs font-bold border transition ${currentStatus === 'leave' ? 'active-leave' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-blue-50'}"
                  >
                    <i class="fa-solid fa-file-signature mr-1"></i> ลา
                  </button>

                  <!-- Absent -->
                  <button 
                    type="button"
                    onclick="setStudentAttendance('${st.id}', 'absent')"
                    class="att-btn px-3 py-1.5 rounded-xl text-xs font-bold border transition ${currentStatus === 'absent' ? 'active-absent' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-red-50'}"
                  >
                    <i class="fa-solid fa-xmark mr-1"></i> ขาด
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Submit Button Footer -->
        <div class="p-4 bg-slate-50 border-t border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
          <div class="text-xs text-slate-500">
            <i class="fa-solid fa-circle-info text-blue-500 mr-1"></i> เมื่อกดบันทึก ระบบจะคำนวณสถิติสะสม และหากพบนักศึกษาขาดเกินเกณฑ์จะส่งสัญญาณแจ้งเตือนครูที่ปรึกษาทันที
          </div>
          <button 
            onclick="submitAttendanceBatch()"
            class="w-full md:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-md shadow-blue-600/30 transition flex items-center justify-center gap-2"
          >
            <i class="fa-solid fa-cloud-arrow-up"></i> บันทึกผลการเช็คชื่อ & ประมวลผลแจ้งเตือน
          </button>
        </div>
      </div>
    </div>
  `;
}

function onAttendanceClassChange(classId) {
  appState.activeClassroomForAttendance = classId;
  initAttendanceDefaults();
  renderAttendanceTab();
}

function setStudentAttendance(studentId, status) {
  appState.currentAttendanceState[studentId] = status;
  renderAttendanceTab();
}

function markAllAttendance(status) {
  const studentsInClass = data.students.filter(st => st.classId === appState.activeClassroomForAttendance);
  studentsInClass.forEach(st => {
    appState.currentAttendanceState[st.id] = status;
  });
  renderAttendanceTab();
}

// Submit attendance and run Rule Engine
function submitAttendanceBatch() {
  const studentsInClass = data.students.filter(st => st.classId === appState.activeClassroomForAttendance);
  const selectedCourse = data.courses.find(c => c.id === appState.activeCourseForAttendance) || data.courses[0];
  
  let absentTriggered = [];

  studentsInClass.forEach(st => {
    const status = appState.currentAttendanceState[st.id] || 'present';
    if (status === 'absent') {
      st.absent = (st.absent || 0) + 1;
      st.consecutiveAbsent = (st.consecutiveAbsent || 0) + 1;
      st.lastAbsendDate = appState.currentAttendanceDate;

      // Check early warning triggers
      const { attendanceRate } = calculateStudentMetrics(st);
      if (st.absent >= 4 || st.consecutiveAbsent >= 3 || attendanceRate < 80) {
        st.riskLevel = 'danger';
        absentTriggered.push({
          student: st,
          reason: `ขาดสะสม ${st.absent} ครั้ง (เวลาเรียนเหลือ ${attendanceRate}%)`,
          level: 'danger'
        });
      } else if (st.absent >= 2) {
        st.riskLevel = 'warning';
        absentTriggered.push({
          student: st,
          reason: `ขาดสะสม ${st.absent} ครั้ง (เริ่มเข้าสู่กลุ่มเฝ้าระวัง)`,
          level: 'warning'
        });
      }
    } else if (status === 'late') {
      st.late = (st.late || 0) + 1;
      st.consecutiveAbsent = 0;
    } else if (status === 'leave') {
      st.leave = (st.leave || 0) + 1;
      st.consecutiveAbsent = 0;
    } else if (status === 'present') {
      st.attended = (st.attended || 0) + 1;
      st.consecutiveAbsent = 0;
    }
  });

  // Create notifications if any triggered
  if (absentTriggered.length > 0) {
    absentTriggered.forEach(item => {
      const newAlert = {
        id: "ALT" + Date.now() + Math.floor(Math.random() * 100),
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
        studentId: item.student.id,
        studentName: `${item.student.prefix}${item.student.firstName} ${item.student.lastName}`,
        studentCode: item.student.studentCode,
        courseCode: selectedCourse.code,
        courseName: selectedCourse.name,
        advisorId: item.student.advisorId,
        advisorName: item.student.advisorName,
        level: item.level,
        type: item.level === 'danger' ? 'danger_absence' : 'warning_absence',
        title: item.level === 'danger' ? '🚨 แจ้งเตือนวิกฤต: เวลาเรียนต่ำกว่าเกณฑ์' : '⚠️ แจ้งเตือนเฝ้าระวัง: ขาดเรียนใหม่',
        message: `${item.student.prefix}${item.student.firstName} ${item.student.lastName} (${item.student.classroom}) ${item.reason} ในวิชา ${selectedCourse.name} ครูที่ปรึกษาควรติดต่อดูแล`,
        isRead: false,
        lineSent: true
      };
      data.alerts.unshift(newAlert);
      if (typeof syncAlertToSupabase === 'function') {
        syncAlertToSupabase(newAlert);
      }
    });

    playAlertBeep();
    showToast(`ตรวจพบนักศึกษาเสี่ยง ${absentTriggered.length} ราย ส่งแจ้งเตือนครูที่ปรึกษาแล้ว!`, 'danger');
  } else {
    showToast('บันทึกการเข้าเรียนเรียบร้อย ทุกคนมาเรียนตามปกติ', 'success');
  }

  // Sync attendance records and student updates to Supabase
  const attRecords = studentsInClass.map(st => ({
    student_code: st.studentCode,
    student_name: `${st.prefix}${st.firstName} ${st.lastName}`,
    course_code: selectedCourse.code,
    course_name: selectedCourse.name,
    class_id: appState.activeClassroomForAttendance,
    date: appState.currentAttendanceDate,
    status: appState.currentAttendanceState[st.id] || 'present',
    recorded_by: selectedCourse.instructor || ''
  }));

  if (typeof syncAttendanceRecordToSupabase === 'function') {
    syncAttendanceRecordToSupabase(attRecords);
  }
  studentsInClass.forEach(st => {
    if (typeof syncStudentToSupabase === 'function') {
      syncStudentToSupabase(st);
    }
  });

  saveAppData(data);
  updateNotificationBadge();
  renderAttendanceTab();
}

// -------------------------------------------------------------
// TAB 4: CARE LOGS (บันทึกการดูแลและส่งต่อ)
// -------------------------------------------------------------
function renderCareLogsTab() {
  const container = document.getElementById('main-content');

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight">บันทึกการดูแลช่วยเหลือ (Care Logs)</h1>
          <p class="text-xs sm:text-sm text-slate-500 mt-1">ประวัติการติดตาม พูดคุยกับผู้ปกครอง และผลลัพธ์การดูแลเพื่อป้องกันการหลุดจากระบบ</p>
        </div>
        <div>
          <button onclick="openCareLogModal()" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition flex items-center gap-2">
            <i class="fa-solid fa-plus"></i> เพิ่มบันทึกการดูแลใหม่
          </button>
        </div>
      </div>

      <!-- Logs Timeline List -->
      <div class="space-y-4">
        ${data.careLogs.length === 0 ? `
          <div class="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400">
            <i class="fa-solid fa-book-open text-4xl mb-3 text-slate-300"></i>
            <p>ยังไม่มีบันทึกการติดตามดูแล</p>
          </div>
        ` : data.careLogs.map(log => {
          const isResolved = log.status === 'resolved';
          const isEscalated = log.status === 'escalated';

          let statusBadgeClass = 'bg-blue-100 text-blue-700 border-blue-200';
          if (isResolved) statusBadgeClass = 'bg-emerald-100 text-emerald-700 border-emerald-200';
          if (isEscalated) statusBadgeClass = 'bg-purple-100 text-purple-700 border-purple-200';

          return `
            <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition">
              <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-lg font-bold">
                    <i class="fa-solid fa-hand-holding-heart"></i>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-bold text-slate-800 text-base">${log.studentName}</span>
                      <span class="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600">${log.studentCode}</span>
                      <span class="text-xs px-2.5 py-0.5 rounded-full font-semibold border ${statusBadgeClass}">
                        ${log.statusLabel || log.status}
                      </span>
                    </div>
                    <div class="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-4">
                      <span><i class="fa-regular fa-calendar mr-1"></i>วันที่ติดตาม: <strong>${log.date} ${log.time || ''}</strong></span>
                      <span><i class="fa-solid fa-user-tie mr-1"></i>ผู้ดูแล: <strong>${log.advisorName}</strong></span>
                      <span><i class="fa-solid fa-satellite-dish mr-1"></i>ช่องทาง: <strong>${log.channelLabel || log.contactChannel}</strong></span>
                    </div>
                  </div>
                </div>
                
                <div class="text-xs text-slate-400 self-end md:self-center font-mono">
                  #${log.id}
                </div>
              </div>

              <!-- Log Body -->
              <div class="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <div class="font-bold text-slate-700 flex items-center gap-1.5 mb-1.5">
                    <i class="fa-solid fa-circle-exclamation text-amber-500"></i> สาเหตุและสภาพปัญหาที่พบ:
                  </div>
                  <p class="text-slate-600 leading-relaxed">${log.details}</p>
                </div>

                <div class="bg-emerald-50/50 p-3.5 rounded-xl border border-emerald-100">
                  <div class="font-bold text-emerald-800 flex items-center gap-1.5 mb-1.5">
                    <i class="fa-solid fa-check text-emerald-600"></i> แนวทางและมาตรการช่วยเหลือที่ดำเนินการ:
                  </div>
                  <p class="text-slate-700 whitespace-pre-line leading-relaxed">${log.actionTaken}</p>
                  ${log.nextFollowUpDate && log.nextFollowUpDate !== '-' ? `
                    <div class="mt-2 pt-2 border-t border-emerald-200/60 font-semibold text-emerald-800 flex items-center gap-1">
                      <i class="fa-regular fa-clock"></i> นัดติดตามผลรอบถัดไป: ${log.nextFollowUpDate}
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// TAB 5: FORMAL REPORT (แบบรายงานสรุปทางการ)
// -------------------------------------------------------------
function renderReportTab() {
  const container = document.getElementById('main-content');

  // Metrics
  const dangerStudents = data.students.filter(st => {
    const { riskLevel } = calculateStudentMetrics(st);
    return riskLevel === 'danger';
  });
  const warningStudents = data.students.filter(st => {
    const { riskLevel } = calculateStudentMetrics(st);
    return riskLevel === 'warning';
  });
  const resolvedStudents = data.students.filter(st => st.caseStatus === 'resolved');

  container.innerHTML = `
    <div class="space-y-6">
      <!-- Toolbar (Hidden in Print) -->
      <div class="no-print flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 class="text-xl font-bold text-slate-800">แบบรายงานสรุปผลการติดตามนักศึกษาขาดเรียนเชิงรุก</h1>
          <p class="text-xs text-slate-500">สำหรับนำเสนอคณะกรรมการสถานศึกษาและการประชุมครูที่ปรึกษา</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="window.print()" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md shadow-blue-600/30 transition flex items-center gap-2">
            <i class="fa-solid fa-print"></i> พิมพ์รายงาน / บันทึกเป็น PDF
          </button>
        </div>
      </div>

      <!-- Printable Report Sheet -->
      <div class="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm max-w-4xl mx-auto space-y-6">
        <!-- Official Header -->
        <div class="text-center pb-6 border-b border-slate-300">
          <img src="logo.png" alt="ตราประจำวิทยาลัยการอาชีพเวียงสระ" class="w-20 h-20 mx-auto mb-3 object-contain drop-shadow-sm">
          <div class="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">รายงานผลการดำเนินงาน</div>
          <h2 class="text-xl font-bold text-slate-900">${data.schoolName}</h2>
          <h3 class="text-base font-semibold text-slate-700 mt-1">รายงานสรุปผลการติดตามดูแลนักศึกษาขาดเรียนบ่อยเพื่อป้องกันการตกหล่นจากระบบ</h3>
          <p class="text-xs text-slate-500 mt-2">
            ประจำ ${data.semester} | ข้อมูล ณ วันที่ ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <!-- Summary Stats Boxes -->
        <div class="grid grid-cols-4 gap-3 text-center">
          <div class="p-3 border border-slate-200 rounded-xl">
            <div class="text-xl font-bold text-slate-800">${data.students.length}</div>
            <div class="text-xs text-slate-500">นักศึกษาทั้งหมด</div>
          </div>
          <div class="p-3 border border-red-200 bg-red-50/50 rounded-xl">
            <div class="text-xl font-bold text-red-600">${dangerStudents.length}</div>
            <div class="text-xs text-red-700">กลุ่มวิกฤต (ขาด >= 4 ครั้ง)</div>
          </div>
          <div class="p-3 border border-amber-200 bg-amber-50/50 rounded-xl">
            <div class="text-xl font-bold text-amber-600">${warningStudents.length}</div>
            <div class="text-xs text-amber-700">กลุ่มเฝ้าระวัง (ขาด 2-3 ครั้ง)</div>
          </div>
          <div class="p-3 border border-emerald-200 bg-emerald-50/50 rounded-xl">
            <div class="text-xl font-bold text-emerald-600">${resolvedStudents.length}</div>
            <div class="text-xs text-emerald-700">แก้ไขสำเร็จ/กลับมาเรียน</div>
          </div>
        </div>

        <!-- High Risk Students Table -->
        <div>
          <h4 class="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-red-600"></span> 1. บัญชีรายชื่อนักศึกษากลุ่มเสี่ยงวิกฤตที่ต้องเฝ้าระวังเป็นกรณีพิเศษ
          </h4>
          <table class="w-full text-xs text-left border border-slate-300">
            <thead class="bg-slate-100 text-slate-700 font-bold border-b border-slate-300">
              <tr>
                <th class="p-2 border-r border-slate-300">ลำดับ</th>
                <th class="p-2 border-r border-slate-300">รหัสนักศึกษา</th>
                <th class="p-2 border-r border-slate-300">ชื่อ - สกุล</th>
                <th class="p-2 border-r border-slate-300">ห้องเรียน</th>
                <th class="p-2 border-r border-slate-300 text-center">ขาด (คาบ)</th>
                <th class="p-2 border-r border-slate-300 text-center">% เวลาเรียน</th>
                <th class="p-2 border-r border-slate-300">สาเหตุสำคัญ</th>
                <th class="p-2">ครูที่ปรึกษาผู้รับผิดชอบ</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${dangerStudents.map((st, i) => {
                const { attendanceRate } = calculateStudentMetrics(st);
                return `
                  <tr>
                    <td class="p-2 border-r border-slate-300 text-center font-mono">${i + 1}</td>
                    <td class="p-2 border-r border-slate-300 font-mono">${st.studentCode}</td>
                    <td class="p-2 border-r border-slate-300 font-bold text-slate-800">${st.prefix}${st.firstName} ${st.lastName}</td>
                    <td class="p-2 border-r border-slate-300">${st.classroom}</td>
                    <td class="p-2 border-r border-slate-300 text-center font-bold text-red-600">${st.absent}</td>
                    <td class="p-2 border-r border-slate-300 text-center font-bold text-red-600">${attendanceRate}%</td>
                    <td class="p-2 border-r border-slate-300 text-slate-600">${st.primaryRiskReason}</td>
                    <td class="p-2 font-medium text-slate-700">${st.advisorName}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Care & Support Actions Summary -->
        <div>
          <h4 class="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-blue-600"></span> 2. สรุปแนวทางการช่วยเหลือและมาตรการที่ดำเนินการไปแล้ว
          </h4>
          <div class="text-xs text-slate-600 space-y-2 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200">
            <p><strong>• ด้านเศรษฐกิจและทุนการศึกษา:</strong> อนุมัติทุนคูปองอาหารกลางวันฉุกเฉิน และประสานงานจัดหางาน Part-time หลังเลิกเรียนเพื่อลดความจำเป็นในการทำงานกะดึก</p>
            <p><strong>• ด้านการเรียนและเวลาเรียน:</strong> ประสานอาจารย์ผู้สอนประจำรายวิชาเปิดโอกาสให้นักศึกษาที่มีความจำเป็นทางครอบครัวส่งงานหรือแบบฝึกหัดเสริมเพื่อชดเชยเวลาเรียนก่อนปิดภาคเรียน</p>
            <p><strong>• ด้านสุขภาพจิตและสังคม:</strong> ส่งต่อนักศึกษาที่มีภาวะซึมเศร้าและความเครียดให้ศูนย์จิตวิทยาและแนะแนวดูแลอย่างใกล้ชิด</p>
          </div>
        </div>

        <!-- Official Signatures -->
        <div class="pt-10 grid grid-cols-2 gap-8 text-center text-xs text-slate-700 break-inside-avoid">
          <div class="space-y-12">
            <p>ลงชื่อ..........................................................<br>(..........................................................)<br>หัวหน้างานครูที่ปรึกษา วิทยาลัยการอาชีพเวียงสระ</p>
          </div>
          <div class="space-y-12">
            <p>ลงชื่อ..........................................................<br>(..........................................................)<br>รองผู้อำนวยการฝ่ายพัฒนากิจการนักเรียนนักศึกษา</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// MODALS & ACTIONS
// -------------------------------------------------------------

// Open Care Log Modal
function openCareLogModal(studentId = null) {
  const modal = document.getElementById('care-log-modal');
  if (!modal) return;

  const targetStudent = studentId ? data.students.find(s => s.id === studentId) : (data.students[0] || null);

  const studentSelectOptions = data.students.length > 0 ? data.students.map(s => `
    <option value="${s.id}" ${targetStudent && s.id === targetStudent.id ? 'selected' : ''}>
      ${s.studentCode} - ${s.prefix}${s.firstName} ${s.lastName} (${s.classroom})
    </option>
  `).join('') : '<option value="">-- ยังไม่มีรายชื่อนักศึกษาในระบบ --</option>';

  document.getElementById('care-modal-student-select').innerHTML = studentSelectOptions;
  document.getElementById('care-modal-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('care-modal-notes').value = targetStudent && targetStudent.primaryRiskReason && targetStudent.primaryRiskReason !== '-' ? `ติดตามกรณี: ${targetStudent.primaryRiskReason}` : '';
  document.getElementById('care-modal-action').value = '';

  const causeSelect = document.getElementById('care-modal-cause');
  if (causeSelect && targetStudent && targetStudent.primaryRiskReason && targetStudent.primaryRiskReason !== '-') {
    causeSelect.value = targetStudent.primaryRiskReason;
  }
  
  modal.classList.remove('hidden');
}

function closeCareLogModal() {
  const modal = document.getElementById('care-log-modal');
  if (modal) modal.classList.add('hidden');
}

function saveCareLogForm(event) {
  event.preventDefault();
  const studentId = document.getElementById('care-modal-student-select').value;
  const channel = document.getElementById('care-modal-channel').value;
  const date = document.getElementById('care-modal-date').value;
  const status = document.getElementById('care-modal-status').value;
  const notes = document.getElementById('care-modal-notes').value;
  const action = document.getElementById('care-modal-action').value;
  const followUpDate = document.getElementById('care-modal-followup').value || '-';

  const student = data.students.find(s => s.id === studentId);
  if (!student) return;

  const causeCategory = document.getElementById('care-modal-cause')?.value || 'ปัญหาการเงิน / ค่าครองชีพ';
  student.primaryRiskReason = causeCategory;

  const channelMap = {
    'phone_parent': 'โทรศัพท์ติดต่อผู้ปกครอง',
    'phone_student': 'โทรศัพท์พูดคุยกับนักศึกษา',
    'in_person': 'พูดคุยตัวต่อตัวที่ห้องพักครู',
    'visit_home': 'ลงพื้นที่เยี่ยมบ้าน',
    'line': 'พูดคุยผ่าน LINE / แชท'
  };

  const statusLabelMap = {
    'in_progress': 'กำลังติดตามต่อเนื่อง',
    'resolved': 'แก้ไขปัญหาสำเร็จ (กลับมาเรียนปกติ)',
    'escalated': 'ส่งต่อฝ่ายแนะแนวและจิตวิทยา'
  };

  const newLog = {
    id: "LOG" + Date.now().toString().slice(-4),
    studentId: student.id,
    studentName: `${student.prefix}${student.firstName} ${student.lastName}`,
    studentCode: student.studentCode,
    date: date,
    time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    advisorName: student.advisorName,
    contactChannel: channel,
    channelLabel: channelMap[channel] || channel,
    rootCausesLabel: causeCategory,
    details: notes,
    actionTaken: action,
    nextFollowUpDate: followUpDate,
    status: status,
    statusLabel: statusLabelMap[status] || status
  };

  data.careLogs.unshift(newLog);

  // Sync with Supabase if online
  if (typeof syncCareLogToSupabase === 'function') {
    syncCareLogToSupabase(newLog);
  }
  if (typeof syncStudentToSupabase === 'function') {
    syncStudentToSupabase(student);
  }

  // Update student status
  student.caseStatus = status;
  student.lastInterventionDate = date;
  if (status === 'resolved') {
    student.riskLevel = 'resolved';
  }

  saveAppData(data);
  closeCareLogModal();
  showToast(`บันทึกการดูแลสำหรับ ${student.firstName} เรียบร้อยแล้ว`, 'success');

  if (appState.currentTab === 'care_logs') renderCareLogsTab();
  if (appState.currentTab === 'students') renderStudentsTab();
  if (appState.currentTab === 'dashboard') renderDashboardTab();
}

// Student Profile Modal
function openStudentProfileModal(studentId) {
  const modal = document.getElementById('student-profile-modal');
  const student = data.students.find(s => s.id === studentId);
  if (!modal || !student) return;

  const { attendanceRate, riskLevel } = calculateStudentMetrics(student);
  const studentLogs = data.careLogs.filter(l => l.studentId === student.id);

  document.getElementById('profile-modal-content').innerHTML = `
    <div class="space-y-6">
      <!-- Header banner -->
      <div class="flex items-center gap-4 pb-4 border-b border-slate-200">
        <div class="w-16 h-16 rounded-2xl ${student.avatarBg} text-white flex items-center justify-center font-bold text-2xl shadow-md">
          ${student.firstName.charAt(0)}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-bold text-slate-800">${student.prefix}${student.firstName} ${student.lastName}</h2>
            <span class="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">${student.studentCode}</span>
          </div>
          <div class="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-4">
            <span><i class="fa-solid fa-graduation-cap mr-1"></i>${student.classroom}</span>
            <span><i class="fa-solid fa-user-tie mr-1"></i>ครูที่ปรึกษา: ${student.advisorName}</span>
          </div>
        </div>
      </div>

      <!-- Quick Metrics -->
      <div class="grid grid-cols-4 gap-3 text-center">
        <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div class="text-xs text-slate-400">เวลาเรียนสะสม</div>
          <div class="text-lg font-bold ${attendanceRate < 80 ? 'text-red-600' : 'text-slate-800'}">${attendanceRate}%</div>
        </div>
        <div class="p-3 rounded-xl bg-red-50 border border-red-200">
          <div class="text-xs text-red-500">ขาดเรียน</div>
          <div class="text-lg font-bold text-red-600">${student.absent} ครั้ง</div>
        </div>
        <div class="p-3 rounded-xl bg-amber-50 border border-amber-200">
          <div class="text-xs text-amber-500">มาสาย</div>
          <div class="text-lg font-bold text-amber-600">${student.late} ครั้ง</div>
        </div>
        <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
          <div class="text-xs text-emerald-500">ขาดติดกัน</div>
          <div class="text-lg font-bold text-slate-800">${student.consecutiveAbsent} วัน</div>
        </div>
      </div>

      <!-- Contact Info -->
      <div class="bg-blue-50/60 p-4 rounded-xl border border-blue-100 space-y-2 text-xs">
        <div class="font-bold text-blue-900 mb-1 flex items-center gap-1.5">
          <i class="fa-solid fa-address-book text-blue-600"></i> ข้อมูลการติดต่อด่วน
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-700">
          <div>เบอร์โทรนักศึกษา: <a href="tel:${student.phone}" class="font-bold text-blue-700 underline">${student.phone}</a></div>
          <div>เบอร์โทรผู้ปกครอง: <a href="tel:${student.parentPhone}" class="font-bold text-emerald-700 underline">${student.parentPhone}</a> (${student.parentName})</div>
        </div>
        <div class="text-slate-600 pt-1">
          <strong>หมายเหตุพฤติกรรม:</strong> ${student.notes || '-'}
        </div>
      </div>

      <!-- Timeline of Care Logs -->
      <div>
        <h3 class="font-bold text-slate-800 text-sm mb-3 flex items-center justify-between">
          <span>ประวัติการดูแลช่วยเหลือ (${studentLogs.length} รายการ)</span>
          <button onclick="closeStudentProfileModal(); openCareLogModal('${student.id}');" class="text-xs text-blue-600 hover:underline">
            + เพิ่มบันทึกใหม่
          </button>
        </h3>
        
        <div class="space-y-3 max-h-56 overflow-y-auto pr-1">
          ${studentLogs.length === 0 ? `
            <div class="text-xs text-slate-400 py-4 text-center bg-slate-50 rounded-xl">ยังไม่มีบันทึกการดูแลสำหรับนักศึกษาคนนี้</div>
          ` : studentLogs.map(l => `
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <div class="flex items-center justify-between font-semibold">
                <span class="text-slate-700">${l.date} (${l.channelLabel})</span>
                <span class="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">${l.statusLabel}</span>
              </div>
              <div class="text-slate-600"><strong>ประเด็น:</strong> ${l.details}</div>
              <div class="text-emerald-700"><strong>การช่วยเหลือ:</strong> ${l.actionTaken}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function closeStudentProfileModal() {
  const modal = document.getElementById('student-profile-modal');
  if (modal) modal.classList.add('hidden');
}

// LINE Alert Simulation Modal
function openLineNotifyModalSim(studentId = null) {
  const modal = document.getElementById('line-sim-modal');
  if (!modal) return;

  const target = studentId ? data.students.find(s => s.id === studentId) : (data.students[0] || null);
  const nowStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  if (target) {
    const { attendanceRate } = calculateStudentMetrics(target);
    document.getElementById('line-sim-body').innerHTML = `
      <div class="text-xs text-slate-800 space-y-2">
        <div class="font-bold text-red-600 flex items-center gap-1.5 text-sm">
          🚨 [วิทยาลัยการอาชีพเวียงสระ - แจ้งเตือนด่วน]
        </div>
        <div>
          <strong>เรียน:</strong> ${target.advisorName} (ครูที่ปรึกษา)
        </div>
        <div class="bg-red-50 p-2.5 rounded-lg border border-red-200">
          <div><strong>นักศึกษา:</strong> ${target.prefix}${target.firstName} ${target.lastName}</div>
          <div><strong>รหัส:</strong> ${target.studentCode} (${target.classroom})</div>
          <div><strong>สถิติ:</strong> ขาดสะสม ${target.absent} คาบ | เวลาเรียนเหลือ ${attendanceRate}%</div>
          <div class="text-red-700 font-bold mt-1">⚠️ เสี่ยงหมดสิทธิ์สอบ (ขาดเกิน 20%)</div>
        </div>
        <div class="text-slate-600">
          <strong>สาเหตุเบื้องต้น:</strong> ${target.primaryRiskReason}
        </div>
        <div class="text-slate-600">
          <strong>เบอร์ผู้ปกครอง:</strong> ${target.parentPhone} (${target.parentName})
        </div>
        <div class="pt-2 text-[11px] text-blue-600 underline">
          👉 แตะเพื่อเปิดระบบบันทึกการดูแล: https://caretrack.edu/case/${target.studentCode}
        </div>
      </div>
    `;
    document.getElementById('line-sim-time').innerText = nowStr;
  } else {
    document.getElementById('line-sim-body').innerHTML = `
      <div class="text-xs text-slate-800 space-y-2 text-center py-4">
        <i class="fa-solid fa-bell text-2xl text-slate-300 mb-1"></i>
        <div class="font-bold text-slate-700">ยังไม่มีข้อมูลนักศึกษาในระบบ</div>
        <p class="text-slate-500 text-[11px]">เมื่อมีนักศึกษาขาดเรียนเกินเกณฑ์ ระบบจะจำลองข้อความแจ้งเตือนเข้าแชท LINE ครูที่ปรึกษาที่นี่</p>
      </div>
    `;
    document.getElementById('line-sim-time').innerText = nowStr;
  }

  modal.classList.remove('hidden');
}

function closeLineNotifyModal() {
  const modal = document.getElementById('line-sim-modal');
  if (modal) modal.classList.add('hidden');
}

function sendLineAlertDirect(studentId) {
  openLineNotifyModalSim(studentId);
  playAlertBeep();
  showToast('ส่งข้อความแจ้งเตือนเข้า LINE Notify ครูที่ปรึกษาแล้ว!', 'success');
}

// Add New Student Modal
function openAddStudentModal() {
  const modal = document.getElementById('add-student-modal');
  if (!modal) return;

  const classSelect = document.getElementById('add-student-classroom');
  if (classSelect) {
    classSelect.innerHTML = data.classrooms.map(c => `
      <option value="${c.id}">${c.name}</option>
    `).join('');
  }

  modal.classList.remove('hidden');
}

function closeAddStudentModal() {
  const modal = document.getElementById('add-student-modal');
  if (modal) modal.classList.add('hidden');
}

function saveNewStudent(event) {
  event.preventDefault();
  const studentCode = document.getElementById('new-stu-code').value.trim();
  const prefix = document.getElementById('new-stu-prefix').value;
  const firstName = document.getElementById('new-stu-first').value.trim();
  const lastName = document.getElementById('new-stu-last').value.trim();
  const classId = document.getElementById('add-student-classroom').value;
  const phone = document.getElementById('new-stu-phone').value.trim();
  const parentName = document.getElementById('new-stu-parent-name').value.trim();
  const parentPhone = document.getElementById('new-stu-parent-phone').value.trim();

  const selectedClass = data.classrooms.find(c => c.id === classId);
  const selectedAdvisor = data.advisors.find(a => a.id === selectedClass?.advisorId) || data.advisors[0];
  const customAdvisor = document.getElementById('new-stu-advisor')?.value.trim();
  const advisorName = customAdvisor || selectedAdvisor.name;
  const primaryCause = document.getElementById('new-stu-cause')?.value || '-';

  const colors = ['bg-blue-500', 'bg-indigo-500', 'bg-emerald-500', 'bg-purple-500', 'bg-teal-500'];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];

  const newStudent = {
    id: "STU" + Date.now().toString().slice(-5),
    studentCode: studentCode,
    prefix: prefix,
    firstName: firstName,
    lastName: lastName,
    classroom: selectedClass?.name || 'ปวช.1',
    classId: classId,
    advisorId: selectedAdvisor.id,
    advisorName: advisorName,
    phone: phone || '',
    parentName: parentName || '',
    parentPhone: parentPhone || '',
    avatarBg: randomColor,
    totalClasses: 15,
    attended: 15,
    late: 0,
    leave: 0,
    absent: 0,
    consecutiveAbsent: 0,
    riskLevel: "safe",
    caseStatus: "none",
    primaryRiskReason: primaryCause,
    lastAbsendDate: "-",
    lastInterventionDate: null,
    notes: "บันทึกข้อมูลเข้าสู่ระบบ"
  };

  data.students.push(newStudent);
  if (typeof syncStudentToSupabase === 'function') {
    syncStudentToSupabase(newStudent);
  }
  saveAppData(data);
  closeAddStudentModal();
  showToast(`เพิ่มนักศึกษา ${prefix}${firstName} ${lastName} สำเร็จ`, 'success');

  if (appState.currentTab === 'students') renderStudentsTab();
  if (appState.currentTab === 'dashboard') renderDashboardTab();
}

// Notification Drawer
function toggleNotificationDrawer() {
  const drawer = document.getElementById('notification-drawer');
  if (!drawer) return;
  drawer.classList.toggle('hidden');
  renderNotificationsList();
}

function renderNotificationsList() {
  const listContainer = document.getElementById('notification-list');
  if (!listContainer) return;

  listContainer.innerHTML = data.alerts.map(a => `
    <div class="p-3 rounded-xl border ${a.isRead ? 'border-slate-100 bg-white' : 'border-blue-100 bg-blue-50/50'} text-xs space-y-1">
      <div class="flex items-center justify-between">
        <span class="font-bold ${a.level === 'danger' ? 'text-red-600' : 'text-amber-600'}">
          ${a.title}
        </span>
        <span class="text-[10px] text-slate-400 font-mono">${a.timestamp}</span>
      </div>
      <p class="text-slate-600">${a.message}</p>
      <div class="pt-1 flex items-center justify-between text-[11px]">
        <button onclick="openCareLogModal('${a.studentId}')" class="text-blue-600 font-semibold hover:underline">
          <i class="fa-solid fa-notes-medical"></i> บันทึกการดูแล
        </button>
        <span class="text-slate-400">ครูที่ปรึกษา: ${a.advisorName}</span>
      </div>
    </div>
  `).join('');
}

function markAllNotificationsRead() {
  data.alerts.forEach(a => a.isRead = true);
  saveAppData(data);
  updateNotificationBadge();
  renderNotificationsList();
  showToast('อ่านการแจ้งเตือนทั้งหมดแล้ว', 'info');
}

function updateNotificationBadge() {
  const badge = document.getElementById('notif-badge');
  const unreadCount = data.alerts.filter(a => !a.isRead).length;
  if (!badge) return;

  if (unreadCount > 0) {
    badge.innerText = unreadCount > 9 ? '9+' : unreadCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// Quick Navigation Helpers
function filterByRiskAndSwitch(risk) {
  appState.selectedRiskFilter = risk;
  switchTab('students');
}

function openAttendanceTabQuick() {
  switchTab('attendance');
}

function closeAllModals() {
  closeCareLogModal();
  closeStudentProfileModal();
  closeLineNotifyModal();
  closeAddStudentModal();
  const drawer = document.getElementById('notification-drawer');
  if (drawer && !drawer.classList.contains('hidden')) drawer.classList.add('hidden');
}

// Export CSV
function exportStudentsCSV() {
  let csv = "รหัสนักศึกษา,คำนำหน้า,ชื่อ,นามสกุล,ห้องเรียน,ครูที่ปรึกษา,ขาด(คาบ),สาย(คาบ),เวลาเรียน(%),ระดับความเสี่ยง,สถานะการดูแล,สาเหตุหลัก\n";
  data.students.forEach(s => {
    const { attendanceRate, riskLevel } = calculateStudentMetrics(s);
    csv += `"${s.studentCode}","${s.prefix}","${s.firstName}","${s.lastName}","${s.classroom}","${s.advisorName}",${s.absent},${s.late},${attendanceRate}%,"${riskLevel}","${s.caseStatus}","${s.primaryRiskReason}"\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `caretrack_student_risk_report_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('ส่งออกข้อมูล CSV สำเร็จ', 'success');
}

// Reset Demo Data
function handleResetDemoData() {
  if (confirm("ต้องการรีเซ็ตข้อมูลตัวอย่างกลับเป็นค่าเริ่มต้นหรือไม่? ข้อมูลที่คุณทดลองบันทึกไว้จะถูกรีเซ็ต")) {
    data = resetToDefaultData();
    showToast('รีเซ็ตข้อมูลตัวอย่างเริ่มต้นเรียบร้อยแล้ว', 'info');
    switchTab(appState.currentTab);
  }
}

// Render Top Navbar items
function renderNavbar() {
  const container = document.getElementById('school-title');
  if (container) {
    container.innerText = data.schoolName;
  }
}

