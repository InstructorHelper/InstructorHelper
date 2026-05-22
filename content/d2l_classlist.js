// Content Script for D2L Brightspace Classlist
console.log("LMS Monitor: D2L Classlist script injected");

// --- Shadow DOM Status Widget ---
let shadowRoot = null;
let widgetContainer = null;

function cleanD2LName(rawName) {
  if (!rawName) return "";
  // Strip parenthesized ID info like "(Id: 123456)" or "(123456)" or comma ID like ", 123456" at the end
  let cleaned = rawName.replace(/[,\s(]+(?:Id:\s*)?\d+\s*\)?\s*$/gi, "");
  // Replace multiple whitespace/punctuation characters with space, convert to lowercase
  return cleaned.replace(/\s+/g, ' ').trim();
}

function namesMatch(name1, name2) {
  const n1 = cleanD2LName(name1).toLowerCase();
  const n2 = cleanD2LName(name2).toLowerCase();
  if (n1 === n2) return true;

  // Split both names into alphabetical tokens (only words, discarding single characters/initials or punctuation)
  const getTokens = (nameStr) => {
    return nameStr
      .replace(/[^a-z\s]/gi, ' ') // replace punctuation/non-alpha with space
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length > 1); // ignore single-letter middle initials
  };

  const tokens1 = getTokens(n1).sort();
  const tokens2 = getTokens(n2).sort();

  if (tokens1.length === 0 || tokens2.length === 0) return false;

  const overlap = tokens1.filter(t => tokens2.includes(t));
  const minLength = Math.min(tokens1.length, tokens2.length);
  
  if (minLength <= 2) {
    return overlap.length === minLength;
  } else {
    return overlap.length >= 2 && overlap.length >= Math.ceil(minLength * 0.66);
  }
}

// Expose for testing
window.__d2l_classlist_test_exports = {
  cleanD2LName,
  namesMatch
};

function getD2LCourseId() {
  const urlParams = new URLSearchParams(window.location.search);
  const ouId = urlParams.get('ou');
  return ouId ? `d2l-${ouId}` : null;
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
  const courseId = getD2LCourseId();
  if (!courseId) return;
  
  const { enabledCourses = {} } = await chrome.storage.local.get('enabledCourses');
  enabledCourses[courseId] = true;
  await chrome.storage.local.set({ enabledCourses });
  
  runScraperSequence();
}

async function disableCourseMonitoring() {
  const courseId = getD2LCourseId();
  if (!courseId) return;
  
  const { enabledCourses = {}, courses = {}, snapshots = {} } = await chrome.storage.local.get(['enabledCourses', 'courses', 'snapshots']);
  enabledCourses[courseId] = false;
  
  // Clean up registered course details so it disappears from the popup dashboard
  delete courses[courseId];
  delete snapshots[courseId];
  
  await chrome.storage.local.set({ enabledCourses, courses, snapshots });
  updateWidget('disabled', 'Monitoring is disabled for this course.');
}

// Helper to wait for elements to load
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        observer.disconnect();
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for selector: ${selector}`));
    }, timeout);
  });
}

// Scrape course details and class list
async function scrapeD2LClasslist() {
  // Extract course ID (ou) from URL
  const urlParams = new URLSearchParams(window.location.search);
  const ouId = urlParams.get('ou');
  if (!ouId) {
    throw new Error("Course ID (ou) not found in URL query parameters");
  }
  const courseId = `d2l-${ouId}`;
  
  // Get previous snapshot to preserve orgId if it was already enriched or scraped before
  const storageData = await chrome.storage.local.get('snapshots');
  const previousStudents = (storageData.snapshots && storageData.snapshots[courseId]) || [];
  
  // Extract Course Name
  let courseName = "D2L Course " + ouId;
  const courseNameSelector = [
    '.d2l-navigation-s-title',
    '.d2l-navigation-s-link',
    'h1',
    '.d2l-page-title'
  ];
  for (const selector of courseNameSelector) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim()) {
      courseName = el.textContent.trim();
      break;
    }
  }
  
  // Scoring algorithm to find the absolute best classlist table on the page
  const tables = Array.from(document.querySelectorAll('table'));
  let bestTable = null;
  let maxScore = -1;
  let columnHeaders = [];
  let headerRow = null;
  
  console.log(`LMS Monitor: Analyzing ${tables.length} tables on page for classlist matches...`);
  
  for (const t of tables) {
    // Find the header row in this table
    const hr = t.querySelector('thead tr') || t.querySelector('tr[header]') || t.querySelector('tr.d_gh') || t.rows[0];
    if (!hr) continue;
    
    // Normalize headers by removing punctuation and collapsing whitespace
    const headers = Array.from(hr.cells).map(c => c.innerText.trim().toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim());
    
    let score = 0;
    if (headers.some(h => h.includes('name') || h.includes('student') || h.includes('user') || h.includes('participant') || h.includes('learner'))) score += 5;
    
    const isOrgIdHeader = h => h.includes('org defined') || h.includes('org id') || (h.includes('org') && h.includes('id'));
    if (headers.some(isOrgIdHeader)) score += 3;
    
    if (headers.some(h => h.includes('email') || h.includes('contact') || h.includes('mail'))) score += 3;
    if (headers.some(h => h.includes('role') || h.includes('group') || h.includes('status'))) score += 2;
    
    // Add small score based on row size
    const rowCount = t.rows ? t.rows.length : 0;
    if (rowCount > 0) {
      score += Math.min(rowCount * 0.1, 2);
    }
    
    if (score > maxScore && score >= 3) { // Require at least name column match
      maxScore = score;
      bestTable = t;
      columnHeaders = headers;
      headerRow = hr;
    }
  }
  
  if (!bestTable || !headerRow) {
    throw new Error("Could not find a valid classlist table on the page");
  }
  
  console.log(`LMS Monitor: Selected table with score ${maxScore}. Mapped column headers:`, columnHeaders);
  
  // Collect debug info for troubleshooting
  const tablesDebug = tables.map((t, idx) => {
    const hr = t.querySelector('thead tr') || t.querySelector('tr[header]') || t.querySelector('tr.d_gh') || t.rows[0];
    const headers = hr ? Array.from(hr.cells).map(c => c.innerText.trim().toLowerCase()) : [];
    return {
      index: idx,
      classes: t.className,
      rowsCount: t.rows ? t.rows.length : 0,
      headers: headers,
      htmlSnippet: t.outerHTML.substring(0, 500)
    };
  });
  
  await chrome.storage.local.set({
    debugLMSInfo: {
      url: window.location.href,
      timestamp: Date.now(),
      tablesCount: tables.length,
      tablesDebug,
      bodyHtmlSnippet: document.body.innerHTML.substring(0, 3000)
    }
  });
  
  // Find column indices in the selected header row
  const isOrgIdHeader = h => h.includes('org defined') || h.includes('org id') || (h.includes('org') && h.includes('id'));
  const nameColIdx = columnHeaders.findIndex(h => h.includes('name') || h.includes('student') || h.includes('user') || h.includes('participant') || h.includes('learner'));
  const orgIdColIdx = columnHeaders.findIndex(isOrgIdHeader);
  const usernameColIdx = columnHeaders.findIndex(h => h.includes('username') || h.includes('login') || h.includes('student id') || (h.includes('id') && !isOrgIdHeader(h)));
  const emailColIdx = columnHeaders.findIndex(h => h.includes('email') || h.includes('contact') || h.includes('mail'));
  const roleColIdx = columnHeaders.findIndex(h => h.includes('role') || h.includes('group') || h.includes('status'));
  
  const rows = Array.from(bestTable.querySelectorAll('tbody tr, tr'));
  const students = [];
  
  for (const row of rows) {
    // Skip if it is the header row
    if (row === headerRow || row.closest('thead') || row.classList.contains('d_gh') || row.hasAttribute('header')) {
      continue;
    }
    
    // Skip small or empty rows
    if (row.cells.length < Math.min(3, columnHeaders.length)) {
      continue;
    }
    
    let name = "";
    let orgId = "";
    let username = "";
    let email = "";
    let role = "Student";
    
    // Parse using mapped columns
    if (nameColIdx !== -1 && row.cells[nameColIdx]) {
      const nameLink = row.cells[nameColIdx].querySelector('a');
      const rawNameText = nameLink ? nameLink.innerText.trim() : row.cells[nameColIdx].innerText.trim();
      
      // Extract org ID from rawNameText if not already populated
      const idMatch = rawNameText.match(/[,\s(]+(?:Id:\s*)?(\d+)\s*\)?\s*$/i);
      if (idMatch) {
        orgId = idMatch[1];
      }
      
      name = cleanD2LName(rawNameText);
    }
    if (orgIdColIdx !== -1 && row.cells[orgIdColIdx]) {
      const colId = row.cells[orgIdColIdx].innerText.trim();
      if (colId) orgId = colId;
    }
    if (usernameColIdx !== -1 && row.cells[usernameColIdx]) {
      username = row.cells[usernameColIdx].innerText.trim();
    }
    if (emailColIdx !== -1 && row.cells[emailColIdx]) {
      const emailLink = row.cells[emailColIdx].querySelector('a[href^="mailto:"]');
      email = emailLink ? emailLink.getAttribute('href').replace('mailto:', '').trim() : row.cells[emailColIdx].innerText.trim();
    }
    if (roleColIdx !== -1 && row.cells[roleColIdx]) {
      role = row.cells[roleColIdx].innerText.trim();
    }
    
    // Fallback parser if column extraction failed
    if (!name || name === "Name" || name === "Image" || name === "Learner") {
      const mailtoLink = row.querySelector('a[href^="mailto:"]');
      if (mailtoLink) {
        email = mailtoLink.getAttribute('href').replace('mailto:', '').trim();
      }
      
      const links = Array.from(row.querySelectorAll('a:not([href^="mailto:"])'));
      const d2lLinks = links.filter(l => l.classList.contains('d2l-link') || l.href.includes('/d2l/'));
      let rawNameText = "";
      if (d2lLinks.length > 0) {
        rawNameText = d2lLinks[0].innerText.trim();
      } else if (links.length > 0) {
        rawNameText = links[0].innerText.trim();
      }
      
      if (rawNameText) {
        const idMatch = rawNameText.match(/[,\s(]+(?:Id:\s*)?(\d+)\s*\)?\s*$/i);
        if (idMatch) {
          orgId = idMatch[1];
        }
        name = cleanD2LName(rawNameText);
      }
    }

    // Email extraction fallbacks (e.g. for User List View where email column doesn't exist)
    if (!email) {
      const mailtoLink = row.querySelector('a[href^="mailto:"]');
      if (mailtoLink) {
        email = mailtoLink.getAttribute('href').replace('mailto:', '').trim();
      }
    }
    if (!email) {
      const emailMatch = row.outerHTML.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        email = emailMatch[0].trim();
      }
    }

    // Username fallback from email prefix
    if (email && !username) {
      username = email.split('@')[0];
    }
    
    // Cleanup Name formatting
    name = name.replace(/\s+/g, ' ').trim();
    
    // Skip if name matches header values or is empty
    if (!name || name.toLowerCase() === 'name' || name.toLowerCase() === 'image' || name.toLowerCase() === 'learner') {
      continue;
    }
    
    // Fallback: if orgId is missing, check if we have it in the previous snapshot
    if (!orgId) {
      const prevMatch = previousStudents.find(s => {
        if (username && s.username === username) return true;
        if (email && s.email && s.email.toLowerCase() === email.toLowerCase()) return true;
        if (name && s.name && s.name.toLowerCase() === name.toLowerCase()) return true;
        return false;
      });
      if (prevMatch && prevMatch.orgId) {
        orgId = prevMatch.orgId;
      }
    }

    // Use orgId as primary id, fallback to username, email, or name
    let studentId = orgId || username;
    if (!studentId) {
      studentId = email || name.replace(/\s+/g, '').toLowerCase();
    }
    
    students.push({ id: studentId, orgId, username, name, email, role });
  }
  
  if (students.length === 0) {
    throw new Error("Classlist table parsed but 0 students were found");
  }
  
  console.log(`LMS Monitor: Scraped ${students.length} students from classlist.`);
  await processClasslistChanges(courseId, courseName, students);
  return students.length;
}

// Diff classlist and save results
async function processClasslistChanges(courseId, courseName, currentStudents) {
  const { snapshots = {}, changeLog = [], courses = {} } = await chrome.storage.local.get(['snapshots', 'changeLog', 'courses']);
  
  const previousStudents = snapshots[courseId] || [];
  const detectedChanges = [];
  const timestamp = Date.now();
  
  const isFirstRun = previousStudents.length === 0;
  const mockUrl = document.querySelector('.url-input')?.value || '';
  const isClasslistPage = window.location.href.includes('classlist.d2l') || (window.location.href.includes('playground.html') && !mockUrl.includes('user_list_view.d2l'));
  
  const newSnapshot = [];
  const processedIncomingIndices = new Set();
  
  if (isFirstRun) {
    // Initial run: all students marked as 'initial' with first run timestamp
    for (const student of currentStudents) {
      newSnapshot.push({
        id: student.id,
        orgId: student.orgId,
        username: student.username,
        name: student.name,
        email: student.email,
        role: student.role,
        status: 'initial',
        timestamp: timestamp
      });
    }
  } else {
    // Subsequent runs: merge and track status transitions
    
    // Step 1: Match and merge previous students with current incoming ones
    for (const prev of previousStudents) {
      // Find a matching student in currentStudents
      let matchIdx = currentStudents.findIndex(curr => {
        if (curr.email && prev.email && curr.email.toLowerCase() !== prev.email.toLowerCase()) return false;
        if (curr.orgId && prev.orgId && curr.orgId === prev.orgId) return true;
        if (curr.username && prev.username && curr.username === prev.username) return true;
        if (curr.email && prev.email && curr.email.toLowerCase() === prev.email.toLowerCase()) return true;
        if (curr.name && prev.name && namesMatch(curr.name, prev.name)) return true;
        return false;
      });
      
      if (matchIdx !== -1) {
        const student = currentStudents[matchIdx];
        processedIncomingIndices.add(matchIdx);
        
        // Merge properties, preferring non-empty values
        const mergedOrgId = student.orgId || prev.orgId || "";
        const mergedUsername = student.username || prev.username || "";
        const mergedEmail = student.email || prev.email || "";
        const mergedRole = student.role || prev.role || "Student";
        
        // Determine primary ID: prefer orgId, fallback to prev.id, username, email, name
        let mergedId = mergedOrgId || prev.id || mergedUsername || mergedEmail || student.name.replace(/\s+/g, '').toLowerCase();
        
        if (prev.status === 'removed') {
          // Re-addition detected
          const updatedStudent = {
            id: mergedId,
            orgId: mergedOrgId,
            username: mergedUsername,
            name: student.name || prev.name,
            email: mergedEmail,
            role: mergedRole,
            status: 'added',
            timestamp: timestamp
          };
          newSnapshot.push(updatedStudent);
          
          detectedChanges.push({
            id: `${courseId}-add-${mergedId}-${timestamp}`,
            courseId,
            courseName,
            timestamp,
            category: 'classlist',
            type: 'addition',
            description: `Student added (previously removed): ${student.name} (${mergedId})`,
            details: { student: updatedStudent }
          });
        } else {
          // Keep active status
          const updatedStudent = {
            id: mergedId,
            orgId: mergedOrgId,
            username: mergedUsername,
            name: student.name || prev.name,
            email: mergedEmail,
            role: mergedRole,
            status: prev.status,
            timestamp: prev.timestamp
          };
          newSnapshot.push(updatedStudent);
          
          // Log changes if any
          if (prev.role !== mergedRole) {
            detectedChanges.push({
              id: `${courseId}-role-${mergedId}-${timestamp}`,
              courseId,
              courseName,
              timestamp,
              category: 'classlist',
              type: 'info-change',
              description: `Role updated for ${student.name}: ${prev.role} → ${mergedRole}`,
              details: { student: updatedStudent, oldValue: prev.role, newValue: mergedRole }
            });
          }
          if (!prev.orgId && mergedOrgId) {
            detectedChanges.push({
              id: `${courseId}-orgid-${mergedId}-${timestamp}`,
              courseId,
              courseName,
              timestamp,
              category: 'classlist',
              type: 'info-change',
              description: `Org ID linked for ${student.name}: ${mergedOrgId}`,
              details: { student: updatedStudent, oldValue: "", newValue: mergedOrgId }
            });
          }
        }
      } else {
        // No match in current scraping page.
        // If we are on classlist page, this is a removal. If we are on other pages (e.g. grades page), we keep them active.
        if (isClasslistPage) {
          if (prev.status === 'removed') {
            newSnapshot.push(prev);
          } else {
            const removedStudent = {
              id: prev.id,
              orgId: prev.orgId,
              username: prev.username,
              name: prev.name,
              email: prev.email,
              role: prev.role,
              status: 'removed',
              timestamp: timestamp
            };
            newSnapshot.push(removedStudent);
            
            detectedChanges.push({
              id: `${courseId}-remove-${prev.id}-${timestamp}`,
              courseId,
              courseName,
              timestamp,
              category: 'classlist',
              type: 'removal',
              description: `Student removed: ${prev.name} (${prev.id})`,
              details: { student: removedStudent }
            });
          }
        } else {
          // Keep previous student as is on grades/user list pages (no removal)
          newSnapshot.push(prev);
        }
      }
    }
    
    // Step 2: Add completely new students from currentStudents
    for (let idx = 0; idx < currentStudents.length; idx++) {
      if (!processedIncomingIndices.has(idx)) {
        const student = currentStudents[idx];
        const newStudent = {
          id: student.id,
          orgId: student.orgId || "",
          username: student.username || "",
          name: student.name,
          email: student.email || "",
          role: student.role || "Student",
          status: 'added',
          timestamp: timestamp
        };
        newSnapshot.push(newStudent);
        
        detectedChanges.push({
          id: `${courseId}-add-${student.id}-${timestamp}`,
          courseId,
          courseName,
          timestamp,
          category: 'classlist',
          type: 'addition',
          description: `Student added: ${student.name} (${student.id})`,
          details: { student: newStudent }
        });
      }
    }
  }
  
  // Update courses list metadata (itemCount counts active students only)
  const activeCount = newSnapshot.filter(s => s.status !== 'removed').length;
  courses[courseId] = {
    id: courseId,
    name: courseName,
    type: 'd2l-classlist',
    url: window.location.href,
    lastChecked: timestamp,
    itemCount: activeCount
  };
  
  // Save new snapshot
  snapshots[courseId] = newSnapshot;
  
  const storageUpdate = {
    courses,
    snapshots
  };
  
  if (detectedChanges.length > 0) {
    storageUpdate.changeLog = [...detectedChanges, ...changeLog].slice(0, 1000);
    console.log(`LMS Monitor: Detected ${detectedChanges.length} changes!`, detectedChanges);
  }
  
  await chrome.storage.local.set(storageUpdate);
  
  if (detectedChanges.length > 0) {
    chrome.runtime.sendMessage({
      type: 'CHANGES_DETECTED',
      payload: {
        courseId,
        courseName,
        changes: detectedChanges
      }
    });
  }
}

// --- Dynamic Retry Scraping Runner ---
let scrapeAttempts = 0;
const maxScrapeAttempts = 5;

async function runScraperSequence() {
  scrapeAttempts++;
  initStatusWidget();
  updateWidget('scanning', `Scanning classlist... (Attempt ${scrapeAttempts}/${maxScrapeAttempts})`);

  try {
    const studentCount = await scrapeD2LClasslist();
    updateWidget('success', `Monitored successfully! ${studentCount} students tracked.`);
    scrapeAttempts = 0; // reset
  } catch (err) {
    console.warn(`LMS Monitor (Attempt ${scrapeAttempts} failed):`, err.message);
    
    if (scrapeAttempts < maxScrapeAttempts) {
      updateWidget('scanning', `Retrying scan... (Attempt ${scrapeAttempts + 1}/${maxScrapeAttempts})`);
      setTimeout(runScraperSequence, 2500); // Wait 2.5s and retry
    } else {
      updateWidget('error', `Failed to monitor course. ${err.message || 'Table not found'}.`);
      scrapeAttempts = 0; // reset
    }
  }
}

async function checkMonitoringStatus() {
  const courseId = getD2LCourseId();
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
