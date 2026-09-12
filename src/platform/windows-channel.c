#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0602
#endif
#include <windows.h>
#include <aclapi.h>
#include <shellapi.h>
#include <sddl.h>
#include <winioctl.h>
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
                !EqualSid((PSID)&ace->SidStart, current)) {
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

static DWORD current_user_acl(PSID current, DWORD inheritance, PACL *acl) {
    EXPLICIT_ACCESSW access = {0};
    access.grfAccessPermissions = GENERIC_ALL;
    access.grfAccessMode = SET_ACCESS;
    access.grfInheritance = inheritance;
    access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    access.Trustee.TrusteeType = TRUSTEE_IS_USER;
    access.Trustee.ptstrName = (LPWSTR)current;
    return SetEntriesInAclW(1, &access, NULL, acl);
}

__declspec(dllexport) int sideleaf_secure_directory(const WCHAR *path) {
    DWORD attributes = GetFileAttributesW(path);
    if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_DIRECTORY) || (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
        return fail(20, L"The Sideleaf channel directory is unsafe");
    }
    PSID current = process_user_sid(GetCurrentProcess());
    if (!current) return fail(21, L"Could not read the current Windows user identity");
    PACL acl = NULL;
    DWORD status = current_user_acl(current, SUB_CONTAINERS_AND_OBJECTS_INHERIT, &acl);
    if (status == ERROR_SUCCESS) status = SetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        current, NULL, acl, NULL);
    if (acl) LocalFree(acl);
    LocalFree(current);
    if (status != ERROR_SUCCESS) { SetLastError(status); return fail(22, L"Could not make the Sideleaf channel private"); }
    return private_acl(path, TRUE, TRUE);
}

__declspec(dllexport) int sideleaf_secure_file(const WCHAR *path) {
    DWORD attributes = GetFileAttributesW(path);
    if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))) {
        return fail(20, L"The Sideleaf channel file is unsafe");
    }
    PSID current = process_user_sid(GetCurrentProcess());
    if (!current) return fail(21, L"Could not read the current Windows user identity");
    PACL acl = NULL;
    DWORD status = current_user_acl(current, NO_INHERITANCE, &acl);
    if (status == ERROR_SUCCESS) status = SetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        current, NULL, acl, NULL);
    if (acl) LocalFree(acl);
    LocalFree(current);
    if (status != ERROR_SUCCESS) { SetLastError(status); return fail(22, L"Could not make the Sideleaf channel file private"); }
    return private_acl(path, FALSE, FALSE);
}

static int secure_handle(HANDLE file) {
    PSID current = process_user_sid(GetCurrentProcess());
    if (!current) return fail(21, L"Could not read the current Windows user identity");
    PACL acl = NULL;
    DWORD status = current_user_acl(current, NO_INHERITANCE, &acl);
    if (status == ERROR_SUCCESS) status = SetSecurityInfo(file, SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        current, NULL, acl, NULL);
    if (acl) LocalFree(acl);
    LocalFree(current);
    if (status != ERROR_SUCCESS) { SetLastError(status); return fail(22, L"Could not make the Sideleaf owner file private"); }
    return private_handle_acl(file);
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
    if (actual_start_ms && actual_start_ms != expected_start_ms) {
        CloseHandle(process);
        return 11;
    }
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

// Return a cheap Windows change fingerprint. NTFS's per-file USN catches
// several changes inside one system-clock tick; redirectors that do not expose
// it retain change/write times and stable file identity without failing open.
__declspec(dllexport) int sideleaf_file_key(const WCHAR *path, char *output, DWORD capacity) {
    HANDLE file = CreateFileW(path, GENERIC_READ,
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
    uint64_t usn = 0;
    BYTE usn_record[512] = {0}; DWORD usn_bytes = 0;
    if (DeviceIoControl(file, FSCTL_READ_FILE_USN_DATA, NULL, 0, usn_record, sizeof(usn_record), &usn_bytes, NULL) && usn_bytes >= 32) {
        USHORT major = 0;
        memcpy(&major, usn_record + 4, sizeof(major));
        DWORD offset = major >= 3 ? 40 : 24;
        if (usn_bytes >= offset + sizeof(usn)) memcpy(&usn, usn_record + offset, sizeof(usn));
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
    int next = snprintf(output + used, capacity - (DWORD)used, ":%llx:%lx:%llx",
        (unsigned long long)standard.EndOfFile.QuadPart, (unsigned long)basic.FileAttributes,
        (unsigned long long)usn);
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

static BOOL pipe_io(HANDLE pipe, BOOL writing, BYTE *bytes, DWORD size, DWORD *transferred) {
    OVERLAPPED operation = {0};
    operation.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!operation.hEvent) return FALSE;
    BOOL started = writing
        ? WriteFile(pipe, bytes, size, transferred, &operation)
        : ReadFile(pipe, bytes, size, transferred, &operation);
    if (!started && GetLastError() == ERROR_IO_PENDING) {
        started = WaitForSingleObject(operation.hEvent, INFINITE) == WAIT_OBJECT_0 &&
            GetOverlappedResult(pipe, &operation, transferred, FALSE);
    }
    DWORD error = started ? ERROR_SUCCESS : GetLastError();
    CloseHandle(operation.hEvent);
    if (!started) SetLastError(error);
    return started;
}

static BOOL write_pipe_all(HANDLE pipe, BYTE *bytes, DWORD size) {
    while (size) {
        DWORD written = 0;
        if (!pipe_io(pipe, TRUE, bytes, size, &written) || !written) return FALSE;
        bytes += written; size -= written;
    }
    return TRUE;
}

typedef struct {
    HANDLE pipe;
} PipeBridge;

static DWORD WINAPI copy_input(LPVOID value) {
    PipeBridge *bridge = (PipeBridge *)value;
    BYTE buffer[64 * 1024]; DWORD read = 0;
    while (ReadFile(GetStdHandle(STD_INPUT_HANDLE), buffer, sizeof(buffer), &read, NULL) && read) {
        if (!write_pipe_all(bridge->pipe, buffer, read)) break;
    }
    // The JavaScript parent keeps stdin open through a normal receipt. EOF
    // therefore means cancellation or parent exit. This process is solely a
    // byte bridge, so exiting here also cancels a main-thread pipe read without
    // a race between cancellation and the start of that read.
    ExitProcess(0);
}

static int connect_pipe(const WCHAR *name, DWORD expected_pid, uint64_t expected_start_ms) {
    int process_state = sideleaf_process_state(expected_pid, expected_start_ms);
    if (process_state) { SetLastError(process_state == 10 ? ERROR_FILE_NOT_FOUND : ERROR_ACCESS_DENIED); return fail(process_state, L"The recorded Sideleaf process identity is stale or unverified"); }
    if (!WaitNamedPipeW(name, 4000) && GetLastError() != ERROR_SEM_TIMEOUT) return fail(30, L"The Sideleaf pipe is unavailable");
    HANDLE pipe = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING,
        FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_ANONYMOUS, NULL);
    if (pipe == INVALID_HANDLE_VALUE) return fail(30, L"Could not connect to the Sideleaf pipe");
    ULONG server_pid = 0;
    if (!GetNamedPipeServerProcessId(pipe, &server_pid) || server_pid != expected_pid || sideleaf_process_state(server_pid, expected_start_ms) != 0) {
        CloseHandle(pipe); SetLastError(ERROR_ACCESS_DENIED); return fail(31, L"The Sideleaf pipe server identity did not match the endpoint record");
    }
    PipeBridge bridge = { pipe };
    HANDLE thread = CreateThread(NULL, 0, copy_input, &bridge, 0, NULL);
    if (!thread) { CloseHandle(pipe); return fail(32, L"Could not start the Sideleaf pipe bridge"); }
    CloseHandle(thread);
    BYTE buffer[64 * 1024]; DWORD read = 0;
    while (pipe_io(pipe, FALSE, buffer, sizeof(buffer), &read) && read) {
        if (!write_all(GetStdHandle(STD_OUTPUT_HANDLE), buffer, read)) { CloseHandle(pipe); return fail(33, L"Could not return the Sideleaf response"); }
    }
    DWORD error = GetLastError();
    CloseHandle(pipe);
    if (error != ERROR_BROKEN_PIPE && error != ERROR_NO_DATA) { SetLastError(error); return fail(34, L"The Sideleaf pipe closed unexpectedly"); }
    return 0;
}

__declspec(dllexport) int sideleaf_acquire_owner(const WCHAR *path, uint64_t *owner_handle) {
    if (!owner_handle) return 41;
    *owner_handle = 0;
    HANDLE file = CreateFileW(path, GENERIC_READ | GENERIC_WRITE | DELETE | WRITE_DAC | WRITE_OWNER, 0, NULL, OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_DELETE_ON_CLOSE | SECURITY_SQOS_PRESENT | SECURITY_ANONYMOUS, NULL);
    if (file == INVALID_HANDLE_VALUE) {
        DWORD error = GetLastError();
        if (error == ERROR_SHARING_VIOLATION || error == ERROR_LOCK_VIOLATION || error == ERROR_ACCESS_DENIED) return 40;
        return fail(41, L"Could not acquire the private Sideleaf owner file");
    }
    if (secure_handle(file) != 0) { CloseHandle(file); return 42; }
    *owner_handle = (uint64_t)(uintptr_t)file;
    return 0;
}

__declspec(dllexport) int sideleaf_release_owner(uint64_t owner_handle) {
    if (!owner_handle) return 0;
    return CloseHandle((HANDLE)(uintptr_t)owner_handle) ? 0 : 1;
}

int wmain(void) {
    int count = 0;
    LPWSTR *args = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!args || count < 2) return 2;
    int result = 2;
    if (lstrcmpW(args[1], L"secure-directory") == 0 && count == 3) result = sideleaf_secure_directory(args[2]);
    else if (lstrcmpW(args[1], L"verify-directory") == 0 && count == 3) result = private_acl(args[2], TRUE, TRUE);
    else if (lstrcmpW(args[1], L"verify-file") == 0 && count == 3) result = private_acl(args[2], FALSE, FALSE);
    else if (lstrcmpW(args[1], L"file-key") == 0 && count == 3) {
        char output[160];
        result = sideleaf_file_key(args[2], output, sizeof(output));
        if (result > 0) {
            BOOL written = write_all(GetStdHandle(STD_OUTPUT_HANDLE), (const BYTE *)output, (DWORD)result) &&
                write_all(GetStdHandle(STD_OUTPUT_HANDLE), (const BYTE *)"\n", 1);
            result = written ? 0 : 50;
        } else {
            result = result == 0 ? 10 : 50;
        }
    }
    else if (lstrcmpW(args[1], L"process") == 0 && count == 4) result = sideleaf_process_state(wcstoul(args[2], NULL, 10), _wcstoui64(args[3], NULL, 10));
    else if (lstrcmpW(args[1], L"connect") == 0 && count == 5) result = connect_pipe(args[2], wcstoul(args[3], NULL, 10), _wcstoui64(args[4], NULL, 10));
    LocalFree(args);
    return result;
}
