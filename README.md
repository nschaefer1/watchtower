# Watchtower

One-line description: e.g., "A lightweight desktop app for monitoring 
local processes that broadcast logs over TCP."

![screenshot.png]

## What it does

2-3 paragraphs. Cover:
- Problem it solves ("monitoring multiple local services in one place")
- How it works at a high level (TCP connection to processes implementing 
  the AdvancedLogger protocol)
- Who it's for (devs running multiple services locally, internal tooling)

## Features

Bullet list of headline capabilities:
- Live log streaming from multiple processes
- Real-time CPU/RAM monitoring per process
- One-click process termination
- Dark/light theme
- ...

## Requirements

- Python 3.10+ (or whatever you targeted)
- Windows / macOS / Linux (be specific about what you tested)
- Target processes must implement the AdvancedLogger protocol (link to spec/example)

## Installation

For users:
- Download from Releases (link)
- Or build from source: instructions

For developers:
\`\`\`bash
git clone https://github.com/you/repo
cd repo
pip install -r requirements.txt
python main.py
\`\`\`

## The AdvancedLogger protocol

Brief description of what processes need to do to be monitorable:
- Open TCP socket on a chosen port
- Accept any client
- Send newline-delimited JSON messages of types: log, stats, conn
- Example payload formats

Link to or include adv_log.py as a reference implementation.

## Building from source

Reference your build.ps1 script. Note Windows-only or cross-platform.

## Configuration

Brief mention of ports.json — auto-generated, no manual editing required.

## Architecture (optional but useful for contributors)

- Backend: Python + pywebview, threaded socket clients per port
- Frontend: vanilla HTML/CSS/JS + Chart.js
- IPC: pywebview's JS↔Python bridge with polling

## Contributing

- Fork, branch, PR
- Code style: follow existing patterns
- For protocol additions, propose in an issue first

## License

MIT — see LICENSE file.