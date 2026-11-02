# QuickBoard

QuickBoard is a modern Angular application that can run as a desktop app using Electron.

## Getting Started

### Prerequisites

- Node.js (v18 or later recommended)
- npm (v9 or later recommended)
- **For Android:** Android Studio, JDK 17+
- **For iOS:** Xcode (macOS only), CocoaPods

### Install dependencies

```bash
npm install
```

### Run in Electron

Builds the Angular app and launches it in Electron:

```bash
npm run electron
```

### Development (Web)

To run the Angular app in your browser for development:

```bash
npm start
```

Then open http://localhost:4200

## Keyboard Shortcuts

Open **QuickBoard > Keyboard Shortcuts** on macOS (below About QuickBoard), or
**File > Keyboard Shortcuts** on Windows/Linux. The searchable window is read-only.
Command/Ctrl-comma opens Settings; Command/Ctrl-Home selects the first board.

Bindings live in `src/shared/shortcuts.json`. The Electron menu, renderer handlers,
canvas tools, and shortcuts window all use this registry. Customization is not yet supported.

Shortcut regression checks:

```bash
npm test -- --watch=false
node --test src/electron/menu.test.cjs
```

## Project Structure

- `src/` — Angular application source code
- `electron-main.js` — Electron main process entry point
- `preload.js` — (optional) Electron preload script

## Building for Production

### Angular Build

```bash
npm run build
```

Output will be in the `dist/` directory (used by Electron).

### Electron App Builds

Build desktop applications for distribution:

```bash
# Build for all platforms (requires platform-specific runners)
npm run electron:build

# Build for specific platforms
npm run electron:build:win    # Windows (NSIS installer + portable)
npm run electron:build:mac    # macOS (DMG + ZIP)
npm run electron:build:linux  # Linux (AppImage, DEB, RPM)
```

Builds will be output to the `release/` directory.

**Note:** To build for macOS, you need to run on macOS. For Windows builds, use Windows or Linux with Wine.

### Mobile App Builds (Android & iOS)

QuickBoard can also be built for Android tablets and iPads using Capacitor.

#### First-Time Setup

```bash
# Add Android platform
npm run cap:add:android

# Add iOS platform (macOS only)
npm run cap:add:ios
```

#### Development

```bash
# Open in Android Studio to run on device/emulator
npm run cap:open:android

# Open in Xcode to run on device/simulator (macOS only)
npm run cap:open:ios
```

#### Building for Release

```bash
# Build Android APK
npm run cap:build:android
# Output: android/app/build/outputs/apk/release/

# Build iOS (opens Xcode for final build)
npm run cap:build:ios
# Then build in Xcode: Product > Archive
```

#### Sync Changes

After making changes to your web code:

```bash
npm run cap:sync
```

This rebuilds the Angular app and syncs it to both platforms.

## Releasing

### Automated Builds with GitHub Actions

The project includes GitHub Actions workflows that automatically build apps for:

- **Desktop:** Windows, macOS, and Linux
- **Mobile:** Android tablets and iPads

#### Creating a Release

1. Update the version in `package.json`
2. Commit your changes
3. Create and push a tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
4. GitHub Actions will automatically:
   - Build for all desktop platforms (Windows, macOS, Linux)
   - Build for mobile platforms (Android APK, iOS app)
   - Create a draft release
   - Upload all build artifacts

#### Manual Workflow Trigger

You can also trigger builds manually from the GitHub Actions tab without creating a release.

**Note:** iOS builds require a paid GitHub account for macOS runners. Android builds run on free Linux runners.

## License

MIT
