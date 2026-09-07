const express = require('express');
const Redis = require('ioredis');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 5000;

// Cluster metadata
const POD_NAME = process.env.POD_NAME || os.hostname();
const NODE_NAME = process.env.NODE_NAME || 'unknown-node';

// Redis connection with basic retry logic
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  connectTimeout: 2000,
  retryStrategy: (times) => Math.min(times * 200, 2000)
});

redis.on('error', (err) => console.error(`[Redis Error] ${err.message}`));

// Request logger (ignoring probes to avoid log spam)
app.use((req, res, next) => {
  if (req.path !== '/health' && req.path !== '/ready') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Pod: ${POD_NAME}`);
  }
  next();
});

// Liveness: Is the Node process running?
app.get('/health', (req, res) => res.status(200).send('OK'));

// Readiness: Is the datastore reachable?
app.get('/ready', async (req, res) => {
  try {
    await redis.ping();
    res.status(200).send('OK');
  } catch (err) {
    console.error('Readiness probe failed:', err.message);
    res.status(503).send('Service Unavailable');
  }
});

const HISTORY_LIMIT = parseInt(process.env.HISTORY_LIMIT || '20', 10);

// JSON API
app.get('/api/metrics', async (req, res) => {
  try {
    const latest = await redis.get('metrics:latest');
    const history = await redis.lrange('metrics:history', 0, HISTORY_LIMIT - 1);

    res.json({
      serving_pod: POD_NAME,
      latest: latest ? JSON.parse(latest) : null,
      history: history.map(item => JSON.parse(item))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// CPU stress endpoint for HPA testing
app.get('/api/cpu-load', (req, res) => {
  const seconds = Number(req.query.seconds) || 5;
  const end = Date.now() + (seconds * 1000);

  console.log(`Triggering CPU burn for ${seconds} seconds...`);

  // Intentionally block the event loop to spike container CPU
  while (Date.now() < end) {
    Math.random();
  }

  res.send(`CPU burn complete. Check 'kubectl get hpa'`);
});

// Raw HTML Dashboard
app.get('/', async (req, res) => {
  try {
    const rawLatest = await redis.get('metrics:latest');
    const lastRun = await redis.get('metrics:last_run_timestamp');
    const latest = rawLatest ? JSON.parse(rawLatest) : null;

    res.send(generateHtml(latest, lastRun));
  } catch (err) {
    res.status(500).send(`<h3>Datastore Error</h3><p>${err.message}</p>`);
  }
});

function generateHtml(latest, lastRun) {
  const cpu = latest ? latest.runtime_metrics.cpu.percent : 0;
  const mem = latest ? latest.runtime_metrics.memory.percent : 0;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>SRE Monitor</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #111827; color: #f9fafb; padding: 2rem; }
        .card { background: #1f2937; padding: 1.5rem; border-radius: 8px; margin-bottom: 1rem; border: 1px solid #374151; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; }
        .stat { font-size: 2rem; font-family: monospace; font-weight: bold; color: #3b82f6; }
        button { background: #ef4444; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
      </style>
    </head>
    <body>
      <h2>SRE System Monitor</h2>
      <p>Serving Pod: <code>${POD_NAME}</code> | Node: <code>${NODE_NAME}</code></p>
      
      <div class="card">
        <strong>Last CronJob Execution:</strong> ${lastRun || 'Awaiting initial run...'}
      </div>

      ${latest ? `
        <div class="grid">
          <div class="card">
            <h4>CPU Utilization</h4>
            <div class="stat">${cpu}%</div>
            <small>${latest.runtime_metrics.cpu.count} Cores</small>
          </div>
          <div class="card">
            <h4>Memory Usage</h4>
            <div class="stat">${mem}%</div>
            <small>${latest.runtime_metrics.memory.used_mb} MB Used</small>
          </div>
          <div class="card">
            <h4>Root Disk</h4>
            <div class="stat">${latest.runtime_metrics.disk.percent}%</div>
            <small>${latest.runtime_metrics.disk.free_gb} GB Free</small>
          </div>
        </div>
      ` : '<div class="card">No metrics collected yet.</div>'}

      <div class="card" style="border-color: #ef4444;">
        <h4>HPA Autoscaling Test</h4>
        <p>Generates blocking CPU load to trigger Kubernetes Pod scaling.</p>
        <button id="burnBtn" style="background: #ef4444; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;" onclick="
          const btn = document.getElementById('burnBtn');
          btn.innerText = '🔥 Burning CPU...';
          btn.disabled = true;
          fetch('/api/cpu-load?seconds=10')
            .then(() => {
              btn.innerText = '✅ Done! Check kubectl get hpa';
            })
            .catch(() => {
              btn.innerText = '❌ Error';
            });
        ">
          Burn CPU (10s)
        </button>
      </div>

      <script>
        setTimeout(() => window.location.reload(), 15000);
      </script>
    </body>
    </html>
  `;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SRE Webapp listening on port ${PORT}`);
});