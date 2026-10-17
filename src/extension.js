//@ts-check
'use strict';

const { createStatusBar } = require('./ui/statusBar');
const { sanitizeSettings } = require('./config/settings');
const { createPipeServer } = require('./transport/pipeServer');
const { thePipePath } = require('./transport/pipePath');
const { createBridgeRequestHandler } = require('./transport/requestHandler');

function resolveVSCodeApi(vscodeApi = null) {
  if (vscodeApi) {
    return vscodeApi;
  }

  try {
    return require('vscode');
  } catch {
    return null;
  }
}

function makeBridgeState(statusBar, settings = sanitizeSettings()) {
  const bridge = {
    settings,
    statusBar,
    isActive: false,
    startedAt: Date.now(),
    start() {
      bridge.isActive = true;
      statusBar.setState('listening');
      return { ok: true, state: statusBar.getState() };
    },
    stop() {
      bridge.isActive = false;
      statusBar.setState('off');
      return { ok: true, state: statusBar.getState() };
    }
  };

  return bridge;
}

function activate(context = {}, vscodeApi = null, options = {}) {
  const settings = sanitizeSettings(options.settings);
  const statusBar = createStatusBar();
  const bridge = makeBridgeState(statusBar, settings);
  const vscode = resolveVSCodeApi(vscodeApi);
  let statusItem = null;
  let serverInstance = null;
  let startPromise = null;
  let stopPromise = null;

  const updateStatusBar = (nextState) => {
    statusBar.setState(nextState);
    if (statusItem && typeof statusItem.text !== 'undefined') {
      if (nextState === 'listening') {
        statusItem.text = '$(sync~spin) VS Code Bridge: listening';
      } else if (nextState === 'error') {
        statusItem.text = '$(error) VS Code Bridge: error';
      } else {
        statusItem.text = '$(debug-disconnect) VS Code Bridge: off';
      }
      if (typeof statusItem.show === 'function') {
        statusItem.show();
      }
    }
  };

  const startBridge = async () => {
    if (stopPromise) {
      await stopPromise;
    }
    if (serverInstance) {
      return { ok: true, state: statusBar.getState() };
    }
    if (startPromise) {
      return startPromise;
    }

    const serverFactory = options.serverFactory || createPipeServer;
    const pipePath = options.pipePath || thePipePath(settings.pipeName);
    const requestHandler = options.requestHandler || createBridgeRequestHandler({
      ...(options.apiDependencies || {}),
      allowedModelFamilies: settings.allowedModelFamilies,
      rateLimit: settings.rateLimit
    });
    const server = serverFactory({
      pipePath,
      requestHandler,
      onError(error) {
        updateStatusBar('error');
        if (typeof options.onError === 'function') {
          options.onError(error);
        }
      }
    });

    startPromise = Promise.resolve().then(() => server.listen()).then(() => {
      serverInstance = server;
      bridge.isActive = true;
      updateStatusBar('listening');
      return { ok: true, state: statusBar.getState() };
    }).catch((error) => {
      updateStatusBar('error');
      throw error;
    }).finally(() => {
      startPromise = null;
    });

    return startPromise;
  };

  const stopBridge = async () => {
    if (stopPromise) {
      return stopPromise;
    }
    if (startPromise) {
      await startPromise.catch(() => undefined);
    }
    if (!serverInstance) {
      bridge.isActive = false;
      updateStatusBar('off');
      return { ok: true, state: statusBar.getState() };
    }

    const server = serverInstance;
    serverInstance = null;
    stopPromise = Promise.resolve().then(() => server.close()).then(() => {
      bridge.isActive = false;
      updateStatusBar('off');
      return { ok: true, state: statusBar.getState() };
    }).catch((error) => {
      updateStatusBar('error');
      throw error;
    }).finally(() => {
      stopPromise = null;
    });

    return stopPromise;
  };

  bridge.start = startBridge;
  bridge.stop = stopBridge;

  if (vscode && vscode.window && typeof vscode.window.createStatusBarItem === 'function') {
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment?.Right ?? 2, 100);
    statusItem.text = '$(debug-disconnect) VS Code Bridge: off';
    statusItem.tooltip = 'Local VS Code bridge for trusted model access';
    statusItem.command = 'vscode-browser-bridge.start';
    statusItem.show();
  }

  if (vscode && vscode.commands && typeof vscode.commands.registerCommand === 'function') {
    const register = (id, handler) => vscode.commands.registerCommand(id, handler);
    const dispose = { dispose() { stopBridge().catch(() => undefined); if (statusItem && typeof statusItem.dispose === 'function') { statusItem.dispose(); } } };
    const startDisposable = register('vscode-browser-bridge.start', startBridge);
    const stopDisposable = register('vscode-browser-bridge.stop', stopBridge);
    if (context && Array.isArray(context.subscriptions)) {
      context.subscriptions.push(startDisposable, stopDisposable, dispose);
    }
  } else if (context && typeof context.subscriptions !== 'undefined') {
    context.subscriptions.push({ dispose() { stopBridge().catch(() => undefined); } });
  }

  bridge.statusBar = statusBar;
  bridge.vscode = vscode;

  return { bridge, statusBar, startBridge, stopBridge, statusItem };
}

function deactivate() {
  return undefined;
}

module.exports = {
  activate,
  deactivate
};
