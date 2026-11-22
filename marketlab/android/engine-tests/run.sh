#!/bin/sh
set -eu
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK folder}"
: "${ANDROID_JSON_JAR:?Set ANDROID_JSON_JAR to the JVM implementation com.vaadin.external.google:android-json:0.0.20131108.vaadin1}"
: "${1:?Use live or cached}"
: "${2:?Choose a private test snapshot path outside the website}"
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
engine=$root/../app/src/main/java/cn/zijing/marketlab
work=$(mktemp -d)
trap 'rm -r "$work"' EXIT
javac -encoding UTF-8 -source 8 -target 8 -cp "$ANDROID_HOME/platforms/android-33/android.jar" -d "$work" \
  "$engine/DataTools.java" "$engine/NetAccess.java" "$engine/LiveFeeds.java" "$engine/ToolResearch.java" "$engine/ModelGateway.java" "$engine/ProviderCatalog.java" \
  "$engine/MarketConfig.java" "$engine/ResearchEngine.java" "$root/DomainCheck.java" "$root/ProviderCheck.java" "$root/ConversationCheck.java"
java -Dfile.encoding=UTF-8 -ea -cp "$ANDROID_JSON_JAR:$work" cn.zijing.marketlab.DomainCheck "$1" "$2"

java -Dfile.encoding=UTF-8 -ea -cp "$ANDROID_JSON_JAR:$work" cn.zijing.marketlab.ProviderCheck

java -Dfile.encoding=UTF-8 -ea -cp "$ANDROID_JSON_JAR:$work" cn.zijing.marketlab.ConversationCheck
