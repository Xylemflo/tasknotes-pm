# Releasing Tasknotes-PM

## Before every release

1. Update `version` in `manifest.json` and `package.json` to the same semantic version.
2. Add that version and its minimum supported Obsidian version to `versions.json`.
3. Run `pnpm release:check`.
4. Test the built plugin in a separate Obsidian test vault with TaskNotes enabled.
5. Commit the source and the resulting `main.js`.

## Publish a GitHub release

1. Create a Git tag whose name exactly matches `manifest.json`'s version, such as `0.1.0` (without a `v` prefix).
2. Create a GitHub release from that tag.
3. Attach the built `main.js`, root `manifest.json`, and `styles.css` files to the release.

## Community Directory

For the first release only, submit the repository at [community.obsidian.md](https://community.obsidian.md) after connecting the GitHub owner account. Resolve any automated review errors before the plugin becomes installable from Obsidian.
