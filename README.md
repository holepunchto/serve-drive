# serve-drive

HTTP drive server for entries delivery. Auto detects types like video, images, etc

```
npm i serve-drive
```

## Usage

Single drive:
```js
const ServeDrive = require('serve-drive')
const Localdrive = require('localdrive')

const drive = new Localdrive('./my-folder')
await drive.put('/index.html', Buffer.from('hi'))

const serve = new ServeDrive({ getDrive: (id, filename) => drive })
await serve.ready()
console.log('Listening on http://localhost:' + serve.address().port)

// Try visiting http://localhost:7000/index.html
```

Multiple drives:
```js
const Localdrive = require('localdrive')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')

const drive1 = new Localdrive('./my-folder-a')
const drive2 = new Localdrive('./my-folder-b')
const drive3 = new Hyperdrive(new Corestore('store'))

await drive1.put('/index.html', Buffer.from('a'))
await drive2.put('/index.html', Buffer.from('b'))
await drive3.put('/index.html', Buffer.from('c'))

const getDrive = (id, filename) => {
  if (id == null) return drive1 // default
  if (id === 'custom-alias') return drive2
  if (id === drive3.key.toString('hex')) return drive3
  return null
}
const serve = new ServeDrive({ getDrive })

await serve.ready()
console.log('Listening on http://localhost:' + serve.address().port)

// Try visiting http://localhost:7000/index.html?drive=custom-alias
```

## API

#### `const serve = new ServeDrive([options])`

Creates a HTTP server that serves entries from a `Hyperdrive` or `Localdrive`.

`getDrive` is a required option. Given an id, it should return either a drive or null (indicating the drive is not available)

Use the `drive` query param to select which drive to use, i.e. `/filename?drive=<id>`.

Available `options`:
```js
{
  releaseDrive: (id) => {},
  port: 7000,
  host: '0.0.0.0',
  anyPort: true,
  server: null
}
```

The `releaseDrive` function is called with the drive `id` whenever a request finishes.

You could pass your own server instance, for example:
```js
const ServeDrive = require('serve-drive')
const Localdrive = require('localdrive')
const http = require('http')
const graceful = require('graceful-http')
const goodbye = require('graceful-goodbye')

const server = http.createServer()
const close = graceful(server)
const drive = new Localdrive('./my-folder')

const serve = new ServeDrive({
  getDrive: (id, filename) => drive,
  server
})
await serve.ready()
console.log('server ready')

goodbye(() => close())
```

#### `serve.getLink(path, id, version)`

Gets a link to the file at the given path.

Optional `id` specifies the drive, and `version` a particular version.

## License

Apache-2.0
