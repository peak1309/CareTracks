// supabase-client.js - Cloud Database Integration for CareTrack Edu (วิทยาลัยการอาชีพเวียงสระ)

const SUPABASE_CONFIG_KEY = "caretrack_supabase_cfg_v2";

// ข้อมูลเชื่อมต่อ Supabase ทางการของวิทยาลัยการอาชีพเวียงสระ
const DEFAULT_SUPABASE_CONFIG = {
  url: "https://lfcefahlgsanrssfnokq.supabase.co",
  anonKey: "sb_publishable_x-m5hg7y329aIrRQFHERTQ_Jmp2izLq",
  isConnected: true
};

let supabaseClient = null;
let isSupabaseConnected = false;

// โหลดการตั้งค่า Supabase จาก LocalStorage (หากไม่มีจะใช้ค่า Default ทันที)
function getSupabaseConfig() {
  const saved = localStorage.getItem(SUPABASE_CONFIG_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.url && parsed.anonKey) return parsed;
    } catch (e) {
      console.error("Invalid Supabase config in storage", e);
    }
  }
  return DEFAULT_SUPABASE_CONFIG;
}

// เริ่มต้น Client
async function initSupabase() {
  const cfg = getSupabaseConfig();
  if (cfg.url && cfg.anonKey && window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
      
      // ทดสอบการเชื่อมต่อ
      const { data: testData, error } = await supabaseClient
        .from('students')
        .select('count', { count: 'exact', head: true });

      if (!error) {
        isSupabaseConnected = true;
        updateSupabaseUI(true, cfg.url);
        console.log("✅ เชื่อมต่อ Supabase สำเร็จ:", cfg.url);
        
        // ซิงค์ข้อมูลล่าสุดจาก Supabase ลง State
        await fetchAllDataFromSupabase();
        return true;
      } else {
        console.warn("⚠️ การเชื่อมต่อ Supabase ส่งค่ากลับ:", error.message);
        isSupabaseConnected = false;
        updateSupabaseUI(false, error.message);
      }
    } catch (err) {
      console.error("❌ เกิดข้อผิดพลาดในการเริ่ม Supabase:", err);
      isSupabaseConnected = false;
      updateSupabaseUI(false, err.message);
    }
  } else {
    isSupabaseConnected = false;
    updateSupabaseUI(false);
  }
  return false;
}

// อัปเดต UI แสดงสถานะการเชื่อมต่อ
function updateSupabaseUI(connected, info = "") {
  const dot = document.getElementById("supabase-status-dot");
  const text = document.getElementById("supabase-status-text");
  const btn = document.getElementById("supabase-status-btn");
  
  if (!dot || !text || !btn) return;

  if (connected) {
    dot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
    text.innerText = "Supabase ออนไลน์";
    btn.className = "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition shadow-xs";
    btn.title = `เชื่อมต่อกับ Cloud Database แล้ว: ${info}`;
  } else {
    dot.className = "w-2 h-2 rounded-full bg-slate-400";
    text.innerText = "เชื่อมต่อ Supabase";
    btn.className = "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 transition shadow-xs";
    btn.title = "คลิกเพื่อตั้งค่าเชื่อมต่อฐานข้อมูล Supabase";
  }
}

// ดึงข้อมูลทั้งหมดจาก Supabase
async function fetchAllDataFromSupabase(showNotification = false) {
  if (!supabaseClient || !isSupabaseConnected) return;

  try {
    // 1. ดึงนักศึกษา
    const { data: dbStudents, error: errStu } = await supabaseClient
      .from('students')
      .select('*')
      .order('student_code', { ascending: true });

    if (!errStu && dbStudents) {
      data.students = dbStudents.map(s => ({
        id: s.id,
        studentCode: s.student_code,
        prefix: s.prefix || 'นาย',
        firstName: s.first_name,
        lastName: s.last_name,
        classroom: s.classroom,
        classId: s.class_id,
        advisorId: s.advisor_id,
        advisorName: s.advisor_name,
        phone: s.phone || '',
        parentName: s.parent_name || '',
        parentPhone: s.parent_phone || '',
        avatarBg: s.avatar_bg || 'bg-blue-500',
        totalClasses: s.total_classes || 15,
        attended: s.attended || 0,
        late: s.late || 0,
        leave: s.leave || 0,
        absent: s.absent || 0,
        consecutiveAbsent: s.consecutive_absent || 0,
        riskLevel: s.risk_level || 'safe',
        caseStatus: s.case_status || 'none',
        primaryRiskReason: s.primary_risk_reason || '-',
        lastAbsendDate: s.last_absent_date || '-',
        lastInterventionDate: s.last_intervention_date || null,
        notes: s.notes || ''
      }));
    }

    // 2. ดึงบันทึกการดูแล
    const { data: dbCareLogs, error: errCare } = await supabaseClient
      .from('care_logs')
      .select('*')
      .order('date', { ascending: false });

    if (!errCare && dbCareLogs) {
      data.careLogs = dbCareLogs.map(c => ({
        id: c.id,
        studentId: c.student_id,
        studentName: c.student_name,
        studentCode: c.student_code,
        date: c.date,
        time: c.time || '',
        advisorName: c.advisor_name,
        contactChannel: c.contact_channel,
        channelLabel: c.channel_label,
        details: c.details,
        actionTaken: c.action_taken,
        nextFollowUpDate: c.next_follow_up_date || '-',
        status: c.status,
        statusLabel: c.status_label
      }));
    }

    // 3. ดึงการแจ้งเตือน
    const { data: dbAlerts, error: errAlt } = await supabaseClient
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);

    if (!errAlt && dbAlerts) {
      data.alerts = dbAlerts.map(a => ({
        id: a.id,
        timestamp: a.timestamp || a.created_at,
        studentId: a.student_id,
        studentName: a.student_name,
        studentCode: a.student_code,
        courseCode: a.course_code,
        courseName: a.course_name,
        advisorId: a.advisor_id,
        advisorName: a.advisor_name,
        level: a.level,
        type: a.type,
        title: a.title,
        message: a.message,
        isRead: a.is_read,
        lineSent: a.line_sent
      }));
    }

    // บันทึกลง LocalStorage Cache
    saveAppData(data);
    updateNotificationBadge();
    
    // รีเฟรชหน้าปัจจุบัน
    if (typeof switchTab === 'function') {
      switchTab(appState.currentTab);
    }

    if (showNotification && typeof showToast === 'function') {
      showToast(`ซิงค์ข้อมูล Cloud สำเร็จ (นักศึกษา ${data.students.length} คน)`, 'success');
    }
  } catch (e) {
    console.error("Error fetching from Supabase:", e);
    if (showNotification && typeof showToast === 'function') {
      showToast('ไม่สามารถซิงค์ข้อมูลกับ Supabase ได้', 'danger');
    }
  }
}

// ปุ่มซิงค์ข้อมูลด่วนจากแถบเมนู
async function syncLatestFromCloud() {
  const icon = document.querySelector('.fa-rotate');
  if (icon) icon.classList.add('fa-spin');
  await fetchAllDataFromSupabase(true);
  if (icon) icon.classList.remove('fa-spin');
}

// ซิงค์นักศึกษา 1 คนขึ้น Supabase
async function syncStudentToSupabase(st) {
  if (!supabaseClient || !isSupabaseConnected) return;

  try {
    const payload = {
      student_code: st.studentCode,
      prefix: st.prefix,
      first_name: st.firstName,
      last_name: st.lastName,
      classroom: st.classroom,
      class_id: st.classId,
      advisor_id: st.advisorId,
      advisor_name: st.advisorName,
      phone: st.phone || '',
      parent_name: st.parentName || '',
      parent_phone: st.parentPhone || '',
      avatar_bg: st.avatarBg || 'bg-blue-500',
      total_classes: st.totalClasses || 15,
      attended: st.attended || 0,
      late: st.late || 0,
      leave: st.leave || 0,
      absent: st.absent || 0,
      consecutive_absent: st.consecutiveAbsent || 0,
      risk_level: st.riskLevel || 'safe',
      case_status: st.caseStatus || 'none',
      primary_risk_reason: st.primaryRiskReason || '',
      last_absent_date: st.lastAbsendDate || '',
      last_intervention_date: st.lastInterventionDate || '',
      notes: st.notes || '',
      updated_at: new Date().toISOString()
    };

    const { error } = await supabaseClient
      .from('students')
      .upsert(payload, { onConflict: 'student_code' });

    if (error) {
      console.error("Supabase upsert student error:", error.message);
    }
  } catch (err) {
    console.error("syncStudentToSupabase error:", err);
  }
}

// ซิงค์บันทึกการดูแลขึ้น Supabase
async function syncCareLogToSupabase(log) {
  if (!supabaseClient || !isSupabaseConnected) return;

  try {
    const payload = {
      student_code: log.studentCode,
      student_name: log.studentName,
      date: log.date,
      time: log.time || '',
      advisor_name: log.advisorName,
      contact_channel: log.contactChannel,
      channel_label: log.channelLabel,
      details: log.details,
      action_taken: log.actionTaken,
      next_follow_up_date: log.nextFollowUpDate || '-',
      status: log.status,
      status_label: log.statusLabel
    };

    const { error } = await supabaseClient
      .from('care_logs')
      .insert([payload]);

    if (error) {
      console.error("Supabase insert care_log error:", error.message);
    }
  } catch (err) {
    console.error("syncCareLogToSupabase error:", err);
  }
}

// ซิงค์การแจ้งเตือนขึ้น Supabase
async function syncAlertToSupabase(alert) {
  if (!supabaseClient || !isSupabaseConnected) return;

  try {
    const payload = {
      student_code: alert.studentCode,
      student_name: alert.studentName,
      course_code: alert.courseCode || '',
      course_name: alert.courseName || '',
      advisor_id: alert.advisorId || '',
      advisor_name: alert.advisorName || '',
      level: alert.level,
      type: alert.type,
      title: alert.title,
      message: alert.message,
      is_read: alert.isRead,
      line_sent: alert.lineSent,
      timestamp: alert.timestamp
    };

    const { error } = await supabaseClient
      .from('alerts')
      .insert([payload]);

    if (error) {
      console.error("Supabase insert alert error:", error.message);
    }
  } catch (err) {
    console.error("syncAlertToSupabase error:", err);
  }
}

// บันทึกการเช็คชื่อขึ้น Supabase
async function syncAttendanceRecordToSupabase(records) {
  if (!supabaseClient || !isSupabaseConnected || !records || records.length === 0) return;

  try {
    const { error } = await supabaseClient
      .from('attendance_records')
      .insert(records);

    if (error) {
      console.error("Supabase insert attendance_records error:", error.message);
    }
  } catch (err) {
    console.error("syncAttendanceRecordToSupabase error:", err);
  }
}

// Modal Controller Functions
function openSupabaseModal() {
  const modal = document.getElementById("supabase-modal");
  if (!modal) return;

  const cfg = getSupabaseConfig();
  const urlInput = document.getElementById("supabase-url-input");
  const keyInput = document.getElementById("supabase-key-input");
  const statusMsg = document.getElementById("supabase-modal-status-msg");

  if (urlInput) urlInput.value = cfg.url || DEFAULT_SUPABASE_CONFIG.url;
  if (keyInput) keyInput.value = cfg.anonKey || DEFAULT_SUPABASE_CONFIG.anonKey;

  if (statusMsg) {
    if (isSupabaseConnected) {
      statusMsg.innerHTML = `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-circle-check mr-1"></i> เชื่อมต่อกับ Supabase สำเร็จแล้ว (ข้อมูลซิงค์แบบเรียลไทม์)</span>`;
    } else {
      statusMsg.innerHTML = `<span class="text-slate-500">กรุณากรอก Project URL และ Anon Key เพื่อเชื่อมต่อ Cloud Database</span>`;
    }
  }

  modal.classList.remove("hidden");
}

function closeSupabaseModal() {
  const modal = document.getElementById("supabase-modal");
  if (modal) modal.classList.add("hidden");
}

// บันทึกและทดสอบการเชื่อมต่อ
async function handleSaveSupabaseConfig(event) {
  if (event) event.preventDefault();
  
  const url = document.getElementById("supabase-url-input").value.trim();
  const anonKey = document.getElementById("supabase-key-input").value.trim();
  const btn = document.getElementById("btn-save-supabase");

  if (!url || !anonKey) {
    alert("กรุณากรอกทั้ง Supabase URL และ Anon Key");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> กำลังเชื่อมต่อ...`;
  }

  try {
    const testClient = window.supabase.createClient(url, anonKey);
    const { data: testData, error } = await testClient
      .from('students')
      .select('count', { count: 'exact', head: true });

    if (error) {
      throw error;
    }

    localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({
      url: url,
      anonKey: anonKey,
      isConnected: true
    }));

    supabaseClient = testClient;
    isSupabaseConnected = true;
    updateSupabaseUI(true, url);

    if (typeof showToast === 'function') {
      showToast('เชื่อมต่อฐานข้อมูล Supabase สำเร็จ!', 'success');
    }

    await fetchAllDataFromSupabase(true);
    closeSupabaseModal();
  } catch (err) {
    console.error("Supabase test failed:", err);
    alert("ไม่สามารถเชื่อมต่อ Supabase ได้: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-plug mr-1"></i> บันทึกและเชื่อมต่อ`;
    }
  }
}

// ตัดการเชื่อมต่อและกลับสู่โหมด LocalStorage
function handleDisconnectSupabase() {
  if (confirm("ต้องการยกเลิกการเชื่อมต่อ Supabase และกลับไปใช้ระบบออฟไลน์ (LocalStorage) หรือไม่?")) {
    localStorage.removeItem(SUPABASE_CONFIG_KEY);
    supabaseClient = null;
    isSupabaseConnected = false;
    updateSupabaseUI(false);
    if (typeof showToast === 'function') {
      showToast('ตัดการเชื่อมต่อ Supabase แล้ว', 'info');
    }
    closeSupabaseModal();
  }
}
