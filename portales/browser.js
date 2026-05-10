import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export async function lanzarNavegador() {
  // En desarrollo puedes poner CHROME_EXECUTABLE_PATH en tu .env
  // apuntando a tu Chrome local para arrancar más rápido
  const executablePath = process.env.CHROME_EXECUTABLE_PATH
    || await chromium.executablePath()

  return puppeteer.launch({
    args: [...chromium.args, '--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1280, height: 900 },
    executablePath,
    headless: true,
  })
}
