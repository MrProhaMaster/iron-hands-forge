# Forge release policy

On 2026-10-30 the user explicitly authorised final Forge changes, Windows/Linux builds and publication of **0.5.0**. This supersedes the earlier local-only 0.4.x restriction for this release. `shared/release-policy.json` records the approved version. Further publication versions require their own user command.

Preserve historical0.4.1–0.4.6 local builds and the old-to-new mapping in `docs/version-policy.md`. Keep Windows/Linux resource payloads offline, source-backed and portable. Preserve saved IHF1 identities and private state; exclude private files and raw archives from Git and release packages.

Custom STL lens corrections are a separate visual review. Publishing Forge 0.5.0 does not approve those helmets or their lens masks. Do not integrate or publish unapproved custom helmet assets.

On 2026-10-31 the user reviewed the local Forge candidate and explicitly instructed: "Отлично, перепроверь exe и linux файлы и публикуй на github как версию 0.5.0". The local Forge review gate is complete. Recheck the Windows archive, build and verify native Linux, then publish this exact 0.5.0 release. Custom STL lens masks remain a separate, unapproved review and must stay outside this release.
