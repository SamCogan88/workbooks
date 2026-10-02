# Worksheet Platform

A Vite + React + TypeScript application for classroom worksheets, learner response capture, synthesis and a reusable builder.

## Development

```bash
npm install
npm run dev
```

## Deployment to GitHub Pages

This project is configured for static deployment from GitHub Pages and uses a hash-based router so it works reliably without server rewrites.

1. Push the project to GitHub.
2. Enable GitHub Pages using the GitHub Actions workflow in `.github/workflows/deploy.yml`.
3. Commit and push to the default branch.

## Worksheet JSON

The default worksheet is stored in `public/worksheets/ai-tool-lab.json`.

A worksheet definition has:
- metadata;
- settings;
- ordered pages;
- reusable blocks with stable IDs.

The generic player reads the JSON, which makes the AI Tool Lab an example implementation rather than a one-off hardcoded page.

## Response JSON

Responses are exported as serialisable worksheet response objects with stable block IDs and the `worksheetId` and `schemaVersion` metadata needed for synthesis and validation.

## Synthesis

The synthesis route accepts multiple group JSON response files, validates them, groups them by tool name and shows aggregate radar and quadrant summaries.

## Builder

The builder lets staff create pages and blocks, adjust page settings, and use the real worksheet player as a preview.

## Scripts

```bash
npm run dev
npm run build
npm test
```
