#!/usr/bin/env node
/**
 * Mac-specific packaging script using @electron/packager.
 * - On macOS 26+: uses both .icns (legacy) and the Icon Composer .icon bundle
 *   for the new dynamic/adaptive icon feature (requires Xcode 26 + actool).
 * - On macOS < 26: uses .icns only, falling back gracefully.
 * After packaging, wraps each .app in a .dmg using hdiutil.
 * Run via: npm run electron:build:mac
 */
const { packager } = require('@electron/packager');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { build, version } = require('../package.json');
const fileTypes = build.fileAssociations.map(({ ext, name, mimeType, role }) => {
  const identifier = `com.quickboard.${ext}`;

  return {
    identifier,
    name,
    mimeType,
    role,
    ext,
  };
});

function getMacOSMajorVersion() {
  const result = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout) {
    return parseInt(result.stdout.trim().split('.')[0], 10);
  }
  return 0;
}

const macOSVersion = getMacOSMajorVersion();
const supportsIconComposer = macOSVersion >= 26;

console.log(
  supportsIconComposer
    ? `macOS ${macOSVersion} — including Icon Composer (.icon) for dynamic icon support.`
    : `macOS ${macOSVersion} — using .icns only (.icon compilation requires macOS 26+).`,
);

const legacyIcon = path.join(root, 'branding', 'QuickBoard_icon_macOSLegacy.icns');
const iconComposer = path.join(root, 'branding', 'QuickBoard_icon_macOS.icon');
const icon = supportsIconComposer ? [legacyIcon, iconComposer] : legacyIcon;

packager({
  dir: root,
  out: path.join(root, 'release'),
  platform: 'darwin',
  arch: ['x64', 'arm64'],
  appBundleId: 'com.quickboard.app',
  appCategoryType: 'public.app-category.productivity',
  name: 'QuickBoard',
  icon,
  extendInfo: {
    UTExportedTypeDeclarations: fileTypes.map(({ identifier, name, mimeType, ext }) => ({
      UTTypeIdentifier: identifier,
      UTTypeDescription: name,
      UTTypeConformsTo: ['public.data'],
      UTTypeTagSpecification: {
        'public.filename-extension': [ext],
        'public.mime-type': mimeType,
      },
    })),
    CFBundleDocumentTypes: fileTypes.map(({ identifier, name, role }) => ({
      CFBundleTypeName: name,
      CFBundleTypeRole: role,
      LSHandlerRank: 'Owner',
      LSItemContentTypes: [identifier],
    })),
  },
  ignore: [
    /^\/src\/(?!electron(?:\/|$)|shared(?:\/(?:themes|shortcuts)\.json)?\/?$)/,
    /^\/branding/,
    /^\/scripts/,
    /^\/android/,
    /^\/ios/,
    /^\/build/,
    /^\/docs/,
    /^\/github-pages/,
    /^\/public/,
    /^\/release/,
    /^\/\.git/,
    /^\/angular\.json/,
    /^\/eslint\.config\.js/,
    /^\/capacitor\.config\.ts/,
    /^\/tsconfig.*\.json/,
    /^\/README\.md/,
    /^\/exportOptions\.plist/,
    /^\/patch-literallycanvas\.js/,
    /node_modules\/.cache/,
  ],
  overwrite: true,
})
  .then((appPaths) => {
    console.log('Packaged .app bundles:', appPaths.join(', '));

    // Wrap each .app bundle in a .dmg so CI artifacts match expected output.
    // appPaths entries look like: release/QuickBoard-darwin-x64
    const releaseDir = path.join(root, 'release');
    for (const appDir of appPaths) {
      const archMatch = path.basename(appDir).match(/darwin-(\w+)$/);
      if (!archMatch) continue;
      const arch = archMatch[1];
      let dmgName = `quickboard-mac-${arch}.dmg`;
      if (arch === 'arm64') {
        dmgName = 'quickboard-mac.dmg';
      } else if (arch === 'x64') {
        dmgName = 'quickboard-mac-intel.dmg';
      }
      const dmgPath = path.join(releaseDir, dmgName);
      const stagingDir = fs.mkdtempSync(path.join(releaseDir, '.quickboard-dmg-'));
      const stagedAppPath = path.join(stagingDir, 'QuickBoard.app');
      console.log(`Creating ${path.basename(dmgPath)}...`);
      try {
        execFileSync('ditto', [path.join(appDir, 'QuickBoard.app'), stagedAppPath], {
          stdio: 'inherit',
        });
        fs.symlinkSync('/Applications', path.join(stagingDir, 'Applications'));
        execFileSync(
          'hdiutil',
          ['create', '-volname', 'QuickBoard', '-srcfolder', stagingDir, '-ov', '-format', 'UDZO', dmgPath],
          { stdio: 'inherit' },
        );
        console.log(`Created ${dmgPath}`);
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    }
  })
  .catch((err) => {
    console.error('Packaging failed:', err);
    process.exit(1);
  });
