# Windows desktop distribution and trust

The current public Windows artifacts are unsigned. That is the direct cause of the blue
**Windows protected your PC** SmartScreen surface with **More info / Run anyway**, and it is also
the most likely reason a low-prevalence release was blocked by McAfee. This is reputation behavior,
not evidence that the installer asked for administrator access: VOLTMARCH is a per-user NSIS install,
runs at `asInvoker`, and requests no elevation.

Do not tell players that the portable executable bypasses SmartScreen. It avoids installation, but
the portable `.exe` has its own signature and file-hash reputation and can be challenged or blocked
independently.

## What code can and cannot fix

The release pipeline now provides these verifiable signals for every Windows build:

- deterministic installer and portable names;
- SHA-256 hashes in `SHA256SUMS.txt`;
- a GitHub build-provenance attestation over both executables, the updater manifest/blockmap and the
  checksum file;
- an Authenticode gate that fails the release if signing credentials were configured but either
  executable is not validly signed;
- a standard per-user, `asInvoker` NSIS installer and an ASAR-packaged application payload;
- stable product, executable, company, copyright, application-ID and version-resource metadata.

These measures make origin and tampering independently checkable. They do **not** create SmartScreen
publisher reputation and do not override an antivirus verdict. GitHub explicitly warns that a build
attestation proves provenance, not that a binary is safe.

Microsoft's current SmartScreen guidance is precise:

- unsigned and self-signed applications receive the unrecognized-app warning;
- an unsigned application's reputation starts again for every changed file hash;
- a trusted OV or EV signature displays a verified publisher and lets publisher reputation carry
  across consistently signed releases, but even a new signed binary can be warned on initially;
- EV certificates no longer receive an automatic SmartScreen bypass;
- Microsoft Store distribution is the only documented path that avoids SmartScreen download warnings
  from the first install.

Sources: [Microsoft SmartScreen reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation),
[electron-builder Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/),
and [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations).

## Signing path

Never commit a PFX, password, private key, signing token or Azure credential. When the owner chooses
a verified publisher identity, store a trusted certificate in the release repository's Actions
secrets as:

- `WIN_CSC_LINK` — the PFX file as a GitHub-supported encrypted secret value or a protected secret URL;
- `WIN_CSC_KEY_PASSWORD` — the certificate password.

The existing electron-builder release command discovers those variables and signs the application,
portable executable, installer and uninstaller. The workflow checks both player-facing executables
with `Get-AuthenticodeSignature` and stops if either is not `Valid`.

Microsoft Artifact Signing is the preferred cloud alternative for distribution outside the Store,
but adopting it requires an owner-approved Azure tenant, identity validation, eligible region,
publisher subject and paid plan. Do not invent those values in YAML. Once provisioned, configure
electron-builder's `win.sign` Azure backend with the validated endpoint, account, profile and exact
certificate subject, using federated CI credentials rather than a tracked key.

Use one signing identity for consecutive releases. Changing identities discards the publisher signal
the certificate was meant to accumulate. Timestamp every signature through the builder's RFC 3161
path so signatures remain valid after certificate expiry.

## Release verification

For a downloaded release, compare the SHA-256 digest with the release's `SHA256SUMS.txt`, then verify
the workflow provenance:

```powershell
Get-FileHash .\VOLTMARCH-Setup-X.Y.Z.exe -Algorithm SHA256
gh attestation verify .\VOLTMARCH-Setup-X.Y.Z.exe -R avihaymenahem/voltmarch
Get-AuthenticodeSignature .\VOLTMARCH-Setup-X.Y.Z.exe | Format-List Status,SignerCertificate
```

For an unsigned release, `NotSigned` is the expected final line; never present it as signed or ask a
tester to disable antivirus. For a signed release, anything other than `Valid` blocks publication.

## False-positive response

Record the exact product, engine/definition version, detection name, affected artifact name, release
URL and SHA-256. A screenshot saying only “McAfee blocked it” is not enough to distinguish malware
detection, potentially-unwanted-app classification and reputation blocking.

Submit the installer **and its extracted application contents** through McAfee's official
[Detection Dispute & Allowlisting form](https://www.mcafee.com/en-us/consumer-support/dispute-detection-allowlisting.html).
McAfee explicitly asks software vendors for both when an installer is involved. If Microsoft Defender
reports a malware verdict rather than the ordinary SmartScreen reputation prompt, submit the file as
a software developer through the [Microsoft Security Intelligence submission portal](https://www.microsoft.com/wdsi/filesubmission).

Do not create blanket antivirus exclusions or tell testers to turn protection off. Early testers may
choose **Run anyway** only after verifying the GitHub release source and digest themselves; enterprise
policy may intentionally remove that choice.
