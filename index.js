const http = require('http')
const rangeParser = require('range-parser')
const mime = require('mime-types')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')
const { pipelinePromise } = require('streamx')

module.exports = class ServeDrive extends ReadyResource {
  constructor (getDrive, releaseDrive, opts = {}) {
    super()

    this.getDrive = getDrive
    this.releaseDrive = releaseDrive

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

  getLink (path, id, version) {
    const { port } = this.address()

    let link = `http://localhost:${port}/${path}`
    if (id || version) link += '?'
    if (id) link += `drive=${id}`

    if (id && version) link += '&'
    if (version) link += `checkout=${version}`
    return link
  }

  async _driveToRequest (drive, req, res, pathname, { id, version }) {
    if (!drive) {
      res.writeHead(404).end('DRIVE_NOT_FOUND')
      return
    }

    const snapshot = version ? drive.checkout(version) : drive
    if (version) res.on('close', () => snapshot.close())

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

    await pipelinePromise(rs, res)
  }

  async _onrequest (req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(400).end()
      return
    }

    const { pathname, searchParams } = new URL(req.url, 'http://localhost')
    const version = searchParams.get('checkout')
    const id = searchParams.get('drive') // String or null

    const drive = await this.getDrive(id)

    try {
      await this._driveToRequest(drive, req, res, pathname, { version, id })
    } finally {
      await this.releaseDrive(id)
    }
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
