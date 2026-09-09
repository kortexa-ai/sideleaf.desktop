#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>

static WCHAR runtimePath[32768];
static WCHAR workingDirectory[32768];
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
    // Shell file-association commands do not provide a working directory.
    // Give the child the app's bin directory without mutating this process.
    for (DWORD i = 0; i < directory; ++i) workingDirectory[i] = runtimePath[i];
    workingDirectory[directory] = 0;
    const WCHAR filename[] = L"electrobun-launcher.exe";
    if (directory + sizeof(filename) / sizeof(WCHAR) > 32768) fail();
    for (DWORD i = 0; i < sizeof(filename) / sizeof(WCHAR); ++i) runtimePath[directory + i] = filename[i];

    // Cottontail .14 reserves a 128 MiB script-thread stack. Matching JSC's
    // limit to that reservation keeps VM entry/exit from repeatedly touching
    // those pages. JSC still applies the native bounds and its guard reserve.
    // Set this before the runtime starts; JSC latches it at VM creation.
    if (!SetEnvironmentVariableW(L"JSC_maxPerThreadStackUsage", L"134217728")) fail();

    // Electrobun consumes launcher arguments when starting its script runtime.
    // Carry the explicitly requested file through the environment instead. This
    // also works when WSL interoperability does not forward arbitrary env vars.
    int argumentCount = 0;
    LPWSTR *parsedArguments = CommandLineToArgvW(GetCommandLineW(), &argumentCount);
    if (!parsedArguments) fail();
    if (argumentCount == 3 && lstrcmpW(parsedArguments[1], L"--sideleaf-open") == 0) {
        if (!SetEnvironmentVariableW(L"SIDELEAF_OPEN_PATH", parsedArguments[2])) fail();
    }
    LocalFree(parsedArguments);

    const WCHAR *arguments = GetCommandLineW();
    DWORD i = 0;
    do {
        if (i >= 32768) fail();
        commandLine[i] = arguments[i];
    } while (arguments[i++]);
    AttachConsole(ATTACH_PARENT_PROCESS);
    startup.cb = sizeof(startup);
    if (!CreateProcessW(runtimePath, commandLine, NULL, NULL, TRUE, 0, NULL, workingDirectory, &startup, &child)) fail();
    CloseHandle(child.hThread);
    DWORD result = 1;
    if (WaitForSingleObject(child.hProcess, INFINITE) == WAIT_OBJECT_0) GetExitCodeProcess(child.hProcess, &result);
    CloseHandle(child.hProcess);
    ExitProcess(result);
}
