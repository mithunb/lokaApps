// Dataset build queue: in-process FIFO, concurrency 1 (builds are 1–5 min and
// the queue doubles as the abuse throttle). Each job spawns the Python
// orchestrator, which emits JSON-line progress events on stdout:
//   {"event":"progress","step":"lulc","pct":55,"msg":"..."}
//   {"event":"done"} | {"event":"error","msg":"..."}
// Builds write into datasets/.building-<slug>/ and are rename()d into place on
// success, so the viewer never sees a partial dataset.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BUILDERS_DIR = path.join(REPO_ROOT, 'api', 'atlas-builders');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const LOG_TAIL = 60;

export const DATASETS_ROOT = path.join(REPO_ROOT, 'atlas', 'datasets');
export const PRIVATE_ROOT = path.join(DATA_DIR, 'private-datasets');

const jobs = new Map();
const queue = [];
let running = null;
let onJobDone = null; // hook set by the router (status transitions, emails)

loadJobs();

function pythonBin() {
  if (process.env.ATLAS_PYTHON) return process.env.ATLAS_PYTHON;
  const venv = path.join(BUILDERS_DIR, '.venv', 'bin', 'python3');
  return fs.existsSync(venv) ? venv : 'python3';
}

function loadJobs() {
  try {
    const arr = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    for (const j of arr) {
      // anything persisted as active died with the previous process
      if (j.status === 'running' || j.status === 'queued') {
        j.status = 'failed';
        j.message = 'interrupted by server restart';
        cleanupBuildDir(j.slug);
      }
      jobs.set(j.id, j);
    }
  } catch {
    // first run
  }
}

let persistPending = false;
function persistJobs() {
  if (persistPending) return;
  persistPending = true;
  setImmediate(() => {
    persistPending = false;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tail = [...jobs.values()].slice(-200); // keep the file bounded
      const tmp = JOBS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(tail));
      fs.renameSync(tmp, JOBS_FILE);
    } catch (e) {
      console.warn('[atlas] jobs persist failed:', e.message);
    }
  });
}

function cleanupBuildDir(slug) {
  try {
    fs.rmSync(path.join(DATASETS_ROOT, '.building-' + slug), { recursive: true, force: true });
  } catch {}
}

export function setJobDoneHook(fn) { onJobDone = fn; }

export function getJob(id) {
  const j = jobs.get(id);
  if (!j) return null;
  return {
    id: j.id, slug: j.slug, status: j.status, step: j.step || '',
    pct: j.pct || 0, message: j.message || '', queuedBehind: queuePosition(j),
    layer: j.layer || '', lnum: j.lnum || 0, ltot: j.ltot || 0,
    logTail: (j.log || []).slice(-12),
  };
}
function queuePosition(j) {
  if (j.status !== 'queued') return 0;
  const idx = queue.findIndex((q) => q.id === j.id);
  return idx < 0 ? 0 : idx + (running ? 1 : 0);
}

/**
 * jobspec: { slug, visibility, tier, region, layers, branding, title, subtitle, about }
 * The orchestrator receives it plus resolved paths and writes the dataset folder.
 */
export function enqueueBuild(jobspec) {
  const id = 'job_' + crypto.randomBytes(8).toString('hex');
  const job = {
    id, slug: jobspec.slug, status: 'queued', step: '', pct: 0, message: 'queued',
    log: [], createdAt: Date.now(), spec: jobspec,
  };
  jobs.set(id, job);
  queue.push(job);
  persistJobs();
  pump();
  return id;
}

function pump() {
  if (running || queue.length === 0) return;
  const job = queue.shift();
  running = job;
  runJob(job).finally(() => {
    running = null;
    pump();
  });
}

async function runJob(job) {
  job.status = 'running';
  job.startedAt = Date.now();
  job.message = 'starting build';
  persistJobs();

  const spec = job.spec;
  const isPrivate = spec.visibility === 'private';
  const targetRoot = isPrivate ? PRIVATE_ROOT : DATASETS_ROOT;
  const buildDir = path.join(DATASETS_ROOT, '.building-' + spec.slug);
  const targetDir = path.join(targetRoot, spec.slug);

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(targetRoot, { recursive: true });

  const jobspecFile = path.join(DATA_DIR, `jobspec-${job.id}.json`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(jobspecFile, JSON.stringify({
    ...spec,
    outDir: buildDir,
    srcCache: path.join(DATA_DIR, 'srccache'),
    catalogFile: path.join(REPO_ROOT, 'atlas', 'setup', 'catalog.json'),
  }));

  const ok = await new Promise((resolve) => {
    const child = spawn(pythonBin(), [path.join(BUILDERS_DIR, 'build_dataset.py'), '--jobspec', jobspecFile], {
      cwd: BUILDERS_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group → we can kill the whole tree
    });
    job.pid = child.pid;

    const timer = setTimeout(() => {
      job.message = 'timed out after 10 minutes';
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, JOB_TIMEOUT_MS);

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        handleLine(job, line);
      }
    });
    child.stderr.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        if (line.trim()) pushLog(job, 'stderr: ' + line.trim());
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      pushLog(job, 'spawn error: ' + e.message);
      job.message = 'could not start the builder (python missing?)';
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && job._done === true);
    });
  });

  try { fs.rmSync(jobspecFile, { force: true }); } catch {}

  if (ok) {
    // atomic move into place; replace an existing dataset only on rebuilds
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(buildDir, targetDir);
    job.status = 'done';
    job.pct = 100;
    job.message = 'build complete';
    job.sizeBytes = dirSize(targetDir);
  } else {
    cleanupBuildDir(spec.slug);
    job.status = 'failed';
    if (!job.message || job.message === 'starting build') job.message = 'build failed';
  }
  job.endedAt = Date.now();
  persistJobs();
  if (onJobDone) {
    try { onJobDone(job); } catch (e) { console.warn('[atlas] job hook failed:', e.message); }
  }
}

function handleLine(job, line) {
  let evt = null;
  try { evt = JSON.parse(line); } catch {}
  if (!evt || typeof evt !== 'object') {
    pushLog(job, line);
    return;
  }
  if (evt.event === 'progress') {
    job.step = String(evt.step || job.step || '');
    // pct is already the monotonic overall value (the builder scales per-layer)
    if (Number.isFinite(evt.pct)) job.pct = Math.max(job.pct || 0, Math.min(99, Math.round(evt.pct)));
    if (evt.layer != null) { job.layer = String(evt.layer); job.lnum = evt.lnum | 0; job.ltot = evt.ltot | 0; }
    if (evt.msg) { job.message = String(evt.msg); pushLog(job, `[${job.step}] ${evt.msg}`); }
  } else if (evt.event === 'warn') {
    pushLog(job, 'warning: ' + (evt.msg || ''));
  } else if (evt.event === 'done') {
    job._done = true;
  } else if (evt.event === 'error') {
    job.message = String(evt.msg || 'build error');
    pushLog(job, 'error: ' + job.message);
  }
}

function pushLog(job, line) {
  job.log = job.log || [];
  job.log.push(line.slice(0, 300));
  if (job.log.length > LOG_TAIL) job.log.splice(0, job.log.length - LOG_TAIL);
}

function dirSize(dir) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      total += f.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
  } catch {}
  return total;
}

// kill children on shutdown so pm2 restarts don't strand python processes
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (running && running.pid) {
      try { process.kill(-running.pid, 'SIGKILL'); } catch {}
    }
    process.exit(0);
  });
}
