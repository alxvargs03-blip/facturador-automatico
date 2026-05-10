import { lanzarNavegador } from './browser.js'

const PORTAL_URL = 'https://www.masfacturaweb.com.mx/chedraui/chedraui_mfw.aspx'
const WAIT = (ms) => new Promise(r => setTimeout(r, ms))

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
  if (!sel) throw new Error(`No se encontró el campo "${campo}" en el portal de Chedraui`)
  await page.click(sel, { clickCount: 3 })
  await WAIT(100)
  await page.type(sel, String(valor), { delay: 40 })
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

export async function facturarChedraui(datosRecibo, datosFiscales, onPaso) {
  if (!datosRecibo.folio) {
    return {
      exitoso: false,
      mensaje: 'No se encontró el FOLIO en el ticket de Chedraui. El FOLIO es el número de 19 dígitos bajo el código de barras.'
    }
  }

  const browser = await lanzarNavegador()

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // ── PASO 1: Cargar portal ─────────────────────────────────────
    onPaso('Abriendo portal de facturación de Chedraui...')
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle2', timeout: 30000 })

    // Hacer click en "Crear Factura" si hay menú inicial
    const btnCrear = await encontrarElemento(page, [
      'a[href*="crear"]', 'a[href*="Crear"]',
      'input[value*="Crear"]', 'button:contains("Crear")',
      '#btnCrearFactura', '.btn-crear'
    ], 2000)
    if (btnCrear) {
      await page.click(btnCrear)
      await WAIT(2000)
    }

    // ── PASO 2: RFC y FOLIO ───────────────────────────────────────
    onPaso('Ingresando RFC...')

    await escribir(page, [
      'input[name="rfc"]', 'input[id="rfc"]',
      'input[name="RFC"]', 'input[id="RFC"]',
      'input[placeholder*="RFC"]', '#txtRFC', '#RFC', '#rfc'
    ], datosFiscales.rfc, 'RFC')

    onPaso('Ingresando folio del ticket...')

    await escribir(page, [
      'input[name*="folio"]', 'input[name*="Folio"]',
      'input[id*="folio"]', 'input[id*="Folio"]',
      'input[placeholder*="folio"]', 'input[placeholder*="Folio"]',
      'input[maxlength="19"]', '#txtFolio', '#folio', '#FOLIO'
    ], datosRecibo.folio, 'Folio')

    onPaso('Buscando tu ticket en el sistema...')

    await clickar(page, [
      'input[value*="Continuar"]', 'input[value*="Buscar"]',
      'input[value*="Siguiente"]', 'input[value*="Aceptar"]',
      'button[type="submit"]', 'input[type="submit"]',
      '.btn-submit', '.btn-primary', 'a.btn', '#btnContinuar'
    ], 'Continuar')

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 })
      .catch(() => WAIT(4000))

    // ── PASO 3: Datos fiscales ────────────────────────────────────
    onPaso('Completando datos fiscales...')

    await escribir(page, [
      'input[type="email"]', 'input[name*="email"]',
      'input[name*="Email"]', 'input[name*="correo"]',
      'input[id*="email"]', 'input[placeholder*="correo"]',
      '#txtEmail', '#email'
    ], datosFiscales.email, 'correo electrónico')

    // Razón Social
    const rsSel = await encontrarElemento(page, [
      'input[name*="razon"]', 'input[name*="nombre"]',
      'input[id*="razon"]', 'input[placeholder*="Razón"]',
      '#txtRazonSocial', '#razonSocial'
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
      'select[id*="usoCFDI"]', '#ddlUso', '#usoCFDI'
    ], datosFiscales.usoCfdi, 'Uso CFDI')

    // Régimen Fiscal
    await seleccionar(page, [
      'select[name*="regimen"]', 'select[name*="Regimen"]',
      'select[id*="regimen"]', '#ddlRegimen', '#regimenFiscal'
    ], datosFiscales.regimenFiscal, 'Régimen Fiscal')

    // Código postal si lo pide
    const cpSel = await encontrarElemento(page, [
      'input[name*="cp"]', 'input[name*="CP"]',
      'input[placeholder*="Código Postal"]', '#txtCP'
    ], 2000)
    if (cpSel) {
      await page.click(cpSel, { clickCount: 3 })
      await page.type(cpSel, datosFiscales.codigoPostal, { delay: 40 })
    }

    onPaso('Enviando solicitud de factura...')

    await clickar(page, [
      'input[value*="Facturar"]', 'input[value*="Generar"]',
      'input[value*="Enviar"]', 'input[value*="Aceptar"]',
      'button[type="submit"]', 'input[type="submit"]',
      '#btnFacturar', '.btn-facturar'
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
      mensaje: `Error en el portal de Chedraui: ${err.message}`
    }
  } finally {
    await browser.close()
  }
}
