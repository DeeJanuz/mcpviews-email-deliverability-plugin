# Dev Server Management

**CRITICAL: Prevent memory exhaustion from hot reloads**

## Before Making Code Changes

1. **Check if dev server is running**: `pgrep -f "next dev" || pgrep -f "npm run dev"`
2. **Kill the dev server autonomously**: Run `pkill -f "next dev"` - do NOT ask the user, just kill it
3. **Proceed with code changes** after confirming the server is stopped
4. **Inform the user** when changes are complete so they can restart if needed

**Never make code changes while the dev server is running.**
