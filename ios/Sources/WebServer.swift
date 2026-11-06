import Foundation
import Network

// Local loopback HTTP server serving the bundled web files (index.html, player.html, JS modules).
// An http://127.0.0.1 origin satisfies ES modules, YouTube embeds (tauri:// fails with error 153),
// and Firebase / Trakt redirects without triggering iOS local network permission prompts.
final class WebServer {
    private var listener: NWListener?
    private(set) var port: UInt16 = 0
    var root: URL
    private let queue = DispatchQueue(label: "webserver", qos: .userInitiated)

    init(root: URL) {
        self.root = root
    }

    func start(completion: @escaping (Result<UInt16, Error>) -> Void) {
        do {
            let tcpOptions = NWProtocolTCP.Options()
            let params = NWParameters(tls: nil, tcp: tcpOptions)
            params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
            params.allowLocalEndpointReuse = true
            let l = try NWListener(using: params)
            self.listener = l

            var completed = false
            l.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                switch state {
                case .ready:
                    if !completed, let port = l.port?.rawValue {
                        completed = true
                        self.port = port
                        completion(.success(port))
                    }
                case .failed(let err):
                    if !completed {
                        completed = true
                        completion(.failure(err))
                    }
                default:
                    break
                }
            }

            l.newConnectionHandler = { [weak self] conn in
                self?.handle(conn)
            }

            l.start(queue: queue)
        } catch {
            completion(.failure(error))
        }
    }

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
            guard let self = self, let data = data, !data.isEmpty,
                  let req = String(data: data, encoding: .utf8) else {
                conn.cancel()
                return
            }
            self.respond(to: req, on: conn)
        }
    }

    private func respond(to req: String, on conn: NWConnection) {
        guard let line = req.components(separatedBy: "\r\n").first ?? req.components(separatedBy: "\n").first else {
            conn.cancel()
            return
        }
        let parts = line.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else {
            send(status: "405 Method Not Allowed", body: Data(), mime: "text/plain", on: conn)
            return
        }
        var rawPath = String(parts[1])
        if let q = rawPath.firstIndex(of: "?") {
            rawPath = String(rawPath[..<q])
        }
        if let decoded = rawPath.removingPercentEncoding {
            rawPath = decoded
        }
        if rawPath.hasPrefix("/") {
            rawPath.removeFirst()
        }
        if rawPath.isEmpty || rawPath == "/" {
            rawPath = "index.html"
        }

        let fileURL = root.appendingPathComponent(rawPath)
        guard let body = try? Data(contentsOf: fileURL) else {
            send(status: "404 Not Found", body: Data("File not found".utf8), mime: "text/plain", on: conn)
            return
        }

        let mime = mimeType(for: fileURL.pathExtension)
        send(status: "200 OK", body: parts[0] == "HEAD" ? Data() : body, mime: mime, on: conn)
    }

    private func send(status: String, body: Data, mime: String, on conn: NWConnection) {
        let headers = [
            "HTTP/1.1 \(status)",
            "Content-Type: \(mime)",
            "Content-Length: \(body.count)",
            "Access-Control-Allow-Origin: *",
            "Connection: close",
            "",
            ""
        ].joined(separator: "\r\n")
        var resp = Data(headers.utf8)
        resp.append(body)
        conn.send(content: resp, completion: .contentProcessed { _ in
            conn.cancel()
        })
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "ico": return "image/x-icon"
        default: return "application/octet-stream"
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }
}
