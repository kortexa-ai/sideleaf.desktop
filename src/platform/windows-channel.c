#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0602
#endif
#include <windows.h>
#include <aclapi.h>
#include <shellapi.h>
#include <sddl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

// This adapter keeps the JavaScript protocol on node:net while supplying the
// Windows identity checks that a named-pipe stream does not expose. It never
// parses, stores or transforms the Sideleaf protocol or bearer value.

static int fail(int code, const WCHAR *message) {
    fwprintf(stderr, L"%ls (Windows error %lu)\n", message, GetLastError());
    return code;
}

static PSID process_user_sid(HANDLE process) {
    HANDLE token = NULL;
    DWORD needed = 0;
    if (!OpenProcessToken(process, TOKEN_QUERY, &token)) return NULL;
    GetTokenInformation(token, TokenUser, NULL, 0, &needed);
    if (!needed || GetLastError() != ERROR_INSUFFICIENT_BUFFER) { CloseHandle(token); return NULL; }
    TOKEN_USER *user = (TOKEN_USER *)LocalAlloc(LPTR, needed);
    if (!user || !GetTokenInformation(token, TokenUser, user, needed, &needed)) {
        if (user) LocalFree(user);
        CloseHandle(token);
        return NULL;
    }
    DWORD sid_bytes = GetLengthSid(user->User.Sid);
    PSID sid = LocalAlloc(LPTR, sid_bytes);
    if (!sid || !CopySid(sid_bytes, sid, user->User.Sid)) {
        if (sid) LocalFree(sid);
        sid = NULL;
    }
    LocalFree(user);
    CloseHandle(token);
    return sid;
}

static BOOL acl_is_private(PSID owner, PACL acl, PSECURITY_DESCRIPTOR descriptor, PSID current, BOOL protect) {
    SECURITY_DESCRIPTOR_CONTROL control = 0; DWORD revision = 0;
    ACL_SIZE_INFORMATION info = {0};
    BOOL valid = owner && EqualSid(owner, current) && acl && IsValidAcl(acl) &&
        GetSecurityDescriptorControl(descriptor, &control, &revision) &&
        (!protect || (control & SE_DACL_PROTECTED)) &&
        GetAclInformation(acl, &info, sizeof(info), AclSizeInformation) && info.AceCount >= 1;
    BOOL effective = FALSE, inherited_children = FALSE;
    if (valid) {
        for (DWORD i = 0; i < info.AceCount; ++i) {
            ACCESS_ALLOWED_ACE *ace = NULL;
            if (!GetAce(acl, i, (void **)&ace) || ace->Header.AceType != ACCESS_ALLOWED_ACE_TYPE ||
                !EqualSid((PSID)&ace->SidStart, current) ||
                (!((ace->Mask & GENERIC_ALL) == GENERIC_ALL) && !((ace->Mask & FILE_ALL_ACCESS) == FILE_ALL_ACCESS))) {
                valid = FALSE; break;
            }
            if (!(ace->Header.AceFlags & INHERIT_ONLY_ACE)) effective = TRUE;
            if ((ace->Header.AceFlags & (CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE)) == (CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE)) inherited_children = TRUE;
        }
    }
    return valid && effective && (!protect || inherited_children);
}

static int private_acl(const WCHAR *path, BOOL require_directory, BOOL protect) {
    DWORD attributes = GetFileAttributesW(path);
    if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
        (!!(attributes & FILE_ATTRIBUTE_DIRECTORY) != !!require_directory)) return fail(20, L"The Sideleaf channel path is unsafe");
    PSID current = process_user_sid(GetCurrentProcess());
    if (!current) return fail(21, L"Could not read the current Windows user identity");
    PSECURITY_DESCRIPTOR descriptor = NULL; PSID owner = NULL; PACL acl = NULL;
    DWORD status = GetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &owner, NULL, &acl, NULL, &descriptor);
    if (status != ERROR_SUCCESS) { SetLastError(status); LocalFree(current); return fail(22, L"Could not inspect the Sideleaf channel ACL"); }
    BOOL valid = acl_is_private(owner, acl, descriptor, current, protect);
    LocalFree(descriptor);
    LocalFree(current);
    if (!valid) { SetLastError(ERROR_ACCESS_DENIED); return fail(23, L"The Sideleaf channel ACL is not private to this Windows user"); }
    return 0;
}

static int private_handle_acl(HANDLE file) {
    PSID current = process_user_sid(GetCurrentProcess());
    if (!current) return fail(21, L"Could not read the current Windows user identity");
    PSECURITY_DESCRIPTOR descriptor = NULL; PSID owner = NULL; PACL acl = NULL;
    DWORD status = GetSecurityInfo(file, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        &owner, NULL, &acl, NULL, &descriptor);
    if (status != ERROR_SUCCESS) { SetLastError(status); LocalFree(current); return fail(22, L"Could not inspect the Sideleaf owner ACL"); }
    BOOL valid = acl_is_private(owner, acl, descriptor, current, FALSE);
    LocalFree(descriptor); LocalFree(current);
    if (!valid) { SetLastError(ERROR_ACCESS_DENIED); return fail(23, L"The Sideleaf owner ACL is not private to this Windows user"); }
    return 0;
}

__declspec(dllexport) int sideleaf_secure_directory(const WCHAR *path) {
    DWORD attributes = GetFileAttributesW(path);
    if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_DIRECTORY) || (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
        return fail(20, L"The Sideleaf channel directory is unsafe");
    }
    PSID current = process_user_sid(GetCurrentProcess());
    if (!current) return fail(21, L"Could not read the current Windows user identity");
    EXPLICIT_ACCESSW access = {0};
    access.grfAccessPermissions = GENERIC_ALL;
    access.grfAccessMode = SET_ACCESS;
    access.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
    access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    access.Trustee.TrusteeType = TRUSTEE_IS_USER;
    access.Trustee.ptstrName = (LPWSTR)current;
    PACL acl = NULL;
    DWORD status = SetEntriesInAclW(1, &access, NULL, &acl);
    if (status == ERROR_SUCCESS) status = SetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        current, NULL, acl, NULL);
    if (acl) LocalFree(acl);
    LocalFree(current);
    if (status != ERROR_SUCCESS) { SetLastError(status); return fail(22, L"Could not make the Sideleaf channel private"); }
    return private_acl(path, TRUE, TRUE);
}

static uint64_t read_process_start_ms(HANDLE process) {
    FILETIME created, exited, kernel, user;
    if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) return 0;
    ULARGE_INTEGER ticks;
    ticks.LowPart = created.dwLowDateTime;
    ticks.HighPart = created.dwHighDateTime;
    if (ticks.QuadPart < 116444736000000000ULL) return 0;
    return (ticks.QuadPart - 116444736000000000ULL) / 10000ULL;
}

__declspec(dllexport) uint64_t sideleaf_current_process_start_ms(void) {
    return read_process_start_ms(GetCurrentProcess());
}

// 0: the exact current-user process is live; 10: gone; 11: PID was reused or
// belongs to another user; 12: identity could not be established.
__declspec(dllexport) int sideleaf_process_state(DWORD pid, uint64_t expected_start_ms) {
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) return GetLastError() == ERROR_INVALID_PARAMETER ? 10 : 12;
    uint64_t actual_start_ms = read_process_start_ms(process);
    PSID current = process_user_sid(GetCurrentProcess());
    PSID owner = process_user_sid(process);
    int result = 12;
    if (actual_start_ms && current && owner) {
        result = EqualSid(current, owner) && actual_start_ms == expected_start_ms ? 0 : 11;
    }
    if (current) LocalFree(current);
    if (owner) LocalFree(owner);
    CloseHandle(process);
    return result;
}

__declspec(dllexport) int sideleaf_verify_path(const WCHAR *path, int directory, int protect) {
    return private_acl(path, directory != 0, protect != 0);
}

// Return a cheap high-resolution NTFS change fingerprint. Unlike Bun's ctime
// mapping on Windows, FILE_BASIC_INFO.ChangeTime advances for an ordinary
// write even when a writer restores LastWriteTime.
__declspec(dllexport) int sideleaf_file_key(const WCHAR *path, char *output, DWORD capacity) {
    HANDLE file = CreateFileW(path, FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | SECURITY_SQOS_PRESENT | SECURITY_ANONYMOUS, NULL);
    if (file == INVALID_HANDLE_VALUE) {
        DWORD error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) return 0;
        return -1;
    }
    FILE_BASIC_INFO basic = {0}; FILE_STANDARD_INFO standard = {0}; FILE_ID_INFO identity = {0};
    if (!GetFileInformationByHandleEx(file, FileBasicInfo, &basic, sizeof(basic)) ||
        !GetFileInformationByHandleEx(file, FileStandardInfo, &standard, sizeof(standard))) {
        CloseHandle(file); return -1;
    }
    if (!GetFileInformationByHandleEx(file, FileIdInfo, &identity, sizeof(identity))) {
        BY_HANDLE_FILE_INFORMATION fallback = {0};
        if (!GetFileInformationByHandle(file, &fallback)) { CloseHandle(file); return -1; }
        identity.VolumeSerialNumber = fallback.dwVolumeSerialNumber;
        memcpy(identity.FileId.Identifier, &fallback.nFileIndexLow, sizeof(fallback.nFileIndexLow));
        memcpy(identity.FileId.Identifier + sizeof(fallback.nFileIndexLow), &fallback.nFileIndexHigh, sizeof(fallback.nFileIndexHigh));
    }
    CloseHandle(file);
    int used = snprintf(output, capacity, "%llx:%llx:%llx:", (unsigned long long)basic.ChangeTime.QuadPart,
        (unsigned long long)basic.LastWriteTime.QuadPart,
        (unsigned long long)identity.VolumeSerialNumber);
    if (used < 0 || (DWORD)used >= capacity) return -1;
    for (DWORD i = 0; i < sizeof(identity.FileId.Identifier); ++i) {
        int next = snprintf(output + used, capacity - (DWORD)used, "%02x", identity.FileId.Identifier[i]);
        if (next != 2) return -1;
        used += next;
    }
    int next = snprintf(output + used, capacity - (DWORD)used, ":%llx:%lx",
        (unsigned long long)standard.EndOfFile.QuadPart, (unsigned long)basic.FileAttributes);
    if (next < 0 || (DWORD)(used + next) >= capacity) return -1;
    return used + next;
}

static BOOL write_all(HANDLE output, const BYTE *bytes, DWORD size) {
    while (size) {
        DWORD written = 0;
        if (!WriteFile(output, bytes, size, &written, NULL) || !written) return FALSE;
        bytes += written; size -= written;
    }
    return TRUE;
}

typedef struct {
    HANDLE pipe;
    HANDLE reader_thread;
} PipeBridge;

static DWORD WINAPI copy_input(LPVOID value) {
    PipeBridge *bridge = (PipeBridge *)value;
    BYTE buffer[64 * 1024]; DWORD read = 0;
    while (ReadFile(GetStdHandle(STD_INPUT_HANDLE), buffer, sizeof(buffer), &read, NULL) && read) {
        if (!write_all(bridge->pipe, buffer, read)) break;
    }
    // The JavaScript parent keeps stdin open through a normal receipt. EOF
    // therefore means cancellation or parent exit; interrupt the reader so a
    // long wait cannot leave this bridge orphaned.
    CancelIoEx(bridge->pipe, NULL);
    CancelSynchronousIo(bridge->reader_thread);
    return 0;
}

static int connect_pipe(const WCHAR *name, DWORD expected_pid, uint64_t expected_start_ms) {
    int process_state = sideleaf_process_state(expected_pid, expected_start_ms);
    if (process_state) { SetLastError(process_state == 10 ? ERROR_FILE_NOT_FOUND : ERROR_ACCESS_DENIED); return fail(process_state, L"The recorded Sideleaf process identity is stale or unverified"); }
    if (!WaitNamedPipeW(name, 4000) && GetLastError() != ERROR_SEM_TIMEOUT) return fail(30, L"The Sideleaf pipe is unavailable");
    HANDLE pipe = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING,
        SECURITY_SQOS_PRESENT | SECURITY_ANONYMOUS, NULL);
    if (pipe == INVALID_HANDLE_VALUE) return fail(30, L"Could not connect to the Sideleaf pipe");
    ULONG server_pid = 0;
    if (!GetNamedPipeServerProcessId(pipe, &server_pid) || server_pid != expected_pid || sideleaf_process_state(server_pid, expected_start_ms) != 0) {
        CloseHandle(pipe); SetLastError(ERROR_ACCESS_DENIED); return fail(31, L"The Sideleaf pipe server identity did not match the endpoint record");
    }
    PipeBridge bridge = { pipe, NULL };
    if (!DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(), &bridge.reader_thread,
        THREAD_TERMINATE, FALSE, 0)) { CloseHandle(pipe); return fail(32, L"Could not track the Sideleaf pipe reader"); }
    HANDLE thread = CreateThread(NULL, 0, copy_input, &bridge, 0, NULL);
    if (!thread) { CloseHandle(bridge.reader_thread); CloseHandle(pipe); return fail(32, L"Could not start the Sideleaf pipe bridge"); }
    CloseHandle(thread);
    BYTE buffer[64 * 1024]; DWORD read = 0;
    while (ReadFile(pipe, buffer, sizeof(buffer), &read, NULL) && read) {
        if (!write_all(GetStdHandle(STD_OUTPUT_HANDLE), buffer, read)) { CloseHandle(pipe); return fail(33, L"Could not return the Sideleaf response"); }
    }
    DWORD error = GetLastError();
    CloseHandle(bridge.reader_thread);
    CloseHandle(pipe);
    if (error != ERROR_BROKEN_PIPE && error != ERROR_NO_DATA) { SetLastError(error); return fail(34, L"The Sideleaf pipe closed unexpectedly"); }
    return 0;
}

static int own_file(const WCHAR *path) {
    HANDLE file = CreateFileW(path, GENERIC_READ | GENERIC_WRITE | DELETE, 0, NULL, OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_DELETE_ON_CLOSE | SECURITY_SQOS_PRESENT | SECURITY_ANONYMOUS, NULL);
    if (file == INVALID_HANDLE_VALUE) {
        DWORD error = GetLastError();
        if (error == ERROR_SHARING_VIOLATION || error == ERROR_LOCK_VIOLATION || error == ERROR_ACCESS_DENIED) return 40;
        return fail(41, L"Could not acquire the private Sideleaf owner file");
    }
    if (private_handle_acl(file) != 0) { CloseHandle(file); return 42; }
    static const char ready[] = "owned\n";
    if (!write_all(GetStdHandle(STD_OUTPUT_HANDLE), (const BYTE *)ready, sizeof(ready) - 1)) { CloseHandle(file); return 43; }
    BYTE buffer[64]; DWORD read = 0;
    while (ReadFile(GetStdHandle(STD_INPUT_HANDLE), buffer, sizeof(buffer), &read, NULL) && read) { /* Hold until the app closes stdin. */ }
    CloseHandle(file);
    return 0;
}

int wmain(void) {
    int count = 0;
    LPWSTR *args = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!args || count < 2) return 2;
    int result = 2;
    if (lstrcmpW(args[1], L"secure-directory") == 0 && count == 3) result = sideleaf_secure_directory(args[2]);
    else if (lstrcmpW(args[1], L"verify-directory") == 0 && count == 3) result = private_acl(args[2], TRUE, TRUE);
    else if (lstrcmpW(args[1], L"verify-file") == 0 && count == 3) result = private_acl(args[2], FALSE, FALSE);
    else if (lstrcmpW(args[1], L"process") == 0 && count == 4) result = sideleaf_process_state(wcstoul(args[2], NULL, 10), _wcstoui64(args[3], NULL, 10));
    else if (lstrcmpW(args[1], L"connect") == 0 && count == 5) result = connect_pipe(args[2], wcstoul(args[3], NULL, 10), _wcstoui64(args[4], NULL, 10));
    else if (lstrcmpW(args[1], L"owner") == 0 && count == 3) result = own_file(args[2]);
    LocalFree(args);
    return result;
}
