#define WIN32_LEAN_AND_MEAN
#include <windows.h>

static WCHAR runtimePath[32768];
static WCHAR commandLine[32768];
static STARTUPINFOW startup;
static PROCESS_INFORMATION child;

static void fail(void) {
    MessageBoxW(NULL, L"Sideleaf could not start its desktop runtime.", L"Sideleaf", MB_OK | MB_ICONERROR);
    ExitProcess(1);
}

void WINAPI sideleafStart(void) {
    DWORD length = GetModuleFileNameW(NULL, runtimePath, 32768);
    if (!length || length >= 32768) fail();
    DWORD directory = length;
    while (directory && runtimePath[directory - 1] != L'\\') --directory;
    if (!directory) fail();
    const WCHAR filename[] = L"electrobun-launcher.exe";
    if (directory + sizeof(filename) / sizeof(WCHAR) > 32768) fail();
    for (DWORD i = 0; i < sizeof(filename) / sizeof(WCHAR); ++i) runtimePath[directory + i] = filename[i];

    // Cottontail .14 reserves a 128 MiB script-thread stack. Matching JSC's
    // limit to that reservation keeps VM entry/exit from repeatedly touching
    // those pages. JSC still applies the native bounds and its guard reserve.
    // Set this before the runtime starts; JSC latches it at VM creation.
    if (!SetEnvironmentVariableW(L"JSC_maxPerThreadStackUsage", L"134217728")) fail();

    const WCHAR *arguments = GetCommandLineW();
    DWORD i = 0;
    do {
        if (i >= 32768) fail();
        commandLine[i] = arguments[i];
    } while (arguments[i++]);
    AttachConsole(ATTACH_PARENT_PROCESS);
    startup.cb = sizeof(startup);
    if (!CreateProcessW(runtimePath, commandLine, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &child)) fail();
    CloseHandle(child.hThread);
    DWORD result = 1;
    if (WaitForSingleObject(child.hProcess, INFINITE) == WAIT_OBJECT_0) GetExitCodeProcess(child.hProcess, &result);
    CloseHandle(child.hProcess);
    ExitProcess(result);
}
