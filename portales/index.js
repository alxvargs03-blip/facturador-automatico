import { facturarWalmart } from './walmart.js'
import { facturarChedraui } from './chedraui.js'

export async function procesarFactura(datosRecibo, datosFiscales, onPaso) {
  const tienda = (datosRecibo.tienda || '').toLowerCase().trim()

  switch (tienda) {
    case 'walmart':
    case 'aurrera':
      return facturarWalmart(datosRecibo, datosFiscales, onPaso)
    case 'chedraui':
      return facturarChedraui(datosRecibo, datosFiscales, onPaso)
    default:
      return {
        exitoso: false,
        mensaje: `Tienda "${datosRecibo.tienda || 'desconocida'}" no soportada. Solo Walmart, Bodega Aurrera y Chedraui.`
      }
  }
}
