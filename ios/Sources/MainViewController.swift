import UIKit
import WebKit

final class MainViewController: UIViewController, TauriBridgeDelegate, MpvSessionDelegate, WKNavigationDelegate {
    private var metalLayer = MetalLayer()
    private(set) var mpvSession: MpvSession?
    private var server: WebServer?
    private let bridge = TauriBridge()

    private var mainWebView: WKWebView!
    private var playerWebView: WKWebView!
    private var activePlayInvokeId: Int?
    private var playerUrl: URL?
    private var bundledRoot: URL!

    private var isPlaying = false {
        didSet {
            setNeedsStatusBarAppearanceUpdate()
            setNeedsUpdateOfHomeIndicatorAutoHidden()
        }
    }
    private var isFullscreen = false {
        didSet {
            setNeedsStatusBarAppearanceUpdate()
            setNeedsUpdateOfHomeIndicatorAutoHidden()
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override var prefersStatusBarHidden: Bool {
        return isPlaying || isFullscreen
    }

    override var prefersHomeIndicatorAutoHidden: Bool {
        return isPlaying || isFullscreen
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return .allButUpsideDown
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        metalLayer.contentsScale = UIScreen.main.nativeScale
        metalLayer.framebufferOnly = true
        metalLayer.backgroundColor = UIColor.black.cgColor
        view.layer.addSublayer(metalLayer)

        let session = MpvSession(metalLayer: metalLayer)
        session.delegate = self
        self.mpvSession = session

        bridge.delegate = self

        setupWebViews()
        startServer()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        metalLayer.frame = view.bounds
        mainWebView.frame = view.bounds
        playerWebView.frame = view.bounds
    }

    private func setupWebViews() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController = bridge.userContentController()

        mainWebView = WKWebView(frame: view.bounds, configuration: config)
        mainWebView.isOpaque = true
        mainWebView.backgroundColor = .black
        mainWebView.scrollView.contentInsetAdjustmentBehavior = .never
        mainWebView.navigationDelegate = self
        view.addSubview(mainWebView)
        bridge.mainWebView = mainWebView

        let playerConfig = WKWebViewConfiguration()
        playerConfig.allowsInlineMediaPlayback = true
        playerConfig.mediaTypesRequiringUserActionForPlayback = []
        playerConfig.userContentController = bridge.userContentController()

        playerWebView = WKWebView(frame: view.bounds, configuration: playerConfig)
        playerWebView.isOpaque = false
        playerWebView.backgroundColor = .clear
        playerWebView.scrollView.backgroundColor = .clear
        playerWebView.scrollView.isScrollEnabled = false
        playerWebView.scrollView.contentInsetAdjustmentBehavior = .never
        playerWebView.isHidden = true
        playerWebView.isUserInteractionEnabled = false
        view.addSubview(playerWebView)
        bridge.playerWebView = playerWebView
    }

    private func startServer() {
        bundledRoot = Bundle.main.url(forResource: "Web", withExtension: nil) ?? Bundle.main.bundleURL
        let webRoot = WebUpdater.root(bundled: bundledRoot)
        let running = WebUpdater.version(of: webRoot)
        Task.detached { [weak self] in
            if await WebUpdater.checkForUpdate(runningVersion: running) {
                DispatchQueue.main.async {
                    self?.mainWebView.evaluateJavaScript("window.dispatchEvent(new Event('marquee-ota'))", completionHandler: nil)
                }
            }
        }

        let s = WebServer(root: webRoot)
        self.server = s
        s.start { [weak self] res in
            guard let self = self else { return }
            switch res {
            case .success(let port):
                DispatchQueue.main.async {
                    let indexUrl = URL(string: "http://127.0.0.1:\(port)/index.html")!
                    self.playerUrl = URL(string: "http://127.0.0.1:\(port)/player.html")!
                    self.mainWebView.load(URLRequest(url: indexUrl))
                }
            case .failure(let err):
                DispatchQueue.main.async {
                    let alert = UIAlertController(title: "Server Error", message: err.localizedDescription, preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: "OK", style: .default))
                    self.present(alert, animated: true)
                }
            }
        }
    }

    // MARK: - TauriBridgeDelegate

    func handlePlayMpv(id: Int, args: [String: Any]) {
        guard let url = args["url"] as? String, !url.isEmpty else {
            bridge.resolve(id: id, webView: mainWebView, error: "Missing stream URL")
            return
        }
        self.activePlayInvokeId = id
        let title = args["title"] as? String
        let start = (args["start"] as? NSNumber)?.doubleValue
        let headers = args["headers"] as? [String]

        isPlaying = true
        playerWebView.isHidden = false
        playerWebView.isUserInteractionEnabled = true
        view.bringSubviewToFront(playerWebView)

        if let purl = playerUrl {
            playerWebView.load(URLRequest(url: purl))
        }

        mpvSession?.start(url: url, title: title, start: start, headers: headers) { [weak self] res in
            if case .failure(let err) = res {
                self?.finishPlayback(error: err.message)
            }
        }
    }

    func handleToggleFullscreen(on: Bool) {
        isFullscreen = on
    }

    private func finishPlayback(error: String? = nil, pos: Double = 0.0, duration: Double = 0.0) {
        guard let id = activePlayInvokeId else { return }
        self.activePlayInvokeId = nil
        isPlaying = false

        if let err = error {
            bridge.resolve(id: id, webView: mainWebView, error: err)
        } else {
            bridge.resolve(id: id, webView: mainWebView, result: [pos, duration])
        }

        playerWebView.isHidden = true
        playerWebView.isUserInteractionEnabled = false
        playerWebView.loadHTMLString("", baseURL: nil)
        view.bringSubviewToFront(mainWebView)
    }

    // MARK: - MpvSessionDelegate

    func mpvEvent(name: String, data: Any) {
        bridge.postEvent(to: playerWebView, name: "mpv", payload: ["name": name, "data": data])
    }

    func mpvDidEnd(pos: Double, duration: Double, error: String?) {
        finishPlayback(error: error, pos: pos, duration: duration)
    }

    deinit {
        server?.stop()
        mpvSession?.stop()
    }
}

// MARK: - WKNavigationDelegate (web OTA safety net)

extension MainViewController {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        WebUpdater.bootFinished()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fallBackToBundledWeb()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        fallBackToBundledWeb()
    }

    private func fallBackToBundledWeb() {
        guard let server = server, server.root != bundledRoot else { return }
        server.root = bundledRoot
        WebUpdater.discard()
        mainWebView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(server.port)/index.html")!))
    }
}
