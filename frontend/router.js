
// Function to utilize in other scripts
async function go(page) {
    const map = {
        
        // Sample pages
        pg1: 'html/index.html',

        // Add HTML here
    };

    const file = map[page];
    if (!file) {
        console.error('Route not found:', page);
        return;
    }

    try {
        const absolutePath = await window.pywebview.api.resolve_path(file);     // ← Present in the API class covered in this document
        window.location.href = `file:///${absolutePath}`;
    } catch (e) {
        console.error('Navigation failed:', e);
    }
}

// Expose function to window
window.go = go;

// F5 or Ctrl+R → refresh current page
document.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
        e.preventDefault();
        location.reload();
    }
});