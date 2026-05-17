# Testing Scope Rules

**CRITICAL: Never run the full test suite. Only run targeted tests.**

## Rules

1. **Only run tests directly related to the code you changed**
   - Use pattern matching: `npm test -- "pattern" --run`
   - Example: Changed `user-service.ts`? Run `npm test -- "user-service" --run`

2. **Never run `npm test` or `npm test -- --run` without a pattern**
   - The full suite can take minutes with test containers
   - Full suite runs are done manually by the developer, not by agents

3. **Multiple related patterns are OK**
   - `npm test -- "user-service|auth" --run` to cover related areas

4. **After modifying shared code**, run tests for the immediate consumers
   - Changed a shared utility? Run tests for that utility + its direct callers
   - Do NOT run the entire test suite "just to be safe"
