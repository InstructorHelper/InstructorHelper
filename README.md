# LMS Monitor (Brightspace & Canvas) — InstructorHelper

A Chrome extension designed for instructors to simplify roster synchronization, discrepancy monitoring, and grade copying between D2L Brightspace and Canvas LMS.

---

## Key Features

1. **Classlist & Roster Scraping**:
   - Automatically scrapes student details (Name, Org-Defined ID, Username, and Email) directly from the D2L Brightspace Classlist/User List View.
   - Using the Org-Defined ID (e.g., student number `0123456`) is critical to ensure accurate matching, especially when students share the exact same first and last names.

2. **Canvas Matching**:
   - Matches D2L student entries with the Canvas Gradebook roster using unique emails and IDs.
   - Offers side-by-side comparison tables.

3. **Discrepancy Detection & Alerting**:
   - Identifies students who exist in D2L Brightspace but not in Canvas, or vice versa.
   - Flags roster discrepancies immediately on the central Dashboard.

4. **Grade Copier Tool**:
   - Streamlines transferring grade items from Brightspace to Canvas grade systems.

5. **LMS Monitor Dashboard**:
   - A central dashboard that displays the discrepancy monitoring log, active class rosters, matching statistics, and change history.
   - Built with modern styling (sleek dark/light theme, custom widgets, scrollable containers).
   - Designed to take the full space of the window for maximum readability and data scanning.

---

## Directory Structure

```text
├── background/
│   └── service-worker.js     # Background service worker handling extension lifecycle and messaging
├── content/
│   ├── canvas_gradebook.js   # Content script injected into Canvas courses to parse/inject roster details
│   ├── d2l_classlist.js     # Content script injected into D2L classlists/user list views to scrape rosters
│   └── d2l_grade_copier.js   # Content script injected into D2L grade item editors to facilitate copying
├── dashboard/
│   ├── dashboard.html        # Options page displaying roster status, discrepancies, and change logs
│   ├── dashboard.css         # Responsive styles for the central dashboard panel
│   └── dashboard.js          # Controller logic for dashboard metrics, data filtering, and rendering
├── icons/                    # Action and extension icons (16px, 48px, 128px)
├── popup/
│   ├── popup.html            # Extension popup panel (browser action)
│   ├── popup.css             # Action popup styles
│   └── popup.js              # Controller logic for quick popup summaries
├── playground/               # Sandbox testing suite for debugging layouts and core logic without extension reload
│   ├── playground.html       # HTML sandbox UI
│   ├── playground.css        # Styles for the playground page
│   ├── playground.js         # Playground controller mimicking chrome.storage API using localStorage
│   ├── run_headless_tests.js # Integration script for running headless tests
│   └── tests.js              # Roster parser and sync unit/integration tests
├── .gitignore                # Git ignore file (excludes OS/local logs)
└── manifest.json             # Extension manifest specification (Manifest V3)
```

---

## Installation & Setup

### Developer Installation
To run this extension locally in your Chrome browser:
1. Open Google Chrome.
2. Navigate to `chrome://extensions/`.
3. Toggle the **Developer mode** switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `InstructorHelper` directory.

### Running the Development Playground
For local layout validation and script testing without installing/reloading the extension:
1. Start a local HTTP server in the workspace root directory:
   ```bash
   python3 -m http.server 8000
   ```
2. Open your browser and navigate to the playground:
   ```text
   http://localhost:8000/playground/playground.html
   ```
3. Open the options/dashboard page:
   ```text
   http://localhost:8000/dashboard/dashboard.html
   ```

---

## Storage & API Interaction

The extension stores rosters and discrepancies inside `chrome.storage.local`. When running outside of the Chrome Extension environment (e.g. inside the local HTTP server playground), the scripts automatically fallback to mock storage in `localStorage` under the key `mock_chrome_storage` so you can continue testing and iterating on layout and style changes natively.
