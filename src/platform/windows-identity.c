#define COBJMACROS
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <propsys.h>
#include <propkey.h>
#include <shlobj.h>
#include <stdio.h>

static const WCHAR *launcher;
static const WCHAR *identity;
static int windows_set;
static HRESULT put(IPropertyStore *store, const PROPERTYKEY *key, const WCHAR *text) {
    PROPVARIANT value = {0}; value.vt = VT_LPWSTR; value.pwszVal = (WCHAR *)text;
    return IPropertyStore_SetValue(store, key, &value);
}
static BOOL CALLBACK configure_window(HWND hwnd, LPARAM unused) {
    (void)unused;
    DWORD pid = 0; GetWindowThreadProcessId(hwnd, &pid);
    if (pid != GetCurrentProcessId() || GetWindow(hwnd, GW_OWNER) || !IsWindowVisible(hwnd)) return TRUE;
    IPropertyStore *store = NULL;
    if (FAILED(SHGetPropertyStoreForWindow(hwnd, &IID_IPropertyStore, (void **)&store))) return TRUE;
    WCHAR command[32768], icon[32768], name[32768];
    if (swprintf(command, 32768, L"\"%ls\"", launcher) < 0 || swprintf(icon, 32768, L"%ls,0", launcher) < 0 || swprintf(name, 32768, L"@%ls,-101", launcher) < 0) { IPropertyStore_Release(store); return TRUE; }
    HRESULT hr = put(store, &PKEY_AppUserModel_RelaunchCommand, command);
    if (SUCCEEDED(hr)) hr = put(store, &PKEY_AppUserModel_RelaunchDisplayNameResource, name);
    if (SUCCEEDED(hr)) hr = put(store, &PKEY_AppUserModel_RelaunchIconResource, icon);
    // Set the explicit window identity last, after all relaunch properties.
    if (SUCCEEDED(hr)) hr = put(store, &PKEY_AppUserModel_ID, identity);
    if (SUCCEEDED(hr)) hr = IPropertyStore_Commit(store);
    IPropertyStore_Release(store);
    HICON large = NULL, small = NULL;
    if (ExtractIconExW(launcher, 0, &large, &small, 1)) {
        SendMessageW(hwnd, WM_SETICON, ICON_BIG, (LPARAM)large);
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL, (LPARAM)small);
        // The window owns the icons for the remaining process lifetime.
    }
    if (SUCCEEDED(hr)) ++windows_set;
    return TRUE;
}

// Update only the installer-owned Sideleaf shortcut whose target belongs to
// this installation. Never rewrite arbitrary user shortcuts or taskbar pins.
static void configure_shortcut(const KNOWNFOLDERID *folder) {
    PWSTR directory = NULL;
    if (FAILED(SHGetKnownFolderPath(folder, 0, NULL, &directory))) return;
    WCHAR path[32768]; swprintf(path, 32768, L"%ls\\Sideleaf.lnk", directory); CoTaskMemFree(directory);
    IShellLinkW *link = NULL; IPersistFile *file = NULL; IPropertyStore *store = NULL;
    if (FAILED(CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void **)&link))) return;
    if (FAILED(IShellLinkW_QueryInterface(link, &IID_IPersistFile, (void **)&file))) goto done;
    if (FAILED(IPersistFile_Load(file, path, STGM_READWRITE))) goto done;
    WCHAR target[32768], root[32768];
    if (FAILED(IShellLinkW_GetPath(link, target, 32768, NULL, SLGP_RAWPATH))) goto done;
    wcscpy(root, launcher); WCHAR *slash = wcsrchr(root, L'\\'); if (!slash) goto done; *slash = 0;
    slash = wcsrchr(root, L'\\'); if (!slash) goto done; slash[1] = 0;
    if (_wcsnicmp(target, root, wcslen(root)) != 0) goto done;
    if (FAILED(IShellLinkW_QueryInterface(link, &IID_IPropertyStore, (void **)&store))) goto done;
    if (SUCCEEDED(put(store, &PKEY_AppUserModel_ID, identity)) && SUCCEEDED(IPropertyStore_Commit(store))) {
        IShellLinkW_SetPath(link, launcher);
        IShellLinkW_SetIconLocation(link, launcher, 0);
        WCHAR bin[32768]; wcscpy(bin, launcher); *wcsrchr(bin, L'\\') = 0;
        IShellLinkW_SetWorkingDirectory(link, bin);
        IPersistFile_Save(file, path, TRUE);
    }
done:
    if (store) IPropertyStore_Release(store);
    if (file) IPersistFile_Release(file);
    IShellLinkW_Release(link);
}
__declspec(dllexport) int sideleaf_identity(const WCHAR *app, const WCHAR *id, int configure) {
    launcher = app; identity = id;
    HRESULT initialized = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    HRESULT hr = SetCurrentProcessExplicitAppUserModelID(identity);
    windows_set = 0;
    if (configure) {
        EnumWindows(configure_window, 0);
        configure_shortcut(&FOLDERID_Desktop); configure_shortcut(&FOLDERID_Programs);
    }
    if (SUCCEEDED(initialized)) CoUninitialize();
    return FAILED(hr) ? -1 : windows_set;
}
