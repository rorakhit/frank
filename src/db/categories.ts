import { CATEGORIES } from '../types.js'
import { db } from './client.js'

export async function getAllCategories(): Promise<string[]> {
  const { data } = await db.from('custom_categories').select('name').order('name')
  const custom = (data ?? []).map(r => r.name as string)
  return [...CATEGORIES, ...custom]
}

export function isValidCategory(category: string, allCategories: string[]): boolean {
  return allCategories.includes(category)
}
