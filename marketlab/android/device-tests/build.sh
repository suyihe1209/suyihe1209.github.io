#!/usr/bin/env bash
set -euo pipefail
qa="$(cd "$(dirname "$0")" && pwd)"
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
jdk="${MARKETLAB_JAVA_HOME:-/opt/homebrew/opt/zulu17/Contents/Home}"
export JAVA_HOME="$jdk"; export PATH="$jdk/bin:$PATH"
bin="$sdk/build-tools/33.0.2"
jar="$sdk/platforms/android-33/android.jar"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/marketlab-device-check.XXXXXX")"
mkdir -p "$tmp/classes" "$tmp/dex"
"$bin/aapt2" link -o "$tmp/check.apk" -I "$jar" --manifest "$qa/Manifest.xml"
"$jdk/bin/javac" --release 8 -encoding UTF-8 -classpath "$jar" -d "$tmp/classes" "$qa/Check.java" "$qa/SettingsCheck.java" "$qa/ChatCheck.java"
"$jdk/bin/jar" cf "$tmp/c.jar" -C "$tmp/classes" .
"$bin/d8" --release --min-api 26 --lib "$jar" --output "$tmp/dex" "$tmp/c.jar"
(cd "$tmp/dex" && /usr/bin/zip -q -j "$tmp/check.apk" classes*.dex)
"$bin/zipalign" -f 4 "$tmp/check.apk" "$tmp/aligned.apk"
echo "$tmp/aligned.apk"
