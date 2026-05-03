'use strict';

const path = require('path');
const { refreshCatalog } = require('./lib/refresh-catalog');

function main() {
  const runnerRoot = __dirname;
  const out = refreshCatalog(runnerRoot);
  process.stdout.write(`Catalog refreshed with ${out.scenarios.length} scenario(s).\n`);
}

main();
