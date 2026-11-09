import UIKit
import Capacitor
import CapacitorNativeToolbar

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    private let defaultThemeItems: [[String: String]] = [
        ["id": "system", "label": "System"],
        ["id": "white", "label": "White"],
        ["id": "light", "label": "Light"],
        ["id": "sepia", "label": "Sepia"],
        ["id": "dark", "label": "Dark"],
        ["id": "black", "label": "Black"]
    ]

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onMenuConfigChanged),
            name: NativeToolbar.menuConfigDidChangeNotification,
            object: nil
        )
        return true
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    @objc private func onMenuConfigChanged() {
        if #available(iOS 13.0, *) {
            UIMenuSystem.main.setNeedsRebuild()
        }
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return [.landscapeLeft, .landscapeRight]
    }

    @available(iOS 13.0, *)
    override func buildMenu(with builder: UIMenuBuilder) {
        guard UIDevice.current.userInterfaceIdiom == .pad, builder.system == .main else {
            super.buildMenu(with: builder)
            return
        }

        super.buildMenu(with: builder)

        builder.replace(menu: .application, with: buildApplicationMenu())
        builder.replace(menu: .file, with: buildFileMenu())
        builder.replace(menu: .edit, with: buildEditMenu())
        builder.replace(menu: .view, with: buildViewMenu())
        builder.replace(menu: .help, with: buildHelpMenu())
    }

    @available(iOS 13.0, *)
    private func buildApplicationMenu() -> UIMenu {
        let about = UIAction(title: "About QuickBoard") { [weak self] _ in
            self?.emitMenuAction("app.about")
        }
        let settings = UIAction(title: "Settings") { [weak self] _ in
            self?.emitMenuAction("app.settings")
        }

        return UIMenu(
            title: "QuickBoard",
            image: nil,
            identifier: .application,
            options: [],
            children: [about, settings]
        )
    }

    @available(iOS 13.0, *)
    private func buildFileMenu() -> UIMenu {
        let save = UIAction(title: "Save") { [weak self] _ in
            self?.emitMenuAction("file.save")
        }
        let saveAs = UIAction(title: "Save As...") { [weak self] _ in
            self?.emitMenuAction("file.saveAs")
        }
        let load = UIAction(title: "Load") { [weak self] _ in
            self?.emitMenuAction("file.load")
        }
        let importImage = UIAction(title: "Image...") { [weak self] _ in
            self?.emitMenuAction("file.importImage")
        }
        let export = UIAction(title: "Export...") { [weak self] _ in
            self?.emitMenuAction("file.export")
        }
        let importMenu = UIMenu(title: "Import", children: [importImage])

        return UIMenu(
            title: "File",
            image: nil,
            identifier: .file,
            options: [],
            children: [save, saveAs, load, importMenu, export]
        )
    }

    @available(iOS 13.0, *)
    private func buildEditMenu() -> UIMenu {
        let undo = UIAction(title: "Undo") { [weak self] _ in
            self?.emitMenuAction("edit.undo")
        }
        let redo = UIAction(title: "Redo") { [weak self] _ in
            self?.emitMenuAction("edit.redo")
        }

        return UIMenu(
            title: "Edit",
            image: nil,
            identifier: .edit,
            options: [],
            children: [undo, redo]
        )
    }

    @available(iOS 13.0, *)
    private func buildViewMenu() -> UIMenu {
        let plugin = NativeToolbar.sharedInstance
        let currentTheme = plugin?.currentTheme ?? "system"
        let themeItems = plugin?.menuThemeItems.isEmpty == false
            ? plugin?.menuThemeItems ?? []
            : defaultThemeItems

        let appearanceItems: [UIMenuElement] = themeItems.compactMap { item in
            guard let id = item["id"], let label = item["label"] else {
                return nil
            }

            return UIAction(
                title: label,
                image: nil,
                identifier: nil,
                discoverabilityTitle: nil,
                attributes: [],
                state: id == currentTheme ? .on : .off
            ) { [weak self] _ in
                self?.emitMenuAction("theme.\(id)")
            }
        }

        let appearanceMenu = UIMenu(
            title: "Appearance",
            image: nil,
            identifier: nil,
            options: .displayInline,
            children: appearanceItems
        )

        return UIMenu(
            title: "View",
            image: nil,
            identifier: .view,
            options: [],
            children: [appearanceMenu]
        )
    }

    @available(iOS 13.0, *)
    private func buildHelpMenu() -> UIMenu {
        let about = UIAction(title: "About QuickBoard") { [weak self] _ in
            self?.emitMenuAction("app.about")
        }

        return UIMenu(
            title: "Help",
            image: nil,
            identifier: .help,
            options: [],
            children: [about]
        )
    }

    private func emitMenuAction(_ actionId: String) {
        NativeToolbar.sharedInstance?.emitMenuAction(actionId: actionId)
    }

}
