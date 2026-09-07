import AppKit

// The panel belongs to Sideleaf's existing application. Only this small API gap
// is platform-specific; document reads and writes remain in the shared host.
@_cdecl("sideleaf_save_dialog")
public func sideleafSaveDialog(_ name: UnsafePointer<CChar>, _ folder: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    let filename = String(cString: name)
    let directory = String(cString: folder)
    let show = { () -> String? in
        let panel = NSSavePanel()
        panel.title = "Save Markdown"
        panel.nameFieldStringValue = filename
        panel.directoryURL = URL(fileURLWithPath: directory, isDirectory: true)
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        return panel.runModal() == .OK ? panel.url?.path : nil
    }
    let path = Thread.isMainThread ? show() : DispatchQueue.main.sync(execute: show)
    return path.flatMap { strdup($0) }
}

@_cdecl("sideleaf_free_string")
public func sideleafFreeString(_ pointer: UnsafeMutablePointer<CChar>?) { free(pointer) }
