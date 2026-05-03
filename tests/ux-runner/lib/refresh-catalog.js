'use strict';

const fs = require('fs');
const path = require('path');

function nowIso() {
  return new Date().toISOString();
}

function refreshCatalog(runnerRoot) {
  const scenariosDir = path.join(runnerRoot, 'scenarios');
  const files = fs.readdirSync(scenariosDir).filter((f) => f.endsWith('.json') && f !== 'catalog.json');

  const scenarios = [];
  for (const file of files) {
    const full = path.join(scenariosDir, file);
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    scenarios.push({
      id: data.id,
      title: data.title,
      tags: Array.isArray(data.tags) ? data.tags : [],
      mode: data.mode || 'quiet',
      stepCount: Array.isArray(data.steps) ? data.steps.length : 0,
      requiredToolCount: Array.isArray(data.requiredTools) ? data.requiredTools.length : 0,
      path: `scenarios/${file}`,
    });
  }

  scenarios.sort((a, b) => a.id.localeCompare(b.id));

  const out = {
    generatedAt: nowIso(),
    scenarios,
  };

  fs.writeFileSync(path.join(scenariosDir, 'catalog.json'), JSON.stringify(out, null, 2));
  return out;
}

module.exports = { refreshCatalog };
