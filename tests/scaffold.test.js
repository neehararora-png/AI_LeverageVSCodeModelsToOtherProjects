//@ts-check
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

const requiredFiles = [
  '.github/workflows/ci.yml',
  '.gitignore',
  '.vscode/extensions.json',
  '.vscode/launch.json',
  '.vscode/tasks.json',
  'LICENSE',
  'PLAN.md',
  'README.md',
  'package.json',
  'scripts/forbidden-api-scan.js',
  'scripts/secret-scan.js'
];

test('repository scaffold includes required project files', () => {
  for (const relative of requiredFiles) {
    const full = path.join(projectRoot, relative);
    assert.ok(fs.existsSync(full), `Missing required file: ${relative}`);
  }
});

test('package manifest does not declare third-party dependencies or dev dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.deepEqual(pkg.devDependencies || {}, {});
});

test('source and scripts begin with required strict header', () => {
  const targets = [
    path.join(projectRoot, 'scripts/forbidden-api-scan.js'),
    path.join(projectRoot, 'scripts/secret-scan.js')
  ];

  for (const file of targets) {
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^\/\/\@ts-check\s*\n'use strict';/m);
  }
});
