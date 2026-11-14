# TMS Wizard mobile builds

The app opens the existing Driver and Warehouse workspaces. TMS account roles
still determine which workspace the user can access. During testing, copy the
newest magic link from email and paste it into the workspace's sign-in form.

Builds are available from the **TMS mobile build** GitHub Actions workflow on a
mobile pull request, or by starting the workflow manually.

- Android uses a Trusted Web Activity launched from the native workspace picker.
  The workflow builds a debug APK and an unsigned release bundle. Local builds
  use JDK 17, Gradle 8.13 and Android SDK 36 from `mobile/android`.
- iOS uses a SwiftUI workspace picker and an embedded WebKit view. On macOS,
  install XcodeGen and use Xcode 26. Run `xcodegen generate` in `mobile/ios`
  and open `TMSWizard.xcodeproj`. The workflow builds for the iOS Simulator.

## Device testing and distribution

1. For Android fullscreen mode, publish a Digital Asset Links statement at
   `https://tmswizard.cloud/.well-known/assetlinks.json` for
   `cloud.tmswizard.mobile` and the signing certificate's SHA-256 fingerprint.
   Use the certificate of the APK installed on the phone. For Google Play
   builds, use the Play App Signing certificate. Until verified, Android shows
   the site in a Custom Tab.
2. For iPhone testing, select the TMS Apple Developer team in Xcode, register
   `cloud.tmswizard.mobile` and sign a device build for TestFlight.
3. On both phones, test sign-in, switching Driver and Warehouse, camera
   scanning, photo upload, and driver GPS. Test the Driver app's offline reopen
   and upload retry on each platform.
