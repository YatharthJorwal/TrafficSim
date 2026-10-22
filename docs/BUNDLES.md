# Bundles

A bundle is one zip containing only new and changed files at their repo-relative paths, plus an optional
`BUNDLE.json` manifest (name, description, commitMessage, `delete` list). It is applied on top of your repo.

## Apply (from the repo root, PowerShell)
```
git status
npm run apply -- $HOME\Downloads\trafficsim-m3-bundle.zip
```
`git status` must be clean first (commit or stash anything else). The tool:
1. prints each file as added (+), changed (~) or deleted (-), and skips identical files
2. writes the files, runs `npm install` only if `package.json` / `package-lock.json` changed
3. runs `npm test`
4. shows `git status --short` and the commit commands to run

Preview without writing:
```
npm run apply -- $HOME\Downloads\trafficsim-m3-bundle.zip --dry-run
```

## Commit
```
git add .
git commit -m "M3: detectors and 3D scene"
git push
```

## Undo a bundle you have not committed
```
git checkout .
git clean -fd
```

## Notes
- The tool never writes outside the repo, or into `.git/` or `node_modules/`.
- `--no-test` skips the test run; `--force` skips the clean-tree check. Avoid both.
- The very first bundle (M2) predates the tool, so it is applied by extracting the zip over the project. See the delivery message.
