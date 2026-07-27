import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const FALLBACK = 'gemini-2.5-flash';
const REFRESH_MS = 24 * 60 * 60 * 1000;

let flashModel = process.env.GEMINI_MODEL || FALLBACK;
let lastRefreshedAt = 0;

function versionOf(name) {
  const m = name.match(/^gemini-(\d+(?:\.\d+)?)-flash$/);
  return m ? parseFloat(m[1]) : -1;
}

async function listAllModels() {
  const out = [];
  const iter = await ai.models.list();
  for await (const m of iter) out.push(m);
  return out;
}

async function refresh() {
  if (!ai) return;
  if (process.env.GEMINI_MODEL) {
    lastRefreshedAt = Date.now();
    return;
  }
  try {
    const models = await listAllModels();
    const stableFlash = models
      .map((m) => (m.name || '').replace(/^models\//, ''))
      .filter((n) => /^gemini-\d+(?:\.\d+)?-flash$/.test(n))
      .sort((a, b) => versionOf(b) - versionOf(a));

    if (stableFlash.length === 0) {
      console.warn('[models] no stable flash variant returned; keeping', flashModel);
    } else if (stableFlash[0] !== flashModel) {
      console.log(`[models] flash: ${flashModel} -> ${stableFlash[0]}`);
      flashModel = stableFlash[0];
    } else {
      console.log(`[models] flash (unchanged): ${flashModel}`);
    }
  } catch (err) {
    console.warn('[models] resolver failed:', err?.message || err);
  } finally {
    lastRefreshedAt = Date.now();
  }
}

export function startModelResolver() {
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
}

export function getFlashModel() {
  return flashModel;
}

// Cheapest tier for constrained multiple-choice tasks (match adjudication,
// spec patching). Derived from the resolved flash model; env-overridable.
export function getFlashLiteModel() {
  if (process.env.GEMINI_LITE_MODEL) return process.env.GEMINI_LITE_MODEL;
  return flashModel + '-lite';
}

// Text-embedding model for the viewer's semantic search. Defaults to Google's
// multilingual embedding model (100+ languages) so search works across languages
// as atlases grow beyond English. Env-overridable; the flash resolver never
// returns an embedding model, so this stays a fixed default rather than a probe.
export function getEmbedModel() {
  return process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
}

export function getResolverStatus() {
  return { flashModel, lastRefreshedAt, overridden: Boolean(process.env.GEMINI_MODEL) };
}
