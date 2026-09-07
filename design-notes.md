# Design Notes

## Why I built it this way

The goal was pretty simple: build something that works reliably on a local cluster, demonstrates real SRE thinking, and doesn't require the reviewer to spend 30 minutes setting things up.

### Tech choices

- **Node.js for the webapp** - Express is dead simple for serving a dashboard. No build step, no bundled assets, just one file. I considered Flask but Node felt lighter for this use case.
- **Python for the collector** - `psutil` gives us CPU/memory/disk stats out of the box. The script is intentionally short (~70 lines). It grabs the metrics, pushes them to Redis, and exits. That's it.
- **Redis as the datastore** - For a local assessment, Redis is perfect. No PVCs, no storage classes, no provisioner headaches. It just works. I know it's ephemeral and that's fine for a demo.

### Things I'm opinionated about

**Decoupled health probes.** The `/health` endpoint only checks if the Node process is alive. It does NOT touch Redis. The `/ready` endpoint is the one that pings Redis. Why? Because if Redis goes down for 10 seconds, I don't want Kubernetes to kill my web pods and cause a restart storm. I want it to just stop routing traffic to them temporarily. Once Redis comes back, traffic resumes automatically. No restarts, no downtime.

**The CPU burn button.** The assessment asks to show how the app can scale under load. Rather than asking the reviewer to install a load testing tool, I just added an endpoint that blocks the event loop for N seconds. Click the button on the dashboard, then run `kubectl get hpa -w` and watch the replicas go from 2 to 4+. Simple.

**ConfigMap for configuration.** Redis host and port are stored in a ConfigMap rather than hardcoded in each manifest. It's a small thing but it shows I think about separating config from code.

**NetworkPolicies.** I locked down traffic so only the webapp and collector can talk to Redis. On most local clusters (Docker Desktop, default Minikube) these policies are silently ignored because there's no CNI enforcing them, but they're there for when it matters.

## How I used AI

I used AI tools to help scaffold the initial boilerplate (Dockerfiles, YAML manifests, basic Express server setup). Typing out Kubernetes YAML from scratch is tedious and error-prone, so I had AI generate the starting point and then I modified it from there.

The AI-generated code was way too overengineered at first. Custom logging classes, heavy CSS frameworks, overly defensive error handling everywhere. I stripped most of that out and rewrote the core logic myself to keep things simple and readable.

I also used AI to sanity-check my probe design and talk through the trade-offs of ephemeral Redis vs. a persistent TSDB for a local demo.

## What I'd do differently in production

- **DaemonSet instead of CronJob** - In production you'd want something like Node Exporter running on every node, not a scheduled job.
- **Prometheus or similar TSDB** - Redis is fine for a demo, but real metrics belong in a time-series database with retention policies and alerting.
- **GitOps** - Replace `kubectl apply` with ArgoCD or Flux for declarative, auditable deployments.
- **Ingress with TLS** - Swap the NodePort for a proper Ingress controller with cert-manager handling TLS certificates.
- **External Secrets** - If Redis had a password, I'd pull it from Vault or AWS Secrets Manager via the External Secrets Operator, not a plain ConfigMap.
