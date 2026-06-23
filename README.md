# LMS Monitor (Brightspace & Canvas)

InstructorHelper is a Chrome extension for instructors who need to compare Brightspace and Canvas course rosters, monitor enrollment changes, and make grade-transfer workflows easier.

The extension is intentionally local-first: it only works when the instructor is already signed in and visiting supported LMS pages, and it stores its working data in browser storage rather than sending student data to an external service.

## What It Does

- Scrapes roster data from D2L Brightspace classlist and grade-related views.
- Scrapes student roster data from supported Canvas course gradebook pages.
- Compares D2L and Canvas rosters to surface mismatches.
- Tracks roster changes over time and raises badge or notification alerts.
- Provides a dashboard for reviewing monitored courses, links, and change history.
- Includes a D2L grade copier workflow for manual grade transfer assistance.

## Supported Pages

The current manifest is scoped to specific LMS hosts and page patterns:

- Brightspace classlist pages on `learn.rrc.ca`
- Brightspace grade item edit pages on `learn.rrc.ca`
- Brightspace user list view pages on `learn.rrc.ca`
- Canvas gradebook and grades pages on `awsacademy.instructure.com`

If you need this extension to work against a different Brightspace or Canvas domain, update the match patterns in `manifest.json` before loading the extension.

## How the Workflow Works

1. Open a supported D2L or Canvas page while signed in.
2. The matching content script captures the visible roster or grade-related data.
3. The extension stores snapshots in `chrome.storage.local`.
4. D2L course rosters can be linked to one or more Canvas courses in the dashboard.
5. The dashboard compares linked rosters and highlights missing or extra students.
6. When changes are detected, the background service worker updates the badge count and can create a browser notification.

## Privacy and Data Handling

- The extension does not scrape anything until you manually visit a supported page.
- Data is stored locally in the browser using `chrome.storage.local`.
- When the dashboard is opened outside the extension context, mock data is stored in `localStorage` under `mock_chrome_storage`.
- No external backend or third-party API is required for normal operation.

## Project Structure

```text
.
├── background/
│   └── service-worker.js
├── content/
│   ├── canvas_gradebook.js
│   ├── d2l_classlist.js
│   └── d2l_grade_copier.js
├── dashboard/
│   ├── dashboard.css
│   ├── dashboard.html
│   └── dashboard.js
├── icons/
├── playground/
│   ├── playground.css
│   ├── playground.html
│   ├── playground.js
│   ├── run_headless_tests.js
│   └── tests.js
├── popup/
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
├── manifest.json
└── README.md
```

## Local Development

### Load the Extension in Chrome

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `InstructorHelper` workspace folder.

### Use the Playground

The playground lets you work on UI and data behavior without reloading the extension for every change.

1. Start a local server from the project root:

   ```powershell
   python -m http.server 8000
   ```

2. Open the playground:

   ```text
   http://localhost:8000/playground/playground.html
   ```

3. Open the dashboard directly in a normal browser tab if you want to test dashboard rendering with mocked storage:

   ```text
   http://localhost:8000/dashboard/dashboard.html
   ```

## Testing Notes

- `playground/tests.js` contains browser-driven tests for roster parsing and snapshot behavior.
- `playground/run_headless_tests.js` is a headless test runner, but it currently uses a macOS Chrome path and will need adjustment before it runs on Windows.

## Storage Model

The extension initializes and uses local storage keys such as:

- `courses`
- `snapshots`
- `changeLog`
- `courseLinks`
- `unreadCount`

These keys support the popup summary, dashboard comparisons, and change-notification badge state.

## Current Scope and Limitations

- This is a Chrome extension built on Manifest V3.
- Host permissions are currently limited to the domains listed in `manifest.json`.
- The matching logic is optimized for instructor-assisted workflows, not unattended synchronization.
- Grade copying is an assistive workflow inside supported D2L pages, not an automated cross-LMS submission pipeline.

## Next Improvements Worth Considering

- Make the supported LMS domains configurable.
- Add a Windows-friendly headless test command.
- Document the expected snapshot schema for contributors.
- Add release or packaging instructions once distribution is needed.
