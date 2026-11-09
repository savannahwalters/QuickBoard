# QuickBoard

QuickBoard is a simple and intuitive app for storyboarding.

## Canvas selections

- Object Select selects and moves whole objects. Shift-click adds or removes objects;
  drag on empty space to select a group. Corner handles resize the selection, preserving
  proportions unless Shift is held.
  The grabber above the selection rotates strokes and groups around their shared center.
- Rectangle, circle, and lasso selectors finish on release. Polygon Select adds a vertex
  per click and finishes only when you click near the first vertex after placing at least
  three vertices. Region outlines are replaced by transform handles around the selected
  content when the tool returns to Object Select.
- Drag inside a completed region to move its contents. The first drag splits affected
  objects into separately cropped connected pieces on the same canvas layer; untouched objects remain
  editable vectors. Splitting, moving, and resizing support undo and redo.

## Getting Started: Installer

Install the [most recent version from the releases page](https://github.com/savannahwalters/QuickBoard/releases/latest/). 
QuickBoard currently releases on macOS (Apple silicon & Intel), Windows, Linux, Android, and iPadOS, **but runs best on macOS** (where it is primarily developed).

<sup><sub>Please note that iPadOS releases are currently not officially supported or published to Testflight or the App Store.</sup></sub>
<sup><sub>Please note that Intel support for macOS will be dropped with the release of macOS 28 in 2027.</sup></sub>

## Getting Started: Manual Build
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
**Note:** iOS builds require a paid GitHub account for macOS runners. Android builds run on free Linux runners.

## License

AGPLv3
