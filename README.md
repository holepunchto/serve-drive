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

const serve = new ServeDrive()
serve.add(drive)
await serve.ready()
console.log('Listening on http://localhost:' + serve.address().port)

// Try visiting http://localhost:7000/index.html
```

Multiple drives:
```js
const drive1 = new Localdrive('./my-folder-a')
const drive2 = new Localdrive('./my-folder-b')
const drive3 = new Hyperdrive(corestore)

await drive1.put('/index.html', Buffer.from('a'))
await drive2.put('/index.html', Buffer.from('b'))
await drive3.put('/index.html', Buffer.from('c'))

const serve = new ServeDrive()

serve.add(drive1, { default: true })
serve.add(drive2, { alias: 'custom-alias' })
serve.add(drive3, { alias: drive3.key.toString('hex') })

await serve.ready()
console.log('Listening on http://localhost:' + serve.address().port)

// Try visiting http://localhost:7000/index.html?drive=custom-alias
```

## API

#### `const serve = new ServeDrive([options])`

Creates a HTTP server that serves entries from a `Hyperdrive` or `Localdrive`.

Use a query param to select which one i.e. `/filename?drive=<id-or-alias>`.

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
const serve = new ServeDrive({ server })
// serve.add(drive)

goodbye(() => close())
```

#### `serve.add(drive, [options])`

Add a drive to the server for serving requests.

Available `options`:
```js
{
  alias: '', // By default: z32 encoding of drive.key
  default: false
}
```

It always adds the drive using z32 encoding as id, even if you use `alias` which is just an extra name.

#### `serve.delete(drive, [options])`

Remove a drive from the server to stop serving requests.

Available `options`:
```js
{
  alias: '', // By default: z32 encoding of drive.key
  default: false
}
```

## License
MIT
