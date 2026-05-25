if (localStorage.getItem('theme') === 'light') {
    document.documentElement.classList.add('light');
}

function set_theme(mode) {
    if (mode === 'light') {
        document.documentElement.classList.add('light');
        localStorage.setItem('theme', 'light');
    } else {
        document.documentElement.classList.remove('light');
        localStorage.setItem('theme', 'dark');
    }
}

function toggle_theme() {
    const is_light = document.documentElement.classList.contains('light');
    set_theme(is_light ? 'dark' : 'light');
}

function get_colors() {
    const styles = getComputedStyle(document.documentElement);

    const colors = {
        primary:    styles.getPropertyValue('--color-primary').trim(),
        danger:     styles.getPropertyValue('--color-danger').trim(),
        success:    styles.getPropertyValue('--color-success').trim(),
        text:       styles.getPropertyValue('--text-primary').trim(),
        textMuted:  styles.getPropertyValue('--text-secondary').trim(),
        border:     styles.getPropertyValue('--border').trim(),
    };

    return colors;
};

function on_click(id, handler) {
    const ele = document.getElementById(id);
    ele.addEventListener('click', handler);
    return ele;
}

function confirm_popup(message, title = 'Are you sure?') {
    return new Promise(resolve => {
        const popup = document.getElementById('confirm-popup');
        document.getElementById('confirm-popup-title').textContent = title;
        document.getElementById('confirm-popup-message').textContent = message;
        
        const ok_btn = document.getElementById('confirm-popup-ok');
        const cancel_btn = document.getElementById('confirm-popup-cancel');
        
        function cleanup(result) {
            popup.classList.remove('show');
            ok_btn.removeEventListener('click', on_ok);
            cancel_btn.removeEventListener('click', on_cancel);
            resolve(result);
        }
        
        function on_ok() { cleanup(true); }
        function on_cancel() { cleanup(false); }
        
        ok_btn.addEventListener('click', on_ok);
        cancel_btn.addEventListener('click', on_cancel);
        
        popup.classList.add('show');
    });
}