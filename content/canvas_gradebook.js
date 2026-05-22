// Content Script for Canvas LMS (awsacademy.instructure.com)
console.log("LMS Monitor: Canvas Grades/Gradebook script injected");

// Helper to get simulated URL in playground, or actual window.location in production
function getEffectiveURL() {
  if (typeof document !== 'undefined') {
    const mockUrlInput = document.getElementById('canvas-url');
    if (mockUrlInput) {
      try {
        return new URL(mockUrlInput.value);
      } catch (e) {
        // fallback
      }
    }
  }
  return new URL(window.location.href);
}

// --- Shadow DOM Status Widget ---
let shadowRoot = null;
let widgetContainer = null;

function getCanvasCourseKey() {
  const loc = getEffectiveURL();
  const match = loc.pathname.match(/\/courses\/(\d+)/);
  if (match) return `canvas-${match[1]}`;
  const urlParams = new URLSearchParams(loc.search);
  const cid = urlParams.get('course_id') || urlParams.get('courseId');
  return cid ? `canvas-${cid}` : null;
}

function initStatusWidget() {
  const existing = document.getElementById('lms-monitor-root');
  if (existing) {
    existing.remove();
  }

  widgetContainer = document.createElement('div');
  widgetContainer.id = 'lms-monitor-root';
  document.body.appendChild(widgetContainer);

  shadowRoot = widgetContainer.attachShadow({ mode: 'closed' });

  // Add Shadow DOM styles
  const style = document.createElement('style');
  style.textContent = `
    .widget-panel {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 12px 16px;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 260px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(8px);
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      transition: opacity 0.3s, transform 0.3s;
      box-sizing: border-box;
    }
    .widget-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 6px;
      box-sizing: border-box;
    }
    .widget-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      background: linear-gradient(135deg, #a5b4fc, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .widget-close {
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 14px;
      padding: 0;
      line-height: 1;
    }
    .widget-close:hover {
      color: #f8fafc;
    }
    .widget-body {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      box-sizing: border-box;
    }
    .widget-icon {
      font-size: 16px;
      flex-shrink: 0;
    }
    .widget-message {
      flex-grow: 1;
      line-height: 1.3;
      color: #e2e8f0;
    }
    .widget-btn {
      background: #4f46e5;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      text-align: center;
      align-self: flex-start;
      margin-top: 4px;
    }
    .widget-btn:hover {
      background: #4338ca;
    }
    .widget-link {
      color: #94a3b8;
      font-size: 11px;
      cursor: pointer;
      text-decoration: underline;
      margin-top: 4px;
      background: none;
      border: none;
      padding: 0;
      text-align: left;
      align-self: flex-start;
    }
    .widget-link:hover {
      color: #e2e8f0;
    }
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #a5b4fc;
      animation: spin 1s ease-in-out infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  shadowRoot.appendChild(style);

  // Add Widget structure
  const panel = document.createElement('div');
  panel.className = 'widget-panel';
  panel.innerHTML = `
    <div class="widget-header">
      <span class="widget-title">LMS Monitor Status</span>
      <button class="widget-close" id="close-btn">&times;</button>
    </div>
    <div class="widget-body">
      <div class="widget-icon" id="status-icon"><div class="spinner"></div></div>
      <div class="widget-message" id="status-message">Initializing...</div>
    </div>
    <button class="widget-btn" id="action-btn" style="display: none;">Enable Monitoring</button>
    <button class="widget-link" id="disable-link" style="display: none;">Disable monitoring</button>
  `;
  shadowRoot.appendChild(panel);

  // Wire event handlers
  shadowRoot.getElementById('close-btn').addEventListener('click', () => {
    widgetContainer.style.opacity = '0';
    widgetContainer.style.transform = 'translateY(10px)';
    setTimeout(() => {
      if (widgetContainer) {
        widgetContainer.remove();
        widgetContainer = null;
        shadowRoot = null;
      }
    }, 300);
  });

  shadowRoot.getElementById('action-btn').addEventListener('click', async () => {
    const btnEl = shadowRoot.getElementById('action-btn');
    if (btnEl.textContent === 'Enable Monitoring') {
      await enableCourseMonitoring();
    } else {
      runScraperSequence();
    }
  });

  shadowRoot.getElementById('disable-link').addEventListener('click', async () => {
    await disableCourseMonitoring();
  });
}

function updateWidget(state, message) {
  initStatusWidget();
  if (!shadowRoot) return;

  const iconEl = shadowRoot.getElementById('status-icon');
  const msgEl = shadowRoot.getElementById('status-message');
  const btnEl = shadowRoot.getElementById('action-btn');
  const disableEl = shadowRoot.getElementById('disable-link');

  msgEl.textContent = message;

  if (state === 'disabled') {
    iconEl.innerHTML = '⏸️';
    btnEl.textContent = 'Enable Monitoring';
    btnEl.style.display = 'block';
    disableEl.style.display = 'none';
  } else if (state === 'scanning') {
    iconEl.innerHTML = '<div class="spinner"></div>';
    btnEl.style.display = 'none';
    disableEl.style.display = 'none';
  } else if (state === 'success') {
    iconEl.innerHTML = '✅';
    btnEl.style.display = 'none';
    disableEl.style.display = 'block';
  } else if (state === 'error') {
    iconEl.innerHTML = '⚠️';
    btnEl.textContent = 'Scan Now';
    btnEl.style.display = 'block';
    disableEl.style.display = 'none';
  }
}

async function enableCourseMonitoring() {
  const courseId = getCanvasCourseKey();
  if (!courseId) return;
  
  const { enabledCourses = {} } = await chrome.storage.local.get('enabledCourses');
  enabledCourses[courseId] = true;
  await chrome.storage.local.set({ enabledCourses });
  
  runScraperSequence();
}

async function disableCourseMonitoring() {
  const courseId = getCanvasCourseKey();
  if (!courseId) return;
  
  const { enabledCourses = {}, courses = {}, snapshots = {} } = await chrome.storage.local.get(['enabledCourses', 'courses', 'snapshots']);
  enabledCourses[courseId] = false;
  
  // Clean up registered course details so it disappears from the popup dashboard
  delete courses[courseId];
  delete snapshots[courseId];
  
  await chrome.storage.local.set({ enabledCourses, courses, snapshots });
  updateWidget('disabled', 'Monitoring is disabled for this course.');
}

// Extract course ID from URL
function getCanvasCourseId() {
  const loc = getEffectiveURL();
  const match = loc.pathname.match(/\/courses\/(\d+)/);
  if (match) return match[1];
  const urlParams = new URLSearchParams(loc.search);
  return urlParams.get('course_id') || urlParams.get('courseId');
}

// Scrape grades from student view HTML table (table#grades_summary)
function scrapeStudentGradesDOM() {
  const rows = document.querySelectorAll('table#grades_summary tr.student_assignment:not(.dummy)');
  const grades = [];
  
  rows.forEach(row => {
    // 1. Get Assignment Name
    const titleEl = row.querySelector('th.title a') || row.querySelector('th.title');
    if (!titleEl) return;
    const assignmentName = titleEl.textContent.trim().replace(/\s+/g, ' ');
    
    // 2. Get Score
    const scoreEl = row.querySelector('td.grade');
    let score = "N/A";
    if (scoreEl) {
      const rawText = scoreEl.textContent.trim();
      const match = rawText.match(/^\s*([\d\.]+)/) || rawText.match(/Score:\s*([\d\.\-]+)/i) || rawText.match(/([\d\.\-]+)\s*out of/i);
      score = match ? match[1] : rawText.split('\n')[0].trim();
    }
    
    // 3. Get Max Points
    const possibleEl = row.querySelector('td.points');
    let maxPoints = "N/A";
    if (possibleEl) {
      const match = possibleEl.textContent.match(/([\d\.]+)/);
      maxPoints = match ? match[1] : possibleEl.textContent.trim();
    }
    
    grades.push({
      assignmentName,
      grade: `${score}/${maxPoints}`,
      score,
      maxPoints
    });
  });
  
  return grades;
}

// Helper to parse RFC 5988 Link headers to find the next page URL
function getNextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.trim().match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Helper to fetch all pages from a paginated Canvas API endpoint
async function fetchCanvasPaginated(initialUrl) {
  let url = initialUrl;
  let allData = [];
  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`API request failed for ${url} with status ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      allData = allData.concat(data);
    } else {
      return data;
    }
    const linkHeader = res.headers.get('Link') || res.headers.get('link');
    url = getNextPageUrl(linkHeader);
  }
  return allData;
}

// Fetch grades for Instructor View via Canvas API
async function fetchInstructorGradesAPI(courseId) {
  // 1. Fetch course details
  const courseRes = await fetch(`/api/v1/courses/${courseId}`);
  if (!courseRes.ok) throw new Error("Not authorized or API endpoint unavailable");
  const courseData = await courseRes.json();
  const courseName = courseData.name || `Canvas Course ${courseId}`;
  
  // 2. Fetch users (students) - Paginated
  const users = await fetchCanvasPaginated(`/api/v1/courses/${courseId}/users?enrollment_type[]=student&per_page=100`);
  
  const userMap = {};
  users.forEach(u => {
    userMap[u.id] = {
      name: u.name,
      email: u.email || u.login_id || ""
    };
  });
  
  // 3. Fetch submissions - Paginated
  const submissions = await fetchCanvasPaginated(`/api/v1/courses/${courseId}/students/submissions?student_ids[]=all&per_page=100&include[]=assignment`);
  
  const studentGradesMap = {};
  
  submissions.forEach(sub => {
    const studentId = sub.user_id;
    const userDetail = userMap[studentId] || { name: `Student #${studentId}`, email: "" };
    const studentName = userDetail.name;
    const studentEmail = userDetail.email;
    const assignmentName = sub.assignment ? sub.assignment.name : `Assignment #${sub.assignment_id}`;
    const pointsPossible = sub.assignment ? sub.assignment.points_possible : "N/A";
    
    const score = sub.score !== null && sub.score !== undefined ? sub.score : "N/A";
    const gradeVal = `${score}/${pointsPossible}`;
    
    if (!studentGradesMap[studentId]) {
      studentGradesMap[studentId] = {
        studentId: String(studentId),
        studentName,
        studentEmail,
        grades: {}
      };
    }
    
    studentGradesMap[studentId].grades[assignmentName] = gradeVal;
  });
  
  return {
    courseName,
    gradebook: Object.values(studentGradesMap)
  };
}

// Scrape Gradebook from DOM (Fallback for instructor view when API fails)
function scrapeInstructorGradesDOM() {
  const rows = document.querySelectorAll('.slick-row');
  const headers = Array.from(document.querySelectorAll('.slick-header-column')).map(h => {
    const rawText = h.innerText || h.textContent || "";
    return rawText.split('\n')[0].trim();
  });
  
  if (rows.length === 0) {
    return null;
  }
  
  const data = [];
  rows.forEach((row, rIdx) => {
    const cells = row.querySelectorAll('.slick-cell');
    let nameEl = row.querySelector('.student-name, .student-placeholder, a.student_title');
    
    // Fallback: if no specific class matches, look for student name in the cell matching the Student column header index
    if (!nameEl && cells.length > 0) {
      const nameColIdx = headers.findIndex(h => h.includes('Student') || h.includes('Name'));
      if (nameColIdx !== -1 && cells[nameColIdx]) {
        nameEl = cells[nameColIdx];
      } else {
        nameEl = cells[0];
      }
    }
    
    const studentName = nameEl ? nameEl.textContent.trim() : `Student Row #${rIdx}`;
    const studentId = nameEl ? (nameEl.getAttribute('data-student_id') || nameEl.getAttribute('data-student-id') || studentName) : `student-${rIdx}`;
    
    const grades = {};
    cells.forEach((cell, cIdx) => {
      const header = headers[cIdx] || `Assignment #${cIdx}`;
      if (header.includes('Student') || header.includes('Total') || header.includes('Secondary')) {
        return;
      }
      grades[header] = cell.innerText.trim();
    });
    
    data.push({
      studentId,
      studentName,
      grades
    });
  });
  
  return data;
}

// Main execution logic
async function scrapeCanvasGrades() {
  const courseId = getCanvasCourseId();
  if (!courseId) {
    throw new Error("Course ID not found in URL structure");
  }
  
  const loc = getEffectiveURL();
  const currentPath = loc.pathname;
  const isStudentGradesPage = currentPath.includes('/grades') && !currentPath.includes('/gradebook');
  const courseKey = `canvas-${courseId}`;
  
  let courseName = "Canvas Course " + courseId;
  const courseTitleEl = document.querySelector('.course-title, #section-tabs-header');
  if (courseTitleEl) {
    courseName = courseTitleEl.textContent.trim();
  }

  // Capture Canvas debug page source info
  try {
    const slickRows = document.querySelectorAll('.slick-row');
    const headers = Array.from(document.querySelectorAll('.slick-header-column')).map(h => {
      const rawText = h.innerText || h.textContent || "";
      return rawText.split('\n')[0].trim();
    });
    const gradesSummary = document.getElementById('grades_summary');
    
    await chrome.storage.local.set({
      debugLMSInfo: {
        url: loc.href,
        timestamp: Date.now(),
        type: 'canvas',
        hasSlickGrid: slickRows.length > 0,
        slickRowsCount: slickRows.length,
        headers,
        hasGradesSummaryTable: !!gradesSummary,
        bodyHtmlSnippet: document.body.innerHTML.substring(0, 30000)
      }
    });
  } catch (debugErr) {
    console.warn("LMS Monitor: Failed to save Canvas debug info:", debugErr);
  }
  
  if (isStudentGradesPage) {
    // 1. Student view
    const studentGrades = scrapeStudentGradesDOM();
    if (studentGrades.length === 0) {
      throw new Error("No student assignment grades located on page DOM");
    }
    await processStudentGradesChanges(courseKey, courseName, studentGrades);
    return { type: 'student', count: studentGrades.length };
  } else {
    // 2. Instructor view
    try {
      const apiData = await fetchInstructorGradesAPI(courseId);
      await processInstructorGradesChanges(courseKey, apiData.courseName, apiData.gradebook);
      return { type: 'instructor (API)', count: apiData.gradebook.length };
    } catch (err) {
      console.warn("LMS Monitor: API extraction failed, attempting DOM fallback:", err.message);
      const domData = scrapeInstructorGradesDOM();
      if (domData && domData.length > 0) {
        await processInstructorGradesChanges(courseKey, courseName, domData);
        return { type: 'instructor (DOM)', count: domData.length };
      } else {
        throw new Error(`Could not access grades (API error: ${err.message}) and DOM table not visible.`);
      }
    }
  }
}

// Diff Student Grades
async function processStudentGradesChanges(courseId, courseName, currentGrades) {
  const { snapshots = {}, changeLog = [], courses = {} } = await chrome.storage.local.get(['snapshots', 'changeLog', 'courses']);
  const previousGrades = snapshots[courseId] || [];
  const detectedChanges = [];
  const timestamp = Date.now();

  // Migrate legacy previous grades if they lack history or timestamp
  const migratedPreviousGrades = previousGrades.map(prev => {
    if (prev && (prev.timestamp === undefined || prev.history === undefined)) {
      const fallbackTime = (courses[courseId] && courses[courseId].lastChecked) || (timestamp - 1000);
      return {
        ...prev,
        timestamp: prev.timestamp || fallbackTime,
        history: prev.history || (prev.grade && prev.grade.indexOf("N/A") === -1 ? [{ grade: prev.grade, timestamp: prev.timestamp || fallbackTime }] : [])
      };
    }
    return prev;
  });

  const previousMap = new Map(migratedPreviousGrades.map(g => [g.assignmentName, g]));
  
  const updatedGrades = currentGrades.map(item => {
    const prev = previousMap.get(item.assignmentName);
    if (!prev) {
      const hasGrade = item.score !== "N/A" && item.score !== "";
      if (hasGrade) {
        detectedChanges.push({
          id: `${courseId}-grade-add-${item.assignmentName}-${timestamp}`,
          courseId,
          courseName,
          timestamp,
          category: 'grades',
          type: 'grade-add',
          description: `Grade added for ${item.assignmentName}: ${item.grade}`,
          details: { assignmentName: item.assignmentName, newValue: item.grade }
        });
      }
      return {
        ...item,
        timestamp,
        history: hasGrade ? [{ grade: item.grade, timestamp }] : []
      };
    } else if (prev.grade !== item.grade) {
      const history = [...(prev.history || [])];
      history.push({ grade: item.grade, timestamp });

      const prevHasGrade = prev.grade && prev.grade.indexOf("N/A") === -1 && prev.grade !== "";
      if (prevHasGrade) {
        detectedChanges.push({
          id: `${courseId}-grade-change-${item.assignmentName}-${timestamp}`,
          courseId,
          courseName,
          timestamp,
          category: 'grades',
          type: 'grade-change',
          description: `Grade changed for ${item.assignmentName}: ${prev.grade} → ${item.grade}`,
          details: { assignmentName: item.assignmentName, oldValue: prev.grade, newValue: item.grade }
        });
      } else {
        detectedChanges.push({
          id: `${courseId}-grade-add-${item.assignmentName}-${timestamp}`,
          courseId,
          courseName,
          timestamp,
          category: 'grades',
          type: 'grade-add',
          description: `Grade added for ${item.assignmentName}: ${item.grade}`,
          details: { assignmentName: item.assignmentName, newValue: item.grade }
        });
      }

      return {
        ...item,
        timestamp,
        history
      };
    } else {
      return {
        ...item,
        timestamp: prev.timestamp,
        history: prev.history || []
      };
    }
  });
  
  courses[courseId] = {
    id: courseId,
    name: courseName,
    type: 'canvas-grades',
    url: getEffectiveURL().href,
    lastChecked: timestamp,
    itemCount: updatedGrades.length
  };
  
  snapshots[courseId] = updatedGrades;
  const storageUpdate = { courses, snapshots };
  if (detectedChanges.length > 0) {
    storageUpdate.changeLog = [...detectedChanges, ...changeLog].slice(0, 1000);
    console.log(`LMS Monitor: Detected ${detectedChanges.length} student grade changes!`, detectedChanges);
  }
  
  await chrome.storage.local.set(storageUpdate);
  
  if (detectedChanges.length > 0) {
    chrome.runtime.sendMessage({
      type: 'CHANGES_DETECTED',
      payload: { courseId, courseName, changes: detectedChanges }
    });
  }
}

// Diff Instructor Gradebook
async function processInstructorGradesChanges(courseId, courseName, currentGradebook) {
  const { snapshots = {}, changeLog = [], courses = {} } = await chrome.storage.local.get(['snapshots', 'changeLog', 'courses']);
  const previousGradebook = snapshots[courseId] || [];
  const detectedChanges = [];
  const timestamp = Date.now();

  // Migrate legacy previous gradebook if they lack nested history/timestamp objects
  const fallbackTime = (courses[courseId] && courses[courseId].lastChecked) || (timestamp - 1000);
  const migratedPreviousGradebook = previousGradebook.map(prevStu => {
    const migratedGrades = {};
    for (const [assignment, val] of Object.entries(prevStu.grades || {})) {
      if (typeof val === 'string') {
        const hasScore = val !== "N/A" && val !== "";
        migratedGrades[assignment] = {
          score: val,
          timestamp: fallbackTime,
          history: hasScore ? [{ score: val, timestamp: fallbackTime }] : []
        };
      } else {
        migratedGrades[assignment] = val;
      }
    }
    return {
      ...prevStu,
      grades: migratedGrades
    };
  });

  const previousMap = new Map(migratedPreviousGradebook.map(s => [s.studentId, s]));
  
  const updatedGradebook = currentGradebook.map(student => {
    const prevStudent = previousMap.get(student.studentId);
    const newGradesObj = {};

    // Process current grades (which are raw score strings)
    for (const [assignment, score] of Object.entries(student.grades || {})) {
      const prevGradeObj = prevStudent ? prevStudent.grades[assignment] : undefined;
      const hasScore = score !== "N/A" && score !== "";
      
      if (!prevGradeObj) {
        newGradesObj[assignment] = {
          score,
          timestamp,
          history: hasScore ? [{ score, timestamp }] : []
        };
        
        if (hasScore) {
          detectedChanges.push({
            id: `${courseId}-grade-add-${student.studentId}-${assignment}-${timestamp}`,
            courseId,
            courseName,
            timestamp,
            category: 'grades',
            type: 'grade-add',
            description: `Grade entered for ${student.studentName} - ${assignment}: ${score}`,
            details: { studentName: student.studentName, assignmentName: assignment, newValue: score }
          });
        }
      } else if (prevGradeObj.score !== score) {
        const history = [...(prevGradeObj.history || [])];
        history.push({ score, timestamp });
        
        newGradesObj[assignment] = {
          score,
          timestamp,
          history
        };
        
        const prevHasScore = prevGradeObj.score && prevGradeObj.score !== "N/A" && prevGradeObj.score !== "";
        if (prevHasScore) {
          detectedChanges.push({
            id: `${courseId}-grade-change-${student.studentId}-${assignment}-${timestamp}`,
            courseId,
            courseName,
            timestamp,
            category: 'grades',
            type: 'grade-change',
            description: `Grade updated for ${student.studentName} - ${assignment}: ${prevGradeObj.score} → ${score}`,
            details: { studentName: student.studentName, assignmentName: assignment, oldValue: prevGradeObj.score, newValue: score }
          });
        } else if (hasScore) {
          detectedChanges.push({
            id: `${courseId}-grade-add-${student.studentId}-${assignment}-${timestamp}`,
            courseId,
            courseName,
            timestamp,
            category: 'grades',
            type: 'grade-add',
            description: `Grade entered for ${student.studentName} - ${assignment}: ${score}`,
            details: { studentName: student.studentName, assignmentName: assignment, newValue: score }
          });
        }
      } else {
        newGradesObj[assignment] = {
          score: prevGradeObj.score,
          timestamp: prevGradeObj.timestamp,
          history: prevGradeObj.history || []
        };
      }
    }

    // Keep any historical assignments not present in current scrape
    if (prevStudent) {
      for (const [assignment, prevGradeObj] of Object.entries(prevStudent.grades || {})) {
        if (newGradesObj[assignment] === undefined) {
          newGradesObj[assignment] = prevGradeObj;
        }
      }
    }

    return {
      studentId: student.studentId,
      studentName: student.studentName,
      studentEmail: student.studentEmail || (prevStudent ? prevStudent.studentEmail : ""),
      grades: newGradesObj
    };
  });
  
  // Student removal detection
  if (previousGradebook.length > 0) {
    const currentMap = new Map(currentGradebook.map(s => [s.studentId, s]));
    for (const [id, student] of previousMap.entries()) {
      if (!currentMap.has(id)) {
        detectedChanges.push({
          id: `${courseId}-student-remove-${id}-${timestamp}`,
          courseId,
          courseName,
          timestamp,
          category: 'grades',
          type: 'removal',
          description: `Student removed from gradebook: ${student.studentName}`,
          details: { studentName: student.studentName }
        });
      }
    }
  }
  
  courses[courseId] = {
    id: courseId,
    name: courseName,
    type: 'canvas-gradebook',
    url: getEffectiveURL().href,
    lastChecked: timestamp,
    itemCount: updatedGradebook.length
  };
  
  snapshots[courseId] = updatedGradebook;
  const storageUpdate = { courses, snapshots };
  if (detectedChanges.length > 0) {
    storageUpdate.changeLog = [...detectedChanges, ...changeLog].slice(0, 1000);
    console.log(`LMS Monitor: Detected ${detectedChanges.length} instructor gradebook changes!`, detectedChanges);
  }
  
  await chrome.storage.local.set(storageUpdate);
  
  if (detectedChanges.length > 0) {
    chrome.runtime.sendMessage({
      type: 'CHANGES_DETECTED',
      payload: { courseId, courseName, changes: detectedChanges }
    });
  }
}

// --- Dynamic Retry Scraping Runner ---
let scrapeAttempts = 0;
const maxScrapeAttempts = 5;

async function runScraperSequence() {
  scrapeAttempts++;
  initStatusWidget();
  updateWidget('scanning', `Scanning Canvas grades... (Attempt ${scrapeAttempts}/${maxScrapeAttempts})`);

  try {
    const res = await scrapeCanvasGrades();
    updateWidget('success', `Monitored successfully! Tracked ${res.count} items in ${res.type} mode.`);
    scrapeAttempts = 0;
  } catch (err) {
    console.warn(`LMS Monitor (Attempt ${scrapeAttempts} failed):`, err.message);
    
    if (scrapeAttempts < maxScrapeAttempts) {
      updateWidget('scanning', `Retrying scan... (Attempt ${scrapeAttempts + 1}/${maxScrapeAttempts})`);
      setTimeout(runScraperSequence, 2500);
    } else {
      updateWidget('error', `Failed to monitor course. ${err.message || 'Data structure not found'}.`);
      scrapeAttempts = 0;
    }
  }
}

async function checkMonitoringStatus() {
  const courseId = getCanvasCourseKey();
  if (!courseId) return;
  
  const { enabledCourses = {} } = await chrome.storage.local.get('enabledCourses');
  if (enabledCourses[courseId] === true) {
    runScraperSequence();
  } else {
    updateWidget('disabled', 'Monitoring is disabled for this course.');
  }
}

// Fire check on page load
setTimeout(checkMonitoringStatus, 1500);
