const http = require('http')
const rangeParser = require('range-parser')
const mime = require('mime-types')

module.exports = async function serve (drive, opts = {}) {
  const port = typeof opts.port !== 'undefined' ? Number(opts.port) : 7000
  const host = typeof opts.host !== 'undefined' ? opts.host : null
  const anyPort = opts.anyPort !== false

  const server = opts.server || http.createServer()

  server.on('request', async function (req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(400).end()
      return
    }

    const { pathname } = new URL(req.url, 'http://localhost')
    const filename = decodeURI(pathname)
    const entry = await drive.entry(filename)

    if (!entry || !entry.value.blob) {
      res.writeHead(404).end()
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

      rs = drive.createReadStream(filename, { start: range.start, length: byteLength })
    } else {
      res.setHeader('Content-Length', entry.value.blob.byteLength)

      rs = drive.createReadStream(filename, { start: 0, length: entry.value.blob.byteLength })
    }

    rs.pipe(res, noop)
  })

  try {
    await listen(server, port, host)
  } catch (err) {
    if (!anyPort) throw err
    if (err.code !== 'EADDRINUSE') throw err
    await listen(server, 0, host)
  }

  return server
}

function listen (server, port, address) {
  return new Promise((resolve, reject) => {
    socket.on('listening', done)
    socket.on('error', done)

    if (address) server.listen(port, address)
    else server.listen(port)

    function done (err) {
      socket.off('listening', done)
      socket.off('error', done)

      if (err) reject(err)
      else resolve()
    }
  })
}

function noop () {}
