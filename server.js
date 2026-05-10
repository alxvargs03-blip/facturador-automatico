import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import Anthropic from '@anthropic-ai/sdk'
import { procesarFactura } from './portales/index.js'

const app = express()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

app.use(express.json())
app.use(express.static('public'))

// Lee el recibo con Claude Vision y extrae los datos del ticket
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
            text: `Analiza este ticket/recibo de compra mexicano. Responde SOLO con JSON válido (sin markdown, sin texto extra).

{
  "tienda": "walmart" | "aurrera" | "chedraui" | "desconocido",
  "fecha": "DD/MM/YYYY o null",
  "total": "monto con 2 decimales como string, ej: 456.78, o null",
  "tc": "número TC completo (walmart/aurrera) — busca 'TC#', 'TC:', 'TICKET' seguido de 15-25 dígitos, o null",
  "tr": "número TR (walmart/aurrera) — busca 'TR#', 'TR:', 'TRANS' seguido de 3-6 dígitos, o null",
  "folio": "FOLIO de 19 dígitos bajo el código de barras (solo chedraui), o null",
  "sucursal": "nombre o número de sucursal si aparece, o null"
}

Identifica la tienda por el encabezado impreso en el ticket. Si no encuentras algún dato, pon null.`
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

// Facturación con SSE: mantiene la conexión abierta y envía progreso en tiempo real.
// Funciona en Vercel (serverless) porque es una sola invocación, sin estado compartido.
app.post('/api/facturar', async (req, res) => {
  const { datosFiscales, datosRecibo } = req.body
  if (!datosFiscales || !datosRecibo) {
    return res.status(400).json({ ok: false, error: 'Faltan datos' })
  }

  // Cabeceras SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // Evita buffering en nginx/Vercel
  res.flushHeaders()

  const enviar = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    const resultado = await procesarFactura(datosRecibo, datosFiscales, (paso) => {
      enviar({ tipo: 'paso', texto: paso })
    })
    enviar({ tipo: 'fin', resultado })
  } catch (err) {
    enviar({ tipo: 'error', mensaje: err.message })
  }

  res.end()
})

// En local arranca el servidor; en Vercel se exporta el app para que lo maneje la plataforma
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => console.log(`✓ Facturador en http://localhost:${PORT}`))
}

export default app
