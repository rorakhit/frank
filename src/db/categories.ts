import { CATEGORIES } from '../types.js'
import { sql } from './client.js'

export async function getAllCategories(): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`SELECT name FROM custom_categories ORDER BY name`
  const custom = rows.map(r => r.name)
  return [...CATEGORIES, ...custom]
}

export function isValidCategory(category: string, allCategories: string[]): boolean {
  return allCategories.includes(category)
}
