//@ts-check
'use strict';

const { createStatusBar } = require('./ui/statusBar');
const { sanitizeSettings } = require('./config/settings');
const { createPipeServer } = require('./transport/pipeServer');
const { thePipePath } = require('./transport/pipePath');
const { createBridgeRequestHandler } = require('./transport/requestHandler');
const { hasConsent, recordConsent, shouldPrompt } = require('./consent/consentGate');
const { createTokenManager } = require('./security/tokenManager');
const { createChatClient } = require('./lm/chatClient');

const CONSENT_STATE_KEY = 'vscode-browser-bridge.consent';
const EXTENSION_VERSION = require('../package.json').version;

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
  const tokenManager = createTokenManager(context.secrets || null);

  const ensureBridgeConsent = async () => {
    const stateStore = context.globalState;
    if (!stateStore || typeof stateStore.get !== 'function' || typeof stateStore.update !== 'function') {
      return false;
    }

    const consentState = stateStore.get(CONSENT_STATE_KEY, {});
    if (!shouldPrompt(consentState, EXTENSION_VERSION) && hasConsent(consentState, EXTENSION_VERSION)) {
      return true;
    }
    if (!vscode?.window || typeof vscode.window.showWarningMessage !== 'function') {
      return false;
    }

    const approved = await vscode.window.showWarningMessage(
      'Allow trusted local applications to send prompts to VS Code language models through a named pipe?',
      { modal: true, detail: 'The bridge requires a local bearer token. Requests are processed by the selected VS Code language model.' },
      'Enable Bridge'
    );
    const nextState = recordConsent(consentState, EXTENSION_VERSION, approved === 'Enable Bridge');
    await stateStore.update(CONSENT_STATE_KEY, nextState);
    return approved === 'Enable Bridge';
  };

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

  const startBridge = () => {
    if (stopPromise) {
      return stopPromise.then(() => startBridge());
    }
    if (serverInstance) {
      return Promise.resolve({ ok: true, state: statusBar.getState() });
    }
    if (startPromise) {
      return startPromise;
    }

    startPromise = Promise.resolve().then(async () => {
      if (!await ensureBridgeConsent()) {
        bridge.isActive = false;
        updateStatusBar('off');
        return { ok: false, state: statusBar.getState(), reason: 'consent_required' };
      }

      if (!context.secrets || typeof context.secrets.get !== 'function' || typeof context.secrets.store !== 'function') {
        throw new Error('VS Code SecretStorage is unavailable');
      }

      const expectedToken = await tokenManager.getToken() || await tokenManager.rotateToken();
      const apiDependencies = options.apiDependencies || {};
      const chatClient = apiDependencies.chatClient || createChatClient(vscode, {
        vendor: apiDependencies.vendor || 'copilot'
      });
      const serverFactory = options.serverFactory || createPipeServer;
      const pipePath = options.pipePath || thePipePath(settings.pipeName);
      const requestHandler = options.requestHandler || createBridgeRequestHandler({
        ...apiDependencies,
        expectedToken,
        chatClient,
        confirmModelRequest: apiDependencies.confirmModelRequest || (async ({ model, messageCount }) => {
          if (!vscode?.window || typeof vscode.window.showWarningMessage !== 'function') {
            return false;
          }
          const answer = await vscode.window.showWarningMessage(
            `Send ${messageCount} message(s) to VS Code model ${model}?`,
            { modal: true, detail: 'Prompt content is processed by the selected language model. It is not included in this confirmation.' },
            'Send Request'
          );
          return answer === 'Send Request';
        }),
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

      await server.listen();
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

  const copyToken = async () => {
    const token = await tokenManager.getToken();
    if (!token) {
      if (vscode?.window?.showInformationMessage) {
        await vscode.window.showInformationMessage('Start the bridge before copying its token.');
      }
      return { ok: false, reason: 'token_unavailable' };
    }
    if (!vscode?.env?.clipboard || typeof vscode.env.clipboard.writeText !== 'function') {
      return { ok: false, reason: 'clipboard_unavailable' };
    }
    await vscode.env.clipboard.writeText(token);
    if (vscode.window?.showInformationMessage) {
      await vscode.window.showInformationMessage('Bridge token copied to the clipboard. Treat it like a password.');
    }
    return { ok: true };
  };

  const disableBridge = async () => {
    await stopBridge();
    const stateStore = context.globalState;
    if (stateStore && typeof stateStore.get === 'function' && typeof stateStore.update === 'function') {
      const consentState = stateStore.get(CONSENT_STATE_KEY, {});
      await stateStore.update(CONSENT_STATE_KEY, recordConsent(consentState, EXTENSION_VERSION, false));
    }
    await tokenManager.deleteToken();
    return { ok: true, state: statusBar.getState() };
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
    const copyTokenDisposable = register('vscode-browser-bridge.copyToken', copyToken);
    const disableDisposable = register('vscode-browser-bridge.disable', disableBridge);
    if (context && Array.isArray(context.subscriptions)) {
      context.subscriptions.push(startDisposable, stopDisposable, copyTokenDisposable, disableDisposable, dispose);
    }
  } else if (context && typeof context.subscriptions !== 'undefined') {
    context.subscriptions.push({ dispose() { stopBridge().catch(() => undefined); } });
  }

  bridge.statusBar = statusBar;
  bridge.vscode = vscode;

  return { bridge, statusBar, startBridge, stopBridge, copyToken, disableBridge, statusItem };
}

function deactivate() {
  return undefined;
}

module.exports = {
  activate,
  deactivate
};
