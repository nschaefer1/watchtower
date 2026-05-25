import logging
logger = logging.getLogger(__name__)

import json 
import psutil
from dataclasses import dataclass
from typing import Any, Optional
from concurrent.futures import ThreadPoolExecutor


##############################################################################

# RESPONSE CODES

    # 2xx Success
        # 200 OK: Request succeeded
        # 201 Created: Resource created (e.g., POST/PUT)
        # 204 No Content: Success, but not body to return (e.g., Delete)

    # 4xx Client Error
        # 400 Bad Request: Server cannot process due to client error
        # 401 Unauthorized: authentication missing or invalid
        # 403 Forbidden: Authenticated, but lacking permission
        # 404 Not Found: Resource does not exist
        # 429 Too Many Requests: Rate limit exceeded

    # 5xx Server Error
        # 500 Internal Server Error: Generic server error
        # 503 Service Unavailable: Server overloaded or down
        # 504 Gateway Timeout: Server acting as a gateway timed out

##############################################################################

@dataclass(frozen=True)
class APIResponse:
    success: bool
    message: str = ""
    data: Optional[Any] = None
    response_code: int = 200

    def __post_init__(self):
        if not self.success:
            logger.error(
                "API Response Failure | Code=%s | Message=%s",
                self.response_code,
                self.message
            )
        else:
            logger.debug(
                "API Resonse Success | Code=%s",
                self.response_code
            )
    
    def to_dict(self):
        return {
            "success": self.success,
            "message": self.message,
            "data": self.data,
            "response_code": self.response_code
        }

import sys
from nrs_toolkit.telemetry import ClientConnection
from pathlib import Path

class API:

    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.session = {}
        self._connections: dict[int, ClientConnection] = {}

    def resolve_path(self, rel_path: str) -> str:
        return self.app_path(f'frontend/{rel_path}').as_posix()
    
    def app_path(self, relative_path):      # ← Also present in main app, duplicated to prevent coupling
        if getattr(sys, 'frozen', False):       
            base_dir = Path(sys.executable).parent
        else:   # This is the dev-env
            base_dir = Path(__file__).resolve().parent.parent
        return base_dir / relative_path
    
    def _pull_into_json(self, data, col_names): # converts DB-style rows into JSON-friendly data
        return [
            {col: self._normalize_str(val) for col, val in zip(col_names, row)}
            for row in data
        ]   
    def _normalize_str(self, value):            # converts empty strings → None
        if isinstance(value, str) and value.strip() == "":
            return None
        return value
    def _normalize(self, obj):                  # converts empty strings → None in nested circumstances
        if isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(v, str) and not v.strip():
                    obj[k] = None
                else:
                    self._normalize(v)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                if isinstance(v, str) and not v.strip():
                    obj[i] = None
                else:
                    self._normalize(v)
    
    # Proxy session state controls
    def set_session(self, key, value):
        self.session[key] = value
        logger.debug(f'Set {key}: {value}')
        return True
    def get_session(self, key):
        return self.session.get(key, None)
    def remove_session(self, key):
        logger.debug(f'Removed `{key}` from session')
        return self.session.pop(key, False)

    # Response wrappers
    def _success_response(self, data=None, message="", response_code=200):
        return APIResponse(
            success=True,
            message=message,
            data=data,
            response_code=response_code
        ).to_dict()
    def _failure_response(self, message, response_code=500, data=None):
        return APIResponse(
            success=False,
            message=message,
            data=data,
            response_code=response_code
        ).to_dict()
    def _format_db_rows(self, db_result, normalize=True):
        outgoing = self._pull_into_json(db_result.rows, db_result.columns)
        if normalize:
            outgoing = self._normalize(outgoing)
        return outgoing

    # Database response checks
    def _db_failure(self, db_result, default_message="Database failure"):
        if not db_result.success:
            return self._failure_response(
                    message = default_message,
                    response_code = 500
                )
        return None
    
    # =============================
    # JSON Data File
    # =============================

    def _ports_file(self) -> Path:
        return Path(self.app_path('ports.json'))
    
    def _load_ports(self) -> list:
        f = self._ports_file()
        if not f.exists():
            return []
        try:
            return json.loads(f.read_text())
        except json.JSONDecodeError:
            logger.error("ports.json is corrupt, starting fresh")
            return []
        
    def _save_ports(self, ports: list) -> None:
        self._ports_file().write_text(json.dumps(ports, indent=4))

    def add_port(self, name:str, port:str):
        if not name or not name.strip():
            return self._failure_response("Process name required", 400)
        try:
            port_num = int(port)
            if not (1 <= port_num <= 65535):
                raise ValueError
        except (ValueError, TypeError):
            return self._failure_response("Port must be 1-65535", 400)

        ports = self._load_ports()
        if any(p['port'] == port_num for p in ports):
            return self._failure_response(f'Port {port_num} already exists', 400)

        new_entry = {"name": name.strip(), "port": port_num}
        ports.append(new_entry)
        self._save_ports(ports)

        # Attempt the connection
        conn = ClientConnection(port_num)
        conn.connect()
        self._connections[port_num] = conn

        return self._success_response(
            data = {
                **new_entry,
                "status": conn.status,
                "error":conn.error,
            }, 
            message="Port added"
        )
    
    def list_ports(self):
        ports = self._load_ports()
        enriched = []
        for p in ports:
            conn = self._connections.get(p['port'])
            enriched.append({
                **p,
                "status": conn.status if conn else "disconnected",
                "error": conn.error if conn else None,
            })
        return self._success_response(data = enriched)
    
    def remove_port(self, port_num: int):
        ports = self._load_ports()
        new_ports = [p for p in ports if p['port'] != port_num]
        if len(new_ports) == len(ports):
            return self._failure_response(f"Port {port_num} not found", 404) 
        self._save_ports(new_ports)

        # Tear down connection if it exists
        conn = self._connections.pop(port_num, None)
        if conn:
            conn.disconnect()

        return self._success_response(message="Port removed")
    
    # =============================
    # PORT Data Collection
    # =============================

    def connect_all_ports(self):
        ports = self._load_ports()
        if not ports:
            return
        
        with ThreadPoolExecutor(max_workers=len(ports)) as pool:
            
            for p in ports:
                port = p['port']
                if port in self._connections:
                    continue
                conn = ClientConnection(port)
                self._connections[port] = conn
                pool.submit(conn.connect)       
    
    def reconnect_all_ports(self):
        if not self._connections:
            return self._failure_response("No ports to refresh", 400)
        
        with ThreadPoolExecutor(max_workers=len(self._connections)) as pool:

            for _, conn in self._connections.items():
                if conn.status == 'connected':
                    continue
                conn.disconnect()
                pool.submit(conn.connect)
        
        return self.get_all_statuses()  # Return the new status - might not be used
        

    def reconnect_port(self, port_num: int):
        conn = self._connections.get(port_num)
        if conn is None:
            return self._failure_response(f"Not tracking port {port_num}", 404)
        
        conn.disconnect()
        conn.connect()

        return self._success_response(
            data = {
                "status": conn.status,
                "error": conn.error,
            },
            message="Reconnect attempted",
        )
            
    def get_logs(self, port:int):
        conn = self._connections.get(port)
        if conn is None:
            return self._failure_response(rf"Not tracking port {port}", 404)
        return self._success_response(data=list(conn.logs))
    
    def get_conn_status(self, port:int):
        conn = self._connections.get(port)
        if conn is None:
            return self._failure_response(rf"Not tracking port: {port}", 404)
        return self._success_response(data={
            "status": conn.status,
            "error": conn.error,
        })
    
    def get_all_statuses(self):
        return self._success_response(data={
            port: {"status": conn.status, "error": conn.error, "pid": conn.pid}
            for port, conn in self._connections.items()
        })
    
    def get_all_stats(self):
        out = {}
        for port, conn in self._connections.items():
            if conn.latest_stats is None:
                out[port] = None
            else:
                out[port] = {
                    "cpu": conn.latest_stats.get('cpu'),
                    "ram_mb": conn.latest_stats.get('ram_mb'),
                }
        return self._success_response(data=out)
    
    def get_hist_stats(self, port_num:int):
        conn = self._connections.get(port_num)

        if conn is None:
            return self._failure_response(f'Not tracking port {port_num}', 404)

        if conn.stats is None:
            return self._failure_response(f"No stats collected on port {port_num}", 404)
        
        return self._success_response(
            data = list(conn.stats)
        )
    
    def clear_logs(self, port: int):
        conn = self._connections.get(port)
        if conn is None:
            return self._failure_response(f'Not tracking port {port}', 404)
        conn.clear_logs()
        return self._success_response(message='Logs cleared')

    def kill_port(self, port: int):
        conn = self._connections.get(port)
        if conn is None:
            return self._failure_response(f'Not tracking port {port}', 404)
        if conn.pid is None:
            return self._failure_response(f'No PID known for port {port}', 400)
        
        try:
            proc = psutil.Process(conn.pid)
            proc_name = proc.name()
            proc.terminate()
            try:
                proc.wait(timeout = 3)      # wait 3 for the exit
            except psutil.TimeoutExpired:
                proc.kill()                 # kill if it didn't die gracefully

            conn.disconnect()

            return self._success_response(
                data={
                    'pid': conn.pid,
                    'name': proc_name,
                },
                message=f"Killed PID {conn.pid} ({proc_name})",
            )
        except psutil.NoSuchProcess:
            return self._failure_response(f"Process {conn.pid} not found", 404) 
        except psutil.AccessDenied:
            return self._failure_response(f"Permission denied killing PID {conn.pid}", 403)