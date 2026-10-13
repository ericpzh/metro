# Tripo passenger B experiment

The official `tripo-cli` is installed on this machine (0.6.1). Authentication
and API connectivity passed verification. The account has 0 available credits
and 0 frozen credits; generation is blocked until free credits are available.
No generation has been submitted and no credits have been spent.
This is an offline asset-production tool, independent of the game runtime.

`references/front.png` is the approved grey, faceless passenger supplied by the
user. Use this as the identity reference. The rejected procedural model is not
an input to Tripo. Additional views must show this same person in a consistent
pose before using multiview generation.

## Account setup

Use `.cmd` on Windows PowerShell so execution-policy changes are unnecessary:

```powershell
tripo.cmd login --region ov
tripo.cmd doctor --json
tripo.cmd balance --json
```

Complete browser sign-in yourself. Credentials are managed by the official CLI
outside this repository; do not paste an API key into chat or commit it.
Verify the account's free trial credits before generating. The user authorized
free setup only; purchasing credits or adding a subscription is outside scope.

## Prepared first generation

From the repository root, this command validates the plan locally without
uploading the reference or spending credits:

```powershell
tripo.cmd make prototypes/tripo-passenger/references/front.png --model tripo-v3.1 --param pbr=false --out prototypes/tripo-passenger/generated --name passenger-b --dry-run --json --no-open
```

The dry run passed. It plans one image-to-model call using the current v3 API.
Only remove `--dry-run` after free-credit availability is verified. The current
billing console shows paid top-ups and no free-credit claim option. Preview
and compare the resulting silhouette with the reference
before rigging or integrating it. Preserve grey colors and the blank face,
and use unlit rendering for the approved flat appearance.

Official documentation:

- https://developers.tripo3d.ai/en/docs/cli
- https://docs.tripo3d.ai/get-started/pricing.html
- https://developers.tripo3d.ai/en/pricing
