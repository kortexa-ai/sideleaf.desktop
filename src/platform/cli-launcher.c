#define WIN32_LEAN_AND_MEAN
#include <windows.h>

static WCHAR runtime[32768], script[32768], command[32768];
static DWORD used;
static void append(const WCHAR *text) {
    while (*text) { if (used >= 32766) ExitProcess(1); command[used++] = *text++; }
    command[used] = 0;
}
void WINAPI sideleafCliStart(void) {
    DWORD n = GetModuleFileNameW(NULL, runtime, 32768);
    if (!n || n >= 32768) ExitProcess(1);
    while (n && runtime[n-1] != L'\\') --n;
    runtime[n] = 0;
    lstrcpyW(script, runtime);
    lstrcatW(script, L"..\\Resources\\app\\cli\\sideleaf.mjs");
    lstrcatW(runtime, L"cottontail.exe");
    if (GetFileAttributesW(script) == INVALID_FILE_ATTRIBUTES) ExitProcess(1);
    SetEnvironmentVariableW(L"JSC_maxPerThreadStackUsage", L"134217728");
    // Keep the caller's exact argument quoting, working directory and handles.
    const WCHAR *args = GetCommandLineW();
    if (*args == L'\"') { ++args; while (*args && *args != L'\"') ++args; if (*args) ++args; }
    else while (*args && *args != L' ' && *args != L'\t') ++args;
    append(L"\""); append(runtime); append(L"\" \""); append(script); append(L"\""); append(args);
    STARTUPINFOW start = {0}; PROCESS_INFORMATION child = {0};
    start.cb = sizeof(start); start.dwFlags = STARTF_USESTDHANDLES;
    start.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    start.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    start.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    if (!CreateProcessW(runtime, command, NULL, NULL, TRUE, 0, NULL, NULL, &start, &child)) ExitProcess(1);
    CloseHandle(child.hThread); DWORD result = 1;
    if (WaitForSingleObject(child.hProcess, INFINITE) == WAIT_OBJECT_0) GetExitCodeProcess(child.hProcess, &result);
    CloseHandle(child.hProcess); ExitProcess(result);
}
