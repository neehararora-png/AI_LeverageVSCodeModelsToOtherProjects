//@ts-check
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPackage } = require('../scripts/package-vsix');

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

function readZipEntryNames(artifact) {
  const archive = fs.readFileSync(artifact);
  const endRecordOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(endRecordOffset, -1, 'VSIX must be a ZIP archive');
  const entryCount = archive.readUInt16LE(endRecordOffset + 10);
  let offset = archive.readUInt32LE(endRecordOffset + 16);
  const fileNames = [];

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50, 'ZIP central directory entry is valid');
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    fileNames.push(archive.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return fileNames;
}

function assertRuntimeFiles(fileNames) {
  assert.ok(fileNames.includes('extension/src/extension.js'));
  assert.ok(fileNames.includes('extension/src/transport/pipeServer.js'));
  assert.ok(fileNames.includes('extension/package.json'));
  assert.ok(fileNames.includes('extension/LICENSE'));
  assert.equal(fileNames.some((name) => name.startsWith('extension/src/test/')), false);
}

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

test('VSIX package contains the extension entry point and runtime sources', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-bridge-vsix-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'bridge.vsix');
  createPackage(artifact);
  assertRuntimeFiles(readZipEntryNames(artifact));
});
