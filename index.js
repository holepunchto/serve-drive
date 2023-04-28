const http = require('http')
const rangeParser = require('range-parser')
const mime = require('mime-types')
const ReadyResource = require('ready-resource')
const z32 = require('z32')
const safetyCatch = require('safety-catch')

module.exports = class ServeDrive extends ReadyResource {
  constructor (opts = {}) {
    super()

    this.drives = new Map()

    this.port = typeof opts.port !== 'undefined' ? Number(opts.port) : 7000
    this.host = typeof opts.host !== 'undefined' ? opts.host : null
    this.anyPort = opts.anyPort !== false

    this.server = opts.server || http.createServer()
    this.server.on('request', this._onrequest.bind(this))

    this._onfilter = opts.filter
  }

  async _open () {
    await Promise.resolve() // Wait a tick, so you don't rely on server.address() being sync sometimes

    try {
      await listen(this.server, this.port, this.host)
    } catch (err) {
      if (!this.anyPort) throw err
      if (err.code !== 'EADDRINUSE') throw err
      await listen(this.server, 0, this.host)
    }
  }

  async _close () {
    if (!this.opened) await this._opening.catch(safetyCatch)

    if (this.server.listening) {
      await new Promise(resolve => this.server.close(() => resolve()))
    }
  }

  address () {
    return this.server.address()
  }

  add (drive, opts = {}) {
    if (opts.alias && opts.default) throw new Error('Can not use both alias and default')
    if (drive.key === null) throw new Error('Drive is not ready')
    if (!opts.default && !opts.alias && !drive.key) throw new Error('Localdrive needs an alias or to be the default')

    if (opts.default) this.drives.set(null, drive)
    if (opts.alias) this.drives.set(opts.alias, drive)

    if (drive.key) this.drives.set(z32.encode(drive.key), drive)
  }

  delete (drive, opts = {}) {
    if (opts.alias && opts.default) throw new Error('Can not use both alias and default')
    if (!drive.opened && drive.key === null) throw new Error('Drive is not ready')
    if (!opts.default && !opts.alias && !drive.key) throw new Error('Localdrive needs an alias or to be the default')

    if (opts.default) this.drives.delete(null)
    if (opts.alias) this.drives.delete(opts.alias)

    if (drive.key) this.drives.delete(z32.encode(drive.key))
  }

  async _onrequest (req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(400).end()
      return
    }

    const { pathname, searchParams } = new URL(req.url, 'http://localhost')

    const id = searchParams.get('drive') // String or null
    const drive = this.drives.get(id)

    if (!drive) {
      res.writeHead(404).end('DRIVE_NOT_FOUND')
      return
    }

    const version = searchParams.get('checkout')
    const snapshot = version ? drive.checkout(version) : drive
    const filename = decodeURI(pathname)

    if (this._onfilter && !this._onfilter(id, filename)) {
      res.writeHead(404).end('ENOENT')
      return
    }

    let entry
    try {
      entry = await snapshot.entry(filename)
    } catch (e) {
      const msg = e.code || e.message

      if (e.code === 'SNAPSHOT_NOT_AVAILABLE') res.writeHead(404)
      else res.writeHead(500)

      res.end(msg)
      return
    }

    if (!entry || !entry.value.blob) {
      res.writeHead(404).end('ENOENT')
      return
    }

    const contentType = mime.lookup(filename)
    res.setHeader('Content-Type', contentType === false ? 'application/octet-stream' : contentType)
    res.setHeader('Accept-Ranges', 'bytes')

    let rs

    if (req.headers.range) {
      const ranges = rangeParser(entry.value.blob.byteLength, req.headers.range)

      if (ranges === -1 || ranges === -2) {
        res.statusCode = 206
        res.setHeader('Content-Length', 0)
        res.end()
        return
      }

      const range = ranges[0]
      const byteLength = range.end - range.start + 1

      res.statusCode = 206
      res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + entry.value.blob.byteLength)
      res.setHeader('Content-Length', byteLength)

      rs = snapshot.createReadStream(filename, { start: range.start, length: byteLength })
    } else {
      res.setHeader('Content-Length', entry.value.blob.byteLength)

      rs = snapshot.createReadStream(filename, { start: 0, length: entry.value.blob.byteLength })
    }

    rs.pipe(res, safetyCatch)
    rs.on('close', () => this.emit('response', id))
  }
}

function listen (server, port, address) {
  return new Promise((resolve, reject) => {
    server.on('listening', done)
    server.on('error', done)

    if (address) server.listen(port, address)
    else server.listen(port)

    function done (err) {
      server.off('listening', done)
      server.off('error', done)

      if (err) reject(err)
      else resolve()
    }
  })
}
