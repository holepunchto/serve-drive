const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Localdrive = require('localdrive')
const http = require('http')
const tmp = require('test-tmp')
const ServeDrive = require('../../index.js')

module.exports = {
  request,
  tmpServe,
  tmpHyperdrive,
  tmpLocaldrive
}

async function request (serve, path, opts) {
  const link = serve.getLink(path, opts)

  return new Promise((resolve, reject) => {
    const req = http.get(link, {
      headers: {
        Connection: 'close'
      }
    })

    req.on('error', reject)
    req.on('response', function (res) {
      let buf = ''

      res.setEncoding('utf-8')

      res.on('data', function (data) {
        buf += data
      })

      res.on('end', function () {
        resolve({ status: res.statusCode, data: buf })
      })
    })
  })
}

function tmpServe (t, opts) {
  const serve = new ServeDrive(opts)
  t.teardown(() => serve.close())
  return serve
}

function tmpHyperdrive (t) {
  const drive = new Hyperdrive(new Corestore(RAM))
  t.teardown(() => drive.close())
  return drive
}

async function tmpLocaldrive (t) {
  return new Localdrive(await tmp(t))
}
