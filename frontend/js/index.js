// =====================================================
// GLOBAL STATE
// =====================================================

let status_poll_timer = null;
let stats_poll_timer = null;
let console_poll_timer = null;

let chart1 = null;
let chart2 = null;

let colors = get_colors();

let sort_mode = 'port';     // 'port' or 'name'

// =====================================================
// SVG ICON CONSTANTS
// (Inline SVG strings — injected into card buttons via innerHTML)
// =====================================================

const REFRESH_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="">
<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
<path d="M21 3v5h-5"/>
</svg>`;

const DELETE_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="">
<path d="M10 11v6"/>
<path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
<path d="M3 6h18"/>
<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
</svg>`;

// =====================================================
// ENTRY POINT
// =====================================================

window.addEventListener('pywebviewready', () => {
    let api = window.pywebview.api;
    init(api);
});

/**
 * Application entry point. Runs once after pywebview signals it's ready.
 *
 * Steps:
 *  1. Wire all static button event listeners.
 *  2. Populate the port card list from the API.
 *  3. Start the three background polling loops (status, stats, console).
 *  4. Render the empty chart shells.
 */
async function init(api) {
    wire_buttons(api);
    await refresh_ports(api);

    start_status_timer(api);
    start_stat_timer(api);
    start_console_timer(api);

    render_charts(colors);
}

// =====================================================
// HELPERS
// =====================================================

/**
 * Enables the Kill button only when a card is selected AND that card's
 * status is "connected". Called from anywhere selection or status may
 * have changed (card click, refresh, status poll, reconnect, etc.).
 */
function sync_kill_button() {
    const selected = document.querySelector('.card.selected');
    const enable = selected && selected.classList.contains('status-connected');
    document.getElementById('kill-btn').classList.toggle('disabled', !enable);
}

/**
 * Reads the currently selected port from the DOM.
 * Returns the port number as an integer, or null if nothing is selected.
 */
function selected_port() {
    const selected = document.querySelector('.card.selected');
    return selected ? parseInt(selected.dataset.port) : null;
}

// =====================================================
// BUTTON MANAGEMENT
// =====================================================

/**
 * Attaches click handlers to every static button in the header and footer.
 * Card-level buttons (reconnect, delete) are wired up inside refresh_ports
 * since they're created dynamically per card.
 */
function wire_buttons(api) {

    on_click('light-dark-btn', () => {
        toggle_theme();
        colors = get_colors();
        render_charts(colors);
    });

    /**
     * Kill button — terminates the OS process for the selected port.
     *
     * Steps:
     *  1. Get the selected port; bail if nothing selected.
     *  2. Show a confirmation popup; bail if user cancels.
     *  3. Disable the button to prevent double-click.
     *  4. Call the kill API, log the result.
     *  5. Refresh the port list and re-sync the kill button state.
     */
    on_click('kill-btn', async () => {
        const port_num = selected_port();
        if (port_num === null) return;

        const confirmed = await confirm_popup(
            `Kill process on port ${port_num}? This cannot be undone.`,
            'Kill process'
        );
        if (!confirmed) return;

        document.getElementById('kill-btn').classList.add('disabled');

        const response = await api.kill_port(port_num);
        if (!response.success) {
            console.error('Kill failed:', response.message);
        } else {
            console.log(response.message);
        }
        await refresh_ports(api);
        sync_kill_button();
    });

    /**
     * Sort-by button — flips between sorting cards by port number vs. name.
     * Updates the button text and re-renders the list.
     */
    on_click('sort-by-btn', async () => {
        sort_mode = sort_mode === 'port' ? 'name' : 'port';
        const btn = document.getElementById('sort-by-btn');
        btn.textContent = sort_mode === 'port' ? 'Sort By: Port' : 'Sort By: Name';
        await refresh_ports(api);
    });

    /** Opens the add-port popup. */
    on_click('add-port-btn', () => {
        document.getElementById('port-popup').classList.add('show');
    });

    /** Closes the add-port popup and clears its inputs. */
    on_click('port-popup-close', () => {
        document.getElementById('port-popup').classList.remove('show');
        document.getElementById('process-name-input').value = '';
        document.getElementById('port-input').value = '';
    });

    /**
     * Submit handler for the add-port popup.
     *
     * Steps:
     *  1. Disable the submit button and the global refresh button.
     *  2. Validate that both fields are filled; show error if not.
     *  3. Call add_port API. On failure, show the error in the popup.
     *  4. On success, clear inputs, close popup, refresh port list.
     *  5. Re-enable buttons in the finally block (always runs).
     */
    on_click('port-popup-submit-btn', async () => {
        const btn = document.getElementById('port-popup-submit-btn');
        btn.classList.add('disabled');
        document.getElementById('cycle-btn').classList.add('disabled');

        const process = document.getElementById('process-name-input');
        const port = document.getElementById('port-input');
        const error_el = document.getElementById('port-popup-error');

        error_el.textContent = '';

        if (process.value === "" || port.value === "") {
            error_el.textContent = "Both fields are required.";
            btn.classList.remove('disabled');
            document.getElementById('cycle-btn').classList.remove('disabled');
            return;
        }

        try {
            const response = await api.add_port(process.value, port.value);
            if (!response.success) {
                error_el.textContent = response.message || "Something went wrong.";
                return;
            }
            process.value = '';
            port.value = '';
            document.getElementById('port-popup').classList.remove('show');
            await refresh_ports(api);
        } catch (err) {
            console.error('API call threw:', err);
            error_el.textContent = 'Unexpected error. Check the console.';
        } finally {
            btn.classList.remove('disabled');
            document.getElementById('cycle-btn').classList.remove('disabled');
        }
    });

    /**
     * Cycle (refresh-all) button — attempts reconnect on every non-connected port.
     *
     * Steps:
     *  1. Disable and spin the cycle button; spin every visible reconnect icon.
     *  2. Call reconnect_all_ports.
     *  3. Restore button states (status polling will update the cards naturally).
     */
    on_click('cycle-btn', async () => {
        const btn_el = document.getElementById('cycle-btn');

        btn_el.classList.add('disabled', 'spinning');
        document.querySelectorAll('.card-reconnect').forEach(el => {
            el.classList.add('spinning');
        });

        const response = await api.reconnect_all_ports();
        if (!response.success) {
            console.error('Refreshing all ports failed');
        } else {
            console.log(response.data);
        }

        btn_el.classList.remove('disabled', 'spinning');
        document.querySelectorAll('.card-reconnect').forEach(el => {
            el.classList.remove('spinning');
        });
    });

    /**
     * Clear-console button — wipes the log deque for the selected port
     * (server-side) and the console pane (client-side).
     *
     * Steps:
     *  1. Bail if no card is selected.
     *  2. Disable the button briefly to prevent double-click.
     *  3. Call clear_logs API.
     *  4. On success, empty the console DOM.
     */
    on_click('clear-console-btn', async () => {
        const port_num = selected_port();
        if (port_num === null) return;

        const btn_el = document.getElementById('clear-console-btn');
        btn_el.classList.add('disabled');

        const response = await api.clear_logs(port_num);
        if (!response.success) {
            console.error('Clear failed:', response.message);
            btn_el.classList.remove('disabled');
            return;
        }

        document.getElementById('main-console').innerHTML = '';
        btn_el.classList.remove('disabled');
    });

}

// =====================================================
// PORT UI REFRESH
// =====================================================

/**
 * Rebuilds the port card list from scratch using the latest data from the API.
 * Called on initial load and after any change that affects the port list
 * (add, remove, kill, refresh-all).
 *
 * Steps:
 *  1. Fetch port list and connection statuses in parallel.
 *  2. Sort the port list by the current sort_mode.
 *  3. Clear and rebuild the .vert-card-list element.
 *  4. For each port, build a card with: status lights, text, stats row,
 *     delete button, reconnect button.
 *  5. Attach click handlers to the card and its action buttons.
 *  6. Re-sync the kill button state (selection is lost during rebuild).
 */
async function refresh_ports(api) {

    const [ports_resp, status_resp] = await Promise.all([
        api.list_ports(),
        api.get_all_statuses()
    ]);

    if (!ports_resp.success) {
        console.error("Failed to load ports:", ports_resp.message);
        return;
    }

    const ports = [...ports_resp.data].sort((a, b) => {
        if (sort_mode === 'port') {
            return a.port - b.port;
        } else {
            return a.name.localeCompare(b.name);
        }
    });

    const statuses = status_resp.success ? status_resp.data : {};

    const list_el = document.querySelector('.vert-card-list');
    list_el.innerHTML = '';

    for (const port of ports) {
        const state = statuses[port.port] || { status: 'disconnected' };

        const card = document.createElement('div');
        card.dataset.port = port.port;
        card.className = `card status-${state.status}`;

        const lights = document.createElement('div');
        lights.className = 'status-lights';
        lights.innerHTML = '<div class="status-light status-light-ok"></div><div class="status-light status-light-err"></div>';

        const text = document.createElement('div');
        text.className = 'card-text';
        text.textContent = `${port.port} : ${port.name}`;

        const stats = document.createElement('div');
        stats.className = 'card-stats';
        stats.innerHTML = `
            <span class="stat-cpu">CPU --</span>
            <span class="stat-ram">RAM --</span>
        `;

        const delete_btn = document.createElement('div');
        delete_btn.className = 'card-delete';
        delete_btn.innerHTML = DELETE_ICON_SVG;
        delete_btn.title = 'Remove port';

        const reconnect_btn = document.createElement('div');
        reconnect_btn.className = 'card-reconnect';
        reconnect_btn.innerHTML = REFRESH_ICON_SVG;
        reconnect_btn.title = 'Reconnect';

        card.appendChild(lights);
        card.appendChild(text);
        card.appendChild(stats);
        card.appendChild(delete_btn);
        card.appendChild(reconnect_btn);

        /**
         * Card click — toggle selection.
         * Deselects all other cards first, then toggles this one.
         */
        card.addEventListener('click', () => {
            document.querySelectorAll('.card.selected').forEach(el => {
                if (el !== card) el.classList.remove('selected');
            });
            card.classList.toggle('selected');
            sync_kill_button();
        });

        /**
         * Reconnect button click — attempts to reconnect this port only.
         *
         * Steps:
         *  1. Stop event propagation (otherwise the card click also fires).
         *  2. Spin the button.
         *  3. Call reconnect_port API.
         *  4. Update the card's status class with the new status.
         *  5. Stop spinning in the finally block.
         */
        reconnect_btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            reconnect_btn.classList.add('spinning');

            try {
                const port_num = parseInt(card.dataset.port);
                const response = await api.reconnect_port(port_num);

                if (!response.success) {
                    console.error('Reconnect failed:', response.message);
                    return;
                }

                card.classList.remove('status-connected', 'status-error', 'status-disconnected');
                card.classList.add(`status-${response.data.status}`);
                sync_kill_button();
            } finally {
                reconnect_btn.classList.remove('spinning');
            }
        });

        /**
         * Delete button click — removes the port from config and connections.
         *
         * Steps:
         *  1. Stop event propagation.
         *  2. Disable the button to prevent double-click.
         *  3. Show confirmation popup; bail if user cancels.
         *  4. Call remove_port API.
         *  5. Refresh the port list (in finally, so it runs even if anything throws).
         *     The console timer will see no selection next tick and clear itself.
         */
        delete_btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            delete_btn.classList.add('disabled');

            try {
                const port_num = parseInt(card.dataset.port);
                const confirmed = await confirm_popup(`Remove port ${port_num}?`);
                if (!confirmed) return;

                const response = await api.remove_port(port_num);

                if (!response.success) {
                    console.error('Port removal failed:', response.message);
                    return;
                }
            } finally {
                delete_btn.classList.remove('disabled');
                await refresh_ports(api);
            }
        });

        list_el.appendChild(card);
    }

    sync_kill_button();
}

// =====================================================
// CONSOLE POLLING
// Continuous loop. Reads selection from the DOM each tick.
// =====================================================

/** Starts the console poll loop. Runs immediately, then every 500ms. */
function start_console_timer(api) {
    update_console(api);
    console_poll_timer = setInterval(() => update_console(api), 500);
}

/**
 * Refreshes the console and charts based on the currently selected card.
 *
 * Steps:
 *  1. If nothing is selected → clear the console and charts; bail.
 *  2. Kick off chart update in parallel (no await — happens alongside log fetch).
 *  3. Fetch logs for the selected port. If port was removed mid-tick, bail quietly.
 *  4. Capture whether the user is at the bottom (for sticky-scroll).
 *  5. Clear and rebuild the console with all current log lines.
 *  6. If we were at the bottom before, snap scroll back to the bottom.
 */
async function update_console(api) {
    const console_el = document.getElementById('main-console');
    const port_num = selected_port();

    if (port_num === null) {
        if (console_el.children.length > 0) console_el.innerHTML = '';
        clear_charts();
        return;
    }

    update_charts(api, port_num);

    const response = await api.get_logs(port_num);
    if (!response.success) return;

    const was_at_bottom = console_el.children.length === 0
        || console_el.scrollHeight - console_el.scrollTop - console_el.clientHeight <= 5;

    console_el.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const entry of response.data) {
        if (entry.type !== 'log') continue;
        const line = document.createElement('div');
        line.className = `console-line log-${entry.level.toLowerCase()}`;
        line.textContent = `${entry.ts} [${entry.level}] ${entry.msg}`;
        frag.appendChild(line);
    }
    console_el.appendChild(frag);

    if (was_at_bottom) {
        console_el.scrollTop = console_el.scrollHeight;
    }
}

// =====================================================
// STATUS POLLING
// =====================================================

/** Starts the status poll loop. Runs immediately, then every 1000ms. */
function start_status_timer(api) {
    update_all_statuses(api);
    status_poll_timer = setInterval(() => update_all_statuses(api), 1000);
}

/**
 * Updates the status class on every visible card and re-syncs the kill button.
 *
 * Steps:
 *  1. Fetch all port statuses from the API.
 *  2. For each port, find its card in the DOM (skip if not present).
 *  3. Remove all status-* classes and apply the current one.
 *  4. Re-sync the kill button (selected card's status may have changed).
 */
async function update_all_statuses(api) {
    const response = await api.get_all_statuses();
    if (!response.success) return;

    for (const [port_str, state] of Object.entries(response.data)) {
        const card = document.querySelector(`.card[data-port="${port_str}"]`);
        if (!card) continue;

        card.classList.remove('status-connected', 'status-error', 'status-disconnected');
        card.classList.add(`status-${state.status}`);
    }

    sync_kill_button();
}

// =====================================================
// STATISTICS POLLING
// =====================================================

/** Starts the stats poll loop. Runs every 5000ms (matches broadcaster interval). */
function start_stat_timer(api) {
    stats_poll_timer = setInterval(() => update_all_stats(api), 5000);
}

/**
 * Updates the CPU and RAM display on every visible card.
 *
 * Steps:
 *  1. Fetch latest stats for every port from the API.
 *  2. For each port, find its card (skip if not present).
 *  3. If stats are null (port connected but no stats yet), show dashes.
 *  4. Otherwise, format CPU as percentage and RAM as GB.
 */
async function update_all_stats(api) {
    const response = await api.get_all_stats();
    if (!response.success) return;

    for (const [port_str, stats] of Object.entries(response.data)) {
        const card = document.querySelector(`.card[data-port="${port_str}"]`);
        if (!card) continue;

        const cpu_el = card.querySelector('.stat-cpu');
        const ram_el = card.querySelector('.stat-ram');

        if (stats === null) {
            cpu_el.textContent = 'CPU --';
            ram_el.textContent = 'RAM --';
        } else {
            cpu_el.textContent = `CPU ${stats.cpu.toFixed(1)}%`;
            ram_el.textContent = `RAM ${(stats.ram_mb / 1024).toFixed(2)} GB`;
        }
    }
}

// =====================================================
// CHARTS
// =====================================================

/**
 * Updates both CPU and RAM charts with the history of the given port.
 *
 * Steps:
 *  1. Fetch historical stats for the port.
 *  2. If the call failed (port not tracked, no stats yet), clear charts; bail.
 *  3. Convert each stat's timestamp into a relative-time label (e.g. "30s", "2m").
 *  4. Extract CPU values and RAM values (converting MB to GB).
 *  5. Push labels and data into both charts; call update() to redraw.
 */
async function update_charts(api, port_num) {
    const response = await api.get_hist_stats(port_num);

    if (!response.success) {
        clear_charts();
        return;
    }

    const history = response.data;

    const now = Date.now();
    const labels = history.map(s => {
        const then = Date.parse(s.ts);
        const seconds_ago = Math.round((now - then) / 1000);

        if (seconds_ago < 60) return `${seconds_ago}s`;
        if (seconds_ago < 3600) return `${Math.round(seconds_ago / 60)}m`;
        return `${Math.round(seconds_ago / 3600)}h`;
    });

    const cpu_data = history.map(s => s.cpu);
    const ram_data = history.map(s => s.ram_mb / 1024);

    chart1.data.labels = labels;
    chart1.data.datasets[0].data = cpu_data;
    chart1.update();

    chart2.data.labels = labels;
    chart2.data.datasets[0].data = ram_data;
    chart2.update();
}

/**
 * Empties both charts and redraws them. Used when nothing is selected or
 * when an API call fails.
 */
function clear_charts() {
    if (!chart1 || !chart2) return;

    chart1.data.labels = [];
    chart1.data.datasets[0].data = [];
    chart1.update();

    chart2.data.labels = [];
    chart2.data.datasets[0].data = [];
    chart2.update();
}

/**
 * Creates the two empty chart instances on page load and any time the theme
 * changes (since Chart.js doesn't auto-pick up CSS variable changes).
 *
 * Steps:
 *  1. Destroy any existing chart instances first to free their canvases.
 *  2. Build a shared_options factory for common chart config.
 *  3. Create chart1 as the CPU chart (y-axis 0-100%, ticks every 50).
 *  4. Create chart2 as the RAM chart (y-axis 0-4 GB, ticks every 2).
 */
function render_charts(colors) {
    if (chart1) chart1.destroy();
    if (chart2) chart2.destroy();

    const shared_options = (title) => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: { display: false },
            title: {
                display: true,
                text: title,
                color: colors.text,
                font: { size: 14, weight: 'bold' },
            },
        },
        scales: {
            x: {
                ticks: {
                    color: colors.textMuted,
                    maxTicksLimit: 4,
                    autoSkip: true,
                },
            },
        }
    });

    chart1 = new Chart(document.getElementById('chart1'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'CPU %',
                data: [],
                borderColor: colors.primary,
                backgroundColor: colors.primary + '33',
                tension: 0.3,
                pointRadius: 0
            }]
        },
        options: {
            ...shared_options("CPU %"),
            scales: {
                ...shared_options("CPU %").scales,
                y: {
                    min: 0,
                    max: 100,
                    ticks: {
                        color: colors.textMuted,
                        stepSize: 50,
                        callback: (v) => `${v}%`,
                    },
                    grid: { color: colors.border },
                    border: { display: false },
                }
            }
        }
    });

    chart2 = new Chart(document.getElementById('chart2'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'RAM (GB)',
                data: [],
                borderColor: colors.primary,
                backgroundColor: colors.primary + '33',
                tension: 0.3,
                pointRadius: 0,
            }]
        },
        options: {
            ...shared_options("RAM (GB)"),
            scales: {
                ...shared_options("RAM (GB)").scales,
                y: {
                    min: 0,
                    max: 4,
                    ticks: {
                        color: colors.textMuted,
                        stepSize: 2,
                        callback: (v) => `${v} GB`,
                    },
                    grid: { color: colors.border },
                    border: { display: false },
                }
            }
        }
    });
}
