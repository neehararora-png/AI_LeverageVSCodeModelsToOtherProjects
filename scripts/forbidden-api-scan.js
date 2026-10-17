//@ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const projectRoot = path.resolve(root, '..');
const forbidden = [
  'child_process',
  'new Function',
  'eval(',
  'vm.',
  'import(',
  'fetch(',
  'XMLHttpRequest',
  'net.createConnection',
  'crypto.subtle'
];
const skipDirs = new Set(['.git', 'node_modules', '.venv', '.pytest_cache', '__pycache__']);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hits = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.vscode') {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) {
        continue;
      }
      hits.push(...walk(fullPath));
    } else if (entry.isFile()) {
      if (fullPath === path.join(projectRoot, 'scripts', 'forbidden-api-scan.js')) {
        continue;
      }
      if (/\.(js|json)$/i.test(entry.name)) {
        const text = fs.readFileSync(fullPath, 'utf8');
        for (const token of forbidden) {
          if (text.includes(token)) {
            hits.push({ file: path.relative(projectRoot, fullPath), token });
          }
        }
      }
    }
  }

  return hits;
}

const matches = walk(projectRoot);

if (matches.length > 0) {
  console.error('Forbidden API scan failed. Found disallowed patterns:');
  for (const entry of matches) {
    console.error(`- ${entry.file}: ${entry.token}`);
  }
  process.exit(1);
}

console.log('Forbidden API scan passed.');
