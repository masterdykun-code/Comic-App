module.exports = ({ config }) => {
  const demo = process.env.APP_VARIANT === 'demo';
  return {
    ...config,
    name: demo ? 'WebNovel Reader Demo' : config.name,
    plugins: [
      ...(config.plugins ?? []).filter(
        (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-build-properties',
      ),
      ['expo-build-properties', { android: { usesCleartextTraffic: demo } }],
    ],
  };
};
