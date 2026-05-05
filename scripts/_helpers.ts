import { createServer } from 'node:net'

/**
 * Asks the OS for a free TCP port, closes the probe socket, returns the port.
 * Use instead of `Bun.serve({ port: 0 })` because Bun in some environments
 * raises "Failed to start server. Is port 0 in use?" instead of binding
 * ephemerally.
 */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, () => {
      const addr = srv.address()
      if (typeof addr === 'object' && addr) {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        srv.close()
        reject(new Error('could not determine free port'))
      }
    })
  })
}
