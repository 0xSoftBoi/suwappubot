/**
 * Run database migrations
 * Usage: DATABASE_URL=... bun run scripts/run-migration.ts
 */

import postgres from 'postgres'
import { readFileSync } from 'fs'
import { join } from 'path'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
	console.error('❌ DATABASE_URL environment variable is required')
	process.exit(1)
}

console.log('🔗 Connecting to database...')

const sql = postgres(DATABASE_URL)

async function runMigration() {
	try {
		// Read the migration file
		const migrationPath = join(import.meta.dir, '../drizzle/0001_add_points_system.sql')
		const migrationSql = readFileSync(migrationPath, 'utf-8')

		console.log('📝 Running points system migration...')

		// Split by statement breakpoint and run each statement
		const statements = migrationSql
			.split(/;[\s]*(?=\n|$)/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0 && !s.startsWith('--'))

		for (const statement of statements) {
			if (statement.trim()) {
				try {
					await sql.unsafe(statement)
					// Log first 50 chars of statement
					const preview = statement.replace(/\s+/g, ' ').substring(0, 60)
					console.log(`  ✓ ${preview}...`)
				} catch (err: any) {
					// Ignore "already exists" errors
					if (err.message?.includes('already exists') || err.message?.includes('duplicate key')) {
						const preview = statement.replace(/\s+/g, ' ').substring(0, 60)
						console.log(`  ⏭ ${preview}... (already exists)`)
					} else {
						throw err
					}
				}
			}
		}

		console.log('\n✅ Migration completed successfully!')

		// Verify tables were created
		const tables = await sql`
			SELECT table_name
			FROM information_schema.tables
			WHERE table_schema = 'public'
			AND table_name IN ('user_points', 'point_transactions', 'milestones', 'user_milestones', 'rewards', 'point_redemptions')
			ORDER BY table_name
		`

		console.log('\n📊 Points tables in database:')
		for (const { table_name } of tables) {
			console.log(`  • ${table_name}`)
		}

		// Count seeded data
		const milestoneCount = await sql`SELECT count(*) as count FROM milestones`
		const rewardCount = await sql`SELECT count(*) as count FROM rewards`

		console.log(`\n🎯 Seeded data:`)
		console.log(`  • ${milestoneCount[0].count} milestones`)
		console.log(`  • ${rewardCount[0].count} rewards`)
	} catch (error) {
		console.error('❌ Migration failed:', error)
		process.exit(1)
	} finally {
		await sql.end()
	}
}

runMigration()
