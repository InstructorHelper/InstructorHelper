// Simplified Extension Popup Control Script

document.addEventListener('DOMContentLoaded', async () => {
  // Clear the extension badge count since the user has opened the panel
  await clearUnreadBadge();

  // Load and render high-level data
  await loadAndRenderData();

  // Setup routing buttons
  setupRoutingHandlers();
});

// Clear badge count
async function clearUnreadBadge() {
  try {
    await chrome.storage.local.set({ unreadCount: 0 });
    await chrome.action.setBadgeText({ text: '' });
  } catch (err) {
    console.error("Error updating badge:", err);
  }
}

// Open options page or playground
function setupRoutingHandlers() {
  document.getElementById('open-dashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });

  document.getElementById('open-playground').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('playground/playground.html') });
  });
}

// Load data and render simplified list
async function loadAndRenderData() {
  const { courses = {}, snapshots = {}, changeLog = [], courseLinks = {} } = await chrome.storage.local.get(['courses', 'snapshots', 'changeLog', 'courseLinks']);
  
  // Normalize course links for backward compatibility
  normalizeCourseLinks(courseLinks);
  
  const courseList = Object.values(courses);
  
  // Update courses count badge
  document.getElementById('courses-count').textContent = courseList.length;
  
  // Render Courses Status cards
  renderCourses(courseList, snapshots, courseLinks, courses);
  
  // Update status badge based on recent logs
  const globalStatus = document.getElementById('global-status');
  if (changeLog.length > 0) {
    const hoursSinceLastChange = (Date.now() - changeLog[0].timestamp) / 3600000;
    if (hoursSinceLastChange < 24) {
      globalStatus.textContent = "Updates Detected";
      globalStatus.style.color = "var(--orange)";
      globalStatus.style.backgroundColor = "var(--orange-glow)";
      globalStatus.style.borderColor = "hsla(35, 92%, 55%, 0.3)";
    } else {
      globalStatus.textContent = "Monitoring";
      globalStatus.style.color = "var(--green)";
      globalStatus.style.backgroundColor = "var(--green-glow)";
      globalStatus.style.borderColor = "hsla(150, 84%, 40%, 0.3)";
    }
  } else {
    globalStatus.textContent = "Idle";
    globalStatus.style.color = "var(--text-muted)";
    globalStatus.style.backgroundColor = "var(--border-glass)";
    globalStatus.style.borderColor = "var(--border-glass)";
  }
}

// Render active course status list
function renderCourses(courses, snapshots = {}, courseLinks = {}, coursesMap = {}) {
  const container = document.getElementById('course-list-container');
  container.innerHTML = '';
  
  if (courses.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No courses actively monitored yet.</p>
        <span class="instruction">Visit D2L Classlist or Canvas Gradebook pages to start tracking.</span>
      </div>
    `;
    return;
  }
  
  // Sort courses by last Checked time
  courses.sort((a, b) => b.lastChecked - a.lastChecked).forEach(course => {
    const card = document.createElement('div');
    card.className = `course-card ${course.type}`;
    
    const formattedTime = formatTimeAgo(course.lastChecked);
    let typeDisplay = "Canvas Gradebook";
    if (course.type === 'd2l-classlist') typeDisplay = "D2L Classlist";
    if (course.type === 'canvas-grades') typeDisplay = "Canvas Grades (Student)";
    
    // Calculate simple high-level status indicator
    let statusBadgeHtml = '';
    if (course.type === 'd2l-classlist') {
      const linkedCanvasIds = courseLinks[course.id] || [];
      if (linkedCanvasIds.length === 0) {
        statusBadgeHtml = `<span class="course-status-pill unlinked">⚪ Unlinked</span>`;
      } else {
        const d2lStudents = (snapshots[course.id] || []).filter(s => s.status !== 'removed');
        const { missingFromCanvas, extraInCanvas } = compareRostersMultiple(d2lStudents, linkedCanvasIds, snapshots, coursesMap);
        const discrepancies = missingFromCanvas.length + extraInCanvas.length;
        if (discrepancies > 0) {
          statusBadgeHtml = `<span class="course-status-pill mismatch">⚠️ ${discrepancies} discrepancies</span>`;
        } else {
          statusBadgeHtml = `<span class="course-status-pill synced">✅ Synced</span>`;
        }
      }
    } else {
      const totalStudents = (snapshots[course.id] || []).length;
      statusBadgeHtml = `<span class="course-status-pill active-scraped">✅ Scraped (${totalStudents} students)</span>`;
    }
    
    card.innerHTML = `
      <div class="course-header">
        <h3 class="course-name" title="${course.name}">${course.name}</h3>
        <span class="course-type">${typeDisplay}</span>
      </div>
      <div class="course-meta">
        <span>Last Checked: ${formattedTime}</span>
        ${statusBadgeHtml}
      </div>
    `;
    
    // Clicking a card routes user directly to that course LMS page
    card.addEventListener('click', () => {
      chrome.tabs.create({ url: course.url });
    });
    
    container.appendChild(card);
  });
}

// Friendly time formatter
function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Never';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// Name normalization helper: converts "Last, First" -> "first last", lowercase, alphanumeric
function normalizeName(name) {
  if (!name) return "";
  
  // Convert to lowercase and trim
  let normalized = name.toLowerCase().trim();
  
  // If it contains a comma (like "Last, First"), split and reverse it
  if (normalized.includes(',')) {
    const parts = normalized.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const last = parts[0];
      const first = parts.slice(1).join(' ');
      normalized = `${first} ${last}`;
    }
  }
  
  // Remove non-alphanumeric characters except spaces
  normalized = normalized.replace(/[^a-z0-9\s]/g, '');
  // Collapse multiple spaces to a single space
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

// Compare two names with middle initial tolerance
function nameMatch(name1, name2) {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  
  // Fallback: compare first and last words
  const tokens1 = n1.split(' ');
  const tokens2 = n2.split(' ');
  if (tokens1.length >= 2 && tokens2.length >= 2) {
    const first1 = tokens1[0];
    const last1 = tokens1[tokens1.length - 1];
    const first2 = tokens2[0];
    const last2 = tokens2[tokens2.length - 1];
    if (first1 === first2 && last1 === last2) {
      return true;
    }
  }
  return false;
}

// Normalize email helper
function normalizeEmail(email) {
  return email ? email.trim().toLowerCase() : "";
}

// Roster comparison logic
function compareRosters(d2lStudents, canvasStudents) {
  const missingFromCanvas = [];
  const extraInCanvas = [];
  
  // For each D2L student, try to find a matching Canvas student
  d2lStudents.forEach(d2lStu => {
    const d2lEmail = normalizeEmail(d2lStu.email);
    
    const matched = canvasStudents.find(canvasStu => {
      const canvasEmail = normalizeEmail(canvasStu.studentEmail);
      
      // Use email-first matching: only match if both emails exist and match
      if (d2lEmail && canvasEmail) {
        return d2lEmail === canvasEmail;
      }
      // If either email is missing, don't match (strict email-based matching)
      return false;
    });
    
    if (!matched) {
      missingFromCanvas.push(d2lStu);
    }
  });
  
  // For each Canvas student, try to find a matching D2L student
  canvasStudents.forEach(canvasStu => {
    const canvasEmail = normalizeEmail(canvasStu.studentEmail);
    
    const matched = d2lStudents.find(d2lStu => {
      const d2lEmail = normalizeEmail(d2lStu.email);
      
      // Use email-first matching: only match if both emails exist and match
      if (d2lEmail && canvasEmail) {
        return d2lEmail === canvasEmail;
      }
      // If either email is missing, don't match (strict email-based matching)
      return false;
    });
    
    if (!matched) {
      extraInCanvas.push(canvasStu);
    }
  });
  
  return { missingFromCanvas, extraInCanvas };
}

// Compare rosters across multiple linked Canvas courses
function compareRostersMultiple(d2lStudents, canvasCourseIds, snapshots, coursesMap) {
  const missingFromCanvas = [];
  const extraInCanvas = [];

  d2lStudents.forEach(d2lStu => {
    const d2lEmail = normalizeEmail(d2lStu.email);
    const missingFromCourses = [];

    canvasCourseIds.forEach(canvasCourseId => {
      const canvasStudents = snapshots[canvasCourseId] || [];
      const matched = canvasStudents.find(canvasStu => {
        const canvasEmail = normalizeEmail(canvasStu.studentEmail);

        // Use email-first matching: only match if both emails exist and match
        if (d2lEmail && canvasEmail) {
          return d2lEmail === canvasEmail;
        }
        // If either email is missing, don't match (strict email-based matching)
        return false;
      });

      if (!matched) {
        const courseName = coursesMap[canvasCourseId]?.name || `Canvas Course ${canvasCourseId}`;
        missingFromCourses.push({ id: canvasCourseId, name: courseName });
      }
    });

    if (missingFromCourses.length > 0) {
      missingFromCanvas.push({
        student: d2lStu,
        missingFrom: missingFromCourses
      });
    }
  });

  canvasCourseIds.forEach(canvasCourseId => {
    const canvasStudents = snapshots[canvasCourseId] || [];
    const courseName = coursesMap[canvasCourseId]?.name || `Canvas Course ${canvasCourseId}`;

    canvasStudents.forEach(canvasStu => {
      const canvasEmail = normalizeEmail(canvasStu.studentEmail);

      const matched = d2lStudents.find(d2lStu => {
        const d2lEmail = normalizeEmail(d2lStu.email);

        // Use email-first matching: only match if both emails exist and match
        if (d2lEmail && canvasEmail) {
          return d2lEmail === canvasEmail;
        }
        // If either email is missing, don't match (strict email-based matching)
        return false;
      });

      if (!matched) {
        extraInCanvas.push({
          student: canvasStu,
          extraIn: { id: canvasCourseId, name: courseName }
        });
      }
    });
  });

  return { missingFromCanvas, extraInCanvas };
}

// Normalize course links map
function normalizeCourseLinks(courseLinks) {
  let updated = false;
  for (const d2lId in courseLinks) {
    if (typeof courseLinks[d2lId] === 'string') {
      courseLinks[d2lId] = [courseLinks[d2lId]];
      updated = true;
    } else if (!Array.isArray(courseLinks[d2lId])) {
      courseLinks[d2lId] = [];
      updated = true;
    }
  }
  return updated;
}
