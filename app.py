
import sys
import os
import webview

from backend.api import API
from pathlib import Path

class MainApp:

    def __init__(self, db_manager, api):
        self.db_manager = db_manager
        self.api = api

        index_html = self.app_path('frontend/html/index.html').replace('\\', '/')
        
        self.window = webview.create_window(
            'Watchtower',
            f'file:///{index_html}',
            width=1200,
            height=800,
            js_api=self.api,
            text_select=True,
        )

    def app_path(self, relative_path):
        if getattr(sys, 'frozen', False):
            base_dir = Path(sys.executable).parent
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(base_dir, relative_path)
    
    def run(self):
        webview.start(
            debug=os.getenv("DEBUG", "").lower() in ("1", "true", "yes", "on"),
            private_mode=False,
            storage_path=self.app_path('webview_data'),
        )

if __name__ == '__main__':
    from nrs_toolkit.telemetry import AdvancedLogger
    AdvancedLogger(dev=True)

    js_api = API(None)
    app = MainApp(None, js_api)
    
    js_api.connect_all_ports()      # attempt to connect to all of the ports BEFORE we start

    app.run()