// D2L Grade Copier Content Script
console.log("LMS Monitor: D2L Grade Copier script injected");

(async () => {
  if (window.__d2l_grade_copier_loaded) {
    console.log("LMS Monitor: D2L Grade Copier is already loaded.");
    return;
  }
  window.__d2l_grade_copier_loaded = true;

  function getCurrentUrl() {
    if (window.location.hostname === 'learn.rrc.ca') {
      return window.location.href;
    }
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
    const cellText = learnerCell.textContent || "";
    const idMatch = cellText.match(/\b\d{6,8}\b/);
    const id = idMatch ? idMatch[0] : null;

    const link = learnerCell.querySelector("a");
    let name = link ? link.textContent.trim() : cellText.replace(/\b\d{6,8}\b/g, "").trim();

    name = name
      .replace(/\s*\(\s*id:\s*\d{6,8}\s*\)/gi, "")
      .replace(/\s*\(\s*id:\s*\)/gi, "")
      .replace(/\b\d{6,8}\b/g, "")
      .replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "")
      .replace(/^\s*[^a-zA-Z0-9\s,']+\s*/, "")
      .replace(/\s*[^a-zA-Z0-9\s,']+\s*$/, "")
      .replace(/^[\s,]+/, "")
      .replace(/[\s,]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

    return { id, name };
  }

  const getCleanTokens = (name) => {
    if (!name) return [];
    return name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token && !/^\d+$/.test(token));
  };

  const smartNameMatch = (d2lName, canvasName, canvasEmail = "") => {
    const tokens1 = getCleanTokens(d2lName);
    const tokens2 = getCleanTokens(canvasName);
    if (tokens1.length > 0 && tokens2.length > 0) {
      const set1 = new Set(tokens1);
      const set2 = new Set(tokens2);

      let matches = 0;
      for (const token of set1) {
        if (set2.has(token)) matches++;
      }

      const minTokens = Math.min(tokens1.length, tokens2.length);
      if (matches >= minTokens) return true;

      if (tokens1.length >= 2 && tokens2.length >= 2) {
        const hasFirst1In2 = set2.has(tokens1[0]);
        const hasLast1In2 = set2.has(tokens1[tokens1.length - 1]);
        if (hasFirst1In2 && hasLast1In2) return true;
      }
    }

    if (!d2lName) return false;
    let lastName = "";
    let firstName = "";
    const parts = d2lName.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      lastName = parts[0];
      firstName = parts[1];
    } else if (parts.length === 1) {
      const spaceParts = parts[0].split(/\s+/);
      if (spaceParts.length >= 2) {
        firstName = spaceParts[0];
        lastName = spaceParts.slice(1).join(" ");
      } else {
        firstName = parts[0];
      }
    }

    const firstClean = firstName.toLowerCase().replace(/[^a-z]/g, "");
    const lastClean = lastName.toLowerCase().replace(/[^a-z]/g, "");
    if (!firstClean && !lastClean) return false;

    const firstInitial = firstClean.charAt(0);
    const lastInitial = lastClean.charAt(0);
    const candidates = new Set();
    if (firstClean && lastClean) {
      candidates.add(firstClean + lastClean);
      candidates.add(lastClean + firstClean);
      if (firstInitial) candidates.add(firstInitial + lastClean);
      if (lastInitial) candidates.add(lastClean + firstInitial);
      if (lastInitial) candidates.add(firstClean + lastInitial);
    }
    if (firstClean) candidates.add(firstClean);
    if (lastClean) candidates.add(lastClean);

    const checkPrefix = (value) => {
      if (!value) return false;
      let normalized = value.toLowerCase();
      if (normalized.includes("@")) {
        normalized = normalized.split("@")[0];
      }
      normalized = normalized.trim();
      if (!normalized) return false;
      if (candidates.has(normalized)) return true;

      const stripped = normalized.replace(/\d+$/g, "");
      return !!stripped && candidates.has(stripped);
    };

    return checkPrefix(canvasEmail) || checkPrefix(canvasName);
  };

  function extractNumerator(scoreStr) {
    if (!scoreStr) return "";
    const parts = scoreStr.split("/");
    const rawNum = parts[0].trim();
    return rawNum === "N/A" ? "" : rawNum;
  }

  let state = {
    d2lCourseId: null,
    canvasCourses: [],
    linkedCanvasIds: [],
    selectedCanvasId: "",
    selectedAssignment: "",
    canvasSnapshot: [],
    d2lSnapshot: [],
    canvasSortField: "orgId",
    canvasSortDirection: "asc"
  };

  let shadowRoot = null;
  let container = null;

  function initUI() {
    const existing = document.getElementById("lms-copier-root");
    if (existing) existing.remove();

    container = document.createElement("div");
    container.id = "lms-copier-root";
    document.body.appendChild(container);

    shadowRoot = container.attachShadow({ mode: "open" });

    const style = document.createElement("style");
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
      .grades-table td.id-cell {
        display: none;
      }
      .grades-table th#th-student-id {
        display: none;
      }
      .grades-table td.org-id-cell {
        font-family: monospace;
        color: #94a3b8;
        width: 70px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .grades-table td.name-cell {
        font-weight: 500;
        color: #e2e8f0;
        max-width: 160px;
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

    const toggle = document.createElement("div");
    toggle.className = "floating-toggle";
    toggle.id = "floating-toggle";
    toggle.innerHTML = "📊 Canvas Copier";
    shadowRoot.appendChild(toggle);

    const panel = document.createElement("div");
    panel.className = "copier-panel";
    panel.id = "copier-panel";
    panel.innerHTML = `
      <div class="copier-header">
        <h2 class="copier-title">Canvas Grade Viewer</h2>
        <div class="header-actions">
          <button class="refresh-btn" id="refresh-btn" title="Refresh Canvas grades">🔄</button>
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

        <div class="student-list" id="student-list-container">
          <div class="no-data-msg">Select a course and assignment to load grades.</div>
        </div>
      </div>
    `;
    shadowRoot.appendChild(panel);

    toggle.addEventListener("click", async () => {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) {
        await refreshCanvasData();
      }
    });

    shadowRoot.getElementById("close-panel-btn").addEventListener("click", () => {
      panel.classList.remove("open");
    });

    shadowRoot.getElementById("refresh-btn").addEventListener("click", async () => {
      await refreshCanvasData();

      const refreshBtn = shadowRoot.getElementById("refresh-btn");
      refreshBtn.style.transform = "rotate(360deg)";
      setTimeout(() => {
        refreshBtn.style.transform = "none";
      }, 500);
    });

    shadowRoot.getElementById("canvas-course-select").addEventListener("change", async (e) => {
      state.selectedCanvasId = e.target.value;
      await populateAssignments();
      await refreshCanvasData();
    });

    shadowRoot.getElementById("canvas-assignment-select").addEventListener("change", async (e) => {
      state.selectedAssignment = e.target.value;
      renderStudentList();
    });
  }

  async function loadData() {
    state.d2lCourseId = getD2LCourseId();
    if (!state.d2lCourseId) {
      console.warn("LMS Monitor: Could not find D2L course ID from URL parameters.");
      return;
    }

    const storageData = await chrome.storage.local.get(["courses", "courseLinks"]);
    const courses = storageData.courses || {};
    const courseLinks = storageData.courseLinks || {};

    state.linkedCanvasIds = courseLinks[state.d2lCourseId] || [];
    state.canvasCourses = Object.values(courses).filter((course) => course.type === "canvas-gradebook");

    populateCoursesDropdown();
    await populateAssignments();
    await refreshCanvasData();
  }

  function populateCoursesDropdown() {
    if (!shadowRoot) return;
    const select = shadowRoot.getElementById("canvas-course-select");
    select.innerHTML = '<option value="">Select a course...</option>';

    if (state.canvasCourses.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No Canvas courses found in storage";
      opt.disabled = true;
      select.appendChild(opt);
      return;
    }

    let defaultCanvasId = "";
    if (state.linkedCanvasIds.length > 0) {
      defaultCanvasId = state.linkedCanvasIds[0];
    } else if (state.canvasCourses.length > 0) {
      defaultCanvasId = state.canvasCourses[0].id;
    }

    state.selectedCanvasId = defaultCanvasId;

    state.canvasCourses.forEach((course) => {
      const opt = document.createElement("option");
      opt.value = course.id;
      opt.textContent = course.name + (state.linkedCanvasIds.includes(course.id) ? " (Linked)" : "");
      if (course.id === defaultCanvasId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  async function populateAssignments() {
    if (!shadowRoot) return;
    const select = shadowRoot.getElementById("canvas-assignment-select");
    select.innerHTML = '<option value="">Select an assignment...</option>';

    if (!state.selectedCanvasId) {
      select.disabled = true;
      state.selectedAssignment = "";
      state.canvasSnapshot = [];
      return;
    }
    select.disabled = false;

    const storageData = await chrome.storage.local.get("snapshots");
    const snapshots = storageData.snapshots || {};
    const canvasSnapshot = snapshots[state.selectedCanvasId] || [];
    const assignmentsSet = new Set();

    canvasSnapshot.forEach((student) => {
      if (student.grades) {
        Object.keys(student.grades).forEach((assignmentName) => {
          assignmentsSet.add(assignmentName);
        });
      }
    });

    const assignments = Array.from(assignmentsSet).sort();

    if (assignments.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No assignments found";
      opt.disabled = true;
      select.appendChild(opt);
      state.selectedAssignment = "";
      state.canvasSnapshot = canvasSnapshot;
      return;
    }

    const hasCurrentSelection = assignments.includes(state.selectedAssignment);
    state.selectedAssignment = hasCurrentSelection ? state.selectedAssignment : assignments[0];

    assignments.forEach((assignment) => {
      const opt = document.createElement("option");
      opt.value = assignment;
      opt.textContent = assignment;
      if (assignment === state.selectedAssignment) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  async function refreshCanvasData() {
    if (!shadowRoot) return;

    const listContainer = shadowRoot.getElementById("student-list-container");
    if (!state.selectedCanvasId || !state.selectedAssignment) {
      state.canvasSnapshot = [];
      listContainer.innerHTML = '<div class="no-data-msg">Select a course and assignment to load grades.</div>';
      return;
    }

    const storageData = await chrome.storage.local.get("snapshots");
    const snapshots = storageData.snapshots || {};
    state.canvasSnapshot = snapshots[state.selectedCanvasId] || [];
    state.d2lSnapshot = snapshots[state.d2lCourseId] || [];
    renderStudentList();
  }

  function renderStudentList() {
    const listContainer = shadowRoot.getElementById("student-list-container");
    listContainer.innerHTML = "";

    if (!state.selectedCanvasId || !state.selectedAssignment) {
      listContainer.innerHTML = '<div class="no-data-msg">Select a course and assignment to load grades.</div>';
      return;
    }

    const sortedCanvasStudents = [...(state.canvasSnapshot || [])];
    sortedCanvasStudents.sort((a, b) => {
      let valA;
      let valB;

      if (state.canvasSortField === "name") {
        valA = (a.studentName || "").toLowerCase();
        valB = (b.studentName || "").toLowerCase();
      } else if (state.canvasSortField === "studentId") {
        valA = a.studentId || "";
        valB = b.studentId || "";
        if (!valA && !valB) return 0;
        if (!valA) return state.canvasSortDirection === "asc" ? 1 : -1;
        if (!valB) return state.canvasSortDirection === "asc" ? -1 : 1;
        return state.canvasSortDirection === "asc"
          ? valA.localeCompare(valB, undefined, { numeric: true })
          : valB.localeCompare(valA, undefined, { numeric: true });
      } else if (state.canvasSortField === "orgId") {
        // Resolve Org IDs for sorting
        const getOrgId = (student) => {
          if (student.studentEmail && state.d2lSnapshot) {
            const match = state.d2lSnapshot.find(s => s.email && s.email.toLowerCase() === student.studentEmail.toLowerCase());
            if (match && match.id) return match.id;
          }
          if (student.orgId) return student.orgId;
          return "";
        };
        valA = getOrgId(a) || "";
        valB = getOrgId(b) || "";
        if (!valA && !valB) return 0;
        if (!valA) return state.canvasSortDirection === "asc" ? 1 : -1;
        if (!valB) return state.canvasSortDirection === "asc" ? -1 : 1;
        return state.canvasSortDirection === "asc"
          ? valA.localeCompare(valB, undefined, { numeric: true })
          : valB.localeCompare(valA, undefined, { numeric: true });
      } else {
        const gradeAObj = a.grades ? a.grades[state.selectedAssignment] : null;
        const gradeBObj = b.grades ? b.grades[state.selectedAssignment] : null;
        valA = gradeAObj ? parseFloat(extractNumerator(gradeAObj.score)) : -1;
        valB = gradeBObj ? parseFloat(extractNumerator(gradeBObj.score)) : -1;
        if (isNaN(valA)) valA = -1;
        if (isNaN(valB)) valB = -1;
      }

      if (valA < valB) return state.canvasSortDirection === "asc" ? -1 : 1;
      if (valA > valB) return state.canvasSortDirection === "asc" ? 1 : -1;
      return 0;
    });

    const table = document.createElement("table");
    table.className = "grades-table";

    const getSortIndicator = (field) => {
      if (state.canvasSortField !== field) return " ↕";
      return state.canvasSortDirection === "asc" ? " ▲" : " ▼";
    };

    const isSortActive = (field) => {
      return state.canvasSortField === field ? 'class="active-sort"' : "";
    };

    table.innerHTML = `
      <thead>
        <tr>
          <th id="th-student-id" style="width: 70px;" ${isSortActive("studentId")}>Canvas ID<span class="sort-icon">${getSortIndicator("studentId")}</span></th>
          <th id="th-org-id" style="width: 70px;" ${isSortActive("orgId")}>Org ID<span class="sort-icon">${getSortIndicator("orgId")}</span></th>
          <th id="th-name" ${isSortActive("name")}>Name<span class="sort-icon">${getSortIndicator("name")}</span></th>
          <th id="th-grade" style="text-align: center;" ${isSortActive("grade")}>Grade<span class="sort-icon">${getSortIndicator("grade")}</span></th>
          <th style="text-align: right;">Action</th>
        </tr>
      </thead>
      <tbody id="canvas-grades-table-body"></tbody>
    `;

    listContainer.appendChild(table);
    const tbody = table.querySelector("#canvas-grades-table-body");

    if (sortedCanvasStudents.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="4" class="no-data-msg" style="border: none;">No Canvas students found.</td>';
      tbody.appendChild(tr);
    } else {
      sortedCanvasStudents.forEach((student) => {
        const tr = document.createElement("tr");
        const gradeObj = student.grades ? student.grades[state.selectedAssignment] : null;
        const scoreDisplay = gradeObj && gradeObj.score ? gradeObj.score : "Ungraded";
        const rawNumerator = gradeObj ? extractNumerator(gradeObj.score) : "";

        // Resolve Org ID from D2L snapshot via email matching
        let orgId = "";
        if (student.studentEmail && state.d2lSnapshot) {
          const d2lMatch = state.d2lSnapshot.find(s => s.email && s.email.toLowerCase() === student.studentEmail.toLowerCase());
          if (d2lMatch && d2lMatch.id) {
            orgId = d2lMatch.id;
          }
        }
        if (!orgId && student.orgId) {
          orgId = student.orgId;
        }

        tr.innerHTML = `
          <td class="id-cell" title="${student.studentId || "—"}">${student.studentId || "—"}</td>
          <td class="org-id-cell" title="${orgId || "—"}">${orgId || "—"}</td>
          <td class="name-cell" title="${student.studentName}">${student.studentName}</td>
          <td class="grade-cell">${scoreDisplay}</td>
          <td class="actions-cell">
            ${rawNumerator ? `<button class="icon-btn copy-table-grade-btn" data-score="${rawNumerator}" title="Copy numerator (${rawNumerator}) to clipboard">📋</button>` : ""}
          </td>
        `;

        tbody.appendChild(tr);
      });
    }

    const thStudentId = table.querySelector("#th-student-id");
    const thOrgId = table.querySelector("#th-org-id");
    const thName = table.querySelector("#th-name");
    const thGrade = table.querySelector("#th-grade");

    thStudentId.addEventListener("click", () => {
      if (state.canvasSortField === "studentId") {
        state.canvasSortDirection = state.canvasSortDirection === "asc" ? "desc" : "asc";
      } else {
        state.canvasSortField = "studentId";
        state.canvasSortDirection = "asc";
      }
      renderStudentList();
    });

    thOrgId.addEventListener("click", () => {
      if (state.canvasSortField === "orgId") {
        state.canvasSortDirection = state.canvasSortDirection === "asc" ? "desc" : "asc";
      } else {
        state.canvasSortField = "orgId";
        state.canvasSortDirection = "asc";
      }
      renderStudentList();
    });

    thName.addEventListener("click", () => {
      if (state.canvasSortField === "name") {
        state.canvasSortDirection = state.canvasSortDirection === "asc" ? "desc" : "asc";
      } else {
        state.canvasSortField = "name";
        state.canvasSortDirection = "asc";
      }
      renderStudentList();
    });

    thGrade.addEventListener("click", () => {
      if (state.canvasSortField === "grade") {
        state.canvasSortDirection = state.canvasSortDirection === "asc" ? "desc" : "asc";
      } else {
        state.canvasSortField = "grade";
        state.canvasSortDirection = "desc";
      }
      renderStudentList();
    });

    table.querySelectorAll(".copy-table-grade-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const score = btn.getAttribute("data-score");
        navigator.clipboard.writeText(score).then(() => {
          btn.textContent = "✅";
          setTimeout(() => {
            btn.textContent = "📋";
          }, 1000);
        });
      });
    });
  }

  initUI();
  await loadData();

  window.__d2l_grade_copier_test_exports = {
    parseD2LLearnerCell,
    smartNameMatch,
    getCurrentUrl,
    getD2LCourseId,
    state
  };
})();
