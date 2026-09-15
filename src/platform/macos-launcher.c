#include <mach-o/dyld.h>
#include <string.h>
#include "macos-runtime.h"

int main(int argc, char **argv) {
    (void)argc;
    char executable[PATH_MAX], resolved[PATH_MAX], launcher[PATH_MAX];
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size) || !realpath(executable, resolved)) return 1;
    char *separator = strrchr(resolved, '/'); if (!separator) return 1; *separator = 0;
    if (snprintf(launcher, sizeof(launcher), "%s/electrobun-launcher", resolved) >= (int)sizeof(launcher)) return 1;
    if (sideleafRuntimeEnvironment()) { perror("Could not prepare Sideleaf runtime scratch"); return 1; }
    // Preserve PID, arguments, cwd and inherited handles for native open events.
    argv[0] = launcher;
    execv(launcher, argv); perror("Could not start Sideleaf"); return 1;
}
