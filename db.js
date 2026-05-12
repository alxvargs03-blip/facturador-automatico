import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { MongoClient, ObjectId } from 'mongodb'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const CSV_PATH  = path.join(__dirname, 'data', 'products.csv')

// ─── Size normalization ───────────────────────────────────────────────────────

export function normalizeSize(raw) {
  if (!raw) return null
  const s = raw.trim()
  const m = s.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i)
  if (!m) return s
  let a = parseFloat(m[1])
  let b = parseFloat(m[2])
  if (a >= 1 && a < 10) a = Math.round(a * 100)
  if (b >= 1 && b < 10) b = Math.round(b * 100)
  const lo = Math.min(a, b), hi = Math.max(a, b)
  return `${lo}x${hi}`
}

export function displaySize(normalized) {
  if (!normalized) return '—'
  const m = normalized.match(/^(\d+)x(\d+)$/)
  if (!m) return normalized
  return `${m[1]} × ${m[2]} cm`
}

// ─── Model detection ─────────────────────────────────────────────────────────

export function detectModel(name) {
  if (!name) return 'Supreme'
  const n = name.toLowerCase()
  if (n.includes('memory'))   return 'Memory'
  if (n.includes('imper') || n.includes('viajera')) return 'Impermeable'
  if (n.includes('supreme'))  return 'Supreme'
  return 'Supreme'
}

// ─── Products (in-memory from CSV) ───────────────────────────────────────────

function isValidColor(c) {
  if (!c || c === 'Color') return false
  if (c.length > 30) return false
  return true
}

function parsePrice(raw) {
  if (!raw || raw.trim() === '') return 0
  return parseFloat(raw.replace(',', '.')) || 0
}

function loadProducts() {
  if (!fs.existsSync(CSV_PATH)) { console.warn('[db] products.csv not found'); return [] }
  const text = fs.readFileSync(CSV_PATH, 'utf8')
  const lines = text.split('\n')
  if (lines.length < 2) return []
  const header  = lines[0].split(',')
  const idx = (name) => header.findIndex(h => h.trim() === name)
  const iHandle  = idx('handle')
  const iName    = idx('name')
  const iSku     = idx('sku')
  const iPrice   = idx('price')
  const iInv     = idx('inventory')
  const iVisible = idx('visible')
  const iColor   = idx('productOptionValue1')
  const iSize    = idx('productOptionValue2')
  const products = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = line.split(',')
    const sku = cols[iSku]?.trim()
    if (!sku) continue
    const rawColor = cols[iColor]?.trim() || null
    const rawSize  = cols[iSize]?.trim()  || null
    const color = isValidColor(rawColor) ? rawColor : null
    const size  = (rawSize && rawSize !== 'Tamano' && rawSize !== 'Product') ? normalizeSize(rawSize) : null
    const name  = cols[iName]?.trim() || ''
    products.push({
      handle:    cols[iHandle]?.trim() || '',
      name, sku,
      price:     parsePrice(cols[iPrice]),
      inventory: parseInt(cols[iInv], 10) || 0,
      color, size, rawSize,
      model:     detectModel(name),
      visible:   cols[iVisible]?.trim() === 'true'
    })
  }
  console.log(`[db] Loaded ${products.length} product variants from CSV`)
  return products
}

const PRODUCTS = loadProducts()

export function getAllProductsGrouped() {
  const map = new Map()
  for (const p of PRODUCTS) {
    if (!p.visible) continue
    if (!map.has(p.handle)) {
      map.set(p.handle, {
        handle: p.handle, name: p.name, model: p.model,
        minPrice: p.price || Infinity, maxPrice: 0,
        colors: new Set(), sizes: new Set(), normalizedSizes: new Set(),
        totalInventory: 0
      })
    }
    const e = map.get(p.handle)
    if (p.price) { e.minPrice = Math.min(e.minPrice, p.price); e.maxPrice = Math.max(e.maxPrice, p.price) }
    if (p.color) e.colors.add(p.color)
    if (p.size)  { e.sizes.add(p.size); e.normalizedSizes.add(p.size) }
    e.totalInventory += p.inventory
  }
  return [...map.values()].map(e => ({
    ...e,
    minPrice: e.minPrice === Infinity ? 0 : e.minPrice,
    colors: [...e.colors],
    sizes:  [...e.sizes].sort(),
    normalizedSizes: [...e.normalizedSizes]
  }))
}

export function getProductByHandle(handle) {
  const variants = PRODUCTS.filter(p => p.handle === handle && p.visible)
  if (!variants.length) return null
  return {
    handle: variants[0].handle, name: variants[0].name, model: variants[0].model,
    variants: variants.map(v => ({
      sku: v.sku, price: v.price, inventory: v.inventory,
      color: v.color, size: v.size, rawSize: v.rawSize
    }))
  }
}

// ─── MongoDB connection ───────────────────────────────────────────────────────

let _client = null
let _db = null

async function getDb() {
  if (_db) return _db
  if (!_client) {
    _client = new MongoClient(process.env.MONGODB_URI)
    await _client.connect()
  }
  _db = _client.db('unicuna')
  return _db
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUserByEmail(email) {
  const db = await getDb()
  return db.collection('users').findOne({ email: email.toLowerCase() })
}

export async function getUserById(id) {
  const db = await getDb()
  try {
    const u = await db.collection('users').findOne({ _id: new ObjectId(id) })
    if (!u) return null
    const { password: _, ...safe } = u
    return { ...safe, id: u._id.toString() }
  } catch { return null }
}

export async function createUser({ name, email, password, phone }) {
  const db = await getDb()
  const result = await db.collection('users').insertOne({
    name, email: email.toLowerCase(), password,
    phone: phone || null, created_at: new Date()
  })
  return result.insertedId.toString()
}

export async function updateUserProfile(userId, data) {
  const db = await getDb()
  const allowed = ['phone','calle','numExt','numInt','colonia','ciudad','estado','cp','referencias']
  const update = {}
  for (const k of allowed) if (data[k] !== undefined) update[k] = data[k]
  if (!Object.keys(update).length) return true
  try {
    await db.collection('users').updateOne({ _id: new ObjectId(userId) }, { $set: update })
    return true
  } catch { return false }
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function createOrder(order, items) {
  const db = await getDb()
  await db.collection('orders').insertOne({ ...order, items, created_at: new Date() })
  return order.id
}

export async function getOrderById(orderId) {
  const db = await getDb()
  return db.collection('orders').findOne({ id: orderId })
}

export async function getOrdersByUser(userId) {
  const db = await getDb()
  return db.collection('orders').find({ user_id: userId }).sort({ created_at: -1 }).toArray()
}

export async function updateOrderStatus(orderId, status) {
  const db = await getDb()
  await db.collection('orders').updateOne({ id: orderId }, { $set: { status } })
}

export async function updateOrderPaymentStatus(orderId, paymentStatus, paymentMethod) {
  const db = await getDb()
  await db.collection('orders').updateOne(
    { id: orderId },
    { $set: { payment_status: paymentStatus, payment_method: paymentMethod } }
  )
}

// ─── Visits ───────────────────────────────────────────────────────────────────

export async function recordVisit(pagePath) {
  try {
    const db = await getDb()
    const day = new Date().toISOString().slice(0, 10)
    await db.collection('visits').updateOne(
      { _id: 'stats' },
      { $inc: { total: 1, [`byDay.${day}`]: 1, [`byPage.${pagePath}`]: 1 } },
      { upsert: true }
    )
  } catch {}
}

export async function getVisitStats() {
  const db = await getDb()
  const stats = await db.collection('visits').findOne({ _id: 'stats' })
  return stats || { total: 0, byDay: {}, byPage: {} }
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function getAllUsers() {
  const db = await getDb()
  const users = await db.collection('users').find({}).sort({ created_at: -1 }).toArray()
  return users.map(({ password: _, ...u }) => ({ ...u, id: u._id.toString() }))
}

export async function getAllOrders() {
  const db = await getDb()
  return db.collection('orders').find({}).sort({ created_at: -1 }).toArray()
}
