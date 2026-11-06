import Foundation

// Over-the-air updates for the bundled web layer (Web/*). Swift / libmpv changes still need a new IPA.
// Flow: a launch downloads a newer copy into "staging" -> "next"; the following launch promotes it to
// "current" and serves it. A copy is dropped if the bundled one is newer (new IPA installed) or if the
// last launch with it never finished loading.
enum WebUpdater {
    // shortcut: assumes the native bridge hasn't changed incompatibly; add a minNative field to the manifest if it does.
    static let base = URL(string: "https://github.com/Jddhnthnl/marquee/releases/download/web-latest/")!

    private struct Manifest: Decodable {
        let version: Int
        let files: [String]
    }

    private static let fm = FileManager.default
    private static let dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("web-ota")
    private static let current = dir.appendingPathComponent("current")
    private static let next = dir.appendingPathComponent("next")
    private static let staging = dir.appendingPathComponent("staging")
    private static let booting = dir.appendingPathComponent("booting")

    static func version(of root: URL) -> Int {
        let text = try? String(contentsOf: root.appendingPathComponent("web-version.txt"), encoding: .utf8)
        return Int(text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") ?? 0
    }

    static func discard() {
        try? fm.removeItem(at: dir)
    }

    // Web root to serve this launch.
    static func root(bundled: URL) -> URL {
        if fm.fileExists(atPath: booting.path) { discard() }
        if fm.fileExists(atPath: next.path) {
            try? fm.removeItem(at: current)
            try? fm.moveItem(at: next, to: current)
        }
        guard version(of: current) > version(of: bundled) else {
            discard()
            return bundled
        }
        fm.createFile(atPath: booting.path, contents: nil)
        return current
    }

    static func bootFinished() {
        try? fm.removeItem(at: booting)
    }

    @discardableResult
    static func checkForUpdate(runningVersion: Int) async -> Bool {
        do {
            var req = URLRequest(url: base.appendingPathComponent("web-manifest.json"), cachePolicy: .reloadIgnoringLocalCacheData)
            req.timeoutInterval = 15
            let (data, _) = try await URLSession.shared.data(for: req)
            let m = try JSONDecoder().decode(Manifest.self, from: data)
            guard m.version > max(runningVersion, version(of: next)), !m.files.isEmpty else { return false }

            try? fm.removeItem(at: staging)
            try fm.createDirectory(at: staging, withIntermediateDirectories: true)
            for name in m.files {
                guard !name.contains("/"), !name.contains("..") else { throw URLError(.badURL) }
                let (body, resp) = try await URLSession.shared.data(from: base.appendingPathComponent(name))
                guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                try body.write(to: staging.appendingPathComponent(name))
            }
            try String(m.version).write(to: staging.appendingPathComponent("web-version.txt"), atomically: true, encoding: .utf8)
            try? fm.removeItem(at: next)
            try fm.moveItem(at: staging, to: next)
            return true
        } catch {
            try? fm.removeItem(at: staging)
            return false
        }
    }
}
