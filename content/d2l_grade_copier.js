// D2L Grade Copier Content Script
console.log("LMS Monitor: D2L Grade Copier script injected");

(async () => {
  // Prevent duplicate runs
  if (window.__d2l_grade_copier_loaded) {
    console.log("LMS Monitor: D2L Grade Copier is already loaded.");
    return;
  }
  window.__d2l_grade_copier_loaded = true;

  // --- Helpers for Page Parsing & Matching ---
  function getCurrentUrl() {
    if (window.location.hostname === 'learn.rrc.ca') {
      return window.location.href;
    }
    // In playground simulator, read from the simulated address input
    const playgroundUrlInput = document.querySelector('#d2l-env .url-input');
    if (playgroundUrlInput) {
      return playgroundUrlInput.value;
    }
    return window.location.href;
  }

  function getD2LCourseId() {
    const url = getCurrentUrl();
    const match = url.match(/ou=(\d+)/);
    return match ? `d2l-${match[1]}` : null;
  }

  function parseD2LLearnerCell(learnerCell) {
    if (!learnerCell) return { id: null, name: "" };
    const cellText = learnerCell.textContent || '';
    
    // Extract ID: 6 to 8 digits
    const idMatch = cellText.match(/\b\d{6,8}\b/);
    const id = idMatch ? idMatch[0] : null;

    const link = learnerCell.querySelector('a');
    let name = link ? link.textContent.trim() : cellText.replace(/\b\d{6,8}\b/g, '').trim();

    // Clean up "Id: 12345" or similar inside parentheses, numeric IDs, emojis, trailing/leading commas, double spaces
    name = name
      .replace(/\s*\(\s*id:\s*\d{6,8}\s*\)/gi, '')
      .replace(/\s*\(\s*id:\s*\)/gi, '')
      .replace(/\b\d{6,8}\b/g, '')
      .replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '') // Remove emojis/symbols
      .replace(/^\s*[^a-zA-Z0-9\s,']+\s*/, '') // Remove leading garbage/icons
      .replace(/\s*[^a-zA-Z0-9\s,']+\s*$/, '') // Remove trailing garbage/icons (like down arrows)
      .replace(/^[\s,]+/, '') // Remove leading whitespace and commas
      .replace(/[\s,]+$/, '') // Remove trailing whitespace and commas
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim();

    return { id, name };
  }

  const getCleanTokens = (name) => {
    if (!name) return [];
    return name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t && !/^\d+$/.test(t));
  };

  const smartNameMatch = (d2lName, canvasName, canvasEmail = '') => {
    // 1. Standard token-based name matching
    const tokens1 = getCleanTokens(d2lName);
    const tokens2 = getCleanTokens(canvasName);
    if (tokens1.length > 0 && tokens2.length > 0) {
      const set1 = new Set(tokens1);
      const set2 = new Set(tokens2);
      
      let matches = 0;
      for (const t of set1) {
        if (set2.has(t)) matches++;
      }
      
      const minTokens = Math.min(tokens1.length, tokens2.length);
      if (matches >= minTokens) return true;
      
      if (tokens1.length >= 2 && tokens2.length >= 2) {
        const hasFirst1In2 = set2.has(tokens1[0]);
        const hasLast1In2 = set2.has(tokens1[tokens1.length - 1]);
        if (hasFirst1In2 && hasLast1In2) return true;
      }
    }

    // 2. Username/Email prefix matching
    if (!d2lName) return false;
    let lastName = '';
    let firstName = '';
    const parts = d2lName.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      lastName = parts[0];
      firstName = parts[1];
    } else if (parts.length === 1) {
      const spaceParts = parts[0].split(/\s+/);
      if (spaceParts.length >= 2) {
        firstName = spaceParts[0];
        lastName = spaceParts.slice(1).join(' ');
      } else {
        firstName = parts[0];
      }
    }

    const firstClean = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const lastClean = lastName.toLowerCase().replace(/[^a-z]/g, '');
    if (!firstClean && !lastClean) return false;

    const firstInitial = firstClean.charAt(0);
    const lastInitial = lastClean.charAt(0);

    const candidates = new Set();
    if (firstClean && lastClean) {
      candidates.add(firstClean + lastClean);       // e.g. subhpreetsingh
      candidates.add(lastClean + firstClean);       // e.g. singhsubhpreet
      if (firstInitial) candidates.add(firstInitial + lastClean); // e.g. mmohamed
      if (lastInitial) candidates.add(lastClean + firstInitial);  // e.g. bulawanf
      if (lastInitial) candidates.add(firstClean + lastInitial);  // e.g. franzb
    }
    if (firstClean) candidates.add(firstClean);
    if (lastClean) candidates.add(lastClean);

    const checkPrefix = (str) => {
      if (!str) return false;
      let s = str.toLowerCase();
      if (s.includes('@')) {
        s = s.split('@')[0];
      }
      s = s.trim();
      if (!s) return false;

      // Check raw prefix
      if (candidates.has(s)) return true;
      // Check prefix with digits stripped
      const stripped = s.replace(/\d+$/g, '');
      if (stripped && candidates.has(stripped)) return true;

      return false;
    };

    if (checkPrefix(canvasEmail)) return true;
    if (checkPrefix(canvasName)) return true;

    return false;
  };

  function findStudentRows() {
    const table = document.querySelector('#d2l-grades-table-body') || document.querySelector('table.d_gl tbody');
    if (!table) return [];
    
    // Find column indexes
    const parentTable = table.closest('table');
    const headerRow = parentTable ? (parentTable.querySelector('thead tr, tr.d_gh') || parentTable.rows[0]) : null;
    let learnerColIdx = 1; // Default D2L column indices
    let lastNameColIdx = -1;
    let firstNameColIdx = -1;
    let orgIdColIdx = -1;  // Not found by default
    let gradeColIdx = 2;
    
    if (headerRow) {
      const headers = Array.from(headerRow.querySelectorAll('th, td'));
      headers.forEach((h, idx) => {
        const text = h.textContent.trim().toLowerCase();
        const cleanText = text.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        
        const isOrgId = cleanText.includes('org defined') || cleanText.includes('org id') || (cleanText.includes('org') && cleanText.includes('id'));
        const isLastName = cleanText.includes('last name') || cleanText === 'last' || cleanText === 'lastname';
        const isFirstName = cleanText.includes('first name') || cleanText === 'first' || cleanText === 'firstname';

        if (isOrgId) {
          orgIdColIdx = idx;
        } else if (isLastName) {
          lastNameColIdx = idx;
        } else if (isFirstName) {
          firstNameColIdx = idx;
        } else if (cleanText.includes('learner') || cleanText.includes('student') || (cleanText.includes('name') && !cleanText.includes('last') && !cleanText.includes('first'))) {
          learnerColIdx = idx;
        } else if (cleanText === 'grade' || cleanText.startsWith('grade ')) {
          gradeColIdx = idx;
        }
      });
    }
    
    const trs = Array.from(table.querySelectorAll('tr'));
    
    // Fallback/Validation: scan the first few rows (up to 5 rows) of the table to find the cell index containing an active input field.
    let detectedGradeColIdx = -1;
    for (let i = 0; i < Math.min(trs.length, 5); i++) {
      const rowCells = Array.from(trs[i].querySelectorAll('td, th'));
      for (let idx = 0; idx < rowCells.length; idx++) {
        const cell = rowCells[idx];
        const hasInput = cell.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
        if (hasInput) {
          detectedGradeColIdx = idx;
          break;
        }
      }
      if (detectedGradeColIdx !== -1) break;
    }
    if (detectedGradeColIdx !== -1) {
      gradeColIdx = detectedGradeColIdx;
    }

    const studentRows = [];
    
    trs.forEach(row => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      const maxColIdx = Math.max(learnerColIdx, gradeColIdx, lastNameColIdx, firstNameColIdx, orgIdColIdx);
      if (cells.length <= maxColIdx) return;
      
      const gradeCell = cells[gradeColIdx];
      if (!gradeCell) return;
      
      const inputElement = gradeCell.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
      if (!inputElement) return; // Skip non-grade input rows (e.g. spacer or headers)
      
      const orgIdCell = orgIdColIdx !== -1 && cells.length > orgIdColIdx ? cells[orgIdColIdx] : null;
      
      if (lastNameColIdx !== -1 && firstNameColIdx !== -1) {
        studentRows.push({
          rowElement: row,
          lastNameCell: cells[lastNameColIdx],
          firstNameCell: cells[firstNameColIdx],
          orgIdCell,
          inputElement
        });
      } else {
        studentRows.push({
          rowElement: row,
          learnerCell: cells[learnerColIdx],
          orgIdCell,
          inputElement
        });
      }
    });
    
    return studentRows;
  }

  function extractNumerator(scoreStr) {
    if (!scoreStr) return "";
    const parts = scoreStr.split('/');
    const rawNum = parts[0].trim();
    return rawNum === "N/A" ? "" : rawNum;
  }

  // --- State Variable ---
  let state = {
    d2lCourseId: null,
    canvasCourses: [],
    linkedCanvasIds: [],
    selectedCanvasId: "",
    selectedAssignment: "",
    d2lStudents: [], // { rowElement, learnerText, name, id, inputElement }
    matchedList: [], // { d2lStudent, canvasStudent, score, isMatched }
    activeTab: 'matcher', // 'matcher' or 'canvas-table'
    canvasSortField: 'orgId', // 'name', 'orgId' or 'grade'
    canvasSortDirection: 'asc' // 'asc' or 'desc'
  };

  // --- Shadow DOM Side Panel UI Creation ---
  let shadowRoot = null;
  let container = null;

  function initUI() {
    const existing = document.getElementById('lms-copier-root');
    if (existing) existing.remove();

    container = document.createElement('div');
    container.id = 'lms-copier-root';
    document.body.appendChild(container);

    shadowRoot = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      .copier-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: 420px;
        height: 100vh;
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(16px) saturate(180%);
        -webkit-backdrop-filter: blur(16px) saturate(180%);
        border-left: 1px solid rgba(255, 255, 255, 0.15);
        color: #f1f5f9;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        transform: translateX(100%);
        box-sizing: border-box;
      }
      .copier-panel.open {
        transform: translateX(0);
      }

      .copier-header {
        padding: 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .copier-title {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        background: linear-gradient(135deg, #a5b4fc 0%, #6366f1 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      
      .header-actions {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .refresh-btn {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 16px;
        cursor: pointer;
        padding: 0;
        transition: color 0.2s, transform 0.2s;
      }
      .refresh-btn:hover {
        color: #f1f5f9;
        transform: rotate(180deg);
      }

      .close-btn {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        transition: color 0.2s;
      }
      .close-btn:hover {
        color: #f1f5f9;
      }

      .copier-body {
        padding: 20px;
        flex-grow: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 16px;
        box-sizing: border-box;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .form-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #94a3b8;
      }
      .form-select {
        background: rgba(30, 41, 59, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 10px 12px;
        color: #f1f5f9;
        font-size: 13px;
        outline: none;
        cursor: pointer;
        transition: all 0.3s;
        box-sizing: border-box;
      }
      .form-select:focus {
        border-color: #6366f1;
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
      }

      .stats-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        padding: 12px 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-sizing: border-box;
      }
      .stats-text {
        font-size: 13px;
        color: #e2e8f0;
      }
      .stats-number {
        font-size: 18px;
        font-weight: 700;
        color: #818cf8;
      }

      .primary-btn {
        background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
        border: none;
        border-radius: 8px;
        padding: 12px;
        color: white;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
      }
      .primary-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(79, 70, 229, 0.5);
      }
      .primary-btn:active {
        transform: translateY(0);
      }
      .primary-btn:disabled {
        background: #334155;
        color: #64748b;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
      }

      .student-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      
      .no-data-msg {
        font-size: 13px;
        color: #94a3b8;
        text-align: center;
        padding: 20px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px dashed rgba(255, 255, 255, 0.1);
        border-radius: 10px;
      }

      .student-card {
        background: rgba(30, 41, 59, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        padding: 10px 12px;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        gap: 6px;
        box-sizing: border-box;
      }
      .student-card:hover {
        background: rgba(30, 41, 59, 0.6);
        border-color: rgba(99, 102, 241, 0.3);
      }
      
      .student-header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .student-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 65%;
      }
      .student-name-container {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .student-name {
        font-size: 13px;
        font-weight: 600;
        color: #f1f5f9;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .student-details {
        font-size: 10px;
        color: #94a3b8;
      }
      .student-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .badge {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 12px;
      }
      .badge.success {
        background: rgba(16, 185, 129, 0.15);
        color: #34d399;
      }
      .badge.warning {
        background: rgba(245, 158, 11, 0.15);
        color: #fbbf24;
      }
      .badge.danger {
        background: rgba(239, 68, 68, 0.15);
        color: #f87171;
      }
      
      .icon-btn {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        width: 26px;
        height: 26px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        color: #94a3b8;
        transition: all 0.2s;
        padding: 0;
        font-size: 12px;
      }
      .icon-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #f1f5f9;
        border-color: rgba(255, 255, 255, 0.2);
      }
      .icon-btn.fill-grade-btn {
        color: #fbbf24;
      }
      .icon-btn.fill-grade-btn:hover {
        background: rgba(245, 158, 11, 0.2);
        color: #fbbf24;
        border-color: rgba(245, 158, 11, 0.4);
      }

      .history-section {
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        padding-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .history-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: #94a3b8;
        cursor: pointer;
        user-select: none;
        font-weight: 500;
      }
      .history-toggle:hover {
        color: #cbd5e1;
      }
      .history-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-left: 8px;
        margin-top: 2px;
      }
      .history-item {
        font-size: 10px;
        color: #94a3b8;
        display: flex;
        justify-content: space-between;
      }
      .history-time {
        color: #64748b;
      }
      .history-score {
        font-weight: 600;
        color: #e2e8f0;
      }

      /* Floating Toggle Button */
      .floating-toggle {
        position: fixed;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.85) 0%, rgba(15, 23, 42, 0.9) 100%);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-right: none;
        border-radius: 12px 0 0 12px;
        padding: 12px 8px;
        color: #f1f5f9;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        z-index: 2147483646;
        box-shadow: -4px 4px 16px rgba(0, 0, 0, 0.35);
        writing-mode: vertical-rl;
        text-orientation: mixed;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.3s;
      }
      .floating-toggle:hover {
        background: rgba(30, 41, 59, 0.95);
        border-color: rgba(99, 102, 241, 0.4);
        padding-right: 12px;
      }

      /* Tabs styles */
      .tabs-container {
        display: flex;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 2px;
        box-sizing: border-box;
        margin-bottom: 4px;
      }
      .tab-btn {
        flex: 1;
        background: none;
        border: none;
        border-radius: 6px;
        padding: 8px 10px;
        color: #94a3b8;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
      }
      .tab-btn:hover {
        color: #f1f5f9;
        background: rgba(255, 255, 255, 0.02);
      }
      .tab-btn.active {
        background: rgba(99, 102, 241, 0.35);
        color: #f1f5f9;
        border: 1px solid rgba(99, 102, 241, 0.2);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
      }

      /* Sortable grades table styles */
      .grades-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 12px;
        color: #cbd5e1;
        margin-top: 4px;
      }
      .grades-table th {
        font-weight: 700;
        color: #94a3b8;
        text-transform: uppercase;
        font-size: 9px;
        letter-spacing: 0.05em;
        cursor: pointer;
        user-select: none;
        padding: 8px 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        text-align: left;
        transition: color 0.2s, background 0.2s;
      }
      .grades-table th:hover {
        color: #f1f5f9;
        background: rgba(255, 255, 255, 0.03);
      }
      .grades-table th.active-sort {
        color: #818cf8;
      }
      .grades-table td {
        padding: 8px 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        vertical-align: middle;
      }
      .grades-table tr:hover td {
        background: rgba(255, 255, 255, 0.02);
      }
      .grades-table td.name-cell {
        font-weight: 500;
        color: #e2e8f0;
        max-width: 160px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .grades-table td.org-id-cell {
        font-family: monospace;
        color: #94a3b8;
        width: 70px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .grades-table td.grade-cell {
        font-weight: 600;
        color: #a5b4fc;
        text-align: center;
        width: 70px;
      }
      .grades-table td.actions-cell {
        text-align: right;
        width: 70px;
      }
      .sort-icon {
        margin-left: 2px;
        font-size: 8px;
        display: inline-block;
        vertical-align: middle;
      }
    `;
    shadowRoot.appendChild(style);

    const toggle = document.createElement('div');
    toggle.className = 'floating-toggle';
    toggle.id = 'floating-toggle';
    toggle.innerHTML = `📊 Canvas Copier`;
    shadowRoot.appendChild(toggle);

    const panel = document.createElement('div');
    panel.className = 'copier-panel';
    panel.id = 'copier-panel';
    panel.innerHTML = `
      <div class="copier-header">
        <h2 class="copier-title">Canvas Grade Copier</h2>
        <div class="header-actions">
          <button class="refresh-btn" id="refresh-btn" title="Refresh page inputs">🔄</button>
          <button class="close-btn" id="close-panel-btn">&times;</button>
        </div>
      </div>
      <div class="copier-body">
        <div class="form-group">
          <label class="form-label" for="canvas-course-select">Canvas Course</label>
          <select class="form-select" id="canvas-course-select">
            <option value="">Select a course...</option>
          </select>
        </div>
        
        <div class="form-group">
          <label class="form-label" for="canvas-assignment-select">Canvas Assignment</label>
          <select class="form-select" id="canvas-assignment-select">
            <option value="">Select an assignment...</option>
          </select>
        </div>
        
        <div class="stats-card">
          <span class="stats-text">Students Matched</span>
          <span class="stats-number" id="match-stats">0/0</span>
        </div>
        
        <button class="primary-btn" id="autofill-btn" disabled>
          ⚡ Autofill Matched Grades
        </button>
        
        <div class="tabs-container">
          <button class="tab-btn active" id="tab-btn-matcher">Auto-Match</button>
          <button class="tab-btn" id="tab-btn-canvas-table">Canvas Grades</button>
        </div>
        <div class="student-list" id="student-list-container">
          <div class="no-data-msg">Select a course and assignment to load grades.</div>
        </div>
      </div>
    `;
    shadowRoot.appendChild(panel);

    // Event Handlers
    toggle.addEventListener('click', async () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        await scanD2LInputs();
        await runMatching();
      }
    });

    shadowRoot.getElementById('close-panel-btn').addEventListener('click', () => {
      panel.classList.remove('open');
    });

    shadowRoot.getElementById('refresh-btn').addEventListener('click', async () => {
      await scanD2LInputs();
      await runMatching();
      
      const refreshBtn = shadowRoot.getElementById('refresh-btn');
      refreshBtn.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        refreshBtn.style.transform = 'none';
      }, 500);
    });

    shadowRoot.getElementById('canvas-course-select').addEventListener('change', (e) => {
      state.selectedCanvasId = e.target.value;
      populateAssignments();
      runMatching();
    });

    shadowRoot.getElementById('canvas-assignment-select').addEventListener('change', (e) => {
      state.selectedAssignment = e.target.value;
      runMatching();
    });

    shadowRoot.getElementById('autofill-btn').addEventListener('click', () => {
      autofillAllMatched();
    });

    shadowRoot.getElementById('tab-btn-matcher').addEventListener('click', () => {
      state.activeTab = 'matcher';
      updateTabButtons();
      renderStudentList();
    });

    shadowRoot.getElementById('tab-btn-canvas-table').addEventListener('click', () => {
      state.activeTab = 'canvas-table';
      updateTabButtons();
      renderStudentList();
    });
  }

  function updateTabButtons() {
    if (!shadowRoot) return;
    const btnMatcher = shadowRoot.getElementById('tab-btn-matcher');
    const btnCanvas = shadowRoot.getElementById('tab-btn-canvas-table');
    if (!btnMatcher || !btnCanvas) return;
    
    if (state.activeTab === 'matcher') {
      btnMatcher.classList.add('active');
      btnCanvas.classList.remove('active');
    } else {
      btnMatcher.classList.remove('active');
      btnCanvas.classList.add('active');
    }
  }

  // --- Load Storage and Initial Setup ---
  async function loadData() {
    state.d2lCourseId = getD2LCourseId();
    if (!state.d2lCourseId) {
      console.warn("LMS Monitor: Could not find D2L course ID from URL parameters.");
      return;
    }

    const storageData = await chrome.storage.local.get(['courses', 'snapshots', 'courseLinks']);
    const courses = storageData.courses || {};
    const courseLinks = storageData.courseLinks || {};

    // Get linked Canvas course IDs
    state.linkedCanvasIds = courseLinks[state.d2lCourseId] || [];

    // Filter Canvas courses
    state.canvasCourses = Object.values(courses).filter(c => c.type === 'canvas-gradebook');

    populateCoursesDropdown();
    populateAssignments();
    await scanD2LInputs();
    await runMatching();
  }

  function populateCoursesDropdown() {
    if (!shadowRoot) return;
    const select = shadowRoot.getElementById('canvas-course-select');
    select.innerHTML = '<option value="">Select a course...</option>';

    if (state.canvasCourses.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = "No Canvas courses found in storage";
      opt.disabled = true;
      select.appendChild(opt);
      return;
    }

    // Determine default canvas course
    let defaultCanvasId = "";
    if (state.linkedCanvasIds.length > 0) {
      defaultCanvasId = state.linkedCanvasIds[0];
    } else if (state.canvasCourses.length > 0) {
      defaultCanvasId = state.canvasCourses[0].id;
    }

    state.selectedCanvasId = defaultCanvasId;

    state.canvasCourses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name + (state.linkedCanvasIds.includes(c.id) ? " (Linked)" : "");
      if (c.id === defaultCanvasId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  async function populateAssignments() {
    if (!shadowRoot) return;
    const select = shadowRoot.getElementById('canvas-assignment-select');
    select.innerHTML = '<option value="">Select an assignment...</option>';

    if (!state.selectedCanvasId) {
      select.disabled = true;
      return;
    }
    select.disabled = false;

    // Fetch assignments from Canvas snapshot students
    const storageData = await chrome.storage.local.get('snapshots');
    const snapshots = storageData.snapshots || {};
    const canvasSnapshot = snapshots[state.selectedCanvasId] || [];

    // Extract unique assignment names
    const assignmentsSet = new Set();
    canvasSnapshot.forEach(student => {
      if (student.grades) {
        Object.keys(student.grades).forEach(assignmentName => {
          assignmentsSet.add(assignmentName);
        });
      }
    });

    const assignments = Array.from(assignmentsSet).sort();

    if (assignments.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = "No assignments found";
      opt.disabled = true;
      select.appendChild(opt);
      state.selectedAssignment = "";
      return;
    }

    state.selectedAssignment = assignments[0];

    assignments.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      if (a === state.selectedAssignment) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  async function scanD2LInputs() {
    const studentRows = findStudentRows();
    state.d2lStudents = studentRows.map(sr => {
      let name = "";
      let id = null;
      let learnerCell = null;

      if (sr.lastNameCell && sr.firstNameCell) {
        const lastParsed = parseD2LLearnerCell(sr.lastNameCell);
        const firstParsed = parseD2LLearnerCell(sr.firstNameCell);
        id = lastParsed.id || firstParsed.id;
        
        const ln = lastParsed.name.trim();
        const fn = firstParsed.name.trim();
        if (ln && fn) {
          name = `${ln}, ${fn}`;
        } else {
          name = ln || fn || "";
        }
        learnerCell = sr.lastNameCell;
      } else if (sr.learnerCell) {
        const parsed = parseD2LLearnerCell(sr.learnerCell);
        id = parsed.id;
        name = parsed.name;
        learnerCell = sr.learnerCell;
      }

      if (!id && sr.orgIdCell) {
        const cellText = sr.orgIdCell.textContent || '';
        const idMatch = cellText.match(/\b\d{6,8}\b/);
        id = idMatch ? idMatch[0] : cellText.trim() || null;
      }

      // Extract email from row
      let email = "";
      const mailtoLink = sr.rowElement.querySelector('a[href^="mailto:"]');
      if (mailtoLink) {
        email = mailtoLink.getAttribute('href').replace('mailto:', '').trim();
      } else {
        const emailMatch = sr.rowElement.outerHTML.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) {
          email = emailMatch[0].trim();
        }
      }

      return {
        rowElement: sr.rowElement,
        learnerCell: learnerCell,
        learnerText: learnerCell ? learnerCell.textContent.trim() : "",
        name: name,
        id: id,
        email: email,
        inputElement: sr.inputElement
      };
    });
    console.log(`LMS Monitor: Scanned ${state.d2lStudents.length} student inputs on D2L page.`);

    // Automatically enrich the stored D2L classlist snapshot with the Org IDs parsed from this page
    try {
      const courseId = getD2LCourseId();
      if (courseId && state.d2lStudents.length > 0) {
        const storageData = await chrome.storage.local.get('snapshots');
        const snapshots = storageData.snapshots || {};
        const d2lSnapshot = snapshots[courseId] || [];
        
        let snapshotUpdated = false;
        state.d2lStudents.forEach(ds => {
          if (ds.id && ds.name) {
            // Check for match via email first if available
            let match = null;
            if (ds.email) {
              match = d2lSnapshot.find(s => s.email && s.email.toLowerCase() === ds.email.toLowerCase());
            }
            
            // If no match by email, fall back to smartNameMatch but only if it is unambiguous (only one student with that name exists in the snapshot)
            if (!match) {
              const nameMatches = d2lSnapshot.filter(s => {
                // If snap student and incoming student both have emails and they mismatch, don't match
                if (s.email && ds.email && s.email.toLowerCase() !== ds.email.toLowerCase()) {
                  return false;
                }
                return smartNameMatch(s.name, ds.name);
              });
              if (nameMatches.length === 1) {
                match = nameMatches[0];
              } else if (nameMatches.length > 1) {
                console.warn(`LMS Monitor: Ambiguous name match for auto-enrichment: "${ds.name}". Multiple matches found. Skipping.`);
              }
            }
            
            if (match && (!match.orgId || match.orgId !== ds.id)) {
              match.orgId = ds.id;
              if (match.id === match.username) {
                match.id = ds.id;
              }
              // Also update email and username if missing in snapshot
              if (ds.email && !match.email) {
                match.email = ds.email;
              }
              if (ds.email && !match.username) {
                match.username = ds.email.split('@')[0];
              }
              snapshotUpdated = true;
            }
          }
        });

        if (snapshotUpdated) {
          snapshots[courseId] = d2lSnapshot;
          await chrome.storage.local.set({ snapshots });
          console.log("LMS Monitor: Automatically enriched D2L classlist snapshot with Org IDs from Enter Grades page.");
        }
      }
    } catch (err) {
      console.warn("LMS Monitor: Error enriching D2L classlist snapshot:", err);
    }
  }

  async function runMatching() {
    if (!shadowRoot) return;
    
    const listContainer = shadowRoot.getElementById('student-list-container');
    const matchStats = shadowRoot.getElementById('match-stats');
    const autofillBtn = shadowRoot.getElementById('autofill-btn');

    if (!state.selectedCanvasId || !state.selectedAssignment) {
      listContainer.innerHTML = '<div class="no-data-msg">Select a course and assignment to load grades.</div>';
      matchStats.textContent = "0/0";
      autofillBtn.disabled = true;
      return;
    }

    const storageData = await chrome.storage.local.get('snapshots');
    const snapshots = storageData.snapshots || {};
    
    // Get D2L classlist snapshot for email lookups
    const d2lSnapshot = snapshots[state.d2lCourseId] || [];
    
    // Get Canvas grades snapshot
    const canvasSnapshot = snapshots[state.selectedCanvasId] || [];

    state.matchedList = [];
    let matchedCount = 0;

    state.d2lStudents.forEach(d2lStudent => {
      // 1. Email Lookup (prefer row-scraped email, fallback to snapshot)
      let d2lEmail = d2lStudent.email;
      if (!d2lEmail) {
        const d2lMatchInfo = d2lStudent.id ? d2lSnapshot.find(s => s.id === d2lStudent.id) : null;
        d2lEmail = d2lMatchInfo ? d2lMatchInfo.email : null;
      }

      let canvasStudent = null;
      if (d2lEmail) {
        canvasStudent = canvasSnapshot.find(cs => cs.studentEmail && cs.studentEmail.toLowerCase() === d2lEmail.toLowerCase());
      }

      // 2. Smart Name Match Fallback
      if (!canvasStudent && d2lStudent.name) {
        canvasStudent = canvasSnapshot.find(cs => {
          if (d2lEmail && cs.studentEmail && d2lEmail.toLowerCase() !== cs.studentEmail.toLowerCase()) {
            return false;
          }
          return smartNameMatch(d2lStudent.name, cs.studentName, cs.studentEmail);
        });
      }

      let score = null;
      let scoreHistory = [];
      if (canvasStudent && canvasStudent.grades && canvasStudent.grades[state.selectedAssignment]) {
        const gradeObj = canvasStudent.grades[state.selectedAssignment];
        score = gradeObj.score;
        scoreHistory = gradeObj.history || [];
      }

      const isMatched = !!canvasStudent;
      if (isMatched) matchedCount++;

      state.matchedList.push({
        d2lStudent,
        canvasStudent,
        score,
        scoreHistory,
        isMatched
      });
    });

    state.d2lSnapshot = d2lSnapshot;
    state.canvasSnapshot = canvasSnapshot;

    if (state.d2lStudents.length === 0) {
      state.activeTab = 'canvas-table';
      updateTabButtons();
    }

    matchStats.textContent = `${matchedCount}/${state.d2lStudents.length}`;
    autofillBtn.disabled = matchedCount === 0;

    renderStudentList();
  }

  function renderStudentList() {
    const listContainer = shadowRoot.getElementById('student-list-container');
    listContainer.innerHTML = '';

    if (state.activeTab === 'matcher') {
      if (state.matchedList.length === 0) {
        listContainer.innerHTML = '<div class="no-data-msg">No D2L student inputs detected. Ensure you are on the "Enter Grades" page and click refresh.</div>';
        return;
      }

      state.matchedList.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'student-card';
        
        const parsedD2LName = item.d2lStudent.name || item.d2lStudent.learnerText;
        const displayName = item.d2lStudent.id ? `${parsedD2LName} (${item.d2lStudent.id})` : parsedD2LName;
        const d2lMatchInfo = item.d2lStudent.id && state.d2lSnapshot ? state.d2lSnapshot.find(s => s.id === item.d2lStudent.id) : null;
        const studentEmail = (item.canvasStudent && item.canvasStudent.studentEmail) || (d2lMatchInfo && d2lMatchInfo.email) || '';

        const d2lIdText = item.d2lStudent.id ? `D2L: ${item.d2lStudent.id}` : 'No ID';
        const canvasIdText = item.canvasStudent ? `Canvas: ${item.canvasStudent.studentId}` : '';
        const emailText = studentEmail ? studentEmail : '';
        const metaSubText = [d2lIdText, canvasIdText, emailText].filter(Boolean).join(' | ');

        const badgeClass = item.isMatched 
          ? (item.score && item.score !== "N/A" ? 'success' : 'warning') 
          : 'danger';
        const badgeText = item.isMatched 
          ? (item.score && item.score !== "N/A" ? item.score : 'Ungraded') 
          : 'Unmatched';
        
        // Expandable history block if history exists
        let historyHtml = '';
        if (item.isMatched && item.scoreHistory && item.scoreHistory.length > 0) {
          const historyItems = item.scoreHistory.map(h => {
            const dateStr = new Date(h.timestamp).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
            return `
              <div class="history-item">
                <span class="history-time">${dateStr}</span>
                <span class="history-score">${h.score}</span>
              </div>
            `;
          }).reverse().join(''); // Show latest first

          historyHtml = `
            <div class="history-section">
              <div class="history-toggle" data-index="${index}">
                <span>▶</span> History (${item.scoreHistory.length})
              </div>
              <div class="history-list" id="history-list-${index}" style="display: none;">
                ${historyItems}
              </div>
            </div>
          `;
        }

        card.innerHTML = `
          <div class="student-header-row">
            <div class="student-meta">
              <div class="student-name-container">
                <span class="student-name" title="${parsedD2LName}">${displayName}</span>
              </div>
              <span class="student-details">${metaSubText}</span>
            </div>
            <div class="student-actions">
              <span class="badge ${badgeClass}">${badgeText}</span>
              ${item.isMatched && item.score && item.score !== "N/A" ? `
                <button class="icon-btn copy-grade-btn" data-index="${index}" title="Copy numerator to clipboard">📋</button>
                <button class="icon-btn fill-grade-btn" data-index="${index}" title="Fill into D2L box">⚡</button>
              ` : ''}
            </div>
          </div>
          ${historyHtml}
        `;

        // Hover D2L row highlight handlers
        card.addEventListener('mouseenter', () => {
          card.classList.add('highlighted');
          if (item.d2lStudent.rowElement) {
            item.d2lStudent.rowElement.style.outline = '2px solid #6366f1';
            item.d2lStudent.rowElement.style.outlineOffset = '-2px';
            item.d2lStudent.rowElement.style.backgroundColor = 'rgba(99, 102, 241, 0.08)';
          }
        });

        card.addEventListener('mouseleave', () => {
          card.classList.remove('highlighted');
          if (item.d2lStudent.rowElement) {
            item.d2lStudent.rowElement.style.outline = '';
            item.d2lStudent.rowElement.style.outlineOffset = '';
            item.d2lStudent.rowElement.style.backgroundColor = '';
          }
        });

        listContainer.appendChild(card);
      });

      // Wire up dynamic click listeners for details toggle, copy, and fill
      shadowRoot.querySelectorAll('.history-toggle').forEach(el => {
        el.addEventListener('click', (e) => {
          const idx = el.getAttribute('data-index');
          const list = shadowRoot.getElementById(`history-list-${idx}`);
          const arrow = el.querySelector('span');
          if (list.style.display === 'none') {
            list.style.display = 'flex';
            arrow.textContent = '▼';
          } else {
            list.style.display = 'none';
            arrow.textContent = '▶';
          }
        });
      });

      shadowRoot.querySelectorAll('.copy-grade-btn').forEach(el => {
        el.addEventListener('click', (e) => {
          const idx = el.getAttribute('data-index');
          const item = state.matchedList[idx];
          const num = extractNumerator(item.score);
          if (num !== "") {
            navigator.clipboard.writeText(num).then(() => {
              el.textContent = '✅';
              setTimeout(() => { el.textContent = '📋'; }, 1000);
            });
          }
        });
      });

      shadowRoot.querySelectorAll('.fill-grade-btn').forEach(el => {
        el.addEventListener('click', (e) => {
          const idx = el.getAttribute('data-index');
          const item = state.matchedList[idx];
          const num = extractNumerator(item.score);
          if (num !== "" && item.d2lStudent.inputElement) {
            fillD2LInput(item.d2lStudent.inputElement, num);
            el.textContent = '✅';
            setTimeout(() => { el.textContent = '⚡'; }, 1000);
          }
        });
      });

    } else if (state.activeTab === 'canvas-table') {
      const sortedCanvasStudents = [...(state.canvasSnapshot || [])].map(student => {
        const matchedItem = state.matchedList.find(item => item.canvasStudent && String(item.canvasStudent.studentId) === String(student.studentId));

        // Resolve D2L Org ID for this Canvas student
        let d2lOrgId = null;

        // 1. Check in matchedList
        if (matchedItem && matchedItem.d2lStudent && matchedItem.d2lStudent.id) {
          d2lOrgId = matchedItem.d2lStudent.id;
        }

        // 2. Fallback to d2lSnapshot via email matching
        if (!d2lOrgId && student.studentEmail && state.d2lSnapshot) {
          const snapMatch = state.d2lSnapshot.find(s => s.email && s.email.toLowerCase() === student.studentEmail.toLowerCase());
          if (snapMatch && snapMatch.id) {
            d2lOrgId = snapMatch.id;
          }
        }

        // 3. Fallback to smartNameMatch against d2lSnapshot
        if (!d2lOrgId && state.d2lSnapshot) {
          const snapMatch = state.d2lSnapshot.find(s => {
            if (s.email && student.studentEmail && s.email.toLowerCase() !== student.studentEmail.toLowerCase()) {
              return false;
            }
            return s.name && smartNameMatch(s.name, student.studentName, student.studentEmail);
          });
          if (snapMatch && snapMatch.id) {
            d2lOrgId = snapMatch.id;
          }
        }

        return {
          student,
          matchedItem,
          d2lOrgId: d2lOrgId || ''
        };
      });

      sortedCanvasStudents.sort((a, b) => {
        let valA, valB;
        if (state.canvasSortField === 'name') {
          valA = (a.student.studentName || '').toLowerCase();
          valB = (b.student.studentName || '').toLowerCase();
        } else if (state.canvasSortField === 'orgId') {
          valA = a.d2lOrgId || '';
          valB = b.d2lOrgId || '';
          if (!valA && !valB) return 0;
          if (!valA) return state.canvasSortDirection === 'asc' ? 1 : -1;
          if (!valB) return state.canvasSortDirection === 'asc' ? -1 : 1;
          return state.canvasSortDirection === 'asc'
            ? valA.localeCompare(valB, undefined, { numeric: true })
            : valB.localeCompare(valA, undefined, { numeric: true });
        } else if (state.canvasSortField === 'grade') {
          const gradeAObj = a.student.grades ? a.student.grades[state.selectedAssignment] : null;
          const gradeBObj = b.student.grades ? b.student.grades[state.selectedAssignment] : null;
          valA = gradeAObj ? parseFloat(extractNumerator(gradeAObj.score)) : -1;
          valB = gradeBObj ? parseFloat(extractNumerator(gradeBObj.score)) : -1;
          if (isNaN(valA)) valA = -1;
          if (isNaN(valB)) valB = -1;
        }
        
        if (valA < valB) return state.canvasSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return state.canvasSortDirection === 'asc' ? 1 : -1;
        return 0;
      });

      const table = document.createElement('table');
      table.className = 'grades-table';
      
      const getSortIndicator = (field) => {
        if (state.canvasSortField !== field) return ' ↕';
        return state.canvasSortDirection === 'asc' ? ' ▲' : ' ▼';
      };
      
      const isSortActive = (field) => {
        return state.canvasSortField === field ? 'class="active-sort"' : '';
      };

      table.innerHTML = `
        <thead>
          <tr>
            <th id="th-org-id" style="width: 70px;" ${isSortActive('orgId')}>Org ID<span class="sort-icon">${getSortIndicator('orgId')}</span></th>
            <th id="th-name" ${isSortActive('name')}>Name<span class="sort-icon">${getSortIndicator('name')}</span></th>
            <th id="th-grade" style="text-align: center;" ${isSortActive('grade')}>Grade<span class="sort-icon">${getSortIndicator('grade')}</span></th>
            <th style="text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody id="canvas-grades-table-body">
        </tbody>
      `;
      
      listContainer.appendChild(table);
      const tbody = table.querySelector('#canvas-grades-table-body');

      if (sortedCanvasStudents.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="4" class="no-data-msg" style="border: none;">No Canvas students found.</td>`;
        tbody.appendChild(tr);
      } else {
        sortedCanvasStudents.forEach(({ student, matchedItem, d2lOrgId }) => {
          const tr = document.createElement('tr');
          
          const gradeObj = student.grades ? student.grades[state.selectedAssignment] : null;
          const scoreDisplay = gradeObj && gradeObj.score ? gradeObj.score : 'Ungraded';
          const rawNumerator = gradeObj ? extractNumerator(gradeObj.score) : '';
          
          const canFill = matchedItem && matchedItem.d2lStudent && matchedItem.d2lStudent.inputElement;

          tr.innerHTML = `
            <td class="org-id-cell" title="${d2lOrgId || '—'}">${d2lOrgId || '—'}</td>
            <td class="name-cell" title="${student.studentName}">${student.studentName}</td>
            <td class="grade-cell">${scoreDisplay}</td>
            <td class="actions-cell">
              ${rawNumerator ? `
                <button class="icon-btn copy-table-grade-btn" data-score="${rawNumerator}" title="Copy numerator (${rawNumerator}) to clipboard">📋</button>
                ${canFill ? `<button class="icon-btn fill-table-grade-btn" data-student-id="${student.studentId}" data-score="${rawNumerator}" title="Fill into D2L box">⚡</button>` : ''}
              ` : ''}
            </td>
          `;
          
          if (matchedItem && matchedItem.d2lStudent && matchedItem.d2lStudent.rowElement) {
            tr.addEventListener('mouseenter', () => {
              matchedItem.d2lStudent.rowElement.style.outline = '2px solid #6366f1';
              matchedItem.d2lStudent.rowElement.style.outlineOffset = '-2px';
              matchedItem.d2lStudent.rowElement.style.backgroundColor = 'rgba(99, 102, 241, 0.08)';
            });
            tr.addEventListener('mouseleave', () => {
              matchedItem.d2lStudent.rowElement.style.outline = '';
              matchedItem.d2lStudent.rowElement.style.outlineOffset = '';
              matchedItem.d2lStudent.rowElement.style.backgroundColor = '';
            });
          }
          
          tbody.appendChild(tr);
        });
      }

      // Event listeners for table headers
      const thOrgId = table.querySelector('#th-org-id');
      const thName = table.querySelector('#th-name');
      const thGrade = table.querySelector('#th-grade');

      thOrgId.addEventListener('click', () => {
        if (state.canvasSortField === 'orgId') {
          state.canvasSortDirection = state.canvasSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.canvasSortField = 'orgId';
          state.canvasSortDirection = 'asc';
        }
        renderStudentList();
      });
      
      thName.addEventListener('click', () => {
        if (state.canvasSortField === 'name') {
          state.canvasSortDirection = state.canvasSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.canvasSortField = 'name';
          state.canvasSortDirection = 'asc';
        }
        renderStudentList();
      });
      
      thGrade.addEventListener('click', () => {
        if (state.canvasSortField === 'grade') {
          state.canvasSortDirection = state.canvasSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.canvasSortField = 'grade';
          state.canvasSortDirection = 'desc';
        }
        renderStudentList();
      });

      // Event listeners for copy and fill buttons in table
      table.querySelectorAll('.copy-table-grade-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const score = btn.getAttribute('data-score');
          navigator.clipboard.writeText(score).then(() => {
            btn.textContent = '✅';
            setTimeout(() => { btn.textContent = '📋'; }, 1000);
          });
        });
      });

      table.querySelectorAll('.fill-table-grade-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const studentId = btn.getAttribute('data-student-id');
          const score = btn.getAttribute('data-score');
          const matchedItem = state.matchedList.find(item => item.canvasStudent && String(item.canvasStudent.studentId) === String(studentId));
          if (matchedItem && matchedItem.d2lStudent && matchedItem.d2lStudent.inputElement) {
            fillD2LInput(matchedItem.d2lStudent.inputElement, score);
            btn.textContent = '✅';
            setTimeout(() => { btn.textContent = '⚡'; }, 1000);
          }
        });
      });
    }
  }

  function fillD2LInput(input, value) {
    input.value = value;
    // Dispatch input and change events to notify D2L framework
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Quick flash micro-animation on the filled input to notify user
    input.style.transition = 'background 0.3s';
    input.style.background = '#065f46';
    input.style.color = '#34d399';
    setTimeout(() => {
      input.style.background = '';
      input.style.color = '';
    }, 800);
  }

  function autofillAllMatched() {
    let count = 0;
    state.matchedList.forEach(item => {
      if (item.isMatched && item.score && item.score !== "N/A" && item.d2lStudent.inputElement) {
        const num = extractNumerator(item.score);
        if (num !== "") {
          fillD2LInput(item.d2lStudent.inputElement, num);
          count++;
        }
      }
    });

    // Provide visual animation feedback on primary button
    const autofillBtn = shadowRoot.getElementById('autofill-btn');
    const oldText = autofillBtn.innerHTML;
    autofillBtn.innerHTML = `✅ Filled ${count} Grades!`;
    autofillBtn.style.background = 'linear-gradient(135deg, #059669 0%, #10b981 100%)';
    autofillBtn.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
    
    setTimeout(() => {
      autofillBtn.innerHTML = oldText;
      autofillBtn.style.background = '';
      autofillBtn.style.boxShadow = '';
    }, 1500);
  }

  // Watch for dynamic DOM changes (e.g. if student list is lazy loaded or refreshed in D2L)
  let activeObserver = null;

  async function handleMutation() {
    const prevCount = state.d2lStudents.length;
    await scanD2LInputs();
    if (state.d2lStudents.length !== prevCount) {
      await runMatching();
    }
  }

  function setupObserver() {
    const tableBody = document.querySelector('#d2l-grades-table-body') || document.querySelector('table.d_gl tbody');
    if (tableBody) {
      if (activeObserver) activeObserver.disconnect();
      activeObserver = new MutationObserver(handleMutation);
      activeObserver.observe(tableBody, { childList: true, subtree: true });
      return true;
    }
    const containerBody = document.querySelector('.d2l-content-body, #application');
    if (containerBody) {
      if (activeObserver) activeObserver.disconnect();
      activeObserver = new MutationObserver(handleMutation);
      activeObserver.observe(containerBody, { childList: true, subtree: true });
      return true;
    }
    return false;
  }

  // --- Initial Launch ---
  initUI();
  await loadData();

  if (!setupObserver()) {
    // If table/container is not found yet, observe document.body until it appears
    const bodyObserver = new MutationObserver(async (mutations, obs) => {
      if (setupObserver()) {
        obs.disconnect();
        // Since table just loaded, trigger scan and matching
        await scanD2LInputs();
        await runMatching();
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Expose exports for testing in playground
  window.__d2l_grade_copier_test_exports = {
    parseD2LLearnerCell,
    smartNameMatch,
    findStudentRows,
    getCurrentUrl,
    getD2LCourseId,
    state
  };

})();
