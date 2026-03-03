import SwiftUI

@main
struct FolioApp: App {
    var body: some Scene {
        WindowGroup {
            WebViewContainer()
                .ignoresSafeArea(.all, edges: .bottom)
                .preferredColorScheme(.dark)
        }
    }
}

/// SwiftUI wrapper around the WKWebView-based controller
struct WebViewContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController {
        return WebViewController()
    }
    
    func updateUIViewController(_ uiViewController: WebViewController, context: Context) {}
}
