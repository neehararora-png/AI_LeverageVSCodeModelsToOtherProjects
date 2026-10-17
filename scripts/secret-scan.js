//@ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const skipDirs = new Set(['.git', 'node_modules', '.venv', '.pytest_cache', '__pycache__']);
const patterns = [
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /BEGIN [A-Z ]*PRIVATE KEY/
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hits = [];

  for (const entry of entries) {
    if (skipDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...walk(fullPath));
    } else if (entry.isFile()) {
      const text = fs.readFileSync(fullPath, 'utf8');
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          hits.push(path.relative(projectRoot, fullPath));
        }
      }
    }
  }

  return hits;
}

const matches = walk(projectRoot);
if (matches.length > 0) {
  console.error('Secret scan failed. Potential secret material found:');
  for (const file of matches) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log('Secret scan passed.');
