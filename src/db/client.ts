import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL must be set')

export const sql = postgres(DATABASE_URL, { ssl: 'require' })
