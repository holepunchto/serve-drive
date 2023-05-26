const http = require('http')
const rangeParser = require('range-parser')
const mime = require('mime-types')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')
const { pipelinePromise } = require('streamx')
const unixPathResolve = require('unix-path-resolve')

const LOCALHOST = '127.0.0.1'

module.exports = class ServeDrive extends ReadyResource {
  constructor (opts = {}) {
    super()

    if (!opts.getDrive) throw new Error('Must specify getDrive function')
    this.getDrive = opts.getDrive
    this.releaseDrive = opts.releaseDrive || noop

    this.port = typeof opts.port !== 'undefined' ? Number(opts.port) : 7000
    this.host = typeof opts.host !== 'undefined' ? opts.host : null
    this.anyPort = opts.anyPort !== false

    this.connections = new Set()
    this.server = opts.server || http.createServer()
    this.server.on('request', this._onrequest.bind(this))
    this.server.on('connection', c => {
      this.connections.add(c)
      c.on('close', () => this.connections.delete(c))
    })

    this._onfilter = opts.filter || alwaysTrue
  }

  async _open () {
    try {
      await listen(this.server, this.port, this.host)
    } catch (err) {
      if (!this.anyPort) throw err
      if (err.code !== 'EADDRINUSE') throw err
      await listen(this.server, 0, this.host)
    }
  }

  async _close () {
    for (const c of this.connections) {
      c.destroy()
    }
    if (this.opened) {
      await new Promise(resolve => this.server.close(() => resolve()))
    }
  }

  address () {
    return this.server.address()
  }

  getLink (path, id, version) {
    path = unixPathResolve('/', path)
    const { port } = this.address()

    let link = `http://${LOCALHOST}:${port}${path}`
    if (id || version) link += '?'
    if (id) link += `drive=${id}`

    if (id && version) link += '&'
    if (version) link += `checkout=${version}`
    return link
  }

  async _driveToRequest (drive, req, res, filename, id, version) {
    if (!drive) {
      res.writeHead(404)
      res.end()
      return
    }

    const snapshot = version ? drive.checkout(version) : drive
    if (version) req.on('close', () => snapshot.close().catch(safetyCatch))

    const isHEAD = req.method === 'HEAD'

    if (!(await this._onfilter(id, filename, snapshot))) {
      res.writeHead(404)
      res.end()
      return
    }

    if (this.closing) return

    let entry
    try {
      entry = await snapshot.entry(filename)
    } catch (e) {
      if (e.code === 'SNAPSHOT_NOT_AVAILABLE') {
        res.writeHead(404)
        res.end()
        return
      }
      throw e // bubble it up
    }

    if (this.closing) return

    if (!entry || !entry.value.blob) {
      res.writeHead(404)
      res.end()
      return
    }

    const contentType = mime.lookup(filename)
    res.setHeader('Content-Type', contentType === false ? 'application/octet-stream' : contentType)
    res.setHeader('Accept-Ranges', 'bytes')

    let start = 0
    let length = entry.value.blob.byteLength

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

      start = range.start
      length = byteLength
    } else {
      res.setHeader('Content-Length', entry.value.blob.byteLength)
    }

    if (isHEAD) {
      res.end()
      return
    }

    const rs = snapshot.createReadStream(filename, { start, length })
    await pipelinePromise(rs, res)
  }

  async _onrequest (req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(400)
      res.end()
      return
    }

    const { pathname, searchParams } = new URL(req.url, `http://${LOCALHOST}`)
    const version = searchParams.get('checkout')
    const id = searchParams.get('drive') // String or null
    const filename = decodeURI(pathname)

    let drive = null
    let error = null

    try {
      drive = await this.getDrive(id, filename)
      await this._driveToRequest(drive, req, res, filename, id, version)
    } catch (e) {
      safetyCatch(e)
      error = e
    }

    try {
      if (drive !== null) await this.releaseDrive(id, drive)
    } catch (e) {
      safetyCatch(e)
      // can technically can overwrite the prev error, but we are ok with that as these
      // are for simple reporting anyway and this is the important one.
      error = e
    }

    if (this.closing || error === null) return

    if (!res.headersSent) {
      res.writeHead(500)
      res.end()
    }

    this.emit('request-error', error)
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

function noop () {}

function alwaysTrue () {
  return true
}
