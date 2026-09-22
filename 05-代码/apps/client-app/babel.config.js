module.exports = function (api) {
  api.cache(true);
  return {
    // reanimated 插件必须在 plugins 最后
    presets: ["babel-preset-expo"],
    plugins: ["react-native-reanimated/plugin"]
  };
};
