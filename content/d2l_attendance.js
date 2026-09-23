// D2L Brightspace Attendance Copier
console.log("LMS Monitor: D2L Attendance script injected");

function normalizeAttendanceText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function getAttendanceRows(table) {
  if (!table) return { headers: [], rows: [] };

  const headerRow = table.querySelector("thead tr") || table.querySelector("tr[header]") || table.rows[0];
  if (!headerRow) return { headers: [], rows: [] };

  const headers = Array.from(headerRow.cells).map(cell => normalizeAttendanceText(cell.innerText || cell.textContent));
  const rows = Array.from(table.querySelectorAll("tbody tr, tr")).filter(row => {
    return row !== headerRow && !row.closest("thead") && row.cells.length > 0;
  }).map(row => Array.from(row.cells).map(cell => normalizeAttendanceText(cell.innerText || cell.textContent)))
    .filter(row => row.some(Boolean));

  return { headers, rows };
}

function scoreAttendanceTable(table) {
  const parsed = getAttendanceRows(table);
  const headers = parsed.headers.map(header => header.toLowerCase());
  if (!headers.length || !parsed.rows.length) return -1;

  let score = Math.min(parsed.rows.length, 10) * 0.1;
  if (headers.some(header => /student|learner|name|user|participant/.test(header))) score += 5;
  if (headers.some(header => /attendance|present|absent|status|date/.test(header))) score += 4;
  if (headers.some(header => /email|username|id/.test(header))) score += 1;
  return score;
}

function findAttendanceTable(root = document) {
  return Array.from(root.querySelectorAll("table"))
    .map(table => ({ table, score: scoreAttendanceTable(table) }))
    .sort((left, right) => right.score - left.score)[0]?.table || null;
}

function attendanceRowsToTsv(headers, rows) {
  const width = headers.length;
  const outputRows = [headers, ...rows].map(row => {
    const cells = Array.from({ length: width }, (_, index) => row[index] || "");
    return cells.map(cell => cell.replace(/\t|\r?\n/g, " ")).join("\t");
  });
  return outputRows.join("\n");
}

window.__d2l_attendance_test_exports = {
  getAttendanceRows,
  scoreAttendanceTable,
  attendanceRowsToTsv
};

function initAttendanceCopier() {
  if (document.getElementById("lms-attendance-copy-root")) return;

  const table = findAttendanceTable();
  if (!table) return;

  const parsed = getAttendanceRows(table);
  if (parsed.headers.length < 2 || parsed.rows.length === 0) return;

  const root = document.createElement("div");
  root.id = "lms-attendance-copy-root";
  root.innerHTML = `
    <style>
      #lms-attendance-copy-root { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #lms-attendance-copy-root button { border: 0; border-radius: 6px; padding: 10px 14px; background: #087f5b; color: #fff; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.24); }
      #lms-attendance-copy-root button:hover { background: #066b4c; }
      #lms-attendance-copy-root .attendance-copy-status { margin-top: 6px; padding: 6px 8px; border-radius: 4px; background: #fff; color: #334155; box-shadow: 0 2px 8px rgba(0,0,0,.16); font-size: 12px; }
    </style>
    <button type="button" id="lms-attendance-copy-button">Copy attendance (${parsed.rows.length} rows)</button>
    <div class="attendance-copy-status" id="lms-attendance-copy-status" hidden></div>
  `;
  document.body.appendChild(root);

  root.querySelector("button").addEventListener("click", async () => {
    const status = root.querySelector(".attendance-copy-status");
    try {
      await navigator.clipboard.writeText(attendanceRowsToTsv(parsed.headers, parsed.rows));
      status.textContent = `Copied ${parsed.rows.length} attendance rows. Paste into Excel or Sheets.`;
    } catch (error) {
      status.textContent = "Clipboard access was blocked. Select the attendance table and copy it manually.";
    }
    status.hidden = false;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAttendanceCopier, { once: true });
} else {
  initAttendanceCopier();
}