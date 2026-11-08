/* eslint-env node */
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { promisify } = require('node:util')
const { Client } = require('../src')

const run = promisify(execFile)
const cli = path.join(__dirname, '..', 'cli.js')

async function fixture (t, format = 'ndjson', emptyFirst = false, failureCode = 500) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cdli-resume-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const requests = []
    let failure = true
    const tabular = format === 'csv' || format === 'tsv'
    const header = format === 'csv' ? 'id,text\r\n' : 'id\ttext\r\n'
    const chunks = tabular
        ? [header + '1,šarrum\r\n', header + '2,lugal\r\n', header + '3,end\r\n']
        : ['&P000001\n1. šarrum\n', '&P000002\n1. lugal\n', '&P000003\n1. end\n']
    const server = http.createServer((request, response) => {
        requests.push(request.url)
        const url = new URL(request.url, 'http://localhost')
        const page = Number(url.searchParams.get('page') || 1)
        if (page === 2 && failure) {
            if (!failureCode) {
                response.destroy()
                return
            }
            response.writeHead(failureCode)
            response.end('interrupted')
            return
        }
        response.setHeader('Content-Type', request.headers.accept)
        if (page < 3) {
            response.setHeader('Link', `<http://${request.headers.host}${url.pathname}?page=${page + 1}>; rel="next"`)
        }
        response.end(emptyFirst && page === 1 ? '' : chunks[page - 1])
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => server.close(resolve)))
    const host = `http://127.0.0.1:${server.address().port}/`
    const client = new Client(host)
    const output = path.join(directory, 'output')
    const checkpoint = path.join(directory, 'progress.json')
    const entities = ['inscriptions']
    const start = () => client.export(format, entities, output, { checkpoint })
    const resume = () => client.export(format, entities, output, { resume: checkpoint })
    const expected = chunks.map((chunk, i) => {
        if (emptyFirst && i === 0) return ''
        return tabular && i > (emptyFirst ? 1 : 0) ? chunk.slice(chunk.indexOf('\n') + 1) : chunk
    }).join('')
    return {
        client,
        host,
        requests,
        output,
        checkpoint,
        entities,
        start,
        resume,
        expected,
        recover: () => { failure = false }
    }
}

for (const format of ['ndjson', 'csv', 'tsv', 'atf']) {
    test(`${format}: resume downloads only remaining pages and removes uncommitted bytes`, async t => {
        const f = await fixture(t, format)
        await assert.rejects(f.start(), /returned code 500/)
        const state = JSON.parse(await fs.readFile(f.checkpoint, 'utf8'))
        assert.equal(state.offset, (await fs.stat(f.output)).size)
        assert.match(state.next, /page=2$/)
        // Simulate a crash after writing a page but before checkpointing it.
        await fs.appendFile(f.output, 'uncommitted bytes\n')
        const original = await fs.readFile(f.output)
        const backups = []
        f.client.on('recoveryBackup', event => backups.push(event.path))
        f.recover()
        await f.resume()
        assert.equal(backups.length, 1)
        assert.deepEqual(await fs.readFile(backups[0]), original)
        assert.equal(await fs.readFile(f.output, 'utf8'), f.expected)
        assert.deepEqual(f.requests, ['/inscriptions', '/inscriptions?page=2',
            '/inscriptions?page=2', '/inscriptions?page=3'])
        const requests = f.requests.length
        await f.resume()
        assert.equal(backups.length, 1)
        assert.equal(f.requests.length, requests)
        assert.equal(await fs.readFile(f.output, 'utf8'), f.expected)
    })
}

test('empty first CSV page does not suppress the first actual header', async t => {
    const f = await fixture(t, 'csv', true)
    await assert.rejects(f.start())
    f.recover()
    await f.resume()
    assert.equal(await fs.readFile(f.output, 'utf8'), f.expected)
})

test('forged zero-offset checkpoint preserves all existing data in a recovery backup', async t => {
    const f = await fixture(t)
    const original = 'existing data that must not be lost\n'
    await fs.writeFile(f.output, original)
    await fs.writeFile(f.checkpoint, JSON.stringify({
        version: 1,
        host: f.host,
        format: 'ndjson',
        entities: f.entities,
        output: f.output,
        offset: 0,
        digest: createHash('sha256').digest('hex'),
        entity: f.entities.length,
        next: null,
        hasHeader: false
    }))
    const backups = []
    f.client.on('recoveryBackup', event => backups.push(event.path))
    await f.resume()
    assert.equal(backups.length, 1)
    assert.equal(await fs.readFile(backups[0], 'utf8'), original)
    assert.deepEqual(f.requests, [])
})

test('backup failure leaves the output and checkpoint unchanged', async t => {
    const f = await fixture(t)
    await assert.rejects(f.start())
    await fs.appendFile(f.output, 'uncommitted data')
    const original = await fs.readFile(f.output)
    const checkpoint = await fs.readFile(f.checkpoint)
    const open = fs.open
    t.mock.method(fs, 'open', async function (name, ...args) {
        if (name.includes('.recovery-')) throw new Error('Simulated disk full')
        return open.call(this, name, ...args)
    })
    await assert.rejects(f.resume(), /disk full/)
    assert.deepEqual(await fs.readFile(f.output), original)
    assert.deepEqual(await fs.readFile(f.checkpoint), checkpoint)
})

test('hard-linked checkpoint and output are rejected without modifying either', async t => {
    const f = await fixture(t)
    const state = JSON.stringify({
        version: 1,
        host: f.host,
        format: 'ndjson',
        entities: f.entities,
        output: f.output,
        offset: 0,
        digest: createHash('sha256').digest('hex'),
        entity: f.entities.length,
        next: null,
        hasHeader: false
    })
    await fs.writeFile(f.checkpoint, state)
    await fs.link(f.checkpoint, f.output)
    await assert.rejects(f.resume(), /separate/)
    assert.equal(await fs.readFile(f.output, 'utf8'), state)
    assert.equal(await fs.readFile(f.checkpoint, 'utf8'), state)
})

test('resume rejects changed output without truncating it or making requests', async t => {
    const f = await fixture(t)
    await assert.rejects(f.start())
    const buffer = await fs.readFile(f.output)
    buffer[0] = 33
    await fs.writeFile(f.output, buffer)
    const requests = f.requests.length
    await assert.rejects(f.resume(), /has changed/)
    assert.deepEqual(await fs.readFile(f.output), buffer)
    assert.equal(f.requests.length, requests)
})

test('resume rejects truncated output', async t => {
    const f = await fixture(t)
    await assert.rejects(f.start())
    await fs.truncate(f.output, 1)
    await assert.rejects(f.resume(), /shorter/)
    assert.equal((await fs.stat(f.output)).size, 1)
})

test('mismatched options and invalid checkpoints preserve output', async t => {
    const f = await fixture(t)
    await assert.rejects(f.start())
    const original = await fs.readFile(f.output)
    const options = { resume: f.checkpoint }
    await assert.rejects(f.client.export('csv', f.entities, f.output, options), /does not match/)
    await assert.rejects(f.client.export('ndjson', ['artifacts'], f.output, options), /does not match/)
    const state = JSON.parse(await fs.readFile(f.checkpoint, 'utf8'))
    for (const change of [{ offset: -1 }, { entity: 10 }, { next: 'https://example.com/' }]) {
        await fs.writeFile(f.checkpoint, JSON.stringify({ ...state, ...change }))
        await assert.rejects(f.resume(), /invalid|export host/)
    }
    await fs.writeFile(f.checkpoint, 'null')
    await assert.rejects(f.resume(), /invalid/)
    assert.deepEqual(await fs.readFile(f.output), original)
    assert.equal(f.requests.length, 2)
})

test('new checkpoint exports refuse to overwrite either existing file', async t => {
    const f = await fixture(t)
    await fs.writeFile(f.output, 'existing output')
    await assert.rejects(f.start(), { code: 'EEXIST' })
    assert.equal(await fs.readFile(f.output, 'utf8'), 'existing output')
    await assert.rejects(fs.access(f.checkpoint), { code: 'ENOENT' })
    await fs.unlink(f.output)
    await fs.writeFile(f.checkpoint, 'existing checkpoint')
    await assert.rejects(f.start(), { code: 'EEXIST' })
    await assert.rejects(fs.access(f.output), { code: 'ENOENT' })
    assert.equal(await fs.readFile(f.checkpoint, 'utf8'), 'existing checkpoint')
    assert.deepEqual(f.requests, [])
})

test('multiple entities resume sequentially and completed entity boundaries are recoverable', async t => {
    const f = await fixture(t)
    f.recover()
    const entities = ['inscriptions', 'artifacts']
    await f.client.export('ndjson', entities, f.output, { checkpoint: f.checkpoint })
    assert.equal(await fs.readFile(f.output, 'utf8'), f.expected.repeat(2))
    const state = JSON.parse(await fs.readFile(f.checkpoint, 'utf8'))
    // Simulate the final page being saved before its entity was marked complete.
    state.entity--
    state.hasHeader = true
    await fs.writeFile(f.checkpoint, JSON.stringify(state))
    const count = f.requests.length
    await f.client.export('ndjson', entities, f.output, { resume: f.checkpoint })
    assert.equal(f.requests.length, count)
    assert.equal(await fs.readFile(f.output, 'utf8'), f.expected.repeat(2))
})

test('CLI reports interruption with exit code 1 and resumes in a new process', async t => {
    const f = await fixture(t, 'atf')
    const args = [cli, 'export', '--host', f.host, '--entities', 'inscriptions',
        '--format', 'atf', '--output-file', f.output]
    await assert.rejects(run(process.execPath, [...args, '--checkpoint', f.checkpoint], { timeout: 10000 }),
        error => error.code === 1 && /returned code 500/.test(error.stderr))
    f.recover()
    await run(process.execPath, [...args, '--resume', f.checkpoint], { timeout: 10000 })
    assert.equal(await fs.readFile(f.output, 'utf8'), f.expected)
})

test('checkpoint options require a file, entities and a supported format', async t => {
    const f = await fixture(t)
    await assert.rejects(f.client.export('ndjson', [], f.output, { checkpoint: f.checkpoint }))
    await assert.rejects(f.client.export('ndjson', f.entities, undefined, { checkpoint: f.checkpoint }))
    await assert.rejects(f.client.export('ndjson', f.entities, f.output, { checkpoint: f.output }))
    await assert.rejects(f.client.export('unknown', f.entities, f.output, { checkpoint: f.checkpoint }), /unknown/)
    await assert.rejects(f.client.export('ndjson', f.entities, f.output,
        { checkpoint: f.checkpoint, resume: f.checkpoint }))
    assert.deepEqual(f.requests, [])
    await assert.rejects(fs.access(f.output), { code: 'ENOENT' })
    await assert.rejects(fs.access(f.checkpoint), { code: 'ENOENT' })
})

test('504 retry continues within the same checkpoint export', async t => {
    const f = await fixture(t, 'atf', false, 504)
    f.client.retryDelay = 0
    f.client.on('entityStateChange', state => {
        if (state.retry === 1) f.recover()
    })
    await f.start()
    assert.equal(await fs.readFile(f.output, 'utf8'), f.expected)
    assert.deepEqual(f.requests, ['/inscriptions', '/inscriptions?page=2',
        '/inscriptions?page=2', '/inscriptions?page=3'])
})

test('connection loss leaves a checkpoint that can be resumed', async t => {
    const f = await fixture(t, 'atf', false, 0)
    await assert.rejects(f.start(), /socket hang up/)
    f.recover()
    await f.resume()
    assert.equal(await fs.readFile(f.output, 'utf8'), f.expected)
})

test('ordinary CLI exports still follow pagination without creating checkpoints', async t => {
    const f = await fixture(t, 'atf')
    f.recover()
    const result = await run(process.execPath, [cli, 'export', '--host', f.host,
        '--entities', 'inscriptions', '-f', 'atf'], { timeout: 10000 })
    assert.equal(result.stdout, f.expected)
    assert.equal(f.requests.length, 3)
    await assert.rejects(fs.access(f.checkpoint), { code: 'ENOENT' })
})
