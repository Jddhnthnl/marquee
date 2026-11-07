import Foundation
import UIKit
import WebKit

protocol TauriBridgeDelegate: AnyObject {
    func handlePlayMpv(id: Int, args: [String: Any])
    func handleToggleFullscreen(on: Bool)
    var mpvSession: MpvSession? { get }
}

final class TauriBridge: NSObject, WKScriptMessageHandler {
    weak var delegate: TauriBridgeDelegate?
    weak var mainWebView: WKWebView?
    weak var playerWebView: WKWebView?
    private var lastPlayerInfo: Any?

    static let bridgeScript: String = """
    (() => {
      const listeners = new Map();
      const callbacks = new Map();
      let nextCallbackId = 1;

      const report = (m) => { try { window.webkit.messageHandlers.tauriInvoke.postMessage({ id: 0, cmd: 'js_error', args: { msg: location.pathname + ': ' + m } }); } catch (e) {} };
      addEventListener('error', (e) => report(e.message + ' @' + e.lineno));
      addEventListener('unhandledrejection', (e) => report('rejected: ' + (e.reason && e.reason.message || e.reason)));

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
    })();
    """

    func userScript() -> WKUserScript {
        return WKUserScript(source: TauriBridge.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func userContentController() -> WKUserContentController {
        let uc = WKUserContentController()
        uc.addUserScript(userScript())
        uc.add(self, name: "tauriInvoke")
        uc.add(self, name: "tauriEmitTo")
        return uc
    }

    func userContentController(didReceiveScriptMessage message: WKScriptMessage) {
        // Handled via WKScriptMessageHandler protocol
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }

        if message.name == "tauriEmitTo" {
            handleEmitTo(body)
        } else if message.name == "tauriInvoke" {
            guard let id = body["id"] as? Int,
                  let cmd = body["cmd"] as? String,
                  let webView = message.webView else { return }
            let args = (body["args"] as? [String: Any]) ?? [:]
            handleInvoke(id: id, cmd: cmd, args: args, webView: webView)
        }
    }

    private func handleEmitTo(_ body: [String: Any]) {
        guard let target = body["target"] as? String,
              let eventName = body["eventName"] as? String else { return }
        let payload = body["payload"] ?? NSNull()

        if target == "player", let pwv = playerWebView {
            postEvent(to: pwv, name: eventName, payload: payload)
        } else if target == "main", let mwv = mainWebView {
            postEvent(to: mwv, name: eventName, payload: payload)
        }
    }

    private func handleInvoke(id: Int, cmd: String, args: [String: Any], webView: WKWebView) {
        switch cmd {
        case "play_mpv":
            delegate?.handlePlayMpv(id: id, args: args)

        case "mpv_cmd":
            let rawArgs = (args["args"] as? [Any]) ?? []
            if let mpv = delegate?.mpvSession {
                let res = mpv.command(rawArgs)
                switch res {
                case .success(let val):
                    resolve(id: id, webView: webView, result: val ?? NSNull())
                case .failure(let err):
                    resolve(id: id, webView: webView, error: err.message)
                }
            } else {
                resolve(id: id, webView: webView, error: "Nothing is playing.")
            }

        case "mpv_state":
            let props = delegate?.mpvSession?.props ?? [:]
            resolve(id: id, webView: webView, result: props)

        case "js_error":
            delegate?.mpvSession?.note("[js] \(args["msg"] as? String ?? "?")")

        case "mpv_log":
            let logs = delegate?.mpvSession?.getRecentLogs() ?? ""
            resolve(id: id, webView: webView, result: logs)

        case "introdb":
            guard let imdb = args["imdb"] as? String,
                  imdb.hasPrefix("tt"),
                  imdb.dropFirst(2).allSatisfy({ $0.isNumber }) else {
                resolve(id: id, webView: webView, error: "bad IMDb id")
                return
            }
            let season = args["season"] as? Int ?? 0
            let episode = args["episode"] as? Int ?? 0
            let urlStr = "https://api.introdb.app/segments?imdb_id=\(imdb)&season=\(season)&episode=\(episode)"
            guard let url = URL(string: urlStr) else {
                resolve(id: id, webView: webView, error: "Invalid IntroDB URL")
                return
            }
            var req = URLRequest(url: url)
            req.timeoutInterval = 8
            URLSession.shared.dataTask(with: req) { [weak self] data, _, err in
                if let err = err {
                    self?.resolve(id: id, webView: webView, error: err.localizedDescription)
                    return
                }
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) else {
                    self?.resolve(id: id, webView: webView, error: "Invalid IntroDB response")
                    return
                }
                self?.resolve(id: id, webView: webView, result: json)
            }.resume()

        case "torbox_me":
            guard let key = args["key"] as? String,
                  let url = URL(string: "https://api.torbox.app/v1/api/user/me") else {
                resolve(id: id, webView: webView, error: "Invalid Torbox request")
                return
            }
            var req = URLRequest(url: url)
            req.timeoutInterval = 8
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            URLSession.shared.dataTask(with: req) { [weak self] data, _, err in
                if let err = err {
                    self?.resolve(id: id, webView: webView, error: err.localizedDescription)
                    return
                }
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) else {
                    self?.resolve(id: id, webView: webView, error: "Invalid Torbox response")
                    return
                }
                self?.resolve(id: id, webView: webView, result: json)
            }.resume()

        case "set_player_info":
            let info = args["info"] ?? args
            self.lastPlayerInfo = info
            if let pwv = playerWebView {
                postEvent(to: pwv, name: "player-info", payload: info)
            }
            resolve(id: id, webView: webView, result: NSNull())

        case "player_info":
            resolve(id: id, webView: webView, result: lastPlayerInfo ?? NSNull())

        case "toggle_fullscreen":
            let on = (args["on"] as? Bool) ?? false
            delegate?.handleToggleFullscreen(on: on)
            resolve(id: id, webView: webView, result: on)

        case "open_external":
            if let urlStr = args["url"] as? String, let url = URL(string: urlStr) {
                DispatchQueue.main.async {
                    UIApplication.shared.open(url, options: [:], completionHandler: nil)
                }
            }
            resolve(id: id, webView: webView, result: NSNull())

        case "haptic":
            DispatchQueue.main.async { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
            resolve(id: id, webView: webView, result: NSNull())

        case "brightness":
            DispatchQueue.main.async {
                if let v = (args["value"] as? NSNumber)?.doubleValue { UIScreen.main.brightness = CGFloat(min(1, max(0.05, v))) }
                self.resolve(id: id, webView: webView, result: Double(UIScreen.main.brightness))
            }

        case "discord_clear", "discord_set", "notify", "check_update":
            resolve(id: id, webView: webView, result: NSNull())

        default:
            resolve(id: id, webView: webView, result: NSNull())
        }
    }

    func resolve(id: Int, webView: WKWebView, result: Any? = nil, error: String? = nil) {
        DispatchQueue.main.async {
            let resJson: String
            if let res = result, !(res is NSNull) {
                if let data = try? JSONSerialization.data(withJSONObject: res, options: []),
                   let s = String(data: data, encoding: .utf8) {
                    resJson = s
                } else if let b = res as? Bool {
                    resJson = b ? "true" : "false"
                } else if let n = res as? NSNumber {
                    resJson = "\(n)"
                } else if let str = res as? String {
                    resJson = (try? String(data: JSONSerialization.data(withJSONObject: [str]), encoding: .utf8))
                        .flatMap { $0.dropFirst().dropLast() }
                        .map(String.init) ?? "\"\(str)\""
                } else {
                    resJson = "null"
                }
            } else {
                resJson = "null"
            }

            let errJson: String
            if let err = error {
                if let data = try? JSONSerialization.data(withJSONObject: [err], options: []),
                   let s = String(data: data, encoding: .utf8) {
                    // Extract quoted JSON string safely
                    errJson = String(s.dropFirst().dropLast())
                } else {
                    errJson = "\"\(err)\""
                }
            } else {
                errJson = "null"
            }

            let js = "window.__TAURI_RESOLVE_INVOKE__(\(id), \(resJson), \(errJson));"
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    func postEvent(to webView: WKWebView, name: String, payload: Any) {
        DispatchQueue.main.async {
            let payloadJson: String
            if !(payload is NSNull),
               let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
               let s = String(data: data, encoding: .utf8) {
                payloadJson = s
            } else if let b = payload as? Bool {
                payloadJson = b ? "true" : "false"
            } else if let n = payload as? NSNumber {
                payloadJson = "\(n)"
            } else if let str = payload as? String {
                if let data = try? JSONSerialization.data(withJSONObject: [str], options: []),
                   let s = String(data: data, encoding: .utf8) {
                    payloadJson = String(s.dropFirst().dropLast())
                } else {
                    payloadJson = "\"\(str)\""
                }
            } else {
                payloadJson = "null"
            }

            guard let nameData = try? JSONSerialization.data(withJSONObject: [name], options: []),
                  let nameJson = String(data: nameData, encoding: .utf8) else { return }
            let js = "window.__TAURI_POST_EVENT__(\(String(nameJson.dropFirst().dropLast())), \(payloadJson));"
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
