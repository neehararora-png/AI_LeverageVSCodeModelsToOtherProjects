//@ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createAuditLog(directory = '.audit', options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : 100;
  const maxFiles = Number.isInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : 5;
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

    let entriesToRemove = Math.max(0, files.reduce((count, name) => {
      const filePath = path.join(auditDirectory, name);
      return count + fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).length;
    }, 0) - maxEntries);
    for (const name of files) {
      if (entriesToRemove === 0) {
        break;
      }
      const filePath = path.join(auditDirectory, name);
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
      if (entriesToRemove >= lines.length) {
        fs.unlinkSync(filePath);
        entriesToRemove -= lines.length;
      } else {
        fs.writeFileSync(filePath, `${lines.slice(entriesToRemove).join('\n')}\n`, 'utf8');
        entriesToRemove = 0;
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
