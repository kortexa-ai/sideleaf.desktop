#ifndef SIDELEAF_MACOS_RUNTIME_H
#define SIDELEAF_MACOS_RUNTIME_H
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

// Cottontail chooses its scratch root before evaluating application JavaScript.
// Use macOS's per-user temporary directory, independent of the caller's cwd or
// inherited TMPDIR, and keep both GUI and CLI scratch outside the signed bundle.
static int sideleafRuntimeEnvironment(void) {
    char base[PATH_MAX], root[PATH_MAX];
    size_t length = confstr(_CS_DARWIN_USER_TEMP_DIR, base, sizeof(base));
    if (length < 2 || length > sizeof(base)) return -1;
    if (snprintf(root, sizeof(root), "%s%sai.kortexa.sideleaf-runtime", base,
        base[length - 2] == '/' ? "" : "/") >= (int)sizeof(root)) return -1;
    if (mkdir(root, 0700) && errno != EEXIST) return -1;
    struct stat info;
    if (lstat(root, &info) || !S_ISDIR(info.st_mode) || info.st_uid != geteuid() ||
        (info.st_mode & 0777) != 0700) { errno = EACCES; return -1; }
    return setenv("COTTONTAIL_TMP_DIR", root, 1);
}
#endif
