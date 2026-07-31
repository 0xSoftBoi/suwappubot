module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // MUST be last. Compiles worklets so animations run on the UI thread
      // instead of round-tripping through the JS bridge.
      'react-native-reanimated/plugin',
    ],
  }
}
