# Watchtower

A lightweight desktop app for monitoring multiple local Python processes from a single dashboard. Connect to any process broadcasting via the AdvancedLogger protocol, watch its logs stream in real-time, track CPU and RAM, and terminate misbehaving processes with one click.

Built with Python + pywebview for the backend, vanilla HTML/CSS/JS + Chart.js for the frontend.

---

## Why

Running several local services during development (APIs, workers, schedulers) often means juggling multiple terminal windows. Watchtower puts every process's live logs, resource usage, and status in one place — useful for development, debugging, and informally monitoring production services running on `127.0.0.1`.

The app connects via TCP to any process that opens a listening socket and emits newline-delimited JSON messages (see the **Protocol** section below). It does not require any modification to the target processes beyond enabling their logger to broadcast.

---

## Features

- **Live log streaming** from multiple processes simultaneously, color-coded by log level
- **Real-time CPU and RAM tracking** per process, with historical line charts
- **Per-port connection status** — green / red-blink / red-solid LED-style indicators
- **One-click reconnect** for ports that have dropped
- **Kill process** by port (with PID lookup via psutil)
- **Add / remove / sort ports** through a popup UI
- **Dark and light themes** that follow the user's preference (saved in localStorage)
- **Resizable panels** so users can adjust the split between port list and console
- **Persistent port config** stored in a local `ports.json`

---

## Requirements

- **Python 3.12** — earlier versions have f-string parsing differences that cause issues with some of the inline templates; later versions (3.13/3.14) should also work but are not the recommended target.
- **Windows** — the app has only been tested on Windows. It should work on macOS and Linux with minor adjustments (path handling, no `.ps1` build script), but those platforms are unverified.
- **WebView2 runtime** — usually pre-installed on Windows 10/11. pywebview will prompt to install it if missing.

### Python dependencies

```
nrs_toolkit
pywebview
psutil
```

Install with:

```bash
pip install -r requirements.txt
```

For development, you'll also want PyInstaller for building distributable executables:

```bash
pip install pyinstaller
```

---

## Running from source

```bash
git clone <repo-url>
cd watchtower
pip install -r requirements.txt
python main.py
```

The app launches a window. On first run, `ports.json` doesn't exist yet — click **Add Port** in the bottom-left, enter a process name and port number, and the app will attempt to connect.

To debug-launch with the devtools console open:

```bash
set DEBUG=1
python main.py
```

(Or on PowerShell: `$env:DEBUG="1"; python main.py`.)

---

## Packaging for distribution

The repo includes a `package.ps1` PowerShell script that builds a single-file Windows executable using PyInstaller. The script is provided as a reference implementation of how the app is expected to be distributed.

```powershell
.\package.ps1
```

This produces:

```
dist/
  Watchtower_v0.1.0/
    Watchtower.exe        # stable name regardless of version
    frontend/             # copied alongside the exe (not bundled)
```

End users only need the `.exe` and the `frontend/` folder — they go anywhere together. `ports.json` and `logs/` are created automatically next to the exe on first run.

To tweak the version, edit the `$Version` variable at the top of `package.ps1`. The script keeps the exe name stable across versions (so shortcuts don't break) but stamps the containing folder with the version.

---

## The AdvancedLogger protocol

Watchtower connects to processes that expose logs over TCP using a simple line-delimited JSON protocol. The reference implementation is `adv_log.py` — a logger that runs alongside your application, opens a TCP listener, and broadcasts log records as they happen.

### Wire format

The server (your process) sends UTF-8 text, newline-delimited (`\n`), with one JSON object per line. Three message types are defined:

**Handshake** (sent once on client connect):
```json
{"type": "conn", "msg": "success"}
```

**Log message** (every time the logger emits):
```json
{"type": "log", "ts": "2026-05-25T13:42:11", "level": "INFO", "msg": "Request received from 10.0.42.7"}
```

**Stats** (emitted at a fixed interval, default 5 seconds):
```json
{"type": "stats", "ts": "2026-05-25T13:42:15", "cpu": 4.2, "ram_mb": 128.6}
```

Clients connect, receive the handshake, then receive a continuous stream of `log` and `stats` messages in interleaved order until the connection closes.

### Adding the logger to a Python service

```python
from watchtower.adv_log import AdvancedLogger

AdvancedLogger(listener=True, port=8080)

import logging
logger = logging.getLogger(__name__)
logger.info("Service started")   # this will broadcast to any connected client
```

Once that runs, Watchtower can connect to `127.0.0.1:8080` and see the logs.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Watchtower (Python)                                         │
│                                                             │
│   API (pywebview js_api)                                    │
│     │                                                       │
│     ├── _connections: dict[port → ClientConnection]         │
│     │                                                       │
│     └── ClientConnection (one per port)                     │
│         ├── socket + reader thread                          │
│         ├── logs: deque(maxlen=1000)                        │
│         ├── stats: deque (history for charts)               │
│         └── latest_stats: dict (latest values)              │
└──────────────┬──────────────────────────────────────────────┘
               │ js_api bridge (polled, not pushed)
               │
┌──────────────▼──────────────────────────────────────────────┐
│ Frontend (HTML / CSS / JS in pywebview)                     │
│                                                             │
│   Three poll loops:                                         │
│     - update_console:    500ms (selected port logs)         │
│     - update_all_statuses: 1s  (LED states)                 │
│     - update_all_stats:  5s    (CPU/RAM display)            │
│                                                             │
│   Charts rendered with Chart.js                             │
└─────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **Pull-based, not push-based.** Python never calls JS directly. The frontend polls API methods on its own schedule. This avoids tight coupling and makes both sides easier to reason about.
- **Selection lives in the DOM, not in JS state.** The console and chart polls read the currently-selected card from the DOM each tick. This means selection state never gets out of sync with the UI.
- **Deques for log and stats buffers.** Thread-safe appends from the reader thread, atomic reads from the API thread, automatic eviction of old entries.
- **One thread per port connection.** Sockets block on `recv`; each lives in its own thread with a clean shutdown signal via `threading.Event`.

---

## File structure

```
watchtower/
├── main.py                       # entry point: creates pywebview window
├── package.ps1                   # PyInstaller build script (Windows)
├── adv_log.py                    # logger module to drop in target processes
├── requirements.txt
├── LICENSE
├── README.md
│
├── backend/
│   ├── api/
│   │   └── api.py                # pywebview js_api class
│   └── services/
│       └── client_connector.py   # ClientConnection (TCP + thread + buffers)
│
└── frontend/
    ├── index.html
    ├── global.css                # theme variables, body, scrollbars
    ├── global.js                 # theme toggle, color helpers
    ├── router.js                 # multi-page navigation helper
    ├── css/
    │   ├── animations.css        # all @keyframes
    │   ├── buttons.css           # .btn + clickable icons
    │   ├── components.css        # cards, console, charts
    │   ├── font.css
    │   ├── layout.css            # structural containers
    │   └── popup.css             # popup dialogs
    └── js/
        ├── chart.umd.js          # Chart.js vendored
        └── index.js              # main app logic
```

---

## Contributing

Forks and PRs are welcome. A few notes for contributors:

- **Code style:** existing patterns are loose but consistent. Snake_case for Python and JS function/variable names; CSS class names use hyphens.
- **Comments:** prefer block-level docstrings with a numbered "Steps:" walkthrough for non-trivial functions. Avoid inline comments unless a line is genuinely ambiguous.
- **No build step.** Frontend is plain HTML/CSS/JS — no bundler, no transpiler. Edit files, refresh the app.
- **Protocol changes:** if you're proposing changes to the AdvancedLogger wire format, please open an issue first to discuss compatibility implications.
- **New features:** small additions can go directly to a PR. Larger changes (new visualizations, alternate transports, etc.) are best discussed in an issue first.

---

## Known limitations

- Single-threaded for connection attempts at startup — bounded by the slowest port, but parallelized within that bound via `ThreadPoolExecutor`.
- The console rebuilds the full DOM each poll instead of appending only new lines. Fine for normal log volume; would need a sequence-ID dedup mechanism for high-frequency logging (>50 lines/sec sustained).
- Only one selected card at a time. The console and charts always reflect the most recently selected port.
- Kill button requires the host process to have permission to terminate the target — works for processes owned by the same user; admin/root needed otherwise.

---

## License

MIT — see [LICENSE](LICENSE) for details.