'use strict';

const fs = require('fs');
const path = require('path');

async function normalizeControlState(client) {
  await client.callTool('reset_emergency_stop');
  await client.callTool('resume_control');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function getRunStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}${mi}${ss}`;
}

function loadJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function walkTests(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTests(full));
      continue;
    }
    if (entry.isFile() && entry.name === 'test.js') {
      out.push(full);
    }
  }
  return out;
}

module.exports = {
  ensureDir,
  getRunStamp,
  loadJsonIfExists,
  normalizeControlState,
  nowIso,
  walkTests,
  writeJson,
};
