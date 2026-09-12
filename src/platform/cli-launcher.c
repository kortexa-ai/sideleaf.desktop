#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include <shellapi.h>

static WCHAR runtime[32768], script[32768], command[32768];
static DWORD used;
static STARTUPINFOEXW startup;
static PROCESS_INFORMATION child;
static JOBOBJECT_EXTENDED_LIMIT_INFORMATION jobLimit;
static void append(const WCHAR *text) {
    while (*text) { if (used >= 32766) ExitProcess(1); command[used++] = *text++; }
    command[used] = 0;
}
static BOOL isWaitCommand(void) {
    int count = 0;
    LPWSTR *arguments = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!arguments) ExitProcess(1);
    BOOL result = count > 1 && lstrcmpW(arguments[1], L"wait") == 0;
    LocalFree(arguments);
    return result;
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
    // A wait can remain blocked for two minutes, so its runtime tree must die
    // with a cancelled WSL/native wrapper. Open/no-argument commands intentionally
    // launch a desktop process that must outlive this short CLI process.
    BOOL contained = isWaitCommand();
    append(L"\""); append(runtime); append(L"\" \""); append(script); append(L"\""); append(args);
    HANDLE job = NULL;
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
    SIZE_T attributeBytes = 0;
    jobLimit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (contained) job = CreateJobObjectW(NULL, NULL);
    if (contained && (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jobLimit, sizeof(jobLimit)))) {
        if (job) CloseHandle(job);
        ExitProcess(1);
    }
    if (contained) {
        InitializeProcThreadAttributeList(NULL, 1, 0, &attributeBytes);
        if (!attributeBytes) { CloseHandle(job); ExitProcess(1); }
        attributes = HeapAlloc(GetProcessHeap(), 0, attributeBytes);
        if (!attributes) { CloseHandle(job); ExitProcess(1); }
        if (!InitializeProcThreadAttributeList(attributes, 1, 0, &attributeBytes)) {
            HeapFree(GetProcessHeap(), 0, attributes);
            CloseHandle(job); ExitProcess(1);
        }
        if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
            &job, sizeof(job), NULL, NULL)) {
            DeleteProcThreadAttributeList(attributes); HeapFree(GetProcessHeap(), 0, attributes);
            CloseHandle(job); ExitProcess(1);
        }
    }
    startup.StartupInfo.cb = contained ? sizeof(startup) : sizeof(startup.StartupInfo);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    startup.lpAttributeList = attributes;
    BOOL created = CreateProcessW(runtime, command, NULL, NULL, TRUE, contained ? EXTENDED_STARTUPINFO_PRESENT : 0,
        NULL, NULL, &startup.StartupInfo, &child);
    if (attributes) { DeleteProcThreadAttributeList(attributes); HeapFree(GetProcessHeap(), 0, attributes); }
    if (!created) {
        if (job) CloseHandle(job); ExitProcess(1);
    }
    CloseHandle(child.hThread); DWORD result = 1;
    if (WaitForSingleObject(child.hProcess, INFINITE) == WAIT_OBJECT_0) GetExitCodeProcess(child.hProcess, &result);
    CloseHandle(child.hProcess); if (job) CloseHandle(job); ExitProcess(result);
}
#else
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
    char executable[PATH_MAX], resolved[PATH_MAX], runtime[PATH_MAX], script[PATH_MAX];
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size) || !realpath(executable, resolved)) return 1;
    char *separator = strrchr(resolved, '/'); if (!separator) return 1; *separator = 0;
    if (snprintf(runtime, sizeof(runtime), "%s/cottontail", resolved) >= (int)sizeof(runtime) ||
        snprintf(script, sizeof(script), "%s/../Resources/app/cli/sideleaf.mjs", resolved) >= (int)sizeof(script)) return 1;
    char **arguments = calloc((size_t)argc + 2, sizeof(char *)); if (!arguments) return 1;
    arguments[0] = runtime; arguments[1] = script;
    for (int i = 1; i < argc; ++i) arguments[i + 1] = argv[i];
    execv(runtime, arguments); perror("Could not start Sideleaf command"); free(arguments); return 1;
}
#endif
