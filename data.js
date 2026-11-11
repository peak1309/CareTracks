// data.js - Initial data & State initialization for CareTrack Student Attendance & Dropout Prevention System
// วิทยาลัยการอาชีพเวียงสระ (Wiang Sa Industrial and Community Education College)
// ระบบฐานข้อมูลจริง เชื่อมต่อกับ Supabase Cloud Database

const INITIAL_DATA = {
  semester: "ภาคเรียนที่ 2 / ปีการศึกษา 2569",
  schoolName: "วิทยาลัยการอาชีพเวียงสระ",
  schoolLogo: "logo.png",

  // แผนกและครูที่ปรึกษาประจำแผนก
  advisors: [
    { id: "ADV01", name: "ครูที่ปรึกษา แผนกวิชาช่างยนต์", department: "ช่างยนต์", phone: "-", email: "auto@wiangsa.ac.th", lineNotifyLinked: true },
    { id: "ADV02", name: "ครูที่ปรึกษา แผนกวิชาการบัญชี", department: "การบัญชี", phone: "-", email: "account@wiangsa.ac.th", lineNotifyLinked: true },
    { id: "ADV03", name: "ครูที่ปรึกษา แผนกวิชาเทคโนโลยีสารสนเทศ", department: "เทคโนโลยีสารสนเทศ", phone: "-", email: "it@wiangsa.ac.th", lineNotifyLinked: true },
    { id: "ADV04", name: "ครูที่ปรึกษา แผนกวิชาช่างไฟฟ้ากำลัง", department: "ช่างไฟฟ้ากำลัง", phone: "-", email: "electric@wiangsa.ac.th", lineNotifyLinked: true },
    { id: "ADV05", name: "ครูที่ปรึกษา แผนกวิชาการตลาด", department: "การตลาด", phone: "-", email: "marketing@wiangsa.ac.th", lineNotifyLinked: false }
  ],

  // รายวิชาที่เปิดสอน
  courses: [
    { id: "ENG201", code: "ENG201", name: "ภาษาอังกฤษเพื่อการสื่อสารในงานอาชีพ", instructor: "ครูผู้สอนประจำวิชา", totalHours: 15, currentWeek: 1 },
    { id: "IT301", code: "IT301", name: "การพัฒนาเว็บแอปพลิเคชัน", instructor: "ครูผู้สอนประจำวิชา", totalHours: 15, currentWeek: 1 },
    { id: "MTH102", code: "MTH102", name: "คณิตศาสตร์และสถิติประยุกต์", instructor: "ครูผู้สอนประจำวิชา", totalHours: 15, currentWeek: 1 },
    { id: "ACC202", code: "ACC202", name: "การบัญชีต้นทุนและการจัดการ", instructor: "ครูผู้สอนประจำวิชา", totalHours: 15, currentWeek: 1 },
    { id: "ELE101", code: "ELE101", name: "งานติดตั้งไฟฟ้าในอาคาร", instructor: "ครูผู้สอนประจำวิชา", totalHours: 15, currentWeek: 1 },
    { id: "MEC204", code: "MEC204", name: "งานเครื่องยนต์สันดาปภายใน", instructor: "ครูผู้สอนประจำวิชา", totalHours: 15, currentWeek: 1 }
  ],

  // แผนกและชั้นเรียน
  classrooms: [
    { id: "auto_v1", name: "ปวช.2/1 ช่างยนต์", advisorId: "ADV01" },
    { id: "acc_v2", name: "ปวช.2/2 การบัญชี", advisorId: "ADV02" },
    { id: "it_h1", name: "ปวส.1/1 เทคโนโลยีสารสนเทศ", advisorId: "ADV03" },
    { id: "ele_v1", name: "ปวช.1/3 ช่างไฟฟ้ากำลัง", advisorId: "ADV04" },
    { id: "mkt_h2", name: "ปวส.2/1 การตลาด", advisorId: "ADV05" }
  ],

  // ข้อมูลเริ่มต้นจริง (ว่างเปล่า เพื่อซิงค์กับ Supabase)
  students: [],
  careLogs: [],
  alerts: []
};

// Storage helper functions
const STORAGE_KEY = "caretrack_wiangsa_prod_v2";

// เคลียร์แคชตัวอย่างเดิมใน LocalStorage อัตโนมัติ เพื่อไม่ให้มีข้อมูลตัวอย่างค้าง
try {
  localStorage.removeItem("caretrack_edu_v1");
  localStorage.removeItem("caretrack_wiangsa_v1");
} catch(e) {}

function loadAppData() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      parsed.schoolName = "วิทยาลัยการอาชีพเวียงสระ";
      parsed.schoolLogo = "logo.png";
      return parsed;
    } catch (e) {
      console.error("Failed to parse stored data", e);
    }
  }
  saveAppData(INITIAL_DATA);
  return JSON.parse(JSON.stringify(INITIAL_DATA));
}

function saveAppData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save to localStorage", e);
  }
}

function resetToDefaultData() {
  localStorage.removeItem(STORAGE_KEY);
  const data = JSON.parse(JSON.stringify(INITIAL_DATA));
  saveAppData(data);
  return data;
}
