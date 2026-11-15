import SwiftUI
import WebKit

private enum Workspace: String, CaseIterable, Identifiable {
    case driver = "Driver"
    case warehouse = "Warehouse"

    var id: String { rawValue }
    var path: String {
        switch self {
        case .driver: "/driver/dashboard"
        case .warehouse: "/warehouse"
        }
    }

    var icon: String {
        switch self {
        case .driver: "truck.box"
        case .warehouse: "barcode.viewfinder"
        }
    }

    static let origin = URL(string: "https://tmswizard.cloud")!

    func contains(_ path: String) -> Bool {
        let root = self == .driver ? "/driver" : "/warehouse"
        return path == root || path.hasPrefix(root + "/")
    }
}

@main
struct TMSWizardApp: App {
    var body: some Scene {
        WindowGroup { WorkspacePicker() }
    }
}

private struct WorkspacePicker: View {
    var body: some View {
        NavigationStack {
            List(Workspace.allCases) { workspace in
                NavigationLink {
                    WorkspaceScreen(workspace: workspace)
                } label: {
                    Label(workspace.rawValue, systemImage: workspace.icon)
                }
            }
            .navigationTitle("TMS Wizard")
        }
    }
}

private struct WorkspaceScreen: View {
    let workspace: Workspace
    @State private var error: String?
    @State private var reloadID = UUID()
    @Environment(\.openURL) private var openURL

    var body: some View {
        WorkspaceWebView(workspace: workspace, error: $error) { url in
            openURL(url)
        }
        .id(reloadID)
        .overlay {
            if let error {
                ContentUnavailableView {
                    Label("Unable to open TMS", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") {
                        self.error = nil
                        reloadID = UUID()
                    }
                    .buttonStyle(.borderedProminent)
                }
                .background(.background)
            }
        }
        .navigationTitle(workspace.rawValue)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct WorkspaceWebView: UIViewRepresentable {
    let workspace: Workspace
    @Binding var error: String?
    let openExternal: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.limitsNavigationsToAppBoundDomains = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: URL(string: workspace.path, relativeTo: Workspace.origin)!.absoluteURL))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: WorkspaceWebView

        init(_ parent: WorkspaceWebView) { self.parent = parent }

        func webView(
            _ view: WKWebView, decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = action.request.url else {
                decisionHandler(.cancel)
                return
            }
            let isTMS = url.scheme == "https" && url.host == Workspace.origin.host
                && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
            if isTMS && (parent.workspace.contains(url.path) || url.path == "/login"
                || url.path == "/auth/confirm" || url.path == "/api/auth/callback") {
                if action.targetFrame == nil {
                    decisionHandler(.cancel)
                    view.load(action.request)
                } else {
                    decisionHandler(.allow)
                }
                return
            }
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated,
               ["https", "mailto", "tel"].contains(url.scheme ?? "") {
                parent.openExternal(url)
            }
        }

        func webView(
            _ view: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            let cameraOnTMS = frame.isMainFrame && origin.protocol == "https"
                && origin.host == Workspace.origin.host && type == .camera
            decisionHandler(cameraOnTMS ? .prompt : .deny)
        }

        func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
            parent.error = nil
        }

        func webView(_ view: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            show(error)
        }

        func webView(_ view: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            show(error)
        }

        private func show(_ error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            parent.error = "Check your connection and try again."
        }
    }
}
