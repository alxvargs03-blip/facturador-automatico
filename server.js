import 'dotenv/config'
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.message || err)
})
import express from 'express'
import session from 'express-session'
import MongoStore from 'connect-mongo'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import nodemailer from 'nodemailer'
import { v4 as uuidv4 } from 'uuid'
import { fileURLToPath } from 'url'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import {
  getAllProductsGrouped, getProductByHandle,
  getUserByEmail, getUserById, createUser, updateUserProfile,
  createOrder, getOrdersByUser, getOrderById, updateOrderPaymentStatus,
  recordVisit, getVisitStats, getAllUsers, getAllOrders, updateOrderStatus
} from './db.js'

const ADMIN_USER = 'Unicuna89'
const ADMIN_PASS = '123456'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const app = express()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Middleware ───────────────────────────────────────────────────────────────

app.set('trust proxy', 1)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(session({
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI, dbName: 'unicuna' }),
  secret: process.env.SESSION_SECRET || 'unicuna-dev-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.VERCEL === '1', httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
}))
// Visit tracking — HTML pages only
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    const p = req.path
    if (p === '/' || p.endsWith('.html')) {
      const label = p === '/' ? 'Inicio' : p.replace(/^\//, '').replace('.html', '')
      recordVisit(label).catch(() => {})
    }
  }
  next()
})

// Serve UNICUNA landing page at root (before static to override public/index.html)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'web-unicuna.html')))
app.use(express.static(path.join(__dirname, 'public'), { index: false }))
app.use('/assets', express.static(path.join(__dirname, 'assets')))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ ok: false, error: 'No autorizado' })
  next()
}

async function sendOrderEmail(order) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    })

    const itemsHtml = order.items.map((i, idx) => {
      const bg = idx % 2 === 0 ? '#fff' : '#fdf9f5'
      return `<tr style="background:${bg}">
        <td style="padding:.5rem .8rem">${i.product_name}</td>
        <td style="padding:.5rem .8rem">${i.color || '—'}</td>
        <td style="padding:.5rem .8rem">${i.size || '—'}</td>
        <td style="padding:.5rem .8rem;text-align:right;color:#c9a96e;font-weight:600">$${i.price.toLocaleString('es-MX')}</td>
        <td style="padding:.5rem .8rem;text-align:center">${i.quantity}</td>
      </tr>`
    }).join('')

    const orderDate = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
    const adminHtml = buildOrderHtml(order, itemsHtml, orderDate, true)
    const customerHtml = buildOrderHtml(order, itemsHtml, orderDate, false)

    // Email to admin
    await transporter.sendMail({
      from: `"UNICUNA® Tienda" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO || process.env.EMAIL_USER,
      subject: `🛍️ Nuevo pedido #${order.id.slice(0, 8).toUpperCase()} — UNICUNA®`,
      html: adminHtml
    })

    // Confirmation email to customer
    await transporter.sendMail({
      from: `"UNICUNA® Colchones" <${process.env.EMAIL_USER}>`,
      to: order.customer_email,
      subject: `✅ Confirmación de tu pedido #${order.id.slice(0, 8).toUpperCase()} — UNICUNA®`,
      html: customerHtml
    })
  } catch (err) {
    console.error('[email] Error enviando notificación:', err.message)
  }
}

function buildOrderHtml(order, itemsHtml, orderDate, isAdmin) {
  const greeting = isAdmin
    ? `<h2 style="color:#1e2d52;margin-bottom:4px">Nuevo pedido en UNICUNA®</h2><p style="color:#6b7280;font-size:.9em;margin-bottom:1.5rem">Acción requerida: preparar y coordinar envío.</p>`
    : `<div style="text-align:center;padding:2rem 0 1rem">
         <div style="font-size:3rem;margin-bottom:.5rem">✅</div>
         <h2 style="color:#1e2d52;margin-bottom:.3rem">¡Pedido recibido!</h2>
         <p style="color:#6b7280;font-size:.95em">Gracias, <strong>${order.customer_name.split(' ')[0]}</strong>. Hemos recibido tu pedido y te contactaremos pronto.</p>
       </div>`
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#fdf9f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <!-- Header -->
  <div style="background:#1e2d52;padding:1.5rem 2rem;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-family:Georgia,serif;font-size:1.6rem;color:#c9a96e;font-weight:700;letter-spacing:.04em">UNICUNA®</div>
      <div style="color:rgba(255,255,255,.6);font-size:.78rem;margin-top:.15rem">Colchones Premium para Bebé</div>
    </div>
    <div style="text-align:right">
      <div style="color:#c9a96e;font-size:.78rem;font-weight:600">PEDIDO</div>
      <div style="color:#fff;font-size:1rem;font-weight:700">#${order.id.slice(0, 8).toUpperCase()}</div>
    </div>
  </div>

  <!-- Body -->
  <div style="padding:2rem">
    ${greeting}

    <!-- Order info -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem">
      <tr>
        <td style="padding:.4rem .6rem;background:#fdf9f5;border-radius:6px;font-size:.82rem;color:#6b7280;width:36%">Fecha</td>
        <td style="padding:.4rem .6rem;font-size:.88rem;font-weight:500">${orderDate}</td>
      </tr>
      <tr>
        <td style="padding:.4rem .6rem;font-size:.82rem;color:#6b7280">Cliente</td>
        <td style="padding:.4rem .6rem;font-size:.88rem;font-weight:500">${order.customer_name}</td>
      </tr>
      <tr>
        <td style="padding:.4rem .6rem;background:#fdf9f5;font-size:.82rem;color:#6b7280">Correo</td>
        <td style="padding:.4rem .6rem;background:#fdf9f5;font-size:.88rem">${order.customer_email}</td>
      </tr>
      <tr>
        <td style="padding:.4rem .6rem;font-size:.82rem;color:#6b7280">Teléfono</td>
        <td style="padding:.4rem .6rem;font-size:.88rem">${order.customer_phone || '—'}</td>
      </tr>
      <tr>
        <td style="padding:.4rem .6rem;background:#fdf9f5;font-size:.82rem;color:#6b7280">Dirección</td>
        <td style="padding:.4rem .6rem;background:#fdf9f5;font-size:.88rem">${order.shipping_address || '—'}</td>
      </tr>
      <tr>
        <td style="padding:.4rem .6rem;font-size:.82rem;color:#6b7280">Método de pago</td>
        <td style="padding:.4rem .6rem;font-size:.88rem">Tarjeta de crédito/débito</td>
      </tr>
    </table>

    <!-- Products -->
    <h3 style="font-family:Georgia,serif;color:#1e2d52;font-size:1.1rem;margin-bottom:.8rem;border-bottom:2px solid #e8e0d5;padding-bottom:.4rem">Productos</h3>
    <table style="width:100%;border-collapse:collapse;font-size:.84rem;margin-bottom:1.5rem">
      <thead>
        <tr style="background:#1e2d52;color:#fff">
          <th style="padding:.6rem .8rem;text-align:left">Colchón</th>
          <th style="padding:.6rem .8rem;text-align:left">Color</th>
          <th style="padding:.6rem .8rem;text-align:left">Medida</th>
          <th style="padding:.6rem .8rem;text-align:right">Precio</th>
          <th style="padding:.6rem .8rem;text-align:center">Cant.</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <!-- Total -->
    <div style="background:#1e2d52;border-radius:8px;padding:1rem 1.2rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <span style="color:rgba(255,255,255,.8);font-size:.9rem;font-weight:500">Total del pedido</span>
      <span style="color:#c9a96e;font-size:1.2rem;font-weight:700">$${order.total.toLocaleString('es-MX')} MXN</span>
    </div>

    ${!isAdmin ? `
    <!-- Customer message -->
    <div style="background:#fdf9f5;border-left:3px solid #c9a96e;padding:1rem 1.2rem;border-radius:0 8px 8px 0;margin-bottom:1.5rem">
      <p style="margin:0;font-size:.88rem;color:#1e2d52;line-height:1.6">
        Nos pondremos en contacto contigo para coordinar la entrega.
        Si tienes alguna pregunta, escríbenos a
        <a href="https://wa.me/525637725305" style="color:#c9a96e;font-weight:600">WhatsApp</a> o
        por correo a <a href="mailto:Monserrat.escalona.sosa@gmail.com" style="color:#c9a96e">Monserrat.escalona.sosa@gmail.com</a>
      </p>
    </div>` : ''}
  </div>

  <!-- Footer -->
  <div style="background:#f5f0e8;padding:1rem 2rem;text-align:center;border-top:1px solid #e8e0d5">
    <p style="margin:0;font-size:.75rem;color:#9ca3af">UNICUNA® · Inde #23, CDMX · Colchones premium para bebé</p>
    <p style="margin:.3rem 0 0;font-size:.75rem;color:#9ca3af">
      <a href="https://wa.me/525569016798" style="color:#c9a96e;text-decoration:none">WhatsApp: 55 6901 6798</a> &nbsp;·&nbsp;
      <a href="https://www.instagram.com/unicunas_personalizada" style="color:#c9a96e;text-decoration:none">@unicunas_personalizada</a>
    </p>
  </div>
</div>
</body></html>`
}

function buildWhatsAppMessage(order) {
  const items = order.items.map(i =>
    `• ${i.product_name} | Color: ${i.color || '—'} | Medida: ${i.size || '—'} | $${i.price.toLocaleString('es-MX')} MXN x${i.quantity}`
  ).join('\n')
  return encodeURIComponent(
    `🛍️ *Nuevo pedido UNICUNA®*\n` +
    `Pedido: #${order.id.slice(0, 8).toUpperCase()}\n` +
    `Cliente: ${order.customer_name}\n` +
    `Email: ${order.customer_email}\n` +
    `Tel: ${order.customer_phone || '—'}\n` +
    `Dirección: ${order.shipping_address || '—'}\n` +
    `Pago: ${order.payment_method}\n\n` +
    `*Productos:*\n${items}\n\n` +
    `*Total: $${order.total.toLocaleString('es-MX')} MXN*`
  )
}

// ─── Products API ─────────────────────────────────────────────────────────────

app.get('/api/products', (req, res) => {
  try {
    const products = getAllProductsGrouped()
    res.json({ ok: true, products })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/products/:handle', (req, res) => {
  try {
    const product = getProductByHandle(req.params.handle)
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no encontrado' })
    res.json({ ok: true, product })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ─── Auth API ─────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, phone } = req.body
  if (!name || !email || !password) {
    return res.status(400).json({ ok: false, error: 'Nombre, email y contraseña son requeridos' })
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' })
  }
  try {
    if (await getUserByEmail(email)) {
      return res.status(409).json({ ok: false, error: 'Este email ya está registrado' })
    }
    const hash = await bcrypt.hash(password, 10)
    const id = await createUser({ name, email, password: hash, phone })
    req.session.userId = id
    res.json({ ok: true, user: { id, name, email } })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' })
  }
  try {
    const user = await getUserByEmail(email)
    if (!user) return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' })
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' })
    req.session.userId = user._id.toString()
    res.json({ ok: true, user: { id: user._id.toString(), name: user.name, email: user.email } })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy()
  res.json({ ok: true })
})

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) return res.json({ ok: true, user: null })
  const user = await getUserById(req.session.userId)
  res.json({ ok: true, user: user || null })
})

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    await updateUserProfile(req.session.userId, req.body)
    const user = await getUserById(req.session.userId)
    res.json({ ok: true, user })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ─── Admin API ────────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ ok: false, error: 'No autorizado' })
  next()
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true
    res.json({ ok: true })
  } else {
    res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' })
  }
})

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.isAdmin = false
  res.json({ ok: true })
})

app.get('/api/admin/me', (req, res) => {
  res.json({ ok: true, isAdmin: !!req.session.isAdmin })
})

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [orders, users, visits] = await Promise.all([getAllOrders(), getAllUsers(), getVisitStats()])
    const today   = new Date().toISOString().slice(0, 10)
    const revenue = orders.reduce((s, o) => s + (o.total || 0), 0)
    const todayOrders = orders.filter(o => (o.created_at instanceof Date ? o.created_at.toISOString() : o.created_at || '').slice(0, 10) === today)
    const todayRev    = todayOrders.reduce((s, o) => s + (o.total || 0), 0)
    const byStatus    = orders.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m }, {})
    res.json({ ok: true, stats: {
      totalOrders: orders.length, totalRevenue: revenue,
      totalUsers: users.length,   totalVisits: visits.total || 0,
      todayOrders: todayOrders.length, todayRevenue: todayRev,
      todayVisits: visits.byDay?.[today] || 0,
      byStatus, visits
    }})
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, orders: await getAllOrders() }) }
  catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.put('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    await updateOrderStatus(req.params.id, req.body.status)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, users: await getAllUsers() }) }
  catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ─── Orders API ───────────────────────────────────────────────────────────────

app.post('/api/orders', async (req, res) => {
  const { customer_name, customer_email, customer_phone, shipping_address, payment_method, items, notes } = req.body
  if (!customer_name || !customer_email || !items?.length) {
    return res.status(400).json({ ok: false, error: 'Faltan datos del pedido' })
  }
  try {
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
    const orderId = uuidv4()
    const order = {
      id: orderId,
      user_id: req.session.userId || null,
      customer_name,
      customer_email,
      customer_phone: customer_phone || null,
      shipping_address: shipping_address || null,
      payment_method: payment_method || 'pendiente',
      payment_status: 'pendiente',
      status: 'nuevo',
      total,
      notes: notes || null
    }
    await createOrder(order, items)
    const fullOrder = await getOrderById(orderId)

    // Save address to user profile for future pre-fill
    if (req.session.userId && req.body.address_fields) {
      await updateUserProfile(req.session.userId, req.body.address_fields)
    }

    // Notificaciones en paralelo (no bloqueamos la respuesta)
    sendOrderEmail(fullOrder).catch(() => {})

    const wpNum = process.env.WHATSAPP_NUMBER || '5637725305'
    const wpMsg = buildWhatsAppMessage(fullOrder)
    const wpUrl = `https://wa.me/52${wpNum}?text=${wpMsg}`

    res.json({ ok: true, orderId, whatsappUrl: wpUrl, total })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const orders = await getOrdersByUser(req.session.userId)
    res.json({ ok: true, orders })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ─── MercadoPago ──────────────────────────────────────────────────────────────

app.post('/api/payments/create', async (req, res) => {
  if (!process.env.MP_ACCESS_TOKEN) {
    return res.status(503).json({ ok: false, error: 'MercadoPago no configurado' })
  }
  try {
    const { createRequire } = await import('module')
    const require = createRequire(import.meta.url)
    const { MercadoPagoConfig, Preference } = require('mercadopago')

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
    const preference = new Preference(client)

    const { items, orderId, customer_email } = req.body
    const result = await preference.create({
      body: {
        items: items.map(i => ({
          title: `${i.product_name} ${i.color ? '— ' + i.color : ''} ${i.size ? i.size : ''}`.trim(),
          unit_price: i.price,
          quantity: i.quantity,
          currency_id: 'MXN'
        })),
        payer: { email: customer_email },
        external_reference: orderId,
        back_urls: {
          success: `${req.protocol}://${req.get('host')}/checkout-exito?order=${orderId}`,
          failure: `${req.protocol}://${req.get('host')}/checkout-error?order=${orderId}`,
          pending: `${req.protocol}://${req.get('host')}/checkout-pendiente?order=${orderId}`
        },
        auto_return: 'approved',
        notification_url: `${req.protocol}://${req.get('host')}/api/payments/webhook`
      }
    })
    res.json({ ok: true, initPoint: result.init_point })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const { type, data } = req.body
    if (type === 'payment' && data?.id) {
      await updateOrderPaymentStatus(data.external_reference, 'pagado', 'mercadopago')
    }
    res.sendStatus(200)
  } catch {
    res.sendStatus(200)
  }
})

// ─── Facturador (preservado) ──────────────────────────────────────────────────

app.post('/api/leer-recibo', upload.single('recibo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió imagen' })
  try {
    const imageBase64 = req.file.buffer.toString('base64')
    const mimeType = req.file.mimetype
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          {
            type: 'text',
            text: `Analiza este ticket/recibo de compra mexicano. Responde SOLO con JSON válido (sin markdown, sin texto extra).\n\n{"tienda":"walmart"|"aurrera"|"chedraui"|"desconocido","fecha":"DD/MM/YYYY o null","total":"monto o null","tc":"número TC o null","tr":"número TR o null","folio":"FOLIO o null","sucursal":"nombre o null"}`
          }
        ]
      }]
    })
    const text = msg.content[0].text.trim()
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Claude no pudo extraer datos del recibo')
    res.json({ ok: true, datos: JSON.parse(match[0]) })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/facturar', async (req, res) => {
  const { datosFiscales, datosRecibo } = req.body
  if (!datosFiscales || !datosRecibo) return res.status(400).json({ ok: false, error: 'Faltan datos' })
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  const enviar = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
  try {
    const { procesarFactura } = await import('./portales/index.js')
    const resultado = await procesarFactura(datosRecibo, datosFiscales, (paso) => enviar({ tipo: 'paso', texto: paso }))
    enviar({ tipo: 'fin', resultado })
  } catch (err) {
    enviar({ tipo: 'error', mensaje: err.message })
  }
  res.end()
})

// ─── Start ────────────────────────────────────────────────────────────────────

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => console.log(`✓ UNICUNA® en http://localhost:${PORT}`))
}

export default app
