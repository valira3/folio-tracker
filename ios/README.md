# Folio iOS App

Native iOS wrapper for the Folio Portfolio Tracker web app, built with SwiftUI and WKWebView.

## Quick Start

1. **Open in Xcode**: Double-click `Folio.xcodeproj`
2. **Set your Team**: Go to Signing & Capabilities → select your Apple Developer team
3. **Set your Bundle ID**: Change `com.folio.tracker` to something unique (e.g. `com.yourname.folio`)
4. **Configure the backend URL**:
   - Open `Folio/WebViewController.swift`
   - Set `AppConfig.serverURL` to your deployed backend URL:
     ```swift
     static let serverURL: String? = "https://folio-tracker-production.up.railway.app"
     ```
   - Or leave as `nil` to use the bundled web files (requires local web files in `Folio/WebApp/`)
5. **Run on Simulator or Device**: Select your target and hit ⌘R

## Project Structure

```
ios/
├── Folio.xcodeproj/          # Xcode project file
├── Folio/
│   ├── FolioApp.swift         # App entry point (SwiftUI lifecycle)
│   ├── WebViewController.swift # WKWebView controller with native features
│   ├── NetworkMonitor.swift    # Network connectivity monitoring
│   ├── Info.plist              # App configuration
│   ├── LaunchScreen.storyboard # Splash screen
│   ├── Assets.xcassets/        # App icons, accent color
│   └── WebApp/                 # Bundled web app files (copy from root)
│       └── README.md           # Instructions for copying web files
```

## Features

- **WKWebView** with full JavaScript support
- **Pull-to-refresh** for manual data reload
- **Network monitoring** with offline state handling
- **JS → Swift bridge** for haptic feedback
- **Safe area handling** for notch/Dynamic Island
- **Dark mode** launch screen matching the app theme
- **Native alerts/confirms** for JavaScript dialogs
- **External link handling** (opens Safari)

## Two Modes of Operation

### Server Mode (Recommended for Production)
Set `AppConfig.serverURL` to your backend URL. The app loads everything from the server, giving you instant updates without App Store resubmission.

### Bundled Mode (Offline Capable)
Set `AppConfig.serverURL = nil`. The app loads from the bundled `Folio/WebApp/` files. Copy the latest web files from the root project first.

## Generating App Icon

You need a 1024x1024 PNG for the App Store icon. Place it in:
`Folio/Assets.xcassets/AppIcon.appiconset/`

Update the `Contents.json` to reference the filename.

## Requirements

- Xcode 15.2+
- iOS 16.0+
- Swift 5
- Apple Developer account (for device testing and App Store submission)

## App Store Deployment

See the App Store Deployment Guide PDF for a comprehensive 15-page walkthrough covering:
- Apple Developer Program enrollment
- Certificates and provisioning profiles
- App Store Connect setup
- TestFlight beta testing
- App Review guidelines
- Submission process
