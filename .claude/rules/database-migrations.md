# Database Migration Rules

**CRITICAL: These rules must ALWAYS be followed.**

## Never Apply Database Changes Directly

- **NEVER** use `prisma db push` - causes migration drift
- **NEVER** use `prisma db execute` to apply SQL directly
- **NEVER** run raw SQL against the database to add/modify schema

## Always Use Migrations

All schema changes MUST go through the migration workflow:

1. Modify `prisma/schema.prisma`
2. Create migration: `npx prisma migrate dev --name <feature_name>`
3. If `migrate dev` fails due to shadow database issues, create migration manually:
   - Create directory: `prisma/migrations/YYYYMMDDHHMMSS_<name>/`
   - Write `migration.sql` with proper SQL
   - Run `npx prisma migrate deploy` to apply
