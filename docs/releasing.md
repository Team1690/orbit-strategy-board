# Releasing the board

The tablet gets new versions of the board through [Obtainium](https://github.com/ImranR98/Obtainium), an app that watches this repo's GitHub Releases. Pushing a version tag makes GitHub Actions build a signed APK and publish it as a release, and Obtainium installs it on the tablet with no taps. The board itself never needs the internet, because everything ships inside the APK.

## Cutting a release

1. Get main up to date. The working tree has to be clean.

   ```sh
   git switch main
   git pull
   ```

2. Bump the version. Use `minor` for a normal release and `patch` for a hotfix.

   ```sh
   bun run release minor
   ```

   This bumps the version in `package.json`, commits "bumped the version to 26.8.0" and creates the tag `v26.8.0`. It doesn't push anything.

3. Push main and only that one tag.

   ```sh
   git push origin main v26.8.0
   ```

   Never use `git push --tags` or `--follow-tags`. Your clone holds upstream's `v2026.*` tags, and their commits carry upstream's own release workflow, so pushing them would start release runs here with our secrets. GitHub also starts no workflow at all when more than three tags arrive in one push.

4. Watch the run under Actions, Release (or `gh run watch`). A build takes roughly 10 to 25 minutes.

5. The release shows up on the repo's Releases page with exactly one file, `orbit-strategy-board-v26.8.0.apk`, and notes made from the merged PR titles. The tablet picks it up at its next check, or straight away if you force one (see below).

The version is the season year, then the release, then the hotfix: `26.8.0`, `26.8.1`, and `27.0.0` for next season (`bun run release major`). Minor and patch stay under 1000 because Android's versionCode is built from all three (`26.8.1` becomes `26008001`) and has to keep going up.

### What the release run checks

The run fails, and publishes nothing, when:

- the tag isn't exactly `v` plus the version in `package.json`
- the version isn't plain `major.minor.patch` with minor and patch under 1000
- one of the three signing secrets is missing
- the APK isn't signed by our release key (the `ANDROID_CERT_SHA256` repo variable)

The decoded key and the signing config are deleted at the end of every run, failed ones too.

## When a release fails

Open the failed run and read the log of the red step.

- **A hiccup**, like a download that timed out: press "Re-run failed jobs".
- **Something to fix, and the run never got to publishing**: no tablet can have this version, so you can redo it. Fix it on main, then move the tag onto the fixed commit:

  ```sh
  git push origin :refs/tags/v26.8.0
  git tag -f v26.8.0
  git push origin main v26.8.0
  ```

  If a release for that tag exists, delete it first with `gh release delete v26.8.0`.
- **The release was published**: assume a tablet already installed it. Never reuse a version a tablet may have. Fix it on main and cut a patch with `bun run release patch`. You can also delete the broken release so tablets that haven't updated yet skip it.

## Rotating the TBA or Nexus key

Both keys are compiled into the APK, and the APK is public, so anyone can read them. They're read keys for public data, so that's accepted. If one gets abused:

1. Make a new key. TBA keys are on your [TBA account page](https://www.thebluealliance.com/account) (add a new read key, delete the old one). For Nexus, press Regenerate on its API page.
2. Update the secret with `gh secret set TBA_API_KEY` or `gh secret set NEXUS_API_KEY` and paste the new key. Update your own `orbit-strategy-board.env` too.
3. Cut a release so the tablet gets a build with the new key.

## The release key

Every release is signed with one permanent key. Android only installs an update when it's signed by the same key as the installed app, and that's also what keeps every Match on the tablet across updates.

- It's a PKCS12 keystore with the alias `upload` (RSA 2048, valid until 2054). Its SHA-256 fingerprint is `9883b31ff088a4d8e71332f9606e239292781e8667d8dc70d4f5adcf2327c3b6`, which is also the `ANDROID_CERT_SHA256` repo variable.
- CI reads it from the `ANDROID_KEY_BASE64`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets. GitHub secrets can't be read back, so they aren't a backup.
- **The backups are the keystore file and its password in the team password manager, and a copy held by a mentor.**
- You never need the key on your own machine. Without `src-tauri/gen/android/keystore.properties`, release builds come out unsigned, and debug builds always use the debug key. That file is gitignored. If you ever need a signed local build, it holds `storeFile` (an absolute path), `keyAlias` and `password`.

If a signing secret is ever deleted, put it back from the backup:

```sh
base64 -i release.jks | gh secret set ANDROID_KEY_BASE64
gh secret set ANDROID_KEY_ALIAS --body upload
gh secret set ANDROID_KEY_PASSWORD
```

### If the key is lost

The board on the tablet can never be updated in place again. The only way out costs a reinstall:

1. Export a Backup from the board and copy it off the tablet.
2. Make a new key with `keytool -genkeypair -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`. Its password can't contain a backslash. Back it up, then set the three secrets and `ANDROID_CERT_SHA256` (the new SHA-256 in lowercase hex with no colons).
3. A mentor re-registers the package with the new fingerprint in the Android Developer Console.
4. Cut a release. On the tablet, uninstall the board (this wipes its Matches), put the new hash in the board's "Expected signing certificate hashes" in Obtainium, install it again through Obtainium and import the Backup.

## Setting up a new or replacement tablet

1. On a laptop, download Obtainium 1.6.17 or later from its [GitHub Releases](https://github.com/ImranR98/Obtainium/releases). Take `app-arm64-v8a-release.apk`. Check who signed it before installing:

   ```sh
   apksigner verify --print-certs app-arm64-v8a-release.apk
   ```

   The SHA-256 digest has to match the one under "Verification Info" on the [Obtainium wiki](https://wiki.obtainium.imranr.dev/). The wiki writes it in capitals with colons. `apksigner` is in the Android SDK's `build-tools` folder. Then install the APK on the tablet.
2. In Android's settings for Obtainium, allow it to install unknown apps, allow its notifications and set its battery usage to Unrestricted. Never force-stop it, or background updates stop.
3. In Obtainium's settings:
   - **GitHub personal access token**: paste a fine-grained token with public repository access and no permissions. It raises GitHub's limit from 60 to 5000 requests an hour, which matters on shared venue Wi-Fi.
   - **Background update checking interval**: 6 hours, the default.
   - **Enable background updates**: on.
   - **Disable background updates when not on Wi-Fi**: off.
   - **Disable background updates when not charging**: off. The tablet sits plugged in at full charge or at a charge limit, where the battery isn't charging, so with this on updates would never install.
4. Tap "Add app" and enter `https://github.com/Team1690/orbit-strategy-board`. Keep the defaults ("Include prereleases" off, "Fallback to older releases" on, standard version detection). Paste the release key's SHA-256 from above into "Expected signing certificate hashes", so Obtainium refuses any APK that isn't signed by our key.
5. Install the board from Obtainium. This first install shows Android's install prompt once. After that, updates are silent only while Obtainium is the app that installed the board, so never install the board over adb or from Files.
6. Have a mentor authorize the tablet (below). If the tablet replaces another one, import the last Backup.

## Authorizing a device

From 2027, a Google-certified tablet only installs apps whose package id is registered to a verified developer. The board's id, `io.github.team1690.strategyboard`, is registered on a mentor's free Limited Distribution account in the Android Developer Console. The account covers up to 20 devices.

To add a tablet, the mentor starts adding a device in the console, and the tablet generates its code by scanning the console's QR code or opening its link. The link expires after 7 days.

## Moving from the old board

This happens once. The old board (`app.strategyboard`, installed by hand) and the new one can sit side by side, and they look the same until the old one is gone.

1. In the old board, export a Backup and copy it off the tablet.
2. Set up Obtainium as above.
3. Install the new board through Obtainium.
4. Import the Backup in the new board and check that every Match and the Board Config are there.
5. Only then uninstall the old board. Uninstalling wipes its data, which is why the Backup has to be checked first.

## Forcing an update

Pull down on Obtainium's app list to check right away, then tap Update on the board. It installs silently and closes the board, so don't do it in the middle of a meeting.

## At events

Obtainium installs updates without waiting for the board to close, so a background update could close it in the middle of a strategy meeting. At an event:

- turn on "Exempt from background updates" in the board's settings in Obtainium
- updates then only show up as a notification, so install them by hand in the pit when it's safe
- turn the exemption off again after the event

## Dev builds

`bun tauri android dev` and `bun tauri android build --debug` build "Board Dev" (`io.github.team1690.strategyboard.dev`), a separate app with its own data that installs next to the real board over adb. It never takes the real id, so testing can't touch the real board's Matches, and adb installs don't need registering.

## The package id

The board is `io.github.team1690.strategyboard`, not upstream's `app.strategyboard`. When merging upstream, never let the id go back to upstream's: not in `src-tauri/tauri.conf.json`, the Android `namespace` and `applicationId`, or the Kotlin path `io/github/team1690/strategyboard`. The tablet would see it as a different app, and moving back would mean an uninstall that wipes its Matches.
