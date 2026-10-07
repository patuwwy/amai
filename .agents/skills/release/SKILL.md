---
name: release
description: >-
  Build, package, and publish a new AMAI release for Commodore Amiga (.lha) to GitHub Releases.
  Use this skill whenever the user asks to release a new version, publish a release, tag a version,
  or deploy the Amiga binaries.
---

# AMAI Release Skill

Automated workflow to prepare, validate, tag, and publish a new AMAI release for Commodore Amiga.

## Trigger & Publishing Mechanism
- Releases are triggered by creating a semantic git tag (`vX.Y.Z`) and pushing it to `origin`.
- The push triggers GitHub Actions workflow `.github/workflows/release.yml`.
- The workflow compiles standalone AmigaOS binaries (`amai`, `amai_020`, `amai_040`), packages them into `amai-vX.Y.Z.lha`, and publishes an official GitHub Release.

---

## Release Procedure Steps

When executing this skill, follow these sequential steps:

### Step 1: Pre-flight Checks (Validation)
1. **Working Tree Cleanliness**:
   Check if there are any uncommitted changes:
   ```powershell
   git status --short
   ```
   If there are modified or untracked files intended for the release, prompt the user to commit or stash them first. Do NOT tag an uncommitted working tree.

2. **Syntax and Code Verification**:
   Ensure basic Node.js syntax checks pass on critical modules:
   ```powershell
   node -c amiga/src/amai.js
   node -c amiga/src/lib/repl.js
   node -c amiga/src/lib/network.js
   node -c pc/server.js
   python -c "import tools.build_amiga; print('Builder syntax OK')"
   ```

3. **Check Current Branch and Remote**:
   Ensure we are on the main branch (e.g. `main` or `master`) and in sync with `origin`:
   ```powershell
   git status
   ```

---

### Step 2: Version Determination (Interactive)
1. Fetch latest git tags to determine the current version:
   ```powershell
   git fetch --tags
   git tag --sort=-v:refname | Select-Object -First 3
   ```
2. Determine the latest version tag (e.g., `v0.0.1`).
3. Calculate:
   - Next **patch** version (e.g. `v0.0.1` -> `v0.0.2`)
   - Next **minor** version (e.g. `v0.0.1` -> `v0.1.0`)
4. Ask the user (or confirm) which version to release:
   - Suggest the next patch version as recommended.
   - Present the minor bump and custom version write-in options.

---

### Step 3: Git Tagging & Pushing
Once the version string `vX.Y.Z` is agreed upon:
1. Verify the tag does not already exist:
   ```powershell
   git tag -l "vX.Y.Z"
   ```
2. Create an annotated git tag with release message:
   ```powershell
   git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
   ```
3. Push the tag to GitHub:
   ```powershell
   git push origin "vX.Y.Z"
   ```

---

### Step 4: Summary & Link to GitHub Actions
After successfully pushing the tag:
1. Do not block the conversation.
2. Provide direct links to the user:
   - **GitHub Actions Run**: `https://github.com/patuwwy/amai/actions/workflows/release.yml`
   - **Releases Page**: `https://github.com/patuwwy/amai/releases`
3. Remind the user that the workflow will automatically compile the standalone AmigaOS executables and create the `amai-vX.Y.Z.lha` asset.

