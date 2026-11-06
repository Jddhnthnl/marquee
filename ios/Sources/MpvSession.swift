import Foundation
import Libmpv
import UIKit

protocol MpvSessionDelegate: AnyObject {
    func mpvEvent(name: String, data: Any)
    func mpvDidEnd(pos: Double, duration: Double, error: String?)
}

struct MpvError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

final class MpvSession {
    private var mpv: OpaquePointer?
    private weak var metalLayer: MetalLayer?
    weak var delegate: MpvSessionDelegate?

    private let queue = DispatchQueue(label: "mpv.session", qos: .userInitiated)
    private var isRunning = false
    private var lastPosTime = Date.distantPast
    private var lastCacheTime = Date.distantPast
    private(set) var props: [String: Any] = [:]
    private var recentLogs: [String] = []
    private var currentUrl: String = ""
    private var initialStart: Double = 0.0

    private let observedProps: [(String, mpv_format)] = [
        ("pause", MPV_FORMAT_FLAG),
        ("time-pos", MPV_FORMAT_DOUBLE),
        ("duration", MPV_FORMAT_DOUBLE),
        ("volume", MPV_FORMAT_DOUBLE),
        ("mute", MPV_FORMAT_FLAG),
        ("speed", MPV_FORMAT_DOUBLE),
        ("track-list", MPV_FORMAT_NODE),
        ("sid", MPV_FORMAT_STRING),
        ("aid", MPV_FORMAT_STRING),
        ("media-title", MPV_FORMAT_STRING),
        ("demuxer-cache-time", MPV_FORMAT_DOUBLE),
        ("paused-for-cache", MPV_FORMAT_FLAG),
        ("seeking", MPV_FORMAT_FLAG),
        ("chapter-list", MPV_FORMAT_NODE),
        ("eof-reached", MPV_FORMAT_FLAG)
    ]

    init(metalLayer: MetalLayer) {
        self.metalLayer = metalLayer
    }

    func start(url: String, title: String?, start: Double?, headers: [String]?, completion: @escaping (Result<Void, MpvError>) -> Void) {
        stop()

        guard let layer = metalLayer else {
            completion(.failure(MpvError(message: "Metal layer missing")))
            return
        }

        guard let h = mpv_create() else {
            completion(.failure(MpvError(message: "mpv_create failed")))
            return
        }
            return
        }
        self.mpv = h
        self.currentUrl = url
        self.initialStart = start ?? 0.0
        self.props.removeAll()

        mpv_request_log_messages(h, "info")
        var l = layer
        mpv_set_option(h, "wid", MPV_FORMAT_INT64, &l)

        let opts: [(String, String)] = [
            ("vo", "gpu-next"),
            ("gpu-api", "vulkan"),
            ("gpu-context", "moltenvk"),
            ("hwdec", "videotoolbox"),
            ("video-rotate", "no"),
            ("keep-open", "yes"),
            ("osc", "no"),
            ("input-default-bindings", "no"),
            ("input-vo-keyboard", "no")
        ]
        for (k, v) in opts {
            mpv_set_option_string(h, k, v)
        }

        if let s = start, s > 0 {
            mpv_set_option_string(h, "start", String(format: "%.2f", s))
        }
        if let t = title, !t.isEmpty {
            mpv_set_option_string(h, "force-media-title", t)
        }
        if let hdrs = headers {
            for hdr in hdrs {
                mpv_set_option_string(h, "http-header-fields-append", hdr)
            }
        }

        // Observe playback properties
        for (idx, p) in observedProps.enumerated() {
            mpv_observe_property(h, UInt64(idx + 1), p.0, p.1)
        }

        let rc = mpv_initialize(h)
        if rc < 0 {
            let msg = String(cString: mpv_error_string(rc))
            self.mpv = nil
            mpv_terminate_destroy(h)
            completion(.failure(MpvError(message: "mpv_initialize failed: \(msg)")))
            return
        }

        isRunning = true
        queue.async { [weak self] in
            self?.eventLoop(h)
        }

        // Issue initial loadfile
        _ = command(["loadfile", url, "replace"])
        completion(.success(()))
    }

    func command(_ args: [Any]) -> Result<Any?, MpvError> {
        guard let h = mpv else { return .failure(MpvError(message: "Nothing is playing.")) }
        let words: [String] = args.map { arg in
            if let b = arg as? Bool { return b ? "yes" : "no" }
            return String(describing: arg)
        }
        let owned: [UnsafeMutablePointer<CChar>?] = words.map { strdup($0) }
        var cArgs: [UnsafePointer<CChar>?] = owned.map { UnsafePointer<CChar>($0) }
        cArgs.append(nil)
        defer { owned.forEach { free($0) } }

        let rc = mpv_command(h, &cArgs)
        if rc < 0 {
            return .failure(MpvError(message: String(cString: mpv_error_string(rc))))
        }
        return .success(nil)
    }

    func stop() {
        isRunning = false
        if let h = mpv {
            self.mpv = nil
            mpv_terminate_destroy(h)
        }
    }

    func getRecentLogs() -> String {
        return recentLogs.joined(separator: "\n")
    }

    private func eventLoop(_ h: OpaquePointer) {
        var hadError = false
        var errorMessage: String?

        while isRunning {
            guard let ev = mpv_wait_event(h, 0.2) else { continue }
            switch ev.pointee.event_id {
            case MPV_EVENT_SHUTDOWN:
                isRunning = false
            case MPV_EVENT_START_FILE:
                DispatchQueue.main.async { [weak self] in
                    self?.props.removeAll()
                    self?.delegate?.mpvEvent(name: "start-file", data: NSNull())
                }
            case MPV_EVENT_PROPERTY_CHANGE:
                let p = ev.pointee.data.assumingMemoryBound(to: mpv_event_property.self).pointee
                guard let nameC = p.name else { break }
                let name = String(cString: nameC)
                let value = extractValue(p)
                handleProperty(name: name, value: value)
            case MPV_EVENT_LOG_MESSAGE:
                let m = ev.pointee.data.assumingMemoryBound(to: mpv_event_log_message.self).pointee
                let line = "[\(String(cString: m.prefix))] \(String(cString: m.text).trimmingCharacters(in: .whitespacesAndNewlines))"
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    self.recentLogs = Array((self.recentLogs + [line]).suffix(50))
                }
            case MPV_EVENT_END_FILE:
                let e = ev.pointee.data.assumingMemoryBound(to: mpv_event_end_file.self).pointee
                if e.reason == MPV_END_FILE_REASON_ERROR {
                    hadError = true
                    errorMessage = "That stream didn't open. The link may be dead."
                    isRunning = false
                } else if e.reason == MPV_END_FILE_REASON_QUIT {
                    isRunning = false
                }
            default:
                break
            }
        }

        let dur = (props["duration"] as? Double) ?? 0.0
        let pos = (props["time-pos"] as? Double) ?? initialStart
        let err = (hadError && dur == 0) ? (errorMessage ?? "That stream didn't open. The link may be dead.") : nil

        DispatchQueue.main.async { [weak self] in
            self?.delegate?.mpvDidEnd(pos: pos, duration: dur, error: err)
        }
    }

    private func handleProperty(name: String, value: Any) {
        let now = Date()
        if name == "time-pos" {
            if now.timeIntervalSince(lastPosTime) < 0.2 { return }
            lastPosTime = now
        } else if name == "demuxer-cache-time" {
            if now.timeIntervalSince(lastCacheTime) < 0.2 { return }
            lastCacheTime = now
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.props[name] = value
            self.delegate?.mpvEvent(name: name, data: value)
        }
    }

    private func extractValue(_ p: mpv_event_property) -> Any {
        guard let data = p.data else { return NSNull() }
        switch p.format {
        case MPV_FORMAT_FLAG:
            return data.assumingMemoryBound(to: Int32.self).pointee != 0
        case MPV_FORMAT_INT64:
            return data.assumingMemoryBound(to: Int64.self).pointee
        case MPV_FORMAT_DOUBLE:
            return data.assumingMemoryBound(to: Double.self).pointee
        case MPV_FORMAT_STRING, MPV_FORMAT_OSD_STRING:
            let ptr = data.assumingMemoryBound(to: UnsafePointer<CChar>.self).pointee
            return String(cString: ptr)
        case MPV_FORMAT_NODE:
            let node = data.assumingMemoryBound(to: mpv_node.self).pointee
            return parseNode(node)
        default:
            return NSNull()
        }
    }

    private func parseNode(_ node: mpv_node) -> Any {
        switch node.format {
        case MPV_FORMAT_FLAG:
            return node.u.flag != 0
        case MPV_FORMAT_INT64:
            return node.u.int64
        case MPV_FORMAT_DOUBLE:
            return node.u.double_
        case MPV_FORMAT_STRING, MPV_FORMAT_OSD_STRING:
            if let s = node.u.string { return String(cString: s) }
            return ""
        case MPV_FORMAT_NODE_ARRAY:
            guard let list = node.u.list else { return [] }
            var arr: [Any] = []
            for i in 0..<Int(list.pointee.num) {
                arr.append(parseNode(list.pointee.values[i]))
            }
            return arr
        case MPV_FORMAT_NODE_MAP:
            guard let list = node.u.list else { return [:] }
            var dict: [String: Any] = [:]
            for i in 0..<Int(list.pointee.num) {
                if let k = list.pointee.keys[i] {
                    dict[String(cString: k)] = parseNode(list.pointee.values[i])
                }
            }
            return dict
        default:
            return NSNull()
        }
    }

    deinit {
        stop()
    }
}
