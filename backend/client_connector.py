import logging
logger = logging.getLogger(__name__)

import socket
import threading
import json
import psutil

from collections import deque

class ClientConnection:

    def __init__(self, port:int):
        
        # Conneciton objects (port, socket, thread, etc.)
        self.port = port
        self._sock = None
        self._thread = None
        self._stop = threading.Event()
        self.error = None
        self.pid = None

        # Logs
        self.logs = deque(maxlen=500)       # the last 500 lines
        
        # Statisitics
        self.stats = deque(maxlen=360)      # historical stats for the last 30min
        self.latest_stats = None            # most recent stats dictionary, or None if never received

        # Status
        self.status = "disconnected"

    def connect(self, host="127.0.0.1") -> bool:
        """
        Open socket and start reader thread.
        Returns True on success.
        """
        self.logs.clear()
        self.stats.clear()
        self.latest_stat = None
        self.pid = None

        try:
            self._sock = socket.socket()
            self._sock.settimeout(2.0)      # 2 seconds
            self._sock.connect((host, self.port))
            self._sock.settimeout(None)     # blocking for reads

        except (OSError, socket.timeout) as e:
            self.status = "error"
            self.error = str(e) 
            logger.warning(rf"Port {self.port} connect failed: {e}")
            return False

        self.pid = self._lookup_pid()
        self.status = "connected"
        self.error = None
        self._stop.clear()
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()
        return True
    
    def _lookup_pid(self):
        try:
            for conn in psutil.net_connections(kind='inet'):
                if conn.laddr and conn.laddr.port == self.port and conn.status == 'LISTEN':
                    return conn.pid
        except (psutil.AccessDenied, psutil.NoSuchProcess) as e:
            logger.warning(f'PID lookup for port {self.port} failed: {e}')
        return None
    
    def disconnect(self):
        """
        Stops the reading thread. Closes the socket.
        """
        self._stop.set()
        if self._sock:
            try:
                self._sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self._sock.close()
            self._sock = None
        self.status = "disconnected"

    def _read_loop(self):
        """
        Runs in a background thread.
        Reads lines and appends to `self.logs`.
        """
        buffer = ""
        try:
            while not self._stop.is_set():
                data = self._sock.recv(4096)
                if not data:
                    break
                buffer += data.decode(errors="replace")

                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line)
                        msg_type = msg.get('type')

                        if msg_type == 'log':
                            self.logs.append(msg)
                        elif msg_type == 'stats':
                            self.latest_stats = msg     # keep the latest readily available1
                            self.stats.append(msg)      # append to dequeue
                        elif msg_type == 'conn':
                            logger.info(rf"Port {self.port} handshake: {msg}")
                        else:
                            logger.debug(rf"Port {self.port} received unknown msg: {msg}")
                            
                    except json.JSONDecodeError:
                        logger.warning(rf"Port {self.port} bad JSON: {line[:80]}")
        except OSError as e:
            logger.info(rf"Port {self.port} socket error: {e}")
        finally:
            self.status = "disconnected"

    def clear_logs(self):
        self.logs.clear()

