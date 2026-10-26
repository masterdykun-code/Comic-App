const configureApp = jest.requireActual('../app.config.js');
const baseApp = jest.requireActual('../app.json').expo;
const eas = jest.requireActual('../eas.json');
const originalVariant = process.env.APP_VARIANT;
test('EAS archive excludes local secrets and signing files but keeps application sources', () => {
  const ignore = jest.requireActual('ignore');
  const fs = jest.requireActual('node:fs');
  const path = jest.requireActual('node:path');
  const cwd = jest.requireActual('node:process').cwd();
  const rules = ignore().add(fs.readFileSync(path.join(cwd, '.easignore'), 'utf8'));
  for (const file of [
    '.env',
    '.env.local',
    '.env.integration',
    'credentials.json',
    'release.keystore',
    'release.jks',
    '.expo/dev/logs/start.log',
    'tests/fixtures.ts',
    'scripts/demo/cli.cjs',
    'dist/metadata.json',
  ])
    expect(rules.ignores(file)).toBe(true);
  for (const file of [
    'app.json',
    'app.config.js',
    'eas.json',
    'package.json',
    'package-lock.json',
    'src/app/_layout.tsx',
    'assets/book-icon.png',
  ])
    expect(rules.ignores(file)).toBe(false);
});
afterEach(() => {
  if (originalVariant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = originalVariant;
});
test('preview APK embeds the approved public API URL and uses a standalone release build', () => {
  const profile = eas.build['preview-apk'];
  expect(profile).toMatchObject({
    distribution: 'internal',
    developmentClient: false,
    android: { buildType: 'apk' },
  });
  expect(profile.env).toEqual({
    APP_VARIANT: 'demo',
    EXPO_PUBLIC_API_BASE_URL: 'http://192.168.1.43:4001/api',
  });
  expect(profile.android.gradleCommand).toBeUndefined();
});
test.each([undefined, 'production', 'preview'])(
  'cleartext stays off by default for variant %s',
  (variant) => {
    if (variant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = variant;
    const config = configureApp({ config: baseApp });
    expect(config.plugins.at(-1)).toEqual([
      'expo-build-properties',
      { android: { usesCleartextTraffic: false } },
    ]);
    expect(config.name).toBe('WebNovel Reader');
  },
);
test('demo enables HTTP and preserves Android identity, native plugins and EAS project linkage', () => {
  process.env.APP_VARIANT = eas.build['preview-apk'].env.APP_VARIANT;
  const config = configureApp({
    config: {
      ...baseApp,
      extra: { eas: { projectId: 'placeholder-test-only' } },
      plugins: [...baseApp.plugins, 'expo-build-properties'],
    },
  });
  expect(config.android.package).toBe('com.webnovel.reader.demo');
  expect(config.android.versionCode).toBe(1);
  expect(config.name).toBe('WebNovel Reader Demo');
  expect(config.extra.eas.projectId).toBe('placeholder-test-only');
  expect(
    config.plugins.filter(
      (p: string | [string, object]) => (Array.isArray(p) ? p[0] : p) === 'expo-build-properties',
    ),
  ).toHaveLength(1);
  expect(config.plugins).toEqual(expect.arrayContaining(['expo-router', 'expo-secure-store']));
  expect(config.plugins.at(-1)).toEqual([
    'expo-build-properties',
    { android: { usesCleartextTraffic: true } },
  ]);
  expect(baseApp.name).toBe('WebNovel Reader');
});
