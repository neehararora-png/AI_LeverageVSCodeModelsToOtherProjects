//@ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const artifact = path.join(root, 'vscode-browser-bridge.vsix');
const staging = path.join(root, '.vsix-staging');

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = Math.floor(date.getSeconds() / 2);
  return {
    dosTime: ((hour & 0x1f) << 11) | ((minute & 0x3f) << 5) | (second & 0x1f),
    dosDate: (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f)
  };
}

function makeLocalHeader(fileName, data) {
  const name = Buffer.from(fileName, 'utf8');
  const dt = dosDateTime(new Date());
  const crc = crc32(data);
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(dt.dosTime, 10);
  header.writeUInt16LE(dt.dosDate, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return Buffer.concat([header, data]);
}

function makeCentralDirectoryEntry(fileName, data, offset) {
  const name = Buffer.from(fileName, 'utf8');
  const dt = dosDateTime(new Date());
  const crc = crc32(data);
  const entry = Buffer.alloc(46 + name.length);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0, 8);
  entry.writeUInt16LE(0, 10);
  entry.writeUInt16LE(0, 12);
  entry.writeUInt16LE(dt.dosTime, 14);
  entry.writeUInt16LE(dt.dosDate, 16);
  entry.writeUInt32LE(crc, 18);
  entry.writeUInt32LE(data.length, 22);
  entry.writeUInt32LE(data.length, 26);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt16LE(0, 30);
  entry.writeUInt16LE(0, 32);
  entry.writeUInt16LE(0, 34);
  entry.writeUInt32LE(0, 36);
  entry.writeUInt32LE(offset, 42);
  name.copy(entry, 46);
  return entry;
}

function makeEocd(totalEntries, centralSize, centralOffset) {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(totalEntries, 8);
  eocd.writeUInt16LE(totalEntries, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return eocd;
}

if (fs.existsSync(staging)) {
  fs.rmSync(staging, { recursive: true, force: true });
}
fs.mkdirSync(staging, { recursive: true });
fs.mkdirSync(path.join(staging, 'extension'), { recursive: true });

const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const manifest = `<?xml version="1.0" encoding="utf-8"?>\n<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">\n  <Metadata>\n    <Identity Id="vscode-browser-bridge" Version="0.1.0" Language="en-US" Publisher="NeeharArora" />\n    <DisplayName>VS Code Browser Bridge</DisplayName>\n    <Description>A local Windows named-pipe bridge to Copilot-backed models.</Description>\n  </Metadata>\n  <Installation>\n    <InstallationTarget Id="Microsoft.VisualStudio.Code" />\n  </Installation>\n</PackageManifest>\n`;
const contentTypes = `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/extension.vsixmanifest" ContentType="application/vnd.code.vsixmanifest+xml"/>\n  <Override PartName="/extension/package.json" ContentType="application/json"/>\n</Types>\n`;

fs.writeFileSync(path.join(staging, 'extension', 'package.json'), packageJson, 'utf8');
fs.writeFileSync(path.join(staging, 'extension.vsixmanifest'), manifest, 'utf8');
fs.writeFileSync(path.join(staging, '[Content_Types].xml'), contentTypes, 'utf8');

const fileEntries = [
  { fileName: 'extension/package.json', data: Buffer.from(packageJson, 'utf8') },
  { fileName: 'extension.vsixmanifest', data: Buffer.from(manifest, 'utf8') },
  { fileName: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') }
];

const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of fileEntries) {
  const localHeader = makeLocalHeader(file.fileName, file.data);
  localParts.push(localHeader);
  const central = makeCentralDirectoryEntry(file.fileName, file.data, offset);
  centralParts.push(central);
  offset += localHeader.length;
}

const centralOffset = localParts.reduce((sum, chunk) => sum + chunk.length, 0);
const centralDirectorySize = centralParts.reduce((sum, chunk) => sum + chunk.length, 0);
const eocd = makeEocd(fileEntries.length, centralDirectorySize, centralOffset);
const zipBuffer = Buffer.concat([...localParts, ...centralParts, eocd]);
fs.writeFileSync(artifact, zipBuffer);
fs.rmSync(staging, { recursive: true, force: true });
console.log(`Created ${artifact}`);
