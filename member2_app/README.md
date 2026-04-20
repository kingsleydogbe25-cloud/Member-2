Member 2

Member 2 is a lightweight desktop data management application designed for keeping track of members, categories, and custom data fields. It uses a simple Python backend exposed via [pywebview](https://github.com/r0x0r/pywebview) and a plain HTML/CSS/JavaScript frontend. No frameworks or build tools are required for the interface; everything runs locally and stores data in JSON files.

[Member 2 Screenshot](docs/screenshot.png)

Features

- Dynamic schema builder for custom member fields
- Category management and filtering
- Import/export in JSON, CSV, and PDF formats
- Backups with one-click restore or delete
- Collapsible sidebar with icon-only mode
- Light/dark theming and other user preferences

Getting Started

Requirements

- Python 3.11 or newer
- pip (to install dependencies)

Installation

   bash
python -m venv .venv
on Windows
.\.venv\Scripts\activate
on macOS/Linux
source .venv/bin/activate

pip install pywebview


Running the App

   bash
python main.py


Packaging

To build a standalone executable using PyInstaller:

   bash
pip install pyinstaller
pyinstaller member2.spec


The compiled application will be in `dist/Member2`.

Project Structure


member2_app/
├── main.py                 # app entry point
├── backend/                # Python API and database logic
│   ├── api.py
│   └── database.py
├── web/                    # UI assets
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── data/                   # JSON data store and backups
└── dist/                   # PyInstaller output


Contributing

Contributions are welcome Please open an issue for bugs or feature requests and submit pull requests against the `main` branch. See [Documentation.md](./Documentation.md) for detailed development instructions.

License

This project is released under the MIT License. See [LICENSE](LICENSE) for details.
