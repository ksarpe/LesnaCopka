// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Granice gmin (scripts/geo/build-gminy.ts) – ładowane jako zasoby, a nie wkompilowane w bundle JS.
config.resolver.assetExts.push('geo');

module.exports = config;
