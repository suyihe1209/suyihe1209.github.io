#!/usr/bin/env bash
set -euo pipefail
project="$(cd "$(dirname "$0")" && pwd)"
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
jdk="${MARKETLAB_JAVA_HOME:-/opt/homebrew/opt/zulu17/Contents/Home}"
tools="$sdk/build-tools/33.0.2"
jar="$sdk/platforms/android-33/android.jar"
export JAVA_HOME="$jdk"
export PATH="$jdk/bin:$PATH"
if [[ ${1:-} == --sign ]]; then
  exec python3 "$project/tools/sign.py" "${2:?missing aligned APK}" "$project/../downloads/MarketLab-Android.apk" "$jdk/bin/keytool" "$tools/apksigner"
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/marketlab-android-build.XXXXXX")"
mkdir -p "$work/assets" "$work/gen" "$work/classes" "$work/dex"
python3 "$project/tools/assets.py" "$work/assets"
"$tools/aapt2" compile --dir "$project/app/src/main/res" -o "$work/res.zip"
"$tools/aapt2" link -o "$work/package.apk" -I "$jar" --manifest "$project/app/src/main/AndroidManifest.xml" \
  -A "$work/assets" --java "$work/gen" "$work/res.zip"
find "$project/app/src/main/java" "$work/gen" -name '*.java' > "$work/sources"
"$jdk/bin/javac" --release 8 -encoding UTF-8 -classpath "$jar" -d "$work/classes" @"$work/sources"
"$jdk/bin/jar" cf "$work/classes.jar" -C "$work/classes" .
"$tools/d8" --release --min-api 26 --lib "$jar" --output "$work/dex" "$work/classes.jar"
(cd "$work/dex" && /usr/bin/zip -q -j "$work/package.apk" classes*.dex)
"$tools/zipalign" -f 4 "$work/package.apk" "$work/aligned.apk"
echo "Aligned APK: $work/aligned.apk"
if [[ ${1:-} != --unsigned ]]; then "$project/build.sh" --sign "$work/aligned.apk"; fi
