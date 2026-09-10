#!/bin/bash
set -euo pipefail
# The app passes its Windows launcher path and invokes this in the default distro.
# No Linux JS runtime and no modifications to any other distro.
windows_command=$1
target=/usr/local/bin/sideleaf
if [[ -e "$target" || -L "$target" ]]; then
  if ! head -n 3 "$target" | grep -q '^# Sideleaf WSL command$'; then
    echo "$target already belongs to another installation." >&2; exit 1
  fi
fi
mkdir -p /usr/local/bin
temp=$(mktemp /usr/local/bin/.sideleaf.XXXXXX)
trap 'rm -f "$temp"' EXIT
{
  printf '%s\n' '#!/bin/bash' '# Sideleaf WSL command' 'set -euo pipefail'
  printf 'windows_command=%q\n' "$windows_command"
  cat <<'WRAPPER'
launcher=$(wslpath -u "$windows_command")
if [[ ! -x "$launcher" ]]; then echo 'Sideleaf is no longer installed in Windows. Reinstall Sideleaf or remove /usr/local/bin/sideleaf.' >&2; exit 1; fi
args=("$@")
# Arguments after the command are untouched except explicit filesystem paths.
if (( ${#args[@]} >= 2 )); then
  case ${args[0]} in read|comments|edit|comment-add|comment-update|comment-remove|open)
    if [[ ! ${args[1]} =~ ^[a-zA-Z]:[\\/] && ${args[1]} != \\\\* ]]; then args[1]=$(wslpath -aw "${args[1]}"); fi
    ;;
  esac
fi
for ((i=2; i<${#args[@]}; i++)); do
  case ${args[i]} in --input|--app)
    ((++i))
    if (( i<${#args[@]} )) && [[ ! ${args[i]} =~ ^[a-zA-Z]:[\\/] && ${args[i]} != \\\\* ]]; then args[i]=$(wslpath -aw "${args[i]}"); fi
    ;;
  esac
done
if [[ ${args[0]:-} == skills ]]; then
  export SIDELEAF_SKILLS_HOME="$HOME"
  case ":${WSLENV:-}:" in
    *:SIDELEAF_SKILLS_HOME/p:*) ;;
    *) export WSLENV="${WSLENV:+$WSLENV:}SIDELEAF_SKILLS_HOME/p" ;;
  esac
fi
exec "$launcher" "${args[@]}"
WRAPPER
} > "$temp"
chmod 755 "$temp"
mv -f "$temp" "$target"
