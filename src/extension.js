//@ts-check
'use strict';

const { createStatusBar } = require('./ui/statusBar');
const { sanitizeSettings } = require('./config/settings');

function activate(context = {}) {
  const settings = sanitizeSettings();
  const statusBar = createStatusBar();
  const bridge = {
    settings,
    statusBar,
    isActive: true
  };

  if (context && typeof context.subscriptions !== 'undefined') {
    context.subscriptions.push({ dispose() { bridge.isActive = false; } });
  }

  return { bridge, statusBar };
}

function deactivate() {
  return undefined;
}

module.exports = {
  activate,
  deactivate
};
