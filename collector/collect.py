#!/usr/bin/env python3
"""Collects container metrics and pod metadata, then pushes to Redis."""
import os, json, sys, psutil, redis
from datetime import datetime, timezone

def main():
    print(json.dumps({"level": "INFO", "message": "CronJob started"}))

    # 1. Gather Kubernetes Metadata (Downward API)
    k8s_meta = {
        "pod_name": os.getenv("POD_NAME", "unknown-pod"),
        "pod_namespace": os.getenv("POD_NAMESPACE", "sre-monitor"),
        "node_name": os.getenv("NODE_NAME", "unknown-node"),
        "pod_ip": os.getenv("POD_IP", "127.0.0.1")
    }

    # 2. Gather System Metrics (MB and GB conversions)
    vmem = psutil.virtual_memory()
    disk = psutil.disk_usage('/')

    payload = {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "kubernetes": k8s_meta,
        "runtime_metrics": {
            "cpu": {
                "count": psutil.cpu_count(logical=True),
                "percent": psutil.cpu_percent(interval=1.0)
            },
            "memory": {
                "total_mb": round(vmem.total / 1048576, 2),
                "available_mb": round(vmem.available / 1048576, 2),
                "used_mb": round(vmem.used / 1048576, 2),
                "percent": vmem.percent,
            },
            "disk": {
                "total_gb": round(disk.total / 1073741824, 2),
                "used_gb": round(disk.used / 1073741824, 2),
                "free_gb": round(disk.free / 1073741824, 2),
                "percent": disk.percent,
            }
        }
    }

    # 3. Store in Redis and handle failures
    try:
        redis_host = os.getenv("REDIS_HOST", "redis")
        redis_port = int(os.getenv("REDIS_PORT", 6379))
        history_limit = int(os.getenv("HISTORY_LIMIT", 20))

        r = redis.Redis(host=redis_host, port=redis_port, decode_responses=True)
        serialized = json.dumps(payload)

        r.set("metrics:latest", serialized)
        r.set("metrics:last_run_timestamp", payload["collected_at"])
        r.lpush("metrics:history", serialized)
        r.ltrim("metrics:history", 0, history_limit - 1) # Keep only configured number of runs

        print(json.dumps({
            "level": "INFO",
            "message": "Metrics stored successfully",
            "cpu_percent": payload["runtime_metrics"]["cpu"]["percent"]
        }))
    except Exception as e:
        print(json.dumps({"level": "ERROR", "message": f"Failed to connect to Redis: {str(e)}"}))
        sys.exit(1) # Tells Kubernetes the CronJob failed so it can retry

if __name__ == "__main__":
    main()