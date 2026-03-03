import Foundation
import Network

extension Notification.Name {
    static let networkStatusChanged = Notification.Name("networkStatusChanged")
}

/// Monitors network connectivity and posts notifications on changes.
class NetworkMonitor {
    static let shared = NetworkMonitor()
    
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.folio.networkMonitor")
    
    private(set) var isConnected = true
    private(set) var connectionType: NWInterface.InterfaceType?
    
    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.isConnected = path.status == .satisfied
            self?.connectionType = path.availableInterfaces.first?.type
            NotificationCenter.default.post(name: .networkStatusChanged, object: nil)
        }
        monitor.start(queue: queue)
    }
    
    deinit {
        monitor.cancel()
    }
}
