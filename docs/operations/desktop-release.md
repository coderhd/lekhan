# Desktop packages and updates

Run the **Desktop packages** workflow to build and test macOS on Apple Silicon and Intel, Windows x64 with NSIS, and Linux x64 with AppImage. Each job builds the pinned llama.cpp sidecar on its own runner. macOS defaults to Metal. Windows and Linux default to CPU for portable packages.

The workflow uploads artifacts for review. Publish the reviewed installer and the matching update signature together.

## Authorize the desktop update channel

Generate a Tauri updater key in a protected environment with `npm exec -- tauri signer generate`. Retain the private key in the release secret store. Use the same public key across releases so existing installations can verify them.

- Set `LEKHAN_UPDATE_PUBLIC_KEY` to the contents of the public key file.
- Set `LEKHAN_UPDATE_MANIFEST_URL` to the HTTPS URL of the static update manifest for this channel.
- Set `TAURI_SIGNING_PRIVATE_KEY` and, if the key is protected, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as build secrets.

Enable **Generate update artifacts with the release signing key** when dispatching the workflow. A local release build reads the same environment and runs `npm run desktop:package`. Builds without update configuration have no update controls or background updater requests.

The release workflow is configured to use [the `latest.json` GitHub release asset](https://github.com/coderhd/lekhan/releases/latest/download/latest.json). The first published release must include that asset before installed builds can fetch it. The updater signing key and password are in GitHub Actions secrets. The password-protected recovery copy is in `~/Library/Application Support/Lekhan Release/desktop-updater.key` on the release Mac, with its password secured by the `online.lekhan.desktop.updater.signing` Keychain entry.

## Sign packages for distribution

Enable **Sign macOS and Windows packages for distribution** for a public build. For a build that will appear in the updater, enable both signing options. Leave both options off for unsigned packaging checks.

- For macOS, set the `APPLE_SIGNING_IDENTITY` variable to the full Developer ID Application identity. Set the `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` secrets to the base64 PKCS#12 export and its password. Add `APPLE_API_ISSUER`, `APPLE_API_KEY`, and `APPLE_API_PRIVATE_KEY` as secrets for App Store Connect notarization. The workflow checks the app signature, stapled ticket, and Gatekeeper assessment. [Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/)
- For Windows, set `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` to a base64 code-signing PFX and its password. The runner imports that certificate and checks that the NSIS installer carries a valid Authenticode signature with a timestamp. An issuer that keeps the private key in hardware or a signing service requires its own signing integration. [Tauri Windows signing guide](https://v2.tauri.app/distribute/sign/windows/)

## Publish a release

1. Set the new version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `package.json`, and refresh the lockfiles.
2. Build the signed artifacts and verify the installer on each supported platform.
3. Upload the signed updater package for each platform to its final HTTPS URL. The macOS package is the app archive, Windows uses the NSIS installer, and Linux uses the AppImage. Use the signatures generated alongside those exact files.
4. Publish the manifest last. Set `version`, an optional `pub_date` and `notes`, and a `platforms` entry for each available architecture. Map `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, and `linux-x86_64` to their package URL and the corresponding signature file contents.
5. Verify updates from the prior installed version on each supported platform. Verify that a modified package fails signature verification and that the vault reopens with saved notes after the restart.

The writer checks for updates at startup and offers installation of a newer version. The updater verifies the package against the build's public key and the writer asks for confirmation through its install control. The control is unavailable while local saves are pending. Close the Cloud workspace window before installing.

[Tauri updater and manifest format](https://v2.tauri.app/plugin/updater/) · [Desktop build prerequisites](https://v2.tauri.app/start/prerequisites/)
