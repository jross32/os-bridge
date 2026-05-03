# Release Checklist

Use this checklist for every meaningful update.

1. Implement tool/code changes.
2. Update/add tests for new behavior.
3. Run:

```powershell
npm run verify
```

4. Bump `package.json` version.
5. Commit with structured notes:
   - Changed
   - Bugs fixed
   - Version bump
6. Push to `main`.

## New Tool Minimum

- Add metadata in `TOOLS`
- Add dispatcher case
- Add implementation function
- Add test coverage (happy path + invalid input + failure path)
