#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
project_root="${script_directory:h}"
app_bundle="${project_root}/The Menyu.app"

mkdir -p "${app_bundle}/Contents/MacOS"
xcrun swiftc "${script_directory}/TheMenyuControl.swift" -o "${app_bundle}/Contents/MacOS/TheMenyu"
codesign --force --deep --sign - "${app_bundle}"
codesign --verify --deep --strict --verbose=2 "${app_bundle}"
