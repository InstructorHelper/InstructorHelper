// LMS Monitor Dashboard Controller Script

// Mock chrome extension API if running in a standalone web browser context
if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
  const mockStorage = {
    _getRaw: function() {
      try {
        return JSON.parse(localStorage.getItem('mock_chrome_storage') || '{}');
      } catch (e) {
        return {};
      }
    },
    _setRaw: function(data) {
      localStorage.setItem('mock_chrome_storage', JSON.stringify(data));
    },
    get: async function(keys) {
      const data = this._getRaw();
      if (keys === null) {
        return { ...data };
      }
      const result = {};
      let keysArr = [];
      if (Array.isArray(keys)) {
        keysArr = keys;
      } else if (typeof keys === 'string') {
        keysArr = [keys];
      } else if (typeof keys === 'object') {
        keysArr = Object.keys(keys);
      }
      keysArr.forEach(k => {
        result[k] = data[k] !== undefined ? data[k] : (typeof keys === 'object' ? keys[k] : undefined);
      });
      return result;
    },
    set: async function(items) {
      const data = this._getRaw();
      Object.assign(data, items);
      this._setRaw(data);
      return {};
    },
    clear: async function() {
      this._setRaw({});
      return {};
    }
  };
  
  window.chrome = {
    storage: {
      local: mockStorage,
      onChanged: {
        addListener: () => {}
      }
    },
    action: {
      setBadgeText: () => {}
    },
    runtime: {
      sendMessage: () => {}
    }
  };
  console.log("Dashboard: Local mock of chrome.storage (with localStorage persistence) and chrome.runtime initialized.");
}

let state = {
  selectedCourseId: null,
  courses: {},
  snapshots: {},
  changeLog: [],
  courseLinks: {}
};

document.addEventListener('DOMContentLoaded', async () => {
  // Clear the extension badge count when the dashboard is opened
  await clearUnreadBadge();

  // Initialize navigation tabs
  setupTabs();
  
  // Load and render all data
  await loadAndRenderData();

  // Register settings buttons
  setupActionHandlers();

  // Listen to storage changes for real-time dashboard updates
  chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local') {
      await loadAndRenderData();
    }
  });
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

// Navigation tabs control
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-link');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Deactivate all tabs and contents
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Activate selected tab
      tab.classList.add('active');
      const contentId = tab.getAttribute('data-tab');
      document.getElementById(contentId).classList.add('active');
    });
  });
}

// Load and Render Courses & Logs
async function loadAndRenderData() {
  const data = await chrome.storage.local.get(['courses', 'snapshots', 'changeLog', 'courseLinks', 'dismissCanvasGradebookAlert']);
  state.courses = data.courses || {};
  state.snapshots = data.snapshots || {};
  state.changeLog = data.changeLog || [];
  state.courseLinks = data.courseLinks || {};
  state.dismissCanvasGradebookAlert = !!data.dismissCanvasGradebookAlert;
  
  // Normalize course links for backward compatibility (string -> string array)
  const linksUpdated = normalizeCourseLinks(state.courseLinks);
  if (linksUpdated) {
    await chrome.storage.local.set({ courseLinks: state.courseLinks });
  }
  
  const courseList = Object.values(state.courses);
  
  // Update counts
  document.getElementById('courses-count').textContent = courseList.length;
  document.getElementById('logs-count').textContent = state.changeLog.length;
  
  // Render Sidebar Monitored Courses
  renderSidebarCourses(courseList);
  
  // Render Detailed Panel (Selected Course)
  renderDetailedPanel();
  
  // Render Logs
  renderLogs();
  
  // Update global status badge based on recent logs
  updateGlobalStatus();
}

// Update status badge based on recent logs
function updateGlobalStatus() {
  const globalStatus = document.getElementById('global-status');
  if (!globalStatus) return;

  if (state.changeLog.length > 0) {
    const hoursSinceLastChange = (Date.now() - state.changeLog[0].timestamp) / 3600000;
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

// Render monitored course items in sidebar
function renderSidebarCourses(courseList) {
  const container = document.getElementById('course-list-container');
  container.innerHTML = '';
  
  if (courseList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No courses actively monitored yet.</p>
        <span class="instruction">Visit your school's D2L Classlist or Canvas Gradebook pages to start tracking.</span>
      </div>
    `;
    return;
  }
  
  // Sort courses: D2L first, then Canvas, then by name
  const sorted = [...courseList].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'd2l-classlist' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  sorted.forEach(course => {
    const item = document.createElement('div');
    item.className = `course-item ${course.type}`;
    if (state.selectedCourseId === course.id) {
      item.classList.add('active');
    }
    
    let typeDisplay = "Canvas Gradebook";
    if (course.type === 'd2l-classlist') typeDisplay = "D2L Classlist";
    if (course.type === 'canvas-grades') typeDisplay = "Canvas Grades (Student)";
    
    // Calculate status pill details if D2L class list
    let statusPillHtml = '';
    if (course.type === 'd2l-classlist') {
      const linkedCanvasIds = state.courseLinks[course.id] || [];
      if (linkedCanvasIds.length === 0) {
        statusPillHtml = `<span class="course-item-status-pill unlinked">Unlinked</span>`;
      } else {
        const d2lStudents = (state.snapshots[course.id] || []).filter(s => s.status !== 'removed');
        const { missingFromCanvas, extraInCanvas } = compareRostersMultiple(d2lStudents, linkedCanvasIds, state.snapshots, state.courses);
        const diffCount = missingFromCanvas.length + extraInCanvas.length;
        if (diffCount > 0) {
          statusPillHtml = `<span class="course-item-status-pill mismatch">${diffCount} Mismatches</span>`;
        } else {
          statusPillHtml = `<span class="course-item-status-pill synced">Synced</span>`;
        }
      }
    } else {
      const studentList = state.snapshots[course.id] || [];
      statusPillHtml = `<span class="course-item-status-pill synced">${studentList.length} Students</span>`;
    }
    
    item.innerHTML = `
      <div class="course-item-header">
        <h3 class="course-item-name" title="${course.name}">${course.name}</h3>
        <span class="course-item-type">${typeDisplay}</span>
      </div>
      <div class="course-item-meta">
        <span>Scanned ${formatTimeAgo(course.lastChecked)}</span>
      </div>
      ${statusPillHtml}
    `;
    
    item.addEventListener('click', () => {
      state.selectedCourseId = course.id;
      // Re-render sidebar to highlight active
      document.querySelectorAll('.course-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      renderDetailedPanel();
    });
    
    container.appendChild(item);
  });
}

// Render detailed operations panel for selected course
function renderDetailedPanel() {
  const container = document.getElementById('main-panel-container');
  
  if (!state.selectedCourseId || !state.courses[state.selectedCourseId]) {
    container.classList.remove('full-height-layout');
    container.innerHTML = `
      <div class="no-selection-state">
        <div class="no-selection-card">
          <span class="large-icon">👈</span>
          <h2>Select a Course</h2>
          <p>Choose a monitored course from the sidebar to link sections, view roster discrepancies, copy student emails, and manage snapshots.</p>
        </div>
      </div>
    `;
    return;
  }
  
  const course = state.courses[state.selectedCourseId];
  
  if (course.type === 'canvas-gradebook') {
    container.classList.add('full-height-layout');
  } else {
    container.classList.remove('full-height-layout');
  }

  const snapshot = state.snapshots[course.id] || [];
  const formattedTime = new Date(course.lastChecked).toLocaleString();
  
  let typeDisplay = "Canvas Gradebook";
  if (course.type === 'd2l-classlist') typeDisplay = "D2L Classlist";
  if (course.type === 'canvas-grades') typeDisplay = "Canvas Grades (Student)";
  
  // Render D2L Classlist operations layout
  if (course.type === 'd2l-classlist') {
    const linkedCanvasIds = state.courseLinks[course.id] || [];
    const canvasCourses = Object.values(state.courses).filter(c => c.type === 'canvas-gradebook');
    const unlinkedCanvasCourses = canvasCourses.filter(cc => !linkedCanvasIds.includes(cc.id));
    
    // Roster Emails
    const d2lEmails = snapshot.filter(s => s.status !== 'removed').map(s => s.email).filter(e => e);
    
    // Linked Courses Badge Tags
    let badgesHtml = '';
    if (linkedCanvasIds.length > 0) {
      badgesHtml = `
        <div class="linked-tags-list">
          ${linkedCanvasIds.map(id => {
            const cName = state.courses[id]?.name || `Canvas Course ${id}`;
            return `
              <span class="linked-tag">
                🔗 ${cName}
                <button class="unlink-badge-btn" data-canvas-id="${id}" title="Unlink course">×</button>
              </span>
            `;
          }).join('')}
        </div>
      `;
    } else {
      badgesHtml = `<span class="linked-label text-muted" style="font-style: italic; font-weight: normal;">No Canvas courses linked yet.</span>`;
    }
    
    // Select dropdown to link another Canvas course
    let linkDropdownHtml = '';
    if (unlinkedCanvasCourses.length > 0) {
      linkDropdownHtml = `
        <div class="link-dropdown-row">
          <label for="link-select-dropdown">${linkedCanvasIds.length > 0 ? 'Link another Canvas Course:' : 'Link to Canvas Course:'}</label>
          <select id="link-select-dropdown" class="link-select">
            <option value="">-- Choose Canvas Course to Link --</option>
            ${unlinkedCanvasCourses.map(cc => `
              <option value="${cc.id}">${cc.name}</option>
            `).join('')}
          </select>
        </div>
      `;
    }
    
    // Roster Mismatch Comparison Panel
    let comparisonHtml = '';
    if (linkedCanvasIds.length > 0) {
      const activeStudents = snapshot.filter(s => s.status !== 'removed');
      const { missingFromCanvas, extraInCanvas } = compareRostersMultiple(activeStudents, linkedCanvasIds, state.snapshots, state.courses);
      
      let bannerClass = 'success';
      let bannerText = '✅ Roster Synchronized: No discrepancies detected between D2L and Canvas.';
      let mismatchListsHtml = '';
      
      if (missingFromCanvas.length > 0 || extraInCanvas.length > 0) {
        bannerClass = 'warning';
        bannerText = `⚠️ Roster Discrepancies: detected ${missingFromCanvas.length + extraInCanvas.length} unmatched records.`;
        
        let missingColHtml = `
          <div class="mismatch-col">
            <div class="mismatch-col-header">
              <span class="mismatch-col-title">Missing from Canvas (${missingFromCanvas.length})</span>
              ${missingFromCanvas.length > 0 ? `<button class="copy-btn" id="copy-all-missing">📋 Copy All Emails</button>` : ''}
            </div>
            <div class="mismatch-table-container">
              ${missingFromCanvas.length === 0 ? `
                <div style="padding: 16px; color: var(--text-muted); text-align: center; font-size: 13px;">No students missing from Canvas.</div>
              ` : `
                <div class="mismatch-list-group">
                  ${missingFromCanvas.map(item => {
                    const stu = item.student;
                    const displayEmail = stu.email || 'No email';
                    const copyAction = stu.email ? `<button class="copy-small-btn" data-email="${stu.email}">📋 Copy</button>` : '';
                    const missingFromNames = item.missingFrom.map(c => c.name).join(', ');
                    return `
                      <div class="mismatch-row">
                        <div class="student-identity">
                          <span class="student-name">${stu.name}${stu.orgId ? ` (${stu.orgId})` : ''}</span>
                          <div class="student-meta">
                            <span>${displayEmail}</span>
                            <span class="mismatch-target-badge">missing from ${missingFromNames}</span>
                          </div>
                        </div>
                        ${copyAction}
                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            </div>
          </div>
        `;
        
        let extraColHtml = `
          <div class="mismatch-col">
            <div class="mismatch-col-header">
              <span class="mismatch-col-title">Extra in Canvas (${extraInCanvas.length})</span>
            </div>
            <div class="mismatch-table-container">
              ${extraInCanvas.length === 0 ? `
                <div style="padding: 16px; color: var(--text-muted); text-align: center; font-size: 13px;">No extra students in Canvas.</div>
              ` : `
                <div class="mismatch-list-group">
                  ${extraInCanvas.map(item => {
                    const stu = item.student;
                    const displayEmail = stu.studentEmail || 'No email';
                    return `
                      <div class="mismatch-row">
                        <div class="student-identity">
                          <span class="student-name">${stu.studentName}</span>
                          <div class="student-meta">
                            <span>${displayEmail}</span>
                            <span class="mismatch-target-badge">extra in ${item.extraIn.name}</span>
                          </div>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            </div>
          </div>
        `;
        
        mismatchListsHtml = `
          <div class="mismatch-grid">
            ${missingColHtml}
            ${extraColHtml}
          </div>
        `;
      }
      
      comparisonHtml = `
        <div class="detail-panel">
          <h3 class="detail-panel-title">Roster Comparison</h3>
          <div class="comparison-status-banner ${bannerClass}">${bannerText}</div>
          ${mismatchListsHtml}
        </div>
      `;
    }
    
    // Scraped Roster List (Collapsible details)
    let rawRosterHtml = `
      <div class="roster-disclosure" id="raw-roster-disclosure">
        <div class="roster-disclosure-trigger" id="roster-toggle-trigger">
          <span>Show Full Monitored D2L Roster (${snapshot.length} students)</span>
          <svg class="arrow-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        <div class="roster-disclosure-content">
          <table class="raw-roster-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Org ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Student ID</th>
                <th>Added / Removed</th>
                <th>Activity Time</th>
              </tr>
            </thead>
            <tbody>
              ${snapshot.map((stu, i) => {
                const status = stu.status || 'initial';
                const timestamp = stu.timestamp || course.lastChecked || Date.now();
                const timeStr = new Date(timestamp).toLocaleString();
                
                let statusLabel = 'Initial Setup';
                if (status === 'added') statusLabel = 'Added';
                if (status === 'removed') statusLabel = 'Removed';
                
                const rowClass = status === 'removed' ? 'class="status-removed-row"' : '';
                return `
                  <tr ${rowClass}>
                    <td>${i + 1}</td>
                    <td style="font-family: monospace;">${stu.orgId || '—'}</td>
                    <td style="font-weight: 500;">${stu.name}</td>
                    <td>${stu.email || '—'}</td>
                    <td style="font-family: monospace;">${stu.username || stu.id || '—'}</td>
                    <td><span class="roster-status-badge status-${status}">${statusLabel}</span></td>
                    <td>${timeStr}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    container.innerHTML = `
      <div class="course-detail-layout">
        <!-- Header -->
        <div class="course-detail-header">
          <div class="course-title-section">
            <h2>${course.name}</h2>
            <div class="course-detail-meta">
              <span>Platform: <strong>${typeDisplay}</strong></span>
              <span>Last Checked: <strong>${formattedTime}</strong></span>
              <span>Scanned Students: <strong>${snapshot.length}</strong></span>
            </div>
          </div>
          <div class="course-detail-actions">
            <button class="btn btn-secondary" id="toggle-sidebar" title="Toggle Sidebar">
              <svg class="sidebar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
              </svg>
              <span>Collapse Sidebar</span>
            </button>
            ${d2lEmails.length > 0 ? `<button class="copy-btn" id="copy-all-emails">📋 Copy Monitored Emails</button>` : ''}
            <button class="btn btn-secondary" id="visit-course-url">🔗 Visit Classlist Page</button>
          </div>
        </div>
        
        <!-- Linking Panel -->
        <div class="detail-panel">
          <h3 class="detail-panel-title">Canvas Linking & Matching</h3>
          <div class="linking-bar">
            <div class="linked-tags-row">
              <span class="linked-label">Linked Canvas Sections:</span>
              ${badgesHtml}
            </div>
            ${linkDropdownHtml}
          </div>
        </div>
        
        <!-- Comparison Panel -->
        ${comparisonHtml}
        
        <!-- Raw Roster Panel -->
        ${rawRosterHtml}
      </div>
    `;
    
    // Wire D2L Event Listeners
    // Visit Course URL
    document.getElementById('visit-course-url').addEventListener('click', () => {
      chrome.tabs.create({ url: course.url });
    });
    
    // Unlink Course Badge click
    const unlinkBtns = container.querySelectorAll('.unlink-badge-btn');
    unlinkBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const canvasId = btn.getAttribute('data-canvas-id');
        const canvasCourseName = state.courses[canvasId]?.name || `Canvas Course ${canvasId}`;
        if (confirm(`Are you sure you want to unlink from "${canvasCourseName}"?`)) {
          const links = state.courseLinks[course.id] || [];
          const updatedLinks = links.filter(id => id !== canvasId);
          if (updatedLinks.length === 0) {
            delete state.courseLinks[course.id];
          } else {
            state.courseLinks[course.id] = updatedLinks;
          }
          await chrome.storage.local.set({ courseLinks: state.courseLinks });
          await loadAndRenderData();
        }
      });
    });
    
    // Link Course dropdown change
    const linkDropdown = document.getElementById('link-select-dropdown');
    if (linkDropdown) {
      linkDropdown.addEventListener('change', async (e) => {
        const canvasCourseId = e.target.value;
        if (!canvasCourseId) return;
        
        if (!state.courseLinks[course.id]) {
          state.courseLinks[course.id] = [];
        }
        
        if (!state.courseLinks[course.id].includes(canvasCourseId)) {
          state.courseLinks[course.id].push(canvasCourseId);
        }
        
        await chrome.storage.local.set({ courseLinks: state.courseLinks });
        await loadAndRenderData();
      });
    }
    
    // Copy Monitored Emails button
    const copyAllEmailsBtn = document.getElementById('copy-all-emails');
    if (copyAllEmailsBtn) {
      copyAllEmailsBtn.addEventListener('click', async () => {
        const emailList = d2lEmails.join(', ');
        try {
          await navigator.clipboard.writeText(emailList);
          copyAllEmailsBtn.classList.add('copied');
          copyAllEmailsBtn.textContent = '✅ Copied Emails!';
          setTimeout(() => {
            copyAllEmailsBtn.classList.remove('copied');
            copyAllEmailsBtn.textContent = '📋 Copy Monitored Emails';
          }, 2000);
        } catch (err) {
          console.error('Clipboard copy failed:', err);
        }
      });
    }
    
    // Copy All Missing Emails button
    const copyAllMissingBtn = document.getElementById('copy-all-missing');
    if (copyAllMissingBtn) {
      copyAllMissingBtn.addEventListener('click', async () => {
        const activeStudents = snapshot.filter(s => s.status !== 'removed');
        const { missingFromCanvas } = compareRostersMultiple(activeStudents, linkedCanvasIds, state.snapshots, state.courses);
        const missingEmails = missingFromCanvas
          .map(item => item.student.email)
          .filter(email => email)
          .join(', ');
        
        if (missingEmails) {
          try {
            await navigator.clipboard.writeText(missingEmails);
            copyAllMissingBtn.classList.add('copied');
            copyAllMissingBtn.textContent = '✅ Copied Missing!';
            setTimeout(() => {
              copyAllMissingBtn.classList.remove('copied');
              copyAllMissingBtn.textContent = '📋 Copy All Emails';
            }, 2000);
          } catch (err) {
            console.error('Clipboard copy failed:', err);
          }
        }
      });
    }
    
    // Copy Single Mismatch Email buttons
    const copySmallBtns = container.querySelectorAll('.copy-small-btn');
    copySmallBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const email = btn.getAttribute('data-email');
        if (email) {
          try {
            await navigator.clipboard.writeText(email);
            const originalText = btn.textContent;
            btn.classList.add('copied');
            btn.textContent = '✅';
            setTimeout(() => {
              btn.classList.remove('copied');
              btn.textContent = originalText;
            }, 1500);
          } catch (err) {
            console.error(err);
          }
        }
      });
    });
    
    // Roster Toggle Collapsible Trigger
    const rosterTrigger = document.getElementById('roster-toggle-trigger');
    const rosterDisclosure = document.getElementById('raw-roster-disclosure');
    if (rosterTrigger && rosterDisclosure) {
      rosterTrigger.addEventListener('click', () => {
        rosterDisclosure.classList.toggle('open');
      });
    }

    // Wire Sidebar Toggle
    wireSidebarToggle();
  } 
  // Render Canvas Course operations layout
  else {
    let mainContentHtml = '';
    let infoAlertHtml = '';

    if (course.type === 'canvas-grades') {
      infoAlertHtml = `
        <div class="detail-panel" style="background: hsla(199, 89%, 48%, 0.05); border-color: hsla(199, 89%, 48%, 0.25);">
          <h3 class="detail-panel-title" style="color: var(--blue);">💡 Canvas Student Grades Snapshot</h3>
          <p style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-muted);">
            This snapshot contains assignments and grades scanned directly from your Canvas student grades view.
            It tracks the date, time, and timeline history of when assignments were graded.
          </p>
        </div>
      `;

      mainContentHtml = `
        <div class="roster-disclosure open" id="raw-roster-disclosure" style="margin-top: 10px;">
          <div class="roster-disclosure-trigger" id="roster-toggle-trigger">
            <span>Assignments & Grades (${snapshot.length} items)</span>
            <svg class="arrow-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          <div class="roster-disclosure-content" style="display: block;">
            <table class="raw-roster-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Assignment Name</th>
                  <th>Current Grade</th>
                  <th>Last Updated</th>
                  <th>Grade History Timeline</th>
                </tr>
              </thead>
              <tbody>
                ${snapshot.map((item, i) => {
                  const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleString() : '—';
                  const historyHtml = (item.history && item.history.length > 0)
                    ? `<div class="grade-history-timeline">
                         ${item.history.map(h => `
                           <div class="timeline-step">
                             <span class="timeline-grade">${h.grade}</span>
                             <span class="timeline-time">${new Date(h.timestamp).toLocaleString()}</span>
                           </div>
                         `).join('')}
                       </div>`
                    : '<span class="text-muted">No edits</span>';
                  return `
                    <tr>
                      <td>${i + 1}</td>
                      <td style="font-weight: 500;">${item.assignmentName}</td>
                      <td style="font-weight: bold; color: var(--accent-color);">${item.grade || '—'}</td>
                      <td>${timeStr}</td>
                      <td>${historyHtml}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      if (state.dismissCanvasGradebookAlert) {
        infoAlertHtml = '';
      } else {
        infoAlertHtml = `
          <div class="detail-panel info-alert" style="background: hsla(199, 89%, 48%, 0.05); border-color: hsla(199, 89%, 48%, 0.25); position: relative; padding-right: 40px;">
            <button class="close-alert-btn" id="close-info-alert" title="Dismiss Alert" style="position: absolute; top: 12px; right: 16px; background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; line-height: 1; transition: color 0.2s;">&times;</button>
            <h3 class="detail-panel-title" style="color: var(--blue);">💡 Canvas Gradebook Snapshot</h3>
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-muted);">
              This Canvas course snapshot contains student rosters and grades scanned directly from the LMS page. 
              To compare this roster against your class list, go to the corresponding <strong>D2L Classlist</strong> and link it to this course under the Linking Panel.
              Click on a student's row to expand and view assignment grades and history.
            </p>
          </div>
        `;
      }

      mainContentHtml = `
        <div class="roster-disclosure open" id="raw-roster-disclosure" style="margin-top: 10px;">
          <div class="roster-disclosure-trigger" id="roster-toggle-trigger">
            <span>Scraped Canvas Gradebook Roster (${snapshot.length} students)</span>
            <svg class="arrow-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          <div class="roster-disclosure-content" style="display: block;">
            <table class="raw-roster-table canvas-instructor-roster-table">
              <thead>
                <tr>
                  <th style="width: 40px;"></th>
                  <th>#</th>
                  <th>Org ID</th>
                  <th>Name</th>
                  <th>Email / Login ID</th>
                  <th>Canvas ID</th>
                  <th>Assignments Graded</th>
                </tr>
              </thead>
              <tbody>
                ${snapshot.map((stu, i) => {
                  const gradesEntries = Object.entries(stu.grades || {});
                  const gradedCount = gradesEntries.filter(([_, val]) => {
                    const gradeObj = typeof val === 'string' ? { score: val } : val;
                    return gradeObj && gradeObj.score && gradeObj.score !== 'N/A' && gradeObj.score !== '';
                  }).length;
                  
                  const d2lStu = findD2LStudentForCanvas(stu, course.id);
                  const d2lOrgId = d2lStu ? (d2lStu.orgId || d2lStu.id) : '—';
                  
                  return `
                    <tr class="student-row-expandable" data-student-id="${stu.studentId}">
                      <td class="chevron-cell">
                        <svg class="chevron-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </td>
                      <td>${i + 1}</td>
                      <td style="font-family: monospace;">${d2lOrgId}</td>
                      <td style="font-weight: 500;">${stu.studentName}</td>
                      <td>${stu.studentEmail || '—'}</td>
                      <td style="font-family: monospace;">${stu.studentId || '—'}</td>
                      <td><span class="roster-status-badge status-initial">${gradedCount} / ${gradesEntries.length}</span></td>
                    </tr>
                    <tr class="student-grades-detail-row" id="detail-${stu.studentId}" style="display: none;">
                      <td colspan="7" class="nested-table-cell">
                        <div class="nested-grades-container">
                          <table class="grades-detail-table">
                            <thead>
                              <tr>
                                <th>Assignment Name</th>
                                <th>Score</th>
                                <th>Last Changed</th>
                                <th>Grade History Timeline</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${gradesEntries.length === 0 ? `
                                <tr><td colspan="4" class="text-muted" style="text-align: center;">No assignments found for this student.</td></tr>
                              ` : gradesEntries.map(([assignmentName, val]) => {
                                const gradeObj = typeof val === 'string' ? { score: val, timestamp: null, history: [] } : val;
                                const score = gradeObj.score || '—';
                                const timeStr = gradeObj.timestamp ? new Date(gradeObj.timestamp).toLocaleString() : '—';
                                const historyHtml = (gradeObj.history && gradeObj.history.length > 0)
                                  ? `<div class="grade-history-timeline">
                                       ${gradeObj.history.map(h => `
                                         <div class="timeline-step">
                                           <span class="timeline-grade">${h.score}</span>
                                           <span class="timeline-time">${new Date(h.timestamp).toLocaleString()}</span>
                                         </div>
                                       `).join('')}
                                     </div>`
                                  : '<span class="text-muted">No edits</span>';
                                return `
                                  <tr>
                                    <td style="font-weight: 500;">${assignmentName}</td>
                                    <td style="font-weight: bold; color: var(--accent-color);">${score}</td>
                                    <td>${timeStr}</td>
                                    <td>${historyHtml}</td>
                                  </tr>
                                `;
                              }).join('')}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
    
    container.innerHTML = `
      <div class="course-detail-layout">
        <!-- Header -->
        <div class="course-detail-header">
          <div class="course-title-section">
            <h2>${course.name}</h2>
            <div class="course-detail-meta">
              <span>Platform: <strong>${typeDisplay}</strong></span>
              <span>Last Checked: <strong>${formattedTime}</strong></span>
              <span>Scanned Items: <strong>${snapshot.length}</strong></span>
            </div>
          </div>
          <div class="course-detail-actions">
            <button class="btn btn-secondary" id="toggle-sidebar" title="Toggle Sidebar">
              <svg class="sidebar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
              </svg>
              <span>Collapse Sidebar</span>
            </button>
            <button class="btn btn-secondary" id="visit-course-url">🔗 Visit ${course.type === 'canvas-grades' ? 'Grades' : 'Gradebook'} Page</button>
          </div>
        </div>
        
        <!-- Info Alert -->
        ${infoAlertHtml}
        
        <!-- Main Content -->
        ${mainContentHtml}
      </div>
    `;
    
    // Wire Canvas Event Listeners
    document.getElementById('visit-course-url').addEventListener('click', () => {
      chrome.tabs.create({ url: course.url });
    });
    
    // Wire Alert Dismissal
    const closeAlertBtn = document.getElementById('close-info-alert');
    if (closeAlertBtn) {
      closeAlertBtn.addEventListener('click', async () => {
        const alertEl = closeAlertBtn.closest('.info-alert');
        if (alertEl) {
          alertEl.style.display = 'none';
          state.dismissCanvasGradebookAlert = true;
          await chrome.storage.local.set({ dismissCanvasGradebookAlert: true });
        }
      });
    }

    // Wire Sidebar Toggle
    wireSidebarToggle();
    
    // Roster Toggle Collapsible Trigger
    const rosterTrigger = document.getElementById('roster-toggle-trigger');
    const rosterDisclosure = document.getElementById('raw-roster-disclosure');
    if (rosterTrigger && rosterDisclosure) {
      rosterTrigger.addEventListener('click', () => {
        rosterDisclosure.classList.toggle('open');
        const content = rosterDisclosure.querySelector('.roster-disclosure-content');
        if (rosterDisclosure.classList.contains('open')) {
          content.style.display = 'block';
        } else {
          content.style.display = 'none';
        }
      });
    }

    if (course.type === 'canvas-gradebook') {
      const expandableRows = container.querySelectorAll('.student-row-expandable');
      expandableRows.forEach(row => {
        row.addEventListener('click', () => {
          const studentId = row.getAttribute('data-student-id');
          const detailRow = container.querySelector(`#detail-${studentId}`);
          if (detailRow) {
            const isVisible = detailRow.style.display !== 'none';
            if (isVisible) {
              detailRow.style.display = 'none';
              row.classList.remove('expanded');
            } else {
              detailRow.style.display = 'table-row';
              row.classList.add('expanded');
            }
          }
        });
      });
    }
  }
}

// Render the timeline of updates
function renderLogs() {
  const container = document.getElementById('log-timeline-container');
  const filterVal = document.getElementById('log-filter').value;
  
  container.innerHTML = '';
  
  const filteredLogs = state.changeLog.filter(log => {
    if (filterVal === 'all') return true;
    return log.category === filterVal;
  });
  
  if (filteredLogs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No changes detected.</p>
        <span class="instruction">Everything is up-to-date.</span>
      </div>
    `;
    return;
  }
  
  filteredLogs.forEach(log => {
    const card = document.createElement('div');
    card.className = `log-card ${log.type}`;
    
    const formattedTime = new Date(log.timestamp).toLocaleString();
    const typeLabel = log.type.replace('-', ' ');
    
    let logActionHtml = '';
    if (log.details && log.details.email) {
      logActionHtml = `
        <div class="log-action-block">
          <button class="copy-btn copy-single-email-btn" data-email="${log.details.email}">📋 Copy Email</button>
        </div>
      `;
    }
    
    card.innerHTML = `
      <div class="log-details-block">
        <div class="log-meta-info">
          <span class="log-course">${log.courseName}</span>
          <span class="log-badge">${typeLabel}</span>
        </div>
        <span class="log-desc">${log.description}</span>
        <span class="log-time">${formattedTime}</span>
      </div>
      ${logActionHtml}
    `;
    
    if (log.details && log.details.email) {
      const copyBtn = card.querySelector('.copy-single-email-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const email = copyBtn.getAttribute('data-email');
          try {
            await navigator.clipboard.writeText(email);
            copyBtn.classList.add('copied');
            copyBtn.textContent = '✅ Copied!';
            setTimeout(() => {
              copyBtn.classList.remove('copied');
              copyBtn.textContent = '📋 Copy Email';
            }, 2000);
          } catch (err) {
            console.error('Clipboard copy failed:', err);
          }
        });
      }
    }
    
    container.appendChild(card);
  });
}

// Action button handlers setup
function setupActionHandlers() {
  // Filter change listener for logs
  document.getElementById('log-filter').addEventListener('change', () => {
    renderLogs();
  });
  
  // Open Test Playground
  document.getElementById('open-playground').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('playground/playground.html') });
  });
  
  // Export to CSV
  document.getElementById('export-csv').addEventListener('click', () => {
    if (state.changeLog.length === 0) {
      alert("No logs available to export.");
      return;
    }
    
    const csvContent = convertLogsToCSV(state.changeLog);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `lms_monitor_change_log_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
  
  // Copy Debug Info to Clipboard
  document.getElementById('copy-debug').addEventListener('click', async () => {
    const { debugLMSInfo } = await chrome.storage.local.get('debugLMSInfo');
    if (!debugLMSInfo) {
      alert("No debug info captured yet. Please reload the D2L Classlist page first to let it attempt scanning.");
      return;
    }
    
    try {
      await navigator.clipboard.writeText(JSON.stringify(debugLMSInfo, null, 2));
      alert("Debug info copied to clipboard! Please paste it in your chat response.");
    } catch (err) {
      console.error(err);
      alert("Failed to write to clipboard. Showing raw details:\n\n" + JSON.stringify(debugLMSInfo).substring(0, 400));
    }
  });
  
  // Clear Database
  document.getElementById('clear-logs').addEventListener('click', async () => {
    if (confirm("Are you sure you want to delete all saved courses, snapshots, and history? This cannot be undone.")) {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        unreadCount: 0,
        courses: {},
        changeLog: [],
        courseLinks: {}
      });
      state.selectedCourseId = null;
      await loadAndRenderData();
      alert("Database wiped successfully.");
    }
  });
}

// CSV Conversion Helper
function convertLogsToCSV(logs) {
  const headers = ['Timestamp', 'Course Name', 'Category', 'Change Type', 'Description'];
  const rows = logs.map(log => [
    new Date(log.timestamp).toISOString(),
    `"${log.courseName.replace(/"/g, '""')}"`,
    log.category,
    log.type,
    `"${log.description.replace(/"/g, '""')}"`
  ]);
  
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
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

// Find matched D2L student for a Canvas student by scanning linked D2L course snapshots
function findD2LStudentForCanvas(canvasStu, canvasCourseId) {
  const canvasEmail = normalizeEmail(canvasStu.studentEmail);
  
  for (const [d2lCourseId, canvasIds] of Object.entries(state.courseLinks || {})) {
    if (Array.isArray(canvasIds) && canvasIds.includes(canvasCourseId)) {
      const d2lStudents = state.snapshots[d2lCourseId] || [];
      const matched = d2lStudents.find(d2lStu => {
        const d2lEmail = normalizeEmail(d2lStu.email);
        // Use email-first matching: only match if both emails exist and match
        if (d2lEmail && canvasEmail) {
          return d2lEmail === canvasEmail;
        }
        // If either email is missing, don't match (strict email-based matching)
        return false;
      });
      if (matched) {
        return matched;
      }
    }
  }
  return null;
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

// Wire Sidebar Toggle functionality shared across layouts
function wireSidebarToggle() {
  const toggleSidebarBtn = document.getElementById('toggle-sidebar');
  if (toggleSidebarBtn) {
    const gridLayout = document.querySelector('#tab-monitor .grid-layout');
    
    // Initialize text/state
    const isCollapsed = gridLayout ? gridLayout.classList.contains('sidebar-collapsed') : false;
    const span = toggleSidebarBtn.querySelector('span');
    if (span) {
      span.textContent = isCollapsed ? "Show Sidebar" : "Collapse Sidebar";
    }
    if (isCollapsed) {
      toggleSidebarBtn.classList.add('active-toggle');
    } else {
      toggleSidebarBtn.classList.remove('active-toggle');
    }
    
    toggleSidebarBtn.addEventListener('click', () => {
      if (gridLayout) {
        const nowCollapsed = gridLayout.classList.toggle('sidebar-collapsed');
        if (span) {
          span.textContent = nowCollapsed ? "Show Sidebar" : "Collapse Sidebar";
        }
        if (nowCollapsed) {
          toggleSidebarBtn.classList.add('active-toggle');
        } else {
          toggleSidebarBtn.classList.remove('active-toggle');
        }
      }
    });
  }
}
