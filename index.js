const http = require('http')
const rangeParser = require('range-parser')
const getMimeType = require('get-mime-type')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')
const { pipelinePromise } = require('streamx')
const unixPathResolve = require('unix-path-resolve')
const HypercoreId = require('hypercore-id-encoding')

module.exports = class ServeDrive extends ReadyResource {
  constructor (opts = {}) {
    super()

    this._getDrive = opts.get || nool
    this._releaseDrive = opts.release || noop
    this._resuming = null

    this.port = typeof opts.port !== 'undefined' ? Number(opts.port) : 49833
    this.host = typeof opts.host !== 'undefined' ? opts.host : null
    this.anyPort = opts.anyPort !== false

    this.suspended = false
    this.connections = new Set()
    this.server = this._createServer(opts.server || null)
  }

  async _open () {
    try {
      await listen(this.server, this.port, this.host)
    } catch (err) {
      if (!this.anyPort) throw err
      await listen(this.server, 0, this.host)
    }
    this.port = this.server.address().port
  }

  async _close () {
    if (this._resuming) await this._resuming
    await this._suspend(true)
  }

  _suspend (alsoServer) {
    return new Promise(resolve => {
      let waiting = 1

      if (alsoServer) {
        this.server.close(onclose)
        waiting++
      }
      this.server.unref()

      for (const c of this.connections) {
        waiting++
        c.on('close', onclose)
        c.destroy()
      }

      onclose() // clear the initial one

      function onclose () {
        if (--waiting === 0) resolve()
      }
    })
  }

  async suspend () {
    if (this.opened === false) await this.ready()
    if (this.suspended) return
    await this._suspend(false) // kill all pending connections, but keep server to try to keep the port...
    if (this.suspended) return // in case of parallel call for some reason
    this.suspended = true
    this.emit('suspend')
  }

  async resume () {
    if (!this.suspended || this.closing) return
    if (this._resuming === null) this._resuming = this._resume()
    await this._resuming
    if (!this.suspended) return
    this.server.ref()
    this._resuming = null
    this.suspended = false
    this.emit('resume')
  }

  async _resume () {
    await this._suspend(true)
    this.server = this._createServer(null)
    await this._open()
  }

  address () {
    return this.opened ? this.server.address() : null
  }

  getLink (path, opts = {}) {
    const proto = opts.https ? 'https' : 'http'
    const host = opts.host || (getHost(this.host) + ':' + this.address().port)
    const pathname = unixPathResolve('/', path)

    const params = []
    if (opts.key) params.push('roomKey=' + opts.roomKey)
    if (opts.key) params.push('key=' + opts.key)
    if (opts.version) params.push('version=' + opts.version)
    const query = params.length ? ('?' + params.join('&')) : ''

    return proto + '://' + host + encodePathName(pathname) + query
  }

  async _driveToRequest (req, res, key, drive, filename, version) {
    if (!drive) {
      res.writeHead(404)
      res.end()
      return
    }

    const snapshot = version ? drive.checkout(version) : drive
    if (snapshot !== drive) req.on('close', () => snapshot.close().catch(safetyCatch))

    let entry
    try {
      entry = await snapshot.entry(filename)
    } catch (e) {
      if (this.closing) return

      if (e.code === 'SNAPSHOT_NOT_AVAILABLE') {
        res.writeHead(404)
        res.end()
        return
      }

      throw e
    }

    if (this.closing) return

    if (!entry || !entry.value.blob) {
      res.writeHead(404)
      res.end()
      return
    }

    const contentType = getMimeType(filename)
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

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    const rs = snapshot.createReadStream(filename, { start, length })
    await pipelinePromise(rs, res)
  }

  _createServer (server) {
    if (!server) server = http.createServer()
    server.on('connection', this._onconnection.bind(this))
    server.on('request', this._onrequest.bind(this))
    return server
  }

  _onconnection (socket) {
    this.connections.add(socket)
    socket.on('close', () => this.connections.delete(socket))
  }

  async _onrequest (req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(400)
      res.end()
      return
    }

    const { pathname, searchParams } = parseURL(req.url)
    const filename = decodePathName(pathname)
    let key = searchParams.get('key') || null
    let roomKey = searchParams.get('roomKey') || null
    const version = parseInt(searchParams.get('version') || 0, 10)

    if (key !== null) {
      try {
        key = HypercoreId.decode(key)
      } catch (err) {
        safetyCatch(err)
        res.writeHead(400)
        res.end()
        return
      }
    }

    if (roomKey !== null) {
      try {
        roomKey = HypercoreId.decode(roomKey)
      } catch (err) {
        safetyCatch(err)
        res.writeHead(400)
        res.end()
        return
      }
    }

    if (Number.isNaN(version)) {
      res.writeHead(400)
      res.end()
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(400)
      res.end()
      return
    }

    let drive = null
    let error = null

    try {
      drive = await this._getDrive({ roomKey, key, filename, version })

      if (!this.closing) {
        await this._driveToRequest(req, res, key, drive, filename, version)
      }
    } catch (e) {
      safetyCatch(e)
      error = e
    }

    try {
      if (drive !== null) await this._releaseDrive({ key, drive })
    } catch (e) {
      safetyCatch(e)
      // Can technically overwrite the prev error, but we are ok with that as these
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

function nool () { return null }
function noop () {}

function getHost (address) {
  if (!address || address === '::' || address === '0.0.0.0') return 'localhost'
  return address
}

function parseURL (url) {
  const [pathname, query] = url.split('?')
  const queryParams = (query || '').split('&')
  const searchParams = new Map()

  for (const params of queryParams) {
    if (!params) continue

    const [key, value] = params.split('=')
    searchParams.set(key, value || null)
  }

  return { pathname, searchParams }
}

function encodePathName (pathname) {
  return pathname.split('/').map(encodeURIComponent).join('/')
}

function decodePathName (pathname) {
  return pathname.split('/').map(decodeURIComponent).join('/')
}
