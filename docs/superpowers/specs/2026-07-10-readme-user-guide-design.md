# README User Guide Design

## Goal

Update `README.md` into a concise user-facing guide that accurately describes the current V1.5.0 product, explains how to install or run it on a computer, and shows the normal usage workflow.

## Scope

The README will contain only:

- Current product capabilities.
- Online and Windows desktop usage.
- Local source deployment on Windows.
- Docker deployment.
- API configuration and the normal image-generation workflow.
- Local data behavior and common operational notes that users need.

The README will not contain architecture decisions, refactoring policy, contributor rules, CI/CD publishing instructions, or internal development constraints.

## Document Structure

1. Product summary and maintainer link.
2. Current V1.5.0 highlights and complete feature overview.
3. Usage options: online version and Windows installer.
4. Local source deployment with prerequisites and exact PowerShell commands derived from `package.json`.
5. Docker deployment with the supported environment variables derived from `deploy/Dockerfile` and `deploy/nginx.conf`.
6. First-run API configuration.
7. Normal workflows for image generation, AI planning, reverse analysis, VOC import, and history management.
8. Local data and privacy notes.

## Version And Link Rules

- The release page must point to GitHub tag `v1.5.0`, verified as the latest release on 2026-07-10.
- The direct installer link will be included only after its exact asset name is verified from GitHub release metadata. If verification is unavailable, the README will link to the release page rather than guess an asset URL.
- Commands and environment variables must match repository files exactly.

## Local Development Constraints

Create `DEVELOPMENT.local.md` at the repository root for local-only engineering constraints. Add the filename to `.git/info/exclude`, not the tracked `.gitignore`, so neither the file nor an ignore-rule change is uploaded to GitHub.

The local file will state that future features should prefer independent modules, components, and state domains, with only minimal integration changes to existing large files. It will also require preserving existing visible behavior and verifying tests before completion.

## Validation

- Check all README commands against `package.json` and deployment configuration.
- Check that README version references consistently use V1.5.0.
- Verify Markdown links and section anchors syntactically.
- Confirm `DEVELOPMENT.local.md` is ignored and absent from `git status`.
- Run the existing test suite only if implementation changes extend beyond documentation; documentation-only changes require Git diff and link verification.

