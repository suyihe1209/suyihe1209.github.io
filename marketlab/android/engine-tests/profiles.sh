#!/usr/bin/env sh
set -eu
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK folder}"
: "${ANDROID_JSON_JAR:?Set ANDROID_JSON_JAR to the JVM implementation com.vaadin.external.google:android-json:0.0.20131108.vaadin1}"
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
engine="$root/../app/src/main/java/cn/zijing/marketlab"
work=$(mktemp -d); trap 'rm -r "$work"' EXIT
javac -encoding UTF-8 -source 8 -target 8 -cp "$ANDROID_HOME/platforms/android-33/android.jar" -d "$work" \
 "$engine/ProviderCatalog.java" "$engine/MarketConfig.java" "$root/ProfileCheck.java"
java -ea -cp "$ANDROID_JSON_JAR:$work:$ANDROID_HOME/platforms/android-33/android.jar" cn.zijing.marketlab.ProfileCheck
