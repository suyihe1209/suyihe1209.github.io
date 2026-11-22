#!/usr/bin/env bash
set -euo pipefail
project="$(cd "$(dirname "$0")" && pwd)"
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
buildtools="$sdk/build-tools/${ANDROID_BUILD_TOOLS:-33.0.2}"
jar="$sdk/platforms/${ANDROID_PLATFORM:-android-33}/android.jar"
: "${JAVA_HOME:?请设置 JAVA_HOME（JDK 17）}"
export PATH="$JAVA_HOME/bin:$PATH"
output="${1:?请指定输出 APK 路径}"
work="$(mktemp -d "${TMPDIR:-/tmp}/minicode-apk.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/assets/www" "$work/gen" "$work/classes" "$work/dex"
cp "$project/../mini-code-editor.html" "$work/assets/www/index.html"
"$buildtools/aapt2" compile --dir "$project/res" -o "$work/res.zip"
"$buildtools/aapt2" link -o "$work/base.apk" -I "$jar" --manifest "$project/AndroidManifest.xml" -A "$work/assets" --java "$work/gen" "$work/res.zip"
find "$project/src" "$work/gen" -name '*.java' > "$work/sources"
javac --release 8 -encoding UTF-8 -classpath "$jar" -d "$work/classes" @"$work/sources"
"$JAVA_HOME/bin/jar" cf "$work/classes.jar" -C "$work/classes" .
"$buildtools/d8" --release --min-api 24 --lib "$jar" --output "$work/dex" "$work/classes.jar"
(cd "$work/dex" && /usr/bin/zip -q -j "$work/base.apk" classes*.dex)
"$buildtools/zipalign" -f 4 "$work/base.apk" "$work/aligned.apk"
if [[ -n "${MINICODE_SIGNING_FILE:-}" ]]; then
    "$buildtools/apksigner" sign --ks "$MINICODE_SIGNING_FILE" --ks-key-alias "${MINICODE_KEY_ALIAS:?}" --ks-pass env:MINICODE_STORE_PASSWORD --key-pass env:MINICODE_KEY_PASSWORD --out "$output" "$work/aligned.apk"
    "$buildtools/apksigner" verify "$output"
else
    cp "$work/aligned.apk" "$output"
    echo "已生成待签名的 APK"
fi
