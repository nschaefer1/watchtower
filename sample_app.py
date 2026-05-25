"""
Test daemon — emits realistic-looking log messages at random intervals.

Usage:
    python log_daemon.py <port>
"""
from nrs_toolkit.logging import AdvancedLogger

import logging
import random
import sys
import time

logger = logging.getLogger(__name__)


# ----------------------------------------------------
# Message templates by level
# ----------------------------------------------------

INFO_MESSAGES = [
    "Request received from 10.0.{a}.{b}",
    "User {user_id} logged in",
    "Cache hit for key 'session:{user_id}'",
    "Processing batch {batch_id} ({n} items)",
    "Health check OK",
    "Database query completed in {ms}ms",
    "Sent {n} messages to queue",
    "Worker {worker} picked up job {job_id}",
    "Token refreshed for client {client}",
    "Scheduled task '{task}' completed",
    "Connection pool: {n} active, {m} idle",
    "Loaded config from /etc/app/{file}",
    "Replication caught up (lag: {ms}ms)",
    "GC freed {mb}MB",
]

WARNING_MESSAGES = [
    "Slow query detected: {ms}ms for SELECT on table_{n}",
    "Connection pool nearing capacity ({n}/{m})",
    "Retry attempt {attempt}/3 for endpoint /api/v1/{endpoint}",
    "Memory usage at {pct}% — consider scaling",
    "Deprecated endpoint /v1/{endpoint} called by client {client}",
    "Cache miss rate elevated: {pct}%",
    "Token will expire in {n} minutes",
    "Disk usage at {pct}% on /var/log",
    "Queue depth exceeded soft limit: {n} messages",
    "Stale connection to upstream service {service}",
]

ERROR_MESSAGES = [
    "Connection refused to upstream {service}",
    "Database query failed: timeout after {ms}ms",
    "Failed to write to /var/log/app.log: Permission denied",
    "Unhandled exception in worker {worker}: KeyError 'session_id'",
    "API call to {service} returned 502",
    "Invalid token from client {client}",
    "Lost connection to message broker",
    "Failed to acquire lock 'resource_{n}' after {ms}ms",
]


# ----------------------------------------------------
# Random value generators
# ----------------------------------------------------

ENDPOINTS = ['users', 'orders', 'products', 'auth', 'reports', 'webhooks']
SERVICES = ['redis', 'postgres', 'kafka', 'auth-service', 'billing-api', 's3']
TASKS = ['cleanup', 'rotate-logs', 'sync-cache', 'export-metrics', 'snapshot']
CONFIG_FILES = ['app.yml', 'database.yml', 'features.yml', 'overrides.yml']


def format_message(template: str) -> str:
    return template.format(
        a=random.randint(0, 255),
        b=random.randint(0, 255),
        user_id=random.randint(1000, 99999),
        batch_id=f"b_{random.randint(10000, 99999)}",
        n=random.randint(1, 500),
        m=random.randint(20, 100),
        ms=random.randint(2, 2500),
        worker=f"w{random.randint(1, 8)}",
        job_id=f"j_{random.randint(1000, 9999)}",
        client=f"c_{random.randint(100, 999)}",
        task=random.choice(TASKS),
        file=random.choice(CONFIG_FILES),
        mb=random.randint(5, 250),
        attempt=random.randint(1, 3),
        endpoint=random.choice(ENDPOINTS),
        pct=random.randint(60, 95),
        service=random.choice(SERVICES),
    )


# ----------------------------------------------------
# Main loop
# ----------------------------------------------------

# Weights — INFO is common, WARNING uncommon, ERROR rare
LEVEL_WEIGHTS = [
    (logging.INFO,    INFO_MESSAGES,    85),
    (logging.WARNING, WARNING_MESSAGES, 12),
    (logging.ERROR,   ERROR_MESSAGES,    3),
]


def emit_one():
    levels, templates, weights = zip(*LEVEL_WEIGHTS)
    level = random.choices(levels, weights=weights, k=1)[0]
    
    # Find matching template list
    template_list = next(t for l, t, _ in LEVEL_WEIGHTS if l == level)
    message = format_message(random.choice(template_list))
    
    logger.log(level, message)


def run():
    if len(sys.argv) < 2:
        print("Usage: python log_daemon.py <port>")
        sys.exit(1)
    
    port = sys.argv[1]
    print(f"Log daemon running on port {port}. Press Ctrl+C to stop.")

    AdvancedLogger(dev=True, listener=True, port=int(port))
    
    try:
        while True:
            emit_one()
            # Random delay between log entries — bursty but realistic
            delay = random.choices(
                [0.1, 0.3, 0.8, 2.0, 5.0],
                weights=[40, 30, 20, 8, 2],
                k=1
            )[0]
            time.sleep(delay)
    except KeyboardInterrupt:
        print("\nShutting down log daemon.")


if __name__ == '__main__':
    run()