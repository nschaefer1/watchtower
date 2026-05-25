let status_poll_timer = null;
let stats_poll_timer = null;
let console_poll_timer = null;

let chart1 = null;
let chart2 = null;

let colors = get_colors();

let sort_mode = 'port';     // 'port' or 'name'

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

window.addEventListener('pywebviewready', () => {
    let api = window.pywebview.api;
    init(api);
});

async function init(api) {        
    wire_buttons(api);              // Hooks up all of the button onclicks

    await refresh_ports(api);       // Refresh the ports in the list on the lefthand side

    start_status_timer(api);        // Status refresh for the ports
    start_stat_timer(api);          // Stat refresh for the ports
    start_console_timer(api);       // Console — always running, reads selection from DOM

    render_charts(colors);
}

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------

// Enables the kill button only when a card is selected AND that card is connected.
// Called from anywhere selection or status might change.
function sync_kill_button() {
    const selected = document.querySelector('.card.selected');
    const enable = selected && selected.classList.contains('status-connected');
    document.getElementById('kill-btn').classList.toggle('disabled', !enable);
}

// Returns the port number of the currently selected card, or null.
function selected_port() {
    const selected = document.querySelector('.card.selected');
    return selected ? parseInt(selected.dataset.port) : null;
}

// ----------------------------------------------------
// BUTTON MANAGEMENT
// ----------------------------------------------------

function wire_buttons(api) {
    
    on_click('light-dark-btn', () => {
        toggle_theme();
        colors = get_colors();
        render_charts(colors);
    });
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
        // sync_kill_button runs implicitly — the card class will reflect new status
        sync_kill_button();
    });
    on_click('sort-by-btn', async () => {
        sort_mode = sort_mode === 'port' ? 'name' : 'port';
        const btn = document.getElementById('sort-by-btn');
        btn.textContent = sort_mode === 'port' ? 'Sort By: Port' : 'Sort By: Name';
        await refresh_ports(api);
    });
    on_click('add-port-btn', () => {
        document.getElementById('port-popup').classList.add('show');
    });
    on_click('port-popup-close' , () => {
        document.getElementById('port-popup').classList.remove('show');
        document.getElementById('process-name-input').value = '';
        document.getElementById('port-input').value = '';
    });
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

            await refresh_ports(api);       // refresh the list
        } catch (err) {
            console.error('API call threw:', err);
            error_el.textContent = 'Unexpected error. Check the console.';
        } finally {
            btn.classList.remove('disabled');
            document.getElementById('cycle-btn').classList.remove('disabled');
        } 
    });
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

// ----------------------------------------------------
// PORT UI REFRESH
// ----------------------------------------------------

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
    list_el.innerHTML = '';     // clear existing cards

    for (const port of ports) {
        const state = statuses[port.port] || { status: 'disconnected' };

        const card = document.createElement('div');
        card.dataset.port = port.port;
        card.className = `card status-${state.status}`;

        // Lights row
        const lights = document.createElement('div');
        lights.className = 'status-lights';
        lights.innerHTML = '<div class="status-light status-light-ok"></div><div class="status-light status-light-err"></div>';

        // Text row
        const text = document.createElement('div');
        text.className = 'card-text';
        text.textContent = `${port.port} : ${port.name}`;

        // Stat row 
        const stats = document.createElement('div');
        stats.className = 'card-stats';
        stats.innerHTML = `
            <span class="stat-cpu">CPU --</span>
            <span class="stat-ram">RAM --</span>
        `;
        
        // Delete button
        const delete_btn = document.createElement('div');
        delete_btn.className = 'card-delete';
        delete_btn.innerHTML = DELETE_ICON_SVG;
        delete_btn.title = 'Remove port';

        // Reconnect button
        const reconnect_btn = document.createElement('div');
        reconnect_btn.className = 'card-reconnect';
        reconnect_btn.innerHTML = REFRESH_ICON_SVG;
        reconnect_btn.title = 'Reconnect';

        card.appendChild(lights);
        card.appendChild(text);
        card.appendChild(stats);
        card.appendChild(delete_btn);
        card.appendChild(reconnect_btn);

        // Card click: toggle selection
        card.addEventListener('click', () => {
            document.querySelectorAll('.card.selected').forEach(el => {
                if (el !== card) el.classList.remove('selected');
            });
            card.classList.toggle('selected');
            sync_kill_button();
        });
        
        // Reconnect click
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

        // Delete click
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
                // The console timer will see no selection next tick and clear itself
            }
        });

        list_el.appendChild(card);
    }

    sync_kill_button();    // re-sync after rebuild — selection is gone
}

// ----------------------------------------------------
// CONSOLE POLLING (always running, reads selection from DOM)
// ----------------------------------------------------

function start_console_timer(api) {
    update_console(api);
    console_poll_timer = setInterval(() => update_console(api), 500);
}

async function update_console(api) {
    const console_el = document.getElementById('main-console');
    const port_num = selected_port();

    // No card selected → make sure console is empty
    if (port_num === null) {
        if (console_el.children.length > 0) console_el.innerHTML = '';
        clear_charts();     // ensure the charts are clean
        return;
    }

    // Update charts alongside console
    update_charts(api, port_num);

    const response = await api.get_logs(port_num);

    // Port may have been removed between selection and this poll — bail quietly
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

// ----------------------------------------------------
// STATUS POLLING
// ----------------------------------------------------

function start_status_timer(api) {
    update_all_statuses(api);
    status_poll_timer = setInterval(() => update_all_statuses(api), 1000);
}

async function update_all_statuses(api) {
    const response = await api.get_all_statuses();
    if (!response.success) return;
    
    for (const [port_str, state] of Object.entries(response.data)) {
        const card = document.querySelector(`.card[data-port="${port_str}"]`);
        if (!card) continue;
        
        card.classList.remove('status-connected', 'status-error', 'status-disconnected');
        card.classList.add(`status-${state.status}`);
    }

    sync_kill_button();    // selected card's status may have changed
}

// ----------------------------------------------------
// STATISTICS POLLING
// ----------------------------------------------------

function start_stat_timer(api) {
    stats_poll_timer = setInterval(() => update_all_stats(api), 5000);
}

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

// ----------------------------------------------------
// CHARTS
// ----------------------------------------------------

async function update_charts(api, port_num) {
    const response = await api.get_hist_stats(port_num);

    if (!response.success) {
        // port not tracked or there is no stats yet
        clear_charts();
        return;
    }

    const history = response.data;

    const now = Date.now();
    const labels = history.map(s => {
        const then = Date.parse(s.ts); // treat as UTC
        const seconds_ago = Math.round((now - then) / 1000);

        if (seconds_ago < 60) return `${seconds_ago}s`;
        if (seconds_ago < 3600) return `${Math.round(seconds_ago / 60)}m`;
        return `${Math.round(seconds_ago / 3600)}h`;
    });

    const cpu_data = history.map(s => s.cpu);
    const ram_data = history.map(s => s.ram_mb / 1024);     // MB to GB conversion

    chart1.data.labels = labels;
    chart1.data.datasets[0].data = cpu_data;
    chart1.update();

    chart2.data.labels = labels;
    chart2.data.datasets[0].data = ram_data;
    chart2.update();
}

function clear_charts() {
    if (!chart1 || !chart2) return;

    chart1.data.labels = [];
    chart1.data.datasets[0].data = [];
    chart1.update();

    chart2.data.labels = [];
    chart2.data.datasets[0].data = [];
    chart2.update();
}

function render_charts(colors) {
    if (chart1) chart1.destroy();
    if (chart2) chart2.destroy();

    const shared_options = (title) => ({
        responsive: true,
        maintainAspectRatio:false,
        animation: false,
        plugins: {
            legend: {display:false},
            title:{
                display: true,
                text:title,
                color:colors.text,
                font:{size:14, weight:'bold'},
            },
        },
        scales: {
            x : {
                ticks: {
                    color:colors.textMuted,
                    maxTicksLimit: 4,
                    autoSkip: true,
                },
                //grid: {color: colors.border}
            },
        }
    })

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
                ...shared_options("CPU%").scales,
                y: {
                    min: 0,
                    max: 100,
                    ticks: {
                        color: colors.textMuted,
                        stepSize: 50,
                        callback: (v) => `${v}%`,
                    },
                    grid: {color: colors.border},
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