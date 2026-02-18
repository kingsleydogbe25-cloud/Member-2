# Member 2 – Development Documentation

This document guides contributors through the architecture, setup, and coding conventions for the Member 2 desktop application. The project consists of a small Python backend (using pywebview) and a single-page frontend written with plain HTML/CSS/JavaScript. No build tools are required for the frontend; a minimal distribution is generated automatically by PyInstaller.


##  Project Structure

member2_app/                ← workspace root
├── main.py                 # entry point, creates pywebview window
├── member2.spec            # PyInstaller spec used to build executable
├── backend/                # Python API layer and data logic
│   ├── api.py
│   ├── database.py
│   └── __pycache__/
├── web/                    # static assets served by the UI
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js          # client-side application logic
│       └── chart.umd.js    # bundled Chart.js
├── data/                   # persistent storage files (JSON)
│   ├── categories.json
│   ├── members.json
│   ├── schema.json
│   ├── settings.json
│   └── backups/            # automatic backups by feature
└── dist/                   # distribution folder created by PyInstaller
    └── Member2/_internal/…


The workspace may also contain build artifacts and caches added by the packaging process.

##  Getting Started

1. **Python environment**
   * Use Python 3.11+ (3.13 used in development). Create a virtual environment:
        powershell
     python -m venv .venv
     .\.venv\Scripts\activate
     
   * Install dependencies (only `pywebview` is required at time of writing):
        powershell
     pip install pywebview
     

2. **Run the app**
      powershell
   python main.py
   
   This opens a window loading `web/index.html` and bridges to the backend via `window.pywebview.api`.

3. **Packaging**
   The repository already includes `member2.spec`. To create a standalone executable:
      powershell
   pip install pyinstaller
   pyinstaller member2.spec
   
   The result will appear under `dist/Member2`.


## Architecture Overview

### Backend (`backend/`)
* `api.py` defines an `Api` class with methods exposed to the UI (`get_members`, `delete_member`, etc.). It acts as a thin wrapper around `database.py`.
* `database.py` handles CRUD operations on the JSON files stored in `data/`. It also manages schema, categories, backups, and basic validation. All data operations are synchronous; the UI calls them via pywebview's async RPC.

### Frontend (`web/`)
* **`index.html`**: single-page layout with a sidebar, main content sections, modals, and settings.
* **`css/style.css`**: custom styles using CSS variables for theming. A sidebar can collapse/expand (new feature) with state saved in `localStorage`.
* **`js/app.js`**: large monolithic object `app` containing state and functions for UI rendering, data fetching, navigation, and util helpers. The file currently exceeds 1100 lines; consider splitting into modules if the code base grows.
* External libraries: Chart.js (local copy), jsPDF (CDN). Font Awesome for icons.

#### Communication
The frontend uses the `window.pywebview.api` object. All backend methods return JSON or simple values; errors are logged to the console and shown via toast notifications.

### Data Format
All persisted data lives in plain JSON. The schema file defines the available fields for each member and is used to build forms dynamically.


## Adding Features or Fixes

1. **Plan changes**: determine whether logic belongs in the backend (`api.py`/`database.py`) or frontend (`app.js`). Frontend UI modifications require updating both HTML and CSS; behaviour enhancements go into `app.js`.
2. **Styles**: follow existing CSS variable names and transition patterns. Keep sidebar width in `--sidebar-width` if it needs to be referenced.
3. **State persistence**: use `localStorage` for lightweight UI preferences (sidebar collapsed state, last page of members, etc.).  Data itself is saved by the backend.
4. **Testing manual flows**: run the app locally and exercise forms, imports, exports, backups, and the new sidebar toggle to ensure nothing regresses.
5. **Packaging**: after changes, rebuild the executable to verify the PyInstaller spec still works. The spec currently includes `web` directory in `datas` and bundles `main.py`.


##  Debugging & Development Tips

* **Browser DevTools** are disabled in production (debug is off in `main.py`). To re-enable, start with `webview.start(debug=True)` or add a keyboard shortcut in `app.js` to toggle `nodeIntegration` for remote inspection.
* **Logging**: the frontend logs to the browser console; the backend prints to stdout. When packaged, stdout is captured in `warn-member2.txt` under `build/`.
* **Persistent state**: inspect files under `data/` to see actual JSON content. Backups are timestamped.
* **Performance**: all operations are local and synchronous — no major performance concerns. If the dataset grows large, consider paging/filtering optimizations.


##  Coding Conventions

* Use ES6 syntax for frontend (`const`, `let`, arrow functions). Avoid third‑party frameworks or bundlers.
* Keep all HTML inside `index.html`; minimal inline styles, but some are used when generating elements in JS.
* Backend methods should return objects with `{status: 'success'|'error', message?: string}` when appropriate.
* Document new API methods with comments in `api.py` and update the client (`app.js`) accordingly.


## Future Improvements

* Modularize `app.js` into smaller files (e.g., `sidebar.js`, `members.js`).
* Add unit tests for backend logic (`database.py`).
* Add validation and error display when importing malformed data.
* Support dark/light theme toggle remembered between sessions (already partially implemented).
* Add keyboard shortcuts, search autocompletion, or sorting enhancements.


## Contributing

Feel free to fork, modify, and submit pull requests. 