// Automated Unit Tests for LMS Monitor Grade Copier and Classlist Monitoring
(() => {
  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || "Assertion failed");
    }
  }

  async function ensureScriptsLoaded() {
    if (!window.__d2l_grade_copier_test_exports) {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = '../content/d2l_grade_copier.js';
        script.onload = resolve;
        document.body.appendChild(script);
      });
    }
    if (typeof processClasslistChanges !== 'function') {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = '../content/d2l_classlist.js';
        script.onload = resolve;
        document.body.appendChild(script);
      });
    }
  }

  function testParseD2LLearnerCell() {
    const exports = window.__d2l_grade_copier_test_exports;
    const parse = exports.parseD2LLearnerCell;
    
    // Create mock learner cells
    const makeMockCell = (text, hasLink = false) => {
      const div = document.createElement('div');
      if (hasLink) {
        const a = document.createElement('a');
        a.textContent = text;
        div.appendChild(a);
      } else {
        div.textContent = text;
      }
      return div;
    };
    
    // Format 1: 0334098, Mohamed, Mohamed
    let res = parse(makeMockCell("0334098, Mohamed, Mohamed"));
    assert(res.id === "0334098", `Format 1 ID was ${res.id}, expected 0334098`);
    assert(res.name === "Mohamed, Mohamed", `Format 1 name was ${res.name}, expected Mohamed, Mohamed`);
    
    // Format 2: Mohamed, Mohamed (Id: 0334098)
    res = parse(makeMockCell("Mohamed, Mohamed (Id: 0334098)"));
    assert(res.id === "0334098", `Format 2 ID was ${res.id}, expected 0334098`);
    assert(res.name === "Mohamed, Mohamed", `Format 2 name was ${res.name}, expected Mohamed, Mohamed`);

    // Extra garbage, emoji, down arrows, spaces
    res = parse(makeMockCell("  ▼  0334098,  Mohamed,   Mohamed  ✨  "));
    assert(res.id === "0334098", `Garbage format ID was ${res.id}, expected 0334098`);
    assert(res.name === "Mohamed, Mohamed", `Garbage format name was "${res.name}", expected "Mohamed, Mohamed"`);

    // Case with parent link
    res = parse(makeMockCell("Mohamed, Mohamed (Id: 0334098)", true));
    assert(res.id === "0334098", `Link format ID was ${res.id}, expected 0334098`);
    assert(res.name === "Mohamed, Mohamed", `Link format name was ${res.name}, expected Mohamed, Mohamed`);
  }

  function testSmartNameMatch() {
    const exports = window.__d2l_grade_copier_test_exports;
    const match = exports.smartNameMatch;

    // Exact matching
    assert(match("Alice Anderson", "Alice Anderson", "aanderson@example.com") === true, "Exact name match failed");
    
    // Username prefix match
    assert(match("Franz Bulawan", "franzbulawan@academic.rrc.ca", "fbulawan@academic.rrc.ca") === true, "Franz Bulawan username match failed");
    
    // Token match with mismatched email
    assert(match("Mohamed Mohamed", "Mohamed Mohamed", "mmohamed45@academic.rrc.ca") === true, "Mohamed token match failed");
    
    // Subhpreet Singh email match
    assert(match("Subhpreet Singh", "Subhpreet Singh", "subhpreetsingh@academic.rrc.ca") === true, "Subhpreet Singh match failed");
    
    // False matches should return false
    assert(match("Alice Anderson", "Bob Brown", "bbrown@example.com") === false, "Incorrect match returned true");
  }

  async function testRosterChangeTracking() {
    // Save original storage data
    const originalData = await chrome.storage.local.get(null);
    
    try {
      // Clear storage for test
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        unreadCount: 0,
        courses: {},
        changeLog: [],
        enabledCourses: {},
        courseLinks: {}
      });

      const courseId = 'd2l-test-course';
      const courseName = 'Test Roster Course';
      
      // Step 1: Initial setup
      const initialStudents = [
        { id: '101', name: 'Alice Anderson', email: 'alice@example.com', role: 'Student' },
        { id: '102', name: 'Bob Brown', email: 'bob@example.com', role: 'Student' }
      ];
      
      await processClasslistChanges(courseId, courseName, initialStudents);
      
      let { snapshots, changeLog } = await chrome.storage.local.get(['snapshots', 'changeLog']);
      let snap = snapshots[courseId];
      
      assert(snap.length === 2, "Snapshot should have 2 students");
      assert(snap[0].status === 'initial', "First student should have status 'initial'");
      assert(snap[1].status === 'initial', "Second student should have status 'initial'");
      const initialTimestamp = snap[0].timestamp;
      assert(typeof initialTimestamp === 'number', "Timestamp should be a number");
      assert(snap[1].timestamp === initialTimestamp, "Both should have the same initial timestamp");
      assert(changeLog.length === 0, "No changes logged on initial run");
      
      // Step 2: Remove a student
      await new Promise(r => setTimeout(r, 10));
      
      const secondRunStudents = [
        { id: '101', name: 'Alice Anderson', email: 'alice@example.com', role: 'Student' }
        // Bob (102) is removed
      ];
      
      await processClasslistChanges(courseId, courseName, secondRunStudents);
      
      ({ snapshots, changeLog } = await chrome.storage.local.get(['snapshots', 'changeLog']));
      snap = snapshots[courseId];
      
      assert(snap.length === 2, "Roster should still contain 2 students (removed student must not be deleted)");
      
      const alice = snap.find(s => s.id === '101');
      const bob = snap.find(s => s.id === '102');
      
      assert(alice.status === 'initial', "Alice should remain 'initial'");
      assert(alice.timestamp === initialTimestamp, "Alice's timestamp should not change");
      
      assert(bob.status === 'removed', "Bob should be marked as 'removed'");
      assert(bob.timestamp > initialTimestamp, "Bob's timestamp should be updated to removal time");
      assert(changeLog.length === 1, "One change should be logged for Bob's removal");
      assert(changeLog[0].type === 'removal', "Logged change should be a 'removal'");
      
      // Step 3: Re-add the removed student
      await new Promise(r => setTimeout(r, 10));
      
      const thirdRunStudents = [
        { id: '101', name: 'Alice Anderson', email: 'alice@example.com', role: 'Student' },
        { id: '102', name: 'Bob Brown', email: 'bob@example.com', role: 'Student' } // Bob is back
      ];
      
      await processClasslistChanges(courseId, courseName, thirdRunStudents);
      
      ({ snapshots, changeLog } = await chrome.storage.local.get(['snapshots', 'changeLog']));
      snap = snapshots[courseId];
      
      assert(snap.length === 2, "Roster should still have 2 students");
      const bobReadded = snap.find(s => s.id === '102');
      assert(bobReadded.status === 'added', "Bob should now be marked as 'added'");
      assert(bobReadded.timestamp > bob.timestamp, "Bob's timestamp should be updated to re-addition time");
      assert(changeLog.length === 2, "Second change should be logged");
      assert(changeLog[0].type === 'addition', "Logged change should be an 'addition'");
      assert(changeLog[0].description.includes("previously removed"), "Change description should mention 'previously removed'");
      
    } finally {
      // Restore original storage data
      await chrome.storage.local.clear();
      await chrome.storage.local.set(originalData);
    }
  }

  function testNamesMatch() {
    const exports = window.__d2l_classlist_test_exports;
    const match = exports.namesMatch;

    // Normal matching
    assert(match("Alice Anderson", "Alice Anderson") === true, "Exact match failed");
    
    // Reversed comma name matching
    assert(match("Singh, Amandeep", "Amandeep Singh") === true, "Reversed format matching failed");
    assert(match("Amandeep Singh", "Singh, Amandeep") === true, "Reversed format matching failed 2");
    
    // Middle name / initials
    assert(match("Franz Bulawan", "Bulawan, Franz M.") === true, "Middle initial matching failed");
    
    // Extraneous punctuation and whitespace
    assert(match("   Mohamed ,  Mohamed  ", "Mohamed Mohamed") === true, "Punctuation/whitespace matching failed");

    // Parentheses stripping
    assert(match("Saeam Kim (Id: 0434490)", "Kim, Saeam") === true, "Parentheses ID matching failed");
    
    // Different names
    assert(match("Alice Anderson", "Bob Brown") === false, "Different names match returned true");
  }

  async function testSnapshotMerging() {
    const originalData = await chrome.storage.local.get(null);
    try {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        unreadCount: 0,
        courses: {},
        changeLog: [],
        enabledCourses: {},
        courseLinks: {}
      });

      const courseId = 'd2l-test-course';
      const courseName = 'Test Merging Course';

      const urlInput = document.querySelector('.url-input');
      const originalUrl = urlInput ? urlInput.value : '';

      // Set to classlist.d2l
      if (urlInput) {
        urlInput.value = 'https://learn.rrc.ca/d2l/lms/classlist/classlist.d2l?ou=753180';
      }

      const classlistStudents = [
        { id: 'aanderson', orgId: '', username: 'aanderson', name: 'Alice Anderson', email: 'aanderson@example.com', role: 'Student' },
        { id: 'bbrown', orgId: '', username: 'bbrown', name: 'Bob Brown', email: 'bbrown@example.com', role: 'Student' }
      ];

      await processClasslistChanges(courseId, courseName, classlistStudents);

      let { snapshots } = await chrome.storage.local.get('snapshots');
      let snap = snapshots[courseId];

      assert(snap.length === 2, "Should have 2 students after classlist run");
      assert(snap[0].email === 'aanderson@example.com', "Email should be saved");
      assert(snap[0].username === 'aanderson', "Username should be saved");
      assert(snap[0].orgId === '', "Org ID should be empty");

      // Set to user_list_view.d2l to simulate Grades view (which skips removals)
      if (urlInput) {
        urlInput.value = 'https://learn.rrc.ca/d2l/lms/grades/admin/enter/user_list_view.d2l?ou=753180';
      }

      const gradesStudents = [
        { id: '10001', orgId: '10001', username: '', name: 'Anderson, Alice', email: '', role: 'Student' },
        { id: '10002', orgId: '10002', username: '', name: 'Brown, Bob', email: '', role: 'Student' }
      ];

      await processClasslistChanges(courseId, courseName, gradesStudents);

      ({ snapshots } = await chrome.storage.local.get('snapshots'));
      snap = snapshots[courseId];

      assert(snap.length === 2, "Should still have 2 students (no duplicates or removals)");
      
      const alice = snap.find(s => s.orgId === '10001');
      const bob = snap.find(s => s.orgId === '10002');

      assert(alice !== undefined, "Alice should be found by orgId");
      assert(bob !== undefined, "Bob should be found by orgId");

      assert(alice.email === 'aanderson@example.com', "Alice's email should be preserved");
      assert(alice.username === 'aanderson', "Alice's username should be preserved");
      assert(alice.id === '10001', "Alice's primary id should be updated to orgId");

      assert(bob.email === 'bbrown@example.com', "Bob's email should be preserved");
      assert(bob.username === 'bbrown', "Bob's username should be preserved");
      assert(bob.id === '10002', "Bob's primary id should be updated to orgId");

      // Restore url input value
      if (urlInput) {
        urlInput.value = originalUrl;
      }
    } finally {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(originalData);
    }
  }

  async function testDuplicateNamesConflictingEmails() {
    const originalData = await chrome.storage.local.get(null);
    try {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        unreadCount: 0,
        courses: {},
        changeLog: [],
        enabledCourses: {},
        courseLinks: {}
      });

      const courseId = 'd2l-test-course';
      const courseName = 'Test Duplicate Name Course';

      const urlInput = document.querySelector('.url-input');
      const originalUrl = urlInput ? urlInput.value : '';

      // Set to classlist.d2l
      if (urlInput) {
        urlInput.value = 'https://learn.rrc.ca/d2l/lms/classlist/classlist.d2l?ou=753180';
      }

      // 1. Two students with same name but different emails in classlist
      const classlistStudents = [
        { id: 'pkaur1', orgId: '', username: 'pkaur1', name: 'Parneet Kaur', email: 'pkaur1@example.com', role: 'Student' },
        { id: 'pkaur2', orgId: '', username: 'pkaur2', name: 'Parneet Kaur', email: 'pkaur2@example.com', role: 'Student' }
      ];

      await processClasslistChanges(courseId, courseName, classlistStudents);

      let { snapshots } = await chrome.storage.local.get('snapshots');
      let snap = snapshots[courseId];

      assert(snap.length === 2, "Should have 2 students in classlist");

      // 2. Simulate User List View where we scrape duplicate names with Org IDs and scraped emails
      if (urlInput) {
        urlInput.value = 'https://learn.rrc.ca/d2l/lms/grades/admin/enter/user_list_view.d2l?ou=753180';
      }

      const gradesStudents = [
        { id: '0397431', orgId: '0397431', username: '', name: 'Kaur, Parneet', email: 'pkaur1@example.com', role: 'Student' },
        { id: '0397432', orgId: '0397432', username: '', name: 'Kaur, Parneet', email: 'pkaur2@example.com', role: 'Student' }
      ];

      await processClasslistChanges(courseId, courseName, gradesStudents);

      ({ snapshots } = await chrome.storage.local.get('snapshots'));
      snap = snapshots[courseId];

      assert(snap.length === 2, "Should still have 2 students (no duplicates created)");
      
      const firstKaur = snap.find(s => s.orgId === '0397431');
      const secondKaur = snap.find(s => s.orgId === '0397432');

      assert(firstKaur !== undefined, "First Parneet Kaur should be found by orgId 0397431");
      assert(secondKaur !== undefined, "Second Parneet Kaur should be found by orgId 0397432");

      assert(firstKaur.email === 'pkaur1@example.com', "First Parneet Kaur's email should match pkaur1@example.com");
      assert(secondKaur.email === 'pkaur2@example.com', "Second Parneet Kaur's email should match pkaur2@example.com");

      // Restore url input value
      if (urlInput) {
        urlInput.value = originalUrl;
      }
    } finally {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(originalData);
    }
  }

  async function runAllTests() {
    const resultsContainer = document.getElementById('test-results-container');
    resultsContainer.style.display = 'block';
    resultsContainer.innerHTML = '🧪 Running tests...\n';
    
    let passed = 0;
    let total = 0;
 
    const runTest = async (name, testFn) => {
      total++;
      try {
        resultsContainer.innerHTML += `⌛ ${name}... `;
        resultsContainer.scrollTop = resultsContainer.scrollHeight;
        await testFn();
        resultsContainer.innerHTML += `<span style="color: #4ade80;">PASSED</span>\n`;
        passed++;
      } catch (err) {
        resultsContainer.innerHTML += `<span style="color: #f87171;">FAILED</span>\n<span style="color: #f87171; font-size: 11px;">   Error: ${err.message}</span>\n`;
      }
      resultsContainer.scrollTop = resultsContainer.scrollHeight;
    };

    try {
      await ensureScriptsLoaded();
      
      await runTest("D2L Cell ID/Name Parser (parseD2LLearnerCell)", testParseD2LLearnerCell);
      await runTest("Smart Name Match Logic (smartNameMatch)", testSmartNameMatch);
      await runTest("Token-based D2L Name Matching (namesMatch)", testNamesMatch);
      await runTest("Roster Tracking and Re-addition diff logic", testRosterChangeTracking);
      await runTest("D2L Classlist & Grades Snapshot Merging logic", testSnapshotMerging);
      await runTest("Duplicate students with conflicting emails merging logic", testDuplicateNamesConflictingEmails);
      
      const successColor = passed === total ? '#4ade80' : '#f59e0b';
      resultsContainer.innerHTML += `\n<span style="color: ${successColor}; font-weight: bold;">Result: ${passed}/${total} tests passed.</span>\n`;
    } catch (err) {
      resultsContainer.innerHTML += `\n<span style="color: #f87171; font-weight: bold;">Run Error: ${err.message}</span>\n`;
    }
    resultsContainer.scrollTop = resultsContainer.scrollHeight;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const runBtn = document.getElementById('run-tests-btn');
    if (runBtn) {
      runBtn.addEventListener('click', runAllTests);
    }
    if (window.location.search.includes('run_tests=true')) {
      setTimeout(runAllTests, 500);
    }
  });
})();
