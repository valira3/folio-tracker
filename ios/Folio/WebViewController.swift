import UIKit
import WebKit

// MARK: - Configuration

/// Change this to your deployed backend URL.
/// While developing locally, use the bundled web app files.
/// For production, point to your Railway/Cloud Run URL.
enum AppConfig {
    /// Set to your deployed backend URL (e.g. "https://folio-tracker-production.up.railway.app")
    /// Set to nil to use the bundled local web files (offline mode)
    static let serverURL: String? = nil
    
    /// App tint color (matches --color-primary in CSS)
    static let tintColor = UIColor(red: 78/255, green: 205/255, blue: 196/255, alpha: 1)
    
    /// Dark background (matches --color-bg in CSS)
    static let backgroundColor = UIColor(red: 13/255, green: 15/255, blue: 17/255, alpha: 1)
}

// MARK: - WebViewController

class WebViewController: UIViewController {
    
    private var webView: WKWebView!
    private var refreshControl: UIRefreshControl!
    private var offlineView: UIView?
    private let networkMonitor = NetworkMonitor.shared
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = AppConfig.backgroundColor
        setupWebView()
        setupRefreshControl()
        setupNetworkMonitoring()
        loadContent()
    }
    
    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }
    
    override var prefersHomeIndicatorAutoHidden: Bool {
        return true
    }
    
    // MARK: - WebView Setup
    
    private func setupWebView() {
        let config = WKWebViewConfiguration()
        
        // Allow inline media playback
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        
        // Enable data detection (phone numbers, links)
        config.dataDetectorTypes = [.link]
        
        // User content controller for JS-Swift bridge
        let contentController = WKUserContentController()
        
        // Inject viewport meta tag to prevent zoom and ensure proper scaling
        let viewportScript = WKUserScript(
            source: """
            var meta = document.querySelector('meta[name="viewport"]');
            if (!meta) {
                meta = document.createElement('meta');
                meta.name = 'viewport';
                document.head.appendChild(meta);
            }
            meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        contentController.addUserScript(viewportScript)
        
        // Inject safe area CSS variables for notch handling
        let safeAreaScript = WKUserScript(
            source: """
            document.documentElement.style.setProperty('--safe-area-top', 'env(safe-area-inset-top)');
            document.documentElement.style.setProperty('--safe-area-bottom', 'env(safe-area-inset-bottom)');
            document.documentElement.style.setProperty('--safe-area-left', 'env(safe-area-inset-left)');
            document.documentElement.style.setProperty('--safe-area-right', 'env(safe-area-inset-right)');
            document.documentElement.classList.add('ios-native');
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        contentController.addUserScript(safeAreaScript)
        
        // Disable long-press context menus and text selection for native feel
        let nativeFeelScript = WKUserScript(
            source: """
            document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        contentController.addUserScript(nativeFeelScript)
        
        // Handle haptic feedback from JS
        contentController.add(self, name: "haptic")
        
        config.userContentController = contentController
        
        // Configure the web view
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = AppConfig.backgroundColor
        webView.scrollView.backgroundColor = AppConfig.backgroundColor
        webView.allowsBackForwardNavigationGestures = false
        
        // Disable bounce on scroll (optional — keep for pull-to-refresh)
        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true
        
        // Add to view
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }
    
    // MARK: - Pull to Refresh
    
    private func setupRefreshControl() {
        refreshControl = UIRefreshControl()
        refreshControl.tintColor = AppConfig.tintColor
        refreshControl.addTarget(self, action: #selector(handleRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl
    }
    
    @objc private func handleRefresh() {
        if let serverURL = AppConfig.serverURL {
            // Reload from server
            if let url = URL(string: serverURL) {
                webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
            }
        } else {
            // Trigger the app's built-in refresh via JS
            webView.evaluateJavaScript("if (typeof refreshAll === 'function') refreshAll();") { _, _ in }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.refreshControl.endRefreshing()
        }
    }
    
    // MARK: - Content Loading
    
    private func loadContent() {
        if let serverURL = AppConfig.serverURL, let url = URL(string: serverURL) {
            // Load from remote server
            let request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad)
            webView.load(request)
        } else {
            // Load bundled web app
            loadLocalWebApp()
        }
    }
    
    private func loadLocalWebApp() {
        guard let htmlPath = Bundle.main.path(forResource: "index", ofType: "html", inDirectory: "WebApp") else {
            showError("Could not find bundled web app files.")
            return
        }
        let htmlURL = URL(fileURLWithPath: htmlPath)
        let baseURL = htmlURL.deletingLastPathComponent()
        webView.loadFileURL(htmlURL, allowingReadAccessTo: baseURL)
    }
    
    // MARK: - Offline View
    
    private func setupNetworkMonitoring() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(networkStatusChanged),
            name: .networkStatusChanged,
            object: nil
        )
    }
    
    @objc private func networkStatusChanged() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.networkMonitor.isConnected {
                self.hideOfflineView()
                // Reload if we were offline and using server mode
                if AppConfig.serverURL != nil {
                    self.loadContent()
                }
            } else if AppConfig.serverURL != nil {
                self.showOfflineView()
            }
        }
    }
    
    private func showOfflineView() {
        guard offlineView == nil else { return }
        
        let container = UIView()
        container.backgroundColor = AppConfig.backgroundColor
        container.translatesAutoresizingMaskIntoConstraints = false
        
        let stack = UIStackView()
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        
        let icon = UILabel()
        icon.text = "📡"
        icon.font = .systemFont(ofSize: 48)
        
        let title = UILabel()
        title.text = "No Connection"
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        title.textColor = .white
        
        let subtitle = UILabel()
        subtitle.text = "Check your internet connection\nand pull down to retry."
        subtitle.font = .systemFont(ofSize: 14)
        subtitle.textColor = .gray
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 0
        
        stack.addArrangedSubview(icon)
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(subtitle)
        container.addSubview(stack)
        
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
        ])
        
        view.addSubview(container)
        NSLayoutConstraint.activate([
            container.topAnchor.constraint(equalTo: view.topAnchor),
            container.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        
        offlineView = container
    }
    
    private func hideOfflineView() {
        offlineView?.removeFromSuperview()
        offlineView = nil
    }
    
    private func showError(_ message: String) {
        let label = UILabel()
        label.text = message
        label.textColor = .gray
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
    }
}

// MARK: - WKNavigationDelegate

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        
        // Open external links in Safari
        if navigationAction.navigationType == .linkActivated,
           let host = url.host,
           !host.contains("railway.app"),
           !host.contains("localhost") {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        
        decisionHandler(.allow)
    }
    
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Match status bar to page background
        webView.evaluateJavaScript("document.documentElement.getAttribute('data-theme')") { [weak self] result, _ in
            if let theme = result as? String {
                self?.setNeedsStatusBarAppearanceUpdate()
            }
        }
    }
    
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        // Ignore cancelled navigations
        if nsError.code == NSURLErrorCancelled { return }
        
        // Show retry option
        if AppConfig.serverURL != nil {
            showOfflineView()
        }
    }
}

// MARK: - WKUIDelegate

extension WebViewController: WKUIDelegate {
    // Handle JavaScript alerts
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    
    // Handle JavaScript confirm dialogs
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}

// MARK: - WKScriptMessageHandler (JS -> Swift bridge)

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "haptic" {
            let type = message.body as? String ?? "medium"
            triggerHaptic(type)
        }
    }
    
    private func triggerHaptic(_ type: String) {
        switch type {
        case "light":
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "heavy":
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case "success":
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "error":
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "selection":
            UISelectionFeedbackGenerator().selectionChanged()
        default:
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }
    }
}
