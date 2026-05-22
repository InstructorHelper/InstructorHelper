// Background Service Worker

// Initialize extension settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    unreadCount: 0,
    courses: {},
    changeLog: []
  };
  
  // Set defaults if not already present
  const existing = await chrome.storage.local.get(Object.keys(defaults));
  const updates = {};
  for (const [key, val] of Object.entries(defaults)) {
    if (existing[key] === undefined) {
      updates[key] = val;
    }
  }
  
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
  
  console.log("LMS Monitor Background Worker initialized");
});

// Listener for messages from Content Scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHANGES_DETECTED') {
    (async () => {
      try {
        const { courseName, courseId, changes } = message.payload;
        
        // 1. Fetch current unread count
        const { unreadCount = 0 } = await chrome.storage.local.get('unreadCount');
        const newCount = unreadCount + changes.length;
        await chrome.storage.local.set({ unreadCount: newCount });
        
        // 2. Update Badge
        if (newCount > 0) {
          await chrome.action.setBadgeText({ text: String(newCount) });
          await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // red-500
        }
        
        // 3. Trigger Desktop Notification
        const changeSummary = formatChangeSummary(changes);
        chrome.notifications.create(`lms-change-${Date.now()}`, {
          type: 'basic',
          iconUrl: '../icons/icon-128.png',
          title: `Changes in ${courseName || courseId}`,
          message: changeSummary,
          priority: 2
        });
        
        sendResponse({ success: true });
      } catch (err) {
        console.error("Error processing changes message:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message channel open for async response
  }
});

// Helper to format a friendly notification summary
function formatChangeSummary(changes) {
  if (!changes || changes.length === 0) return "No modifications detected.";
  
  const count = changes.length;
  if (count === 1) {
    return changes[0].description;
  }
  
  // Count by categories
  const classlistChanges = changes.filter(c => c.category === 'classlist').length;
  const gradeChanges = changes.filter(c => c.category === 'grades').length;
  
  const parts = [];
  if (classlistChanges > 0) parts.push(`${classlistChanges} classlist update(s)`);
  if (gradeChanges > 0) parts.push(`${gradeChanges} grade update(s)`);
  
  return `Detected ${parts.join(" and ")}.`;
}
