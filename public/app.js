// ── Estado global ────────────────────────────────────────────────
const estado = {
  datosFiscales: null,
  datosRecibo: null
}

// ── Elementos ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)

const step1 = $('step1'), step2 = $('step2'), step3 = $('step3')
const stepsNav = $('stepsNav')
const formDatos = $('formDatos')
const uploadArea = $('uploadArea')
const fileInput = $('fileInput')
const previewBox = $('previewBox')
const previewImg = $('previewImg')
const datosDetectados = $('datosDetectados')
const loadingOCR = $('loadingOCR')
const btnVolver1 = $('btnVolver1')
const btnFacturar = $('btnFacturar')
const btnNueva = $('btnNueva')
const btnReintento = $('btnReintento')
const pasosList = $('pasosList')
const progressBar = $('progressBar')
const step3Title = $('step3Title')
const resultadoExito = $('resultadoExito')
const resultadoError = $('resultadoError')

// ── Navegación entre pasos ────────────────────────────────────────
function mostrarPaso(n) {
  [step1, step2, step3].forEach(s => s.classList.add('hidden'))
  if (n === 1) step1.classList.remove('hidden')
  if (n === 2) step2.classList.remove('hidden')
  if (n === 3) step3.classList.remove('hidden')

  stepsNav.querySelectorAll('.step').forEach(el => {
    const num = parseInt(el.dataset.step)
    el.classList.remove('active', 'done')
    if (num === n) el.classList.add('active')
    if (num < n) el.classList.add('done')
  })
}

// ── Guardar / cargar datos fiscales en localStorage ───────────────
function guardarDatos() {
  const d = {
    rfc: $('rfc').value.trim().toUpperCase(),
    razonSocial: $('razonSocial').value.trim().toUpperCase(),
    email: $('email').value.trim().toLowerCase(),
    codigoPostal: $('codigoPostal').value.trim(),
    regimenFiscal: $('regimenFiscal').value,
    usoCfdi: $('usoCfdi').value
  }
  localStorage.setItem('datosFiscales', JSON.stringify(d))
  return d
}

function cargarDatos() {
  try {
    const d = JSON.parse(localStorage.getItem('datosFiscales') || 'null')
    if (!d) return
    if (d.rfc) $('rfc').value = d.rfc
    if (d.razonSocial) $('razonSocial').value = d.razonSocial
    if (d.email) $('email').value = d.email
    if (d.codigoPostal) $('codigoPostal').value = d.codigoPostal
    if (d.regimenFiscal) $('regimenFiscal').value = d.regimenFiscal
    if (d.usoCfdi) $('usoCfdi').value = d.usoCfdi
  } catch { /* no hay datos guardados */ }
}

// ── Paso 1 → Paso 2 ──────────────────────────────────────────────
formDatos.addEventListener('submit', (e) => {
  e.preventDefault()
  estado.datosFiscales = guardarDatos()
  mostrarPaso(2)
  resetearPaso2()
})

// ── Upload drag & drop ────────────────────────────────────────────
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over') })
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'))
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault(); uploadArea.classList.remove('drag-over')
  if (e.dataTransfer.files[0]) procesarArchivo(e.dataTransfer.files[0])
})
fileInput.addEventListener('change', () => { if (fileInput.files[0]) procesarArchivo(fileInput.files[0]) })

function resetearPaso2() {
  previewBox.classList.add('hidden')
  datosDetectados.classList.add('hidden')
  loadingOCR.classList.add('hidden')
  btnFacturar.classList.add('hidden')
  fileInput.value = ''
  estado.datosRecibo = null
}

async function procesarArchivo(file) {
  if (!file.type.startsWith('image/')) { alert('Por favor sube una imagen (JPG, PNG, HEIC...)'); return }

  previewImg.src = URL.createObjectURL(file)
  previewBox.classList.remove('hidden')
  datosDetectados.classList.add('hidden')
  btnFacturar.classList.add('hidden')
  loadingOCR.classList.remove('hidden')

  try {
    const form = new FormData()
    form.append('recibo', file)
    const json = await fetch('/api/leer-recibo', { method: 'POST', body: form }).then(r => r.json())
    loadingOCR.classList.add('hidden')
    if (!json.ok) throw new Error(json.error)

    const d = json.datos
    estado.datosRecibo = d

    $('dtTienda').textContent = { walmart: 'Walmart', aurrera: 'Bodega Aurrera', chedraui: 'Chedraui' }[d.tienda] || d.tienda || '—'
    $('dtTC').textContent = d.tc || '—'
    $('dtTR').textContent = d.tr || '—'
    $('dtFolio').textContent = d.folio || '—'
    $('dtTotal').textContent = d.total ? `$${d.total}` : '—'
    $('dtFecha').textContent = d.fecha || '—'
    datosDetectados.classList.remove('hidden')

    if (d.tienda === 'desconocido' || !d.tienda) {
      alert('No se reconoció la tienda. Solo Walmart, Bodega Aurrera y Chedraui. Intenta con una foto más clara.')
    } else {
      btnFacturar.classList.remove('hidden')
    }
  } catch (err) {
    loadingOCR.classList.add('hidden')
    alert(`Error al leer el recibo: ${err.message}`)
  }
}

// ── Paso 2 → Paso 1 ──────────────────────────────────────────────
btnVolver1.addEventListener('click', () => mostrarPaso(1))

// ── Paso 2 → Paso 3: iniciar facturación con SSE streaming ────────
btnFacturar.addEventListener('click', () => {
  mostrarPaso(3)
  iniciarFacturacion()
})

async function iniciarFacturacion() {
  pasosList.innerHTML = ''
  progressBar.style.width = '0%'
  step3Title.textContent = 'Facturando...'
  resultadoExito.classList.add('hidden')
  resultadoError.classList.add('hidden')

  let pasosContados = 0
  const PASOS_ESTIMADOS = 8

  try {
    const response = await fetch('/api/facturar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datosFiscales: estado.datosFiscales, datosRecibo: estado.datosRecibo })
    })

    if (!response.ok) throw new Error(`Error del servidor: ${response.status}`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lineas = buffer.split('\n')
      buffer = lineas.pop() // Guardar línea incompleta

      for (const linea of lineas) {
        if (!linea.startsWith('data: ')) continue
        try {
          const data = JSON.parse(linea.slice(6))

          if (data.tipo === 'paso') {
            agregarPaso(data.texto)
            pasosContados++
            progressBar.style.width = `${Math.min(90, (pasosContados / PASOS_ESTIMADOS) * 100)}%`
          } else if (data.tipo === 'fin') {
            progressBar.style.width = '100%'
            pasosList.querySelectorAll('li').forEach(li => li.classList.add('done'))
            if (data.resultado.exitoso) {
              mostrarExito(data.resultado.mensaje)
            } else {
              mostrarError(data.resultado.mensaje)
            }
          } else if (data.tipo === 'error') {
            mostrarError(data.mensaje)
          }
        } catch { continue }
      }
    }
  } catch (err) {
    mostrarError(`No se pudo conectar con el servidor: ${err.message}`)
  }
}

function agregarPaso(texto) {
  const li = document.createElement('li')
  li.textContent = texto
  pasosList.appendChild(li)
  li.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function mostrarExito(msg) {
  step3Title.textContent = '¡Listo!'
  $('resultMsg').textContent = msg
  resultadoExito.classList.remove('hidden')
}

function mostrarError(msg) {
  step3Title.textContent = 'Hubo un problema'
  $('errorMsg').textContent = msg
  resultadoError.classList.remove('hidden')
}

btnNueva.addEventListener('click', () => { mostrarPaso(2); resetearPaso2() })
btnReintento.addEventListener('click', () => mostrarPaso(2))

// ── Init ──────────────────────────────────────────────────────────
cargarDatos()
mostrarPaso(1)
