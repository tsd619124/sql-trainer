import Capacitor
import UIKit

final class SQLLabViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SQLLabNativePlugin())
        webView?.isOpaque = false
        webView?.backgroundColor = .systemBackground
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        webView?.scrollView.keyboardDismissMode = .interactive
    }
}
