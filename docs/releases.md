# Releases

This public repository contains only @bruchris/folio-mcp and @bruchris/fiken-mcp. The Freddy application and its Git history are private. Never push or merge a private workspace branch into this repository.

Source snapshots are reviewed before incorporation into this independent public history. Package changes accepted here must be reconciled with the development workspace before subsequent snapshots. The public root manifest and lockfile contain only the two MCP workspaces; never copy a lockfile containing private application dependencies.

## Verify

Run npm ci, npm test, npm run typecheck, npm run build, npm run test:tooling, npm run check:public and npm run check:secrets. CI performs a mandatory redacted Gitleaks scan including history. Package smoke installs real tarballs and verifies clients, help and MCP initialization without vendor networking.

The public boundary gate checks current files, staged blobs and every reachable commit. Secret scanning complements it; neither is permission to add application source under an allowed filename.

## Publish

Packages version independently. Move Unreleased notes to the version heading in each CHANGELOG.md. Tags are folio-mcp-vVERSION and fiken-mcp-vVERSION.

The manual release.yml workflow is disabled unless PUBLIC_RELEASE_ENABLED=true, the protected npm environment exists, and npm trusted publishing is configured for this exact repository, workflow and environment. New npm configurations must explicitly allow direct npm publish. Initial package registration/account access and 2FA may require the owner.

The workflow uses Node24/npm11.11.1, validates the public boundary/version/source metadata, tests and scans, rejects existing release tags, then publishes one package with provenance and creates a GitHub release. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Verify registry metadata, tarball integrity, provenance, public links and clean npx initialization after release. If npm succeeds but GitHub release creation fails, verify the published provenance and finish only the missing tag/release at the exact source SHA; do not rerun an immutable version publish.

Correct ordinary release bugs with a new version. Handle security reports privately and deprecate unsafe versions where appropriate.
