import Libmpv
import UIKit

// Spike: proves libmpv plays a stream inside an unsigned, sideloaded IPA. The web UI comes later.
final class PlayerViewController: UIViewController {
    private var metalLayer = MetalLayer()
    private var mpv: OpaquePointer?
    private let queue = DispatchQueue(label: "mpv", qos: .userInitiated)
    private let field = UITextField()
    private let status = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        metalLayer.contentsScale = UIScreen.main.nativeScale
        metalLayer.framebufferOnly = true
        metalLayer.backgroundColor = UIColor.black.cgColor
        view.layer.addSublayer(metalLayer)

        field.text = "https://download.blender.org/peach/bigbuckbunny_movies/big_buck_bunny_480p_h264.mov"
        field.borderStyle = .roundedRect
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.keyboardType = .URL
        field.returnKeyType = .go
        field.addTarget(self, action: #selector(play), for: .editingDidEndOnExit)
        status.textColor = .white
        status.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        status.numberOfLines = 4
        status.text = "Marquee iOS spike: paste a stream URL and press Go"
        [field, status].forEach { view.addSubview($0) }

        setupMpv()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let safe = view.safeAreaInsets
        metalLayer.frame = view.bounds
        field.frame = CGRect(x: 12, y: safe.top + 8, width: view.bounds.width - 24, height: 36)
        status.frame = CGRect(x: 12, y: view.bounds.height - safe.bottom - 70, width: view.bounds.width - 24, height: 62)
    }

    private func setupMpv() {
        guard let h = mpv_create() else { status.text = "mpv_create failed"; return }
        mpv = h
        mpv_request_log_messages(h, "warn")
        mpv_set_option(h, "wid", MPV_FORMAT_INT64, &metalLayer)
        for (k, v) in [("vo", "gpu-next"), ("gpu-api", "vulkan"), ("gpu-context", "moltenvk"),
                       ("hwdec", "videotoolbox"), ("video-rotate", "no"), ("keep-open", "yes")] {
            mpv_set_option_string(h, k, v)
        }
        let rc = mpv_initialize(h)
        if rc < 0 { status.text = "mpv_initialize failed: \(String(cString: mpv_error_string(rc)))"; return }
        queue.async { [weak self] in self?.eventLoop(h) }
    }

    @objc private func play() {
        field.resignFirstResponder()
        guard let h = mpv, let url = field.text, !url.isEmpty else { return }
        let owned: [UnsafeMutablePointer<CChar>?] = ["loadfile", url, "replace"].map { strdup($0) }
        var args: [UnsafePointer<CChar>?] = owned.map { UnsafePointer<CChar>($0) }
        args.append(nil)
        defer { owned.forEach { free($0) } }
        let rc = mpv_command(h, &args)
        status.text = rc < 0 ? "loadfile failed: \(String(cString: mpv_error_string(rc)))" : "loading..."
    }

    private func show(_ text: String) { DispatchQueue.main.async { self.status.text = text } }

    private func eventLoop(_ h: OpaquePointer) {
        while true {
            guard let ev = mpv_wait_event(h, 1.0) else { continue }
            switch ev.pointee.event_id {
            case MPV_EVENT_SHUTDOWN: return
            case MPV_EVENT_FILE_LOADED: show("playing")
            case MPV_EVENT_LOG_MESSAGE:
                let m = ev.pointee.data.assumingMemoryBound(to: mpv_event_log_message.self).pointee
                show("[\(String(cString: m.prefix))] \(String(cString: m.text).trimmingCharacters(in: .whitespacesAndNewlines))")
            case MPV_EVENT_END_FILE:
                let e = ev.pointee.data.assumingMemoryBound(to: mpv_event_end_file.self).pointee
                if e.reason == MPV_END_FILE_REASON_ERROR { show("playback error: \(String(cString: mpv_error_string(e.error)))") }
            default: break
            }
        }
    }

    deinit {
        if let h = mpv { mpv = nil; mpv_terminate_destroy(h) }
    }
}
