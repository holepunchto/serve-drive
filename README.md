# serve-drive

HTTP drive server for entries delivery. Auto detects types like video, images, etc

```
npm i serve-drive
```

## Usage

Single drive:
```js
const serve = require('serve-drive')
const Localdrive = require('localdrive')

const drive = new Localdrive('./my-folder')
await drive.put('/index.html', Buffer.from('hi'))

const server = await serve(drive)
console.log('Listening on http://localhost:' + server.address().port)

// Try visit http://localhost:7000/index.html
```

Multiple drives:
```js
const drive1 = new Localdrive('./my-folder-a')
const drive2 = new Localdrive('./my-folder-b')

await drive1.put('/index.html', Buffer.from('a'))
await drive2.put('/index.html', Buffer.from('b'))

const drives = new Map()
drives.set('one', drive1) // For Hyperdrive: drive.key.toString('hex') or z32.encode(drive.key)
drives.set('two', drive2)

const server = await serve(drives)
console.log('Listening on http://localhost:' + server.address().port)

// Try visit http://localhost:7000/index.html?drive=two
```

## API

#### `const server = await serve(drive, [options])`

Creates a HTTP server that serves entries from a `Hyperdrive` or `Localdrive`.

It also accepts a `Map` of multiple drives. You can keep adding drives to the `Map` while server is running.\
Use a query param to select which one i.e. `/filename?drive=<map-key>`

Available `options`:
```js
{
  port: 7000,
  host: '0.0.0.0',
  anyPort: true,
  server: null
}
```

You could pass your own server instance, for example:
```js
const http = require('http')
const graceful = require('graceful-http')
const goodbye = require('graceful-goodbye')

const server = http.createServer()
const close = graceful(server)
await serve(drive, { server })

goodbye(() => close())
```

## License
MIT
