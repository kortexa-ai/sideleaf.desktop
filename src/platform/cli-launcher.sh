#!/bin/sh
# Follow the installed command link to the app, so app updates update the CLI too.
set -eu
command_path=$0
while [ -L "$command_path" ]; do
  directory=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$command_path")" && pwd)
  link=$(/usr/bin/readlink "$command_path")
  case $link in /*) command_path=$link ;; *) command_path=$directory/$link ;; esac
done
directory=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$command_path")" && pwd)
exec "$directory/cottontail" "$directory/../Resources/app/cli/sideleaf.mjs" "$@"
