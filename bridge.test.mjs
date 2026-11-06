// Tests for the injected window.__TAURI__ bridge shim used on iOS
import assert from 'node:assert';

// Simulated WKWebView environment
globalThis.window = globalThis;
let invokeHandler = null;
let emitToHandler = null;

globalThis.webkit = {
  messageHandlers: {
    tauriInvoke: { postMessage: (msg) => invokeHandler?.(msg) },
    tauriEmitTo: { postMessage: (msg) => emitToHandler?.(msg) },
  }
};

// Injected bridge script (identical to TauriBridge.swift script)
const bridgeScript = `(() => {
  const listeners = new Map();
  const callbacks = new Map();
  let nextCallbackId = 1;

  window.__TAURI_POST_EVENT__ = (eventName, payload) => {
    const list = listeners.get(eventName);
    if (list) for (const cb of list) { try { cb({ payload }); } catch (e) { console.error(e); } }
  };

  window.__TAURI_RESOLVE_INVOKE__ = (id, result, error) => {
    const cb = callbacks.get(id);
    if (cb) {
      callbacks.delete(id);
      if (error) cb.reject(error);
      else cb.resolve(result);
    }
  };

  window.__TAURI__ = {
    core: {
      invoke: (cmd, args = {}) => {
        return new Promise((resolve, reject) => {
          const id = nextCallbackId++;
          callbacks.set(id, { resolve, reject });
          window.webkit.messageHandlers.tauriInvoke.postMessage({ id, cmd, args });
        });
      }
    },
    event: {
      listen: (eventName, cb) => {
        if (!listeners.has(eventName)) listeners.set(eventName, new Set());
        listeners.get(eventName).add(cb);
        return Promise.resolve(() => listeners.get(eventName)?.delete(cb));
      },
      emitTo: (target, eventName, payload) => {
        window.webkit.messageHandlers.tauriEmitTo.postMessage({ target, eventName, payload });
        return Promise.resolve();
      }
    },
    app: {
      getVersion: () => Promise.resolve('0.8.0')
    },
    window: {
      getCurrentWindow: () => ({
        setFullscreen: (on) => window.__TAURI__.core.invoke('toggle_fullscreen', { on })
      })
    }
  };
})();`;

new Function(bridgeScript)();

const tauri = window.__TAURI__;
assert(tauri, 'tauri bridge must exist on window');

// Test 1: invoke success
{
  invokeHandler = ({ id, cmd, args }) => {
    assert.strictEqual(cmd, 'mpv_state');
    assert.deepStrictEqual(args, {});
    window.__TAURI_RESOLVE_INVOKE__(id, { pause: false, 'time-pos': 42 }, null);
  };
  const res = await tauri.core.invoke('mpv_state');
  assert.strictEqual(res['time-pos'], 42);
}

// Test 2: invoke failure (must reject with raw string for app.js LINK_DEAD match)
{
  const DEAD = "That stream didn't open. The link may be dead.";
  invokeHandler = ({ id, cmd }) => {
    assert.strictEqual(cmd, 'play_mpv');
    window.__TAURI_RESOLVE_INVOKE__(id, null, DEAD);
  };
  let caught = null;
  try {
    await tauri.core.invoke('play_mpv', { url: 'https://bad' });
  } catch (e) {
    caught = e;
  }
  assert.strictEqual(caught, DEAD, 'must reject with raw error string for app.js === match');
}

// Test 3: event listen and emit
{
  let received = null;
  const unlisten = await tauri.event.listen('mpv', ({ payload }) => { received = payload; });
  window.__TAURI_POST_EVENT__('mpv', { name: 'pause', data: true });
  assert.deepStrictEqual(received, { name: 'pause', data: true });

  // Unlisten removes listener
  await unlisten();
  window.__TAURI_POST_EVENT__('mpv', { name: 'pause', data: false });
  assert.deepStrictEqual(received, { name: 'pause', data: true }, 'unlisten must prevent further callbacks');
}

// Test 4: event emitTo routes through webkit messageHandler
{
  let sent = null;
  emitToHandler = (msg) => { sent = msg; };
  await tauri.event.emitTo('player', 'player-notice', 'Hello');
  assert.deepStrictEqual(sent, { target: 'player', eventName: 'player-notice', payload: 'Hello' });
}

// Test 5: app version and fullscreen
{
  assert.strictEqual(await tauri.app.getVersion(), '0.8.0');
  invokeHandler = ({ id, cmd, args }) => {
    assert.strictEqual(cmd, 'toggle_fullscreen');
    assert.strictEqual(args.on, true);
    window.__TAURI_RESOLVE_INVOKE__(id, true, null);
  };
  assert.strictEqual(await tauri.window.getCurrentWindow().setFullscreen(true), true);
}

console.log('bridge tests pass');
