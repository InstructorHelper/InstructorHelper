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
  console.log("Playground: Local mock of chrome.storage (with localStorage persistence) and chrome.runtime initialized.");
}

// Ensure search parameters are set for D2L and Canvas scraper simulations
const urlParams = new URLSearchParams(window.location.search);
let paramsChanged = false;
if (!urlParams.has('ou')) {
  urlParams.set('ou', '753180');
  paramsChanged = true;
}
if (!urlParams.has('course_id')) {
  urlParams.set('course_id', '172153');
  paramsChanged = true;
}
if (paramsChanged) {
  window.history.replaceState(null, '', '?' + urlParams.toString());
}

// --- Tab Switching ---
const tabD2l = document.getElementById('tab-d2l');
const tabCanvas = document.getElementById('tab-canvas');
const envD2l = document.getElementById('d2l-env');
const envCanvas = document.getElementById('canvas-env');

tabD2l.addEventListener('click', () => {
  tabD2l.classList.add('active');
  tabCanvas.classList.remove('active');
  envD2l.classList.add('active');
  envCanvas.classList.remove('active');
});

tabCanvas.addEventListener('click', () => {
  tabCanvas.classList.add('active');
  tabD2l.classList.remove('active');
  envCanvas.classList.add('active');
  envD2l.classList.remove('active');
});

// --- D2L Sub-Tab Switching ---
const btnD2lClasslist = document.getElementById('btn-d2l-classlist');
const btnD2lUserList = document.getElementById('btn-d2l-user-list');
const btnD2lEnterGrades = document.getElementById('btn-d2l-enter-grades');
const d2lStudentTable = document.getElementById('z_e');
const d2lEnterGradesTable = document.getElementById('d2l-enter-grades-table');
const d2lUrlInput = envD2l.querySelector('.url-input');
const d2lPageTitle = document.getElementById('d2l-page-title');

function showD2LTable(activeType) {
  if (activeType === 'classlist') {
    if (!d2lStudentTable.parentNode) {
      if (d2lEnterGradesTable.parentNode) {
        d2lEnterGradesTable.replaceWith(d2lStudentTable);
      }
    }
    d2lStudentTable.style.display = '';
  } else {
    if (!d2lEnterGradesTable.parentNode) {
      if (d2lStudentTable.parentNode) {
        d2lStudentTable.replaceWith(d2lEnterGradesTable);
      }
    }
    d2lEnterGradesTable.style.display = '';
  }
}

function updateD2LSubNav(activeBtn) {
  [btnD2lClasslist, btnD2lUserList, btnD2lEnterGrades].forEach(btn => {
    if (btn === activeBtn) {
      btn.classList.add('active');
      btn.style.background = '#312e81';
      btn.style.color = 'white';
    } else {
      btn.classList.remove('active');
      btn.style.background = '#1e293b';
      btn.style.color = '#94a3b8';
    }
  });
}

btnD2lClasslist.addEventListener('click', () => {
  updateD2LSubNav(btnD2lClasslist);
  showD2LTable('classlist');
  d2lUrlInput.value = 'https://learn.rrc.ca/d2l/lms/classlist/classlist.d2l?ou=753180';
  d2lPageTitle.textContent = 'Classlist';
  
  // Clean up grade copier script
  const oldScript = document.getElementById('d2l-copier-script');
  if (oldScript) oldScript.remove();
});

btnD2lUserList.addEventListener('click', () => {
  updateD2LSubNav(btnD2lUserList);
  showD2LTable('grades');
  d2lUrlInput.value = 'https://learn.rrc.ca/d2l/lms/grades/admin/enter/user_list_view.d2l?ou=753180';
  d2lPageTitle.textContent = 'Enter Grades';
  
  renderD2LGrades();
  
  // Clean up grade copier script
  const oldScript = document.getElementById('d2l-copier-script');
  if (oldScript) oldScript.remove();
});

btnD2lEnterGrades.addEventListener('click', () => {
  updateD2LSubNav(btnD2lEnterGrades);
  showD2LTable('grades');
  d2lUrlInput.value = 'https://learn.rrc.ca/d2l/lms/grades/admin/enter/grade_item_edit.d2l?objectId=1498289&ou=753180';
  d2lPageTitle.textContent = 'Grade Item: Lab 1: S3 Bucket';
  
  renderD2LGrades();
  
  // Inject D2L grade copier content script dynamically
  const oldScript = document.getElementById('d2l-copier-script');
  if (oldScript) oldScript.remove();
  
  const script = document.createElement('script');
  script.id = 'd2l-copier-script';
  script.src = '../content/d2l_grade_copier.js';
  document.body.appendChild(script);
  console.log("Playground: Injected content/d2l_grade_copier.js");
});

// --- Mock Datasets ---
let d2lStudents = [
  { id: "10001", orgId: "10001", username: "aanderson", name: "Alice Anderson", email: "aanderson@example.com", role: "Student" },
  { id: "10002", orgId: "10002", username: "bbrown", name: "Bob Brown", email: "bbrown@example.com", role: "Student" },
  { id: "10003", orgId: "10003", username: "ccarter", name: "Charlie Carter", email: "ccarter@example.com", role: "Student" },
  { id: "0434605", orgId: "0434605", username: "acarrillo", name: "Adrian Carrillo", email: "acarrillo@example.com", role: "Student" },
  { id: "0403538", orgId: "0403538", username: "asingh", name: "Amandeep Singh", email: "asingh@example.com", role: "Student" },
  { id: "0427129", orgId: "0427129", username: "fbulawan", name: "Franz Bulawan", email: "fbulawan@example.com", role: "Student" },
  { id: "0334098", orgId: "0334098", username: "mmohamed", name: "Mohamed Mohamed", email: "mmohamed@example.com", role: "Student" },
  { id: "0397429", orgId: "0397429", username: "nkaur", name: "Navjot Kaur", email: "nkaur@example.com", role: "Student" },
  { id: "0397431", orgId: "0397431", username: "pkaur", name: "Parneet Kaur", email: "pkaur@example.com", role: "Student" },
  { id: "0434490", orgId: "0434490", username: "skim", name: "Saeam Kim", email: "skim@example.com", role: "Student" },
  { id: "0404311", orgId: "0404311", username: "ssingh", name: "Sarbjit Singh", email: "ssingh@example.com", role: "Student" },
  { id: "0397294", orgId: "0397294", username: "subhsingh", name: "Subhpreet Singh", email: "subhsingh@example.com", role: "Student" }
];

let canvasStudents = [
  { id: 20001, name: "Alice Anderson", email: "aanderson@example.com" },
  { id: 20002, name: "Bob Brown", email: "bbrown@example.com" },
  { id: 20003, name: "Charlie Carter", email: "ccarter@example.com" },
  { id: 20004, name: "Adrian Carrillo", email: "acarrillo@example.com" },
  { id: 20005, name: "Amandeep Singh", email: "asingh@example.com" },
  { id: 20006, name: "franzbulawan@academic.rrc.ca", email: "fbulawan@academic.rrc.ca" },
  { id: 20007, name: "Mohamed Mohamed", email: "mmohamed45@academic.rrc.ca" },
  { id: 20008, name: "Navjot Kaur", email: "nkaur@example.com" },
  { id: 20009, name: "Parneet Kaur", email: "pkaur@example.com" },
  { id: 20010, name: "Saeam Kim", email: "skim@example.com" },
  { id: 20011, name: "Sarbjit Singh", email: "ssingh@example.com" },
  { id: 20012, name: "Subhpreet Singh", email: "subhpreetsingh@academic.rrc.ca" }
];

let canvasSubmissions = [
  { user_id: 20001, assignment_id: 1, score: 85, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20001, assignment_id: 2, score: 92, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20001, assignment_id: 3, score: 78, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },
  
  { user_id: 20002, assignment_id: 1, score: 95, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20002, assignment_id: 2, score: 88, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20002, assignment_id: 3, score: 85, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20003, assignment_id: 1, score: 70, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20003, assignment_id: 2, score: 82, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20003, assignment_id: 3, score: 90, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20004, assignment_id: 1, score: 88, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20004, assignment_id: 2, score: 91, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20004, assignment_id: 3, score: 82, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20005, assignment_id: 1, score: 76, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20005, assignment_id: 2, score: 84, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20005, assignment_id: 3, score: 70, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20006, assignment_id: 1, score: 95, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20006, assignment_id: 2, score: 90, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20006, assignment_id: 3, score: 92, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20007, assignment_id: 1, score: 62, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20007, assignment_id: 2, score: 75, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20007, assignment_id: 3, score: 68, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20008, assignment_id: 1, score: 81, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20008, assignment_id: 2, score: 89, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20008, assignment_id: 3, score: 80, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20009, assignment_id: 1, score: 90, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20009, assignment_id: 2, score: 93, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20009, assignment_id: 3, score: 88, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20010, assignment_id: 1, score: 84, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20010, assignment_id: 2, score: 87, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20010, assignment_id: 3, score: 85, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20011, assignment_id: 1, score: 73, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20011, assignment_id: 2, score: 80, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20011, assignment_id: 3, score: 79, assignment: { id: 3, name: "Exam 1", points_possible: 100 } },

  { user_id: 20012, assignment_id: 1, score: 92, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
  { user_id: 20012, assignment_id: 2, score: 95, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
  { user_id: 20012, assignment_id: 3, score: 90, assignment: { id: 3, name: "Exam 1", points_possible: 100 } }
];

// Student View mock grades (rendered in DOM)
let studentViewGrades = [
  { assignmentName: "Assignment 1: Introduction", score: 9, maxPoints: 10 },
  { assignmentName: "Assignment 2: Linux Basics", score: 18, maxPoints: 20 },
  { assignmentName: "Assignment 3: Git & GitHub", score: 22, maxPoints: 25 },
  { assignmentName: "Final Project Draft", score: "N/A", maxPoints: 50 }
];

// --- Render Functions ---
function renderD2L() {
  const tbody = document.getElementById('d2l-student-table-body');
  // Re-write header row + all student rows to match real D2L grid structure exactly
  tbody.innerHTML = `
    <tr class="d_gh d2l-table-row-first" header="">
      <td class="d_gs d2l-table-cell-first" style="width:1%" rowspan="1" colspan="1">
        <input class="d2l-checkbox float_l" type="checkbox" id="z_bw_all">
      </td>
      <td>Image</td>
      <td>Name</td>
      <td>Org Defined ID</td>
      <td>Username</td>
      <td>Email</td>
      <td>Role</td>
      <td>Last Accessed</td>
    </tr>
  `;
  d2lStudents.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="d2l-checkbox" type="checkbox"></td>
      <td>👤</td>
      <td><a class="d2l-link" href="#">${s.name}</a></td>
      <td>${s.orgId}</td>
      <td>${s.username}</td>
      <td><a href="mailto:${s.email}">${s.email}</a></td>
      <td>${s.role}</td>
      <td>May 21, 2026 00:36 AM</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderD2LGrades() {
  const tbody = document.getElementById('d2l-grades-table-body');
  tbody.innerHTML = '';
  d2lStudents.forEach((s, idx) => {
    const nameParts = s.name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    // Alternate formats to test the parser thoroughly
    const learnerText = idx % 2 === 0
      ? `${lastName}, ${firstName}`
      : `${lastName}, ${firstName} (Id: ${s.id})`;
    
    const tr = document.createElement('tr');
    tr.className = 'd2l-grades-row';
    tr.innerHTML = `
      <td><input type="checkbox"></td>
      <td>
        <div style="font-weight: 500;">
          <a class="d2l-link" href="#" style="color: #b10806; text-decoration: none;">${learnerText}</a>
          <div style="display:none;"><a href="mailto:${s.email}">Email ${s.name}</a></div>
        </div>
      </td>
      <td>${s.orgId}</td>
      <td>
        <input type="text" class="d2l-input-grade" style="padding: 4px 8px; border: 1px solid #e5bdb7; background: #ffffff; color: #281715; border-radius: 4px; width: 60px;" value=""> / 100
      </td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCanvasStudent() {
  const tbody = document.getElementById('canvas-student-table-body');
  tbody.innerHTML = '';
  studentViewGrades.forEach(g => {
    const tr = document.createElement('tr');
    tr.className = 'student_assignment';
    tr.innerHTML = `
      <th class="title"><a href="#">${g.assignmentName}</a></th>
      <td>May 20, 2026</td>
      <td class="grade">${g.score}</td>
      <td class="points">${g.maxPoints}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCanvasInstructorDOM() {
  const viewport = document.getElementById('canvas-instructor-grid-body');
  viewport.innerHTML = '';
  canvasStudents.forEach(s => {
    // Find grades for this student
    const s1 = canvasSubmissions.find(sub => sub.user_id === s.id && sub.assignment_id === 1);
    const s2 = canvasSubmissions.find(sub => sub.user_id === s.id && sub.assignment_id === 2);
    const s3 = canvasSubmissions.find(sub => sub.user_id === s.id && sub.assignment_id === 3);
    
    const tr = document.createElement('div');
    tr.className = 'slick-row';
    const nameClass = s.id === 20001 ? "slick-cell" : "slick-cell student student-name";
    tr.innerHTML = `
      <div class="${nameClass}" data-student_id="${s.id}">${s.name}</div>
      <div class="slick-cell">${s1 ? s1.score : 'N/A'}/100</div>
      <div class="slick-cell">${s2 ? s2.score : 'N/A'}/100</div>
      <div class="slick-cell">${s3 ? s3.score : 'N/A'}/100</div>
    `;
    viewport.appendChild(tr);
  });
}

// --- Intercept Global fetch to Mock Canvas API ---
const originalFetch = window.fetch;

function buildUrlWithPage(urlObj, pageNum) {
  const newUrl = new URL(urlObj.href);
  newUrl.searchParams.set('page', pageNum);
  return newUrl.pathname + newUrl.search;
}

window.fetch = async (url, options) => {
  console.log(`Playground API Mock Intercept: ${url}`);
  
  const courseMatch = url.match(/\/api\/v1\/courses\/(\d+)/);
  if (courseMatch) {
    const courseId = parseInt(courseMatch[1]);
    
    // 1. Course Details Request
    if (url.endsWith(`/courses/${courseId}`)) {
      return new Response(JSON.stringify({
        id: courseId,
        name: `Mock Canvas Course ${courseId}`
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    
    // 2. Users (Students) Request
    if (url.includes('/users')) {
      const urlObj = new URL(url, window.location.origin);
      const page = parseInt(urlObj.searchParams.get('page')) || 1;
      const perPage = 5; // Force smaller size to test pagination
      
      // Modify students list slightly for course 172154 to differentiate rosters
      let studentsList = [...canvasStudents];
      if (courseId === 172154) {
        studentsList = canvasStudents.filter(s => s.name !== 'Charlie Carter');
      }
      
      const totalPages = Math.ceil(studentsList.length / perPage);
      const startIndex = (page - 1) * perPage;
      const paginatedList = studentsList.slice(startIndex, startIndex + perPage);
      
      const links = [];
      if (page > 1) {
        links.push(`<${buildUrlWithPage(urlObj, page - 1)}>; rel="prev"`);
      }
      if (page < totalPages) {
        links.push(`<${buildUrlWithPage(urlObj, page + 1)}>; rel="next"`);
      }
      links.push(`<${buildUrlWithPage(urlObj, 1)}>; rel="first"`);
      links.push(`<${buildUrlWithPage(urlObj, totalPages)}>; rel="last"`);
      
      const headers = { 'Content-Type': 'application/json' };
      if (links.length > 0) {
        headers['Link'] = links.join(', ');
      }
      
      return new Response(JSON.stringify(paginatedList), {
        status: 200,
        headers
      });
    }
    
    // 3. Submissions Request
    if (url.includes('/students/submissions')) {
      const urlObj = new URL(url, window.location.origin);
      const page = parseInt(urlObj.searchParams.get('page')) || 1;
      const perPage = 10; // Force smaller size to test pagination
      
      const totalPages = Math.ceil(canvasSubmissions.length / perPage);
      const startIndex = (page - 1) * perPage;
      const paginatedSubmissions = canvasSubmissions.slice(startIndex, startIndex + perPage);
      
      const links = [];
      if (page > 1) {
        links.push(`<${buildUrlWithPage(urlObj, page - 1)}>; rel="prev"`);
      }
      if (page < totalPages) {
        links.push(`<${buildUrlWithPage(urlObj, page + 1)}>; rel="next"`);
      }
      links.push(`<${buildUrlWithPage(urlObj, 1)}>; rel="first"`);
      links.push(`<${buildUrlWithPage(urlObj, totalPages)}>; rel="last"`);
      
      const headers = { 'Content-Type': 'application/json' };
      if (links.length > 0) {
        headers['Link'] = links.join(', ');
      }
      
      return new Response(JSON.stringify(paginatedSubmissions), {
        status: 200,
        headers
      });
    }
  }
  
  return originalFetch(url, options);
};

// --- D2L Control Handlers ---
document.getElementById('d2l-add-student').addEventListener('click', () => {
  const nextId = 10001 + d2lStudents.length;
  const inputName = prompt("Enter D2L Student Name:", "Grace Green");
  if (!inputName) return;
  const inputEmail = prompt("Enter D2L Student Email:", "ggreen@example.com");
  if (inputEmail === null) return;
  
  d2lStudents.push({
    id: String(nextId),
    orgId: String(nextId),
    username: inputEmail.split('@')[0],
    name: inputName,
    email: inputEmail,
    role: "Student"
  });
  renderD2L();
  alert(`Added ${inputName} to D2L simulation DOM. Run Classlist Scraper to detect.`);
});

document.getElementById('d2l-remove-student').addEventListener('click', () => {
  if (d2lStudents.length === 0) {
    alert("No students to remove.");
    return;
  }
  let msg = "Select student number to remove:\n" + d2lStudents.map((s, idx) => `${idx + 1}: ${s.name} (${s.id})`).join('\n');
  let choice = prompt(msg, "1");
  if (choice === null) return;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= d2lStudents.length) {
    alert("Invalid student number!");
    return;
  }
  const removed = d2lStudents.splice(idx, 1)[0];
  renderD2L();
  alert(`Removed ${removed.name} from D2L simulation DOM. Run Classlist Scraper to detect.`);
});

document.getElementById('d2l-change-role').addEventListener('click', () => {
  if (d2lStudents.length === 0) return;
  const target = d2lStudents[0];
  target.role = target.role === 'Student' ? 'Auditor' : 'Student';
  renderD2L();
  alert(`Changed ${target.name}'s role to ${target.role}. Run Classlist Scraper to detect.`);
});

// --- Canvas Control Handlers ---
document.getElementById('canvas-add-student').addEventListener('click', () => {
  const isStudentView = document.getElementById('canvas-student-view').checked;
  if (isStudentView) {
    // Add assignment to student grades summary
    const nextNum = studentViewGrades.length + 1;
    studentViewGrades.push({
      assignmentName: `Assignment ${nextNum}: Extra Credit`,
      score: 10,
      maxPoints: 10
    });
    renderCanvasStudent();
    alert("Added Assignment 5 to Student View DOM. Run Grades Scraper to detect.");
  } else {
    // Add student to Instructor View API
    const nextId = 20001 + canvasStudents.length;
    const inputName = prompt("Enter Canvas Student Name:", `New Student #${nextId}`);
    if (!inputName) return;
    const inputEmail = prompt("Enter Canvas Student Email:", `student${nextId}@example.com`);
    if (inputEmail === null) return;
    
    canvasStudents.push({
      id: nextId,
      name: inputName,
      email: inputEmail
    });
    
    // Add submissions for them
    canvasSubmissions.push(
      { user_id: nextId, assignment_id: 1, score: 90, assignment: { id: 1, name: "Lab 1: S3 Bucket", points_possible: 100 } },
      { user_id: nextId, assignment_id: 2, score: 85, assignment: { id: 2, name: "Lab 2: EC2 Instances", points_possible: 100 } },
      { user_id: nextId, assignment_id: 3, score: 80, assignment: { id: 3, name: "Exam 1", points_possible: 100 } }
    );
    
    renderCanvasInstructorDOM();
    alert(`Added ${inputName} to mock Canvas API. Run Grades Scraper to detect.`);
  }
});

document.getElementById('canvas-change-grade').addEventListener('click', () => {
  const isStudentView = document.getElementById('canvas-student-view').checked;
  if (isStudentView) {
    if (studentViewGrades.length === 0) return;
    const oldScore = studentViewGrades[0].score;
    studentViewGrades[0].score = oldScore === "N/A" ? 8 : (oldScore + 1) % 11; // shift score
    renderCanvasStudent();
    alert(`Changed ${studentViewGrades[0].assignmentName} grade from ${oldScore} to ${studentViewGrades[0].score}. Run Grades Scraper to detect.`);
  } else {
    if (canvasSubmissions.length === 0) return;
    const oldScore = canvasSubmissions[0].score;
    canvasSubmissions[0].score = (oldScore + 5) % 105;
    renderCanvasInstructorDOM();
    alert(`Changed ${canvasStudents[0].name}'s grade for Lab 1 from ${oldScore} to ${canvasSubmissions[0].score} in mock API data. Run Grades Scraper to detect.`);
  }
});

document.getElementById('canvas-remove-student').addEventListener('click', () => {
  const isStudentView = document.getElementById('canvas-student-view').checked;
  if (isStudentView) {
    if (studentViewGrades.length === 0) return;
    const removed = studentViewGrades.pop();
    renderCanvasStudent();
    alert(`Removed ${removed.assignmentName} from student view DOM. Run Grades Scraper to detect.`);
  } else {
    if (canvasStudents.length === 0) return;
    const removed = canvasStudents.pop();
    // Remove submissions
    canvasSubmissions = canvasSubmissions.filter(sub => sub.user_id !== removed.id);
    renderCanvasInstructorDOM();
    alert(`Removed student ${removed.name} from mock Canvas API data. Run Grades Scraper to detect.`);
  }
});

// Toggle student view vs instructor view
document.getElementById('canvas-student-view').addEventListener('change', (e) => {
  const isStudent = e.target.checked;
  const studentContainer = document.getElementById('canvas-student-dom-container');
  const instructorContainer = document.getElementById('canvas-instructor-dom-container');
  const urlInput = document.getElementById('canvas-url');
  
  if (isStudent) {
    studentContainer.style.display = 'block';
    instructorContainer.style.display = 'none';
    urlInput.value = 'https://awsacademy.instructure.com/courses/172153/grades?course_id=172153';
  } else {
    studentContainer.style.display = 'none';
    instructorContainer.style.display = 'block';
    urlInput.value = 'https://awsacademy.instructure.com/courses/172153/gradebook?course_id=172153';
  }
});

// --- Trigger Scraper Script Injections ---
document.getElementById('d2l-trigger-scrape').addEventListener('click', () => {
  // Inject D2L content script dynamically
  const oldScript = document.getElementById('d2l-scraper-script');
  if (oldScript) oldScript.remove();
  
  const script = document.createElement('script');
  script.id = 'd2l-scraper-script';
  script.src = '../content/d2l_classlist.js';
  document.body.appendChild(script);
  console.log("Playground: Injected content/d2l_classlist.js");
});

document.getElementById('canvas-trigger-scrape').addEventListener('click', () => {
  // Inject Canvas content script dynamically
  const oldScript = document.getElementById('canvas-scraper-script');
  if (oldScript) oldScript.remove();
  
  const script = document.createElement('script');
  script.id = 'canvas-scraper-script';
  script.src = '../content/canvas_gradebook.js';
  document.body.appendChild(script);
  console.log("Playground: Injected content/canvas_gradebook.js");
});

// --- Inspect & Clear Storage ---
document.getElementById('view-storage').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(null);
  document.getElementById('storage-display').textContent = JSON.stringify(data, null, 2);
});

document.getElementById('clear-storage').addEventListener('click', async () => {
  if (confirm("Are you sure you want to clear the extension local database?")) {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      unreadCount: 0,
      courses: {},
      changeLog: [],
      enabledCourses: {},
      courseLinks: {}
    });
    document.getElementById('storage-display').textContent = "Database cleared and re-initialized.";
    
    // Clear badges
    chrome.action.setBadgeText({ text: '' });
  }
});

// --- Auto-Seed Mock Data ---
async function seedMockData() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    console.warn("chrome.storage.local is not available (not running in extension context).");
    return;
  }
  
  const data = await chrome.storage.local.get(['courseLinks', 'snapshots', 'courses']);
  
  // Only seed if they are empty
  if (!data.courseLinks || Object.keys(data.courseLinks).length === 0) {
    console.log("Playground: Seeding mock database...");
    
    const initialD2LSnap = d2lStudents.map(s => ({
      id: s.orgId || s.id,
      orgId: s.orgId || s.id,
      username: s.username || s.id,
      name: s.name,
      email: s.email,
      role: s.role,
      status: 'initial',
      timestamp: Date.now()
    }));
    
    // Format canvas snapshot
    const canvasSnap = canvasStudents.map(s => {
      const studentSubmissions = canvasSubmissions.filter(sub => sub.user_id === s.id);
      const gradesObj = {};
      studentSubmissions.forEach(sub => {
        gradesObj[sub.assignment.name] = {
          score: `${sub.score}/${sub.assignment.points_possible}`,
          timestamp: Date.now() - 3600000 * 2, // 2 hours ago
          history: [
            { score: `${sub.score - 5}/${sub.assignment.points_possible}`, timestamp: Date.now() - 3600000 * 5 },
            { score: `${sub.score}/${sub.assignment.points_possible}`, timestamp: Date.now() - 3600000 * 2 }
          ]
        };
      });
      
      return {
        studentId: String(s.id),
        studentName: s.name,
        studentEmail: s.email,
        grades: gradesObj
      };
    });
    
    await chrome.storage.local.set({
      courseLinks: {
        "d2l-753180": ["canvas-172153"]
      },
      enabledCourses: {
        "d2l-753180": true,
        "canvas-172153": true
      },
      courses: {
        "d2l-753180": {
          id: "d2l-753180",
          name: "COMP-2045 (283184) Cloud Infrastructure",
          type: "d2l-classlist",
          lastChecked: Date.now(),
          itemCount: d2lStudents.length
        },
        "canvas-172153": {
          id: "canvas-172153",
          name: "AWS Cloud Foundation Course",
          type: "canvas-gradebook",
          lastChecked: Date.now(),
          itemCount: canvasStudents.length
        }
      },
      snapshots: {
        "d2l-753180": initialD2LSnap,
        "canvas-172153": canvasSnap
      },
      changeLog: []
    });
    console.log("Playground: Mock database seeded successfully!");
  }
}

// --- Initial Render ---
(async () => {
  await seedMockData();
  
  // Initially detach the grades table from the DOM to avoid multiple tables during scraper search
  if (d2lEnterGradesTable.parentNode) {
    d2lEnterGradesTable.parentNode.removeChild(d2lEnterGradesTable);
  }
  
  renderD2L();
  renderCanvasStudent();
  renderCanvasInstructorDOM();
  console.log("Playground fully initialized.");
})();
