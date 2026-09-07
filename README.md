# Solventum SRE Kubernetes Assessment

A lightweight, robust Kubernetes monitoring stack designed for local evaluation.

## 1. Overview
This repository contains a full solution for the SRE assessment. It features:
* **Python Collector (CronJob):** Gathers system metrics (CPU, Memory, Disk) and cluster context, saving them to Redis.
* **Node.js Webapp (Deployment):** A lightweight Express app that serves a monitoring dashboard and a synthetic CPU load endpoint for autoscaling tests.
* **Kubernetes Infrastructure:** Configured with decoupled probes, a PodDisruptionBudget, an HPA, NetworkPolicies, and a ConfigMap for clean configuration management.

## 2. Requirements Mapping

| # | Task Requirement | Implementation Location |
|---|---|---|
| **1** | Small Kubernetes environment | `README.md` (Deployment Instructions) |
| **2** | Simple Web App + CronJob | `webapp/` and `collector/` |
| **3** | Gather info & store in datastore | `collector/collect.py` |
| **4** | Display info + last run time | `webapp/server.js` (Dashboard) |
| **5** | External browser access | `k8s/webapp.yaml` (NodePort 30080) |
| **6** | Scale up under heavy load | `k8s/webapp.yaml` (HPA configured at 50% CPU) |

## 3. Repository Structure

```text
.
├── design-notes.md               # SRE architecture rationale & trade-offs
├── k8s/                          # Kubernetes Manifests
│   ├── 00-namespace.yaml         # Dedicated sre-monitor namespace
│   ├── configmap.yaml            # Shared app configuration (e.g., Redis host)
│   ├── redis.yaml                # Datastore deployment & service
│   ├── webapp.yaml               # Node.js app, NodePort, HPA, & PDB
│   ├── cronjob.yaml              # Python collector CronJob
│   └── network-policy.yaml       # Network isolation policies
├── collector/                    # Python script & Dockerfile
└── webapp/                       # Node.js app & Dockerfile
```

## 4. Deployment Instructions

### Prerequisites
1. **Docker** installed and running.
2. A local Kubernetes cluster. **Docker Desktop's built-in Kubernetes** is highly recommended for zero-friction testing. (Kind or Minikube also supported).
3. `kubectl` installed and configured.

### Step 1: Build the Container Images
From the repository root, build the images using your local Docker daemon:
```bash
docker build -t sre-collector:latest ./collector
docker build -t sre-webapp:latest ./webapp
```

### Step 2: Make Images Available to Kubernetes
*   **Docker Desktop:** No action required. Docker Desktop shares the local image registry natively.
*   **Kind:** Run `kind load docker-image sre-collector:latest` and `kind load docker-image sre-webapp:latest`.
*   **Minikube:** Run `minikube image load sre-collector:latest` and `minikube image load sre-webapp:latest`.

### Step 3: Apply Kubernetes Manifests
Deploy the infrastructure:
```bash
kubectl apply -f k8s/
```

### Step 4: Seed Initial Data
The CronJob runs every 2 minutes. To view metrics immediately on the first page load:
```bash
kubectl create job --from=cronjob/system-collector initial-run -n sre-monitor
```

## 5. Verification & Testing

### Access the Dashboard
Open your browser to **http://localhost:30080/** to view the live system metrics and the last CronJob execution time.

### Test Autoscaling (HPA)
The dashboard includes a **Burn CPU (10s)** button. This intentionally blocks the Node.js event loop to artificially spike CPU utilization. 
1. Click the button in the UI.
2. Watch the cluster scale the deployment from 2 to up to 10 replicas:
   ```bash
   kubectl get hpa -n sre-monitor -w
   ```

### Test Resilience (Decoupled Probes)
The webapp uses decoupled `/health` and `/ready` probes to prevent crash-looping during datastore blips. Test it by scaling Redis to 0:
```bash
kubectl scale deployment/redis --replicas=0 -n sre-monitor
```
*Result:* `kubectl get pods -n sre-monitor` will show the webapp pods remain `Running` but switch to `0/1 Ready` (temporarily removed from routing) until Redis returns.
