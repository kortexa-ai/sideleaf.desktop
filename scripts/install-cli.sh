#!/bin/sh
set -eu
# Called by the app with authorization. Only replace a Sideleaf-owned link.
source_path=$1
target=/usr/local/bin/sideleaf
if [ ! -x "$source_path" ]; then echo 'The Sideleaf command is missing. Reinstall Sideleaf.' >&2; exit 1; fi
if [ -e "$target" ] || [ -L "$target" ]; then
  if [ ! -L "$target" ]; then echo "$target already belongs to another installation." >&2; exit 1; fi
  existing=$(/usr/bin/readlink "$target")
  case $existing in */Sideleaf.app/Contents/MacOS/sideleaf|*/Sideleaf-dev.app/Contents/MacOS/sideleaf) ;; *) echo "$target already belongs to another installation." >&2; exit 1 ;; esac
fi
/bin/mkdir -p /usr/local/bin
/bin/ln -sfn "$source_path" "$target"
