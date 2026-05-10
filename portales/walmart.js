import { lanzarNavegador } from './browser.js'

const PORTAL_URL = 'https://facturacion.walmartmexico.com.mx/'
const WAIT = (ms) => new Promise(r => setTimeout(r, ms))

// Intenta varios selectores y retorna el primero que encuentre
async function encontrarElemento(page, selectores, timeout = 5000) {
  for (const sel of selectores) {
    try {
      await page.waitForSelector(sel, { visible: true, timeout })
      return sel
    } catch {
      continue
    }
  }
  return null
}

async function escribir(page, selectores, valor, campo) {
  const sel = await encontrarElemento(page, selectores)
  if (!sel) throw new Error(`No se encontró el campo "${campo}" en el portal`)
  await page.click(sel, { clickCount: 3 })
  await WAIT(100)
  await page.type(sel, String(valor), { delay: 40 })
  return sel
}

async function seleccionar(page, selectores, valor, campo) {
  const sel = await encontrarElemento(page, selectores)
  if (!sel) {
    console.warn(`Campo "${campo}" no encontrado — omitido`)
    return
  }
  await page.select(sel, String(valor))
}

async function clickar(page, selectores, descripcion) {
  const sel = await encontrarElemento(page, selectores)
  if (!sel) throw new Error(`No se encontró el botón "${descripcion}"`)
  await page.click(sel)
}

export async function facturarWalmart(datosRecibo, datosFiscales, onPaso) {
  const browser = await lanzarNavegador()

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
    // Ocultar que es Puppeteer
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // ── PASO 1: Cargar portal ─────────────────────────────────────
    onPaso('Abriendo portal de facturación de Walmart...')
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle2', timeout: 30000 })

    // Aceptar aviso de privacidad si aparece
    const btnAceptar = await encontrarElemento(page, [
      'input[value="Aceptar"]',
      'button:contains("Aceptar")',
      'a:contains("Aceptar")',
      '#btnAceptar',
      '.btn-aceptar'
    ], 2000)
    if (btnAceptar) {
      await page.click(btnAceptar)
      await WAIT(1000)
    }

    // Ir a "Obtener Factura"
    const btnObtener = await encontrarElemento(page, [
      'a[href*="frmDatos"]',
      'a[href*="Datos"]',
      'a[href*="factura"]',
      'input[value*="Obtener"]',
      'a.btn',
      'button.btn-primary'
    ], 3000)
    if (btnObtener) {
      await page.click(btnObtener)
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    }

    // ── PASO 2: Datos del ticket ──────────────────────────────────
    onPaso('Ingresando número de ticket (TC)...')

    await escribir(page, [
      'input[name*="TC"]', 'input[id*="TC"]',
      'input[name*="tc"]', 'input[id*="tc"]',
      'input[placeholder*="TC"]', 'input[placeholder*="Ticket"]',
      '#txtTC', '#TC', 'input[maxlength="20"]'
    ], datosRecibo.tc, 'TC')

    onPaso('Ingresando número de transacción (TR)...')

    await escribir(page, [
      'input[name*="TR"]', 'input[id*="TR"]',
      'input[name*="tr"]', 'input[id*="tr"]',
      'input[placeholder*="TR"]', 'input[placeholder*="Trans"]',
      '#txtTR', '#TR', 'input[maxlength="5"]'
    ], datosRecibo.tr, 'TR')

    onPaso('Ingresando RFC...')

    await escribir(page, [
      'input[name="rfc"]', 'input[id="rfc"]',
      'input[name="RFC"]', 'input[id="RFC"]',
      'input[placeholder*="RFC"]',
      '#txtRFC', '#RFC'
    ], datosFiscales.rfc, 'RFC')

    onPaso('Ingresando código postal...')

    await escribir(page, [
      'input[name*="cp"]', 'input[name*="CP"]',
      'input[name*="postal"]', 'input[id*="cp"]',
      'input[id*="CP"]', 'input[placeholder*="Código Postal"]',
      'input[placeholder*="C.P"]', '#txtCP', '#CP', 'input[maxlength="5"]'
    ], datosFiscales.codigoPostal, 'Código Postal')

    onPaso('Buscando tu ticket en el sistema...')

    await clickar(page, [
      'input[type="submit"]', 'button[type="submit"]',
      'input[value*="Continuar"]', 'input[value*="Buscar"]',
      'input[value*="Siguiente"]', 'input[value*="Aceptar"]',
      '.btn-submit', '.btn-primary', 'a.btn'
    ], 'Continuar')

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 })
      .catch(() => WAIT(4000))

    // ── PASO 3: Datos fiscales del cliente ────────────────────────
    onPaso('Completando datos fiscales...')

    await escribir(page, [
      'input[type="email"]', 'input[name*="email"]',
      'input[name*="Email"]', 'input[name*="correo"]',
      'input[id*="email"]', 'input[placeholder*="correo"]',
      'input[placeholder*="Email"]', '#txtEmail', '#email'
    ], datosFiscales.email, 'correo electrónico')

    // Razón Social (puede ser de solo lectura si el SAT la autocompletó)
    const rsSel = await encontrarElemento(page, [
      'input[name*="razon"]', 'input[name*="Razon"]',
      'input[name*="nombre"]', 'input[id*="razon"]',
      'input[placeholder*="Razón"]', '#txtRazonSocial', '#razonSocial'
    ], 2000)
    if (rsSel) {
      const readOnly = await page.$eval(rsSel, el => el.readOnly).catch(() => false)
      if (!readOnly) {
        await page.click(rsSel, { clickCount: 3 })
        await page.type(rsSel, datosFiscales.razonSocial, { delay: 40 })
      }
    }

    // Uso CFDI
    await seleccionar(page, [
      'select[name*="usoCFDI"]', 'select[name*="uso"]',
      'select[id*="usoCFDI"]', 'select[id*="uso"]',
      '#ddlUso', '#usoCFDI', 'select[name*="Uso"]'
    ], datosFiscales.usoCfdi, 'Uso CFDI')

    // Régimen Fiscal
    await seleccionar(page, [
      'select[name*="regimen"]', 'select[name*="Regimen"]',
      'select[id*="regimen"]', 'select[id*="Regimen"]',
      '#ddlRegimen', '#regimenFiscal'
    ], datosFiscales.regimenFiscal, 'Régimen Fiscal')

    onPaso('Enviando solicitud de factura...')

    await clickar(page, [
      'input[value*="Facturar"]', 'input[value*="Generar"]',
      'input[value*="Enviar"]', 'button[value*="Facturar"]',
      'input[type="submit"]', 'button[type="submit"]',
      '.btn-facturar', '.btn-generar'
    ], 'Generar Factura')

    await WAIT(5000)

    onPaso('¡Solicitud enviada correctamente!')

    return {
      exitoso: true,
      mensaje: 'Factura solicitada. Recibirás el XML y PDF en tu correo electrónico en los próximos minutos.'
    }

  } catch (err) {
    return {
      exitoso: false,
      mensaje: `Error en el portal de Walmart: ${err.message}`
    }
  } finally {
    await browser.close()
  }
}
