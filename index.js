const http = require('http')
const rangeParser = require('range-parser')
const mime = require('mime-types')
const z32 = require('z32')
const safetyCatch = require('safety-catch')

module.exports = class ServeDrive {
  constructor (drives, opts = {}) {
    if (!(drives instanceof Map)) {
      const drive = drives
      drives = new Map()
      drives.set(null, drive)
    }

    this.drives = drives

    this.port = typeof opts.port !== 'undefined' ? Number(opts.port) : 7000
    this.host = typeof opts.host !== 'undefined' ? opts.host : null
    this.anyPort = opts.anyPort !== false

    this.server = opts.server || http.createServer()
    this.server.on('request', this._onrequest.bind(this))

    this._closing = null
    this._opening = this._ready()
    this._opening.catch(safetyCatch)
  }

  ready () {
    return this._opening
  }

  async _ready () {
    try {
      await listen(this.server, this.port, this.host)
    } catch (err) {
      if (!this.anyPort) throw err
      if (err.code !== 'EADDRINUSE') throw err
      await listen(this.server, 0, this.host)
    }

    this.opened = true
  }

  async close () {
    if (this._closing) return this._closing
    this._closing = this._close()
    return this._closing
  }

  async _close () {
    if (this.closed) return
    this.closed = true

    if (!this.opened) await this._opening.catch(safetyCatch)

    if (this.server.listening) {
      await new Promise(resolve => this.server.close(() => resolve()))
    }
  }

  address () {
    return this.server.address()
  }

  add (drive, opts) {
    const id = opts && opts.default ? null : z32.encode(drive.key)
    this.drives.set(id, drive)
  }

  delete (drive, opts) {
    const id = opts && opts.default ? null : z32.encode(drive.key)
    this.drives.delete(id)
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
