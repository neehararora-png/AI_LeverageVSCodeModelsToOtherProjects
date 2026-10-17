//@ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createAuditLog(directory = '.audit', options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : 100;
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 5;
  const auditDirectory = directory || '.audit';

  fs.mkdirSync(auditDirectory, { recursive: true });

  function writeEntry(entry) {
    const fileName = `audit-${Date.now()}.jsonl`;
    const filePath = path.join(auditDirectory, fileName);
    const line = JSON.stringify({
      requestId: entry.requestId || 'unknown',
      endpoint: entry.endpoint || 'unknown',
      outcome: entry.outcome || 'unknown',
      durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : 0,
      responseBytes: Number.isFinite(entry.responseBytes) ? entry.responseBytes : 0,
      timestamp: new Date().toISOString()
    });

    fs.appendFileSync(filePath, `${line}\n`, 'utf8');

    const files = fs.readdirSync(auditDirectory)
      .filter((name) => name.endsWith('.jsonl'))
      .sort();

    while (files.length > maxFiles) {
      const oldest = files.shift();
      if (oldest) {
        fs.unlinkSync(path.join(auditDirectory, oldest));
      }
    }

    return { filePath, entry: JSON.parse(line) };
  }

  return {
    writeEntry,
    maxEntries,
    maxFiles,
    auditDirectory
  };
}

module.exports = {
  createAuditLog
};
