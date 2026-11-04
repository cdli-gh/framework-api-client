/* eslint-env node */
const assert = require('node:assert/strict')
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

async function fixture (t, respond) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cdli-export-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const requests = []
    const server = http.createServer((request, response) => {
        requests.push(request.url)
        respond(request, response)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => server.close(resolve)))
    const host = `http://127.0.0.1:${server.address().port}/`
    return { directory, requests, host }
}

test('library rejects invalid ATF exports without requests or file side effects', async t => {
    const { directory, requests, host } = await fixture(t, (request, response) => {
        response.end('unexpected request')
    })
    const client = new Client(host)
    const existing = path.join(directory, 'existing.atf')
    const missing = path.join(directory, 'new.atf')
    await fs.writeFile(existing, 'keep this content')

    for (const file of [existing, missing]) {
        await assert.rejects(client.export('atf', ['artifacts'], file), {
            name: 'TypeError',
            message: /Cannot export "artifacts" as "atf".*--entities inscriptions --format atf/
        })
    }
    // Let any mistakenly scheduled file opens complete before checking.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await fs.readFile(existing, 'utf8'), 'keep this content')
    await assert.rejects(fs.access(missing), { code: 'ENOENT' })
    assert.deepEqual(requests, [])
})

test('mixed exports validate every entity before starting any downloads', async t => {
    const { requests, host } = await fixture(t, (request, response) => response.end())
    const client = new Client(host)
    const states = []
    client.on('entityStateChange', state => states.push(state))
    await assert.rejects(client.export('atf', ['inscriptions', 'artifacts']), /Cannot export/)
    assert.deepEqual(requests, [])
    assert.deepEqual(states, [])
})

test('CLI rejects invalid entities and indexes before authentication or output creation', async t => {
    const { directory, requests, host } = await fixture(t, (request, response) => response.end())
    const output = path.join(directory, 'file.atf')
    for (const option of ['--entities', '--index']) {
        await assert.rejects(
            run(process.execPath, [cli, 'export', '--host', host, option, 'artifacts',
                '--format', 'atf', '--output-file', output, '--auth'], { timeout: 5000 }),
            error => {
                assert.equal(error.code, 1)
                assert.equal(error.stdout, '')
                assert.match(error.stderr, /Cannot export "artifacts" as "atf"/)
                assert.match(error.stderr, /--entities inscriptions --format atf/)
                assert.doesNotMatch(error.stderr, /username:/)
                return true
            }
        )
    }
    await assert.rejects(fs.access(output), { code: 'ENOENT' })
    assert.deepEqual(requests, [])
})

test('CLI validation preserves an existing output file', async t => {
    const { directory, host } = await fixture(t, (request, response) => response.end())
    const output = path.join(directory, 'existing.atf')
    await fs.writeFile(output, 'original content')
    await assert.rejects(run(process.execPath, [cli, 'export', '--host', host,
        '--entities', 'artifacts', '-f', 'atf', '-o', output], { timeout: 5000 }),
    { code: 1 })
    assert.equal(await fs.readFile(output, 'utf8'), 'original content')
})

test('valid inscription ATF export continues past an empty page', async t => {
    const { requests, host } = await fixture(t, (request, response) => {
        response.setHeader('Content-Type', 'text/x-c-atf; charset=UTF-8')
        if (request.url === '/inscriptions') {
            response.setHeader('Link', `<http://${request.headers.host}/inscriptions?page=2>; rel="next"`)
            response.end('')
        } else {
            response.end('&P000001 = example\n1. text\n')
        }
    })
    const result = await run(process.execPath, [cli, 'export', '--host', host,
        '--entities', 'inscriptions', '-f', 'atf'], { timeout: 5000 })
    assert.equal(result.stdout, '&P000001 = example\n1. text\n')
    assert.deepEqual(requests, ['/inscriptions', '/inscriptions?page=2'])
})

test('other artifact formats, default format, and custom indexes remain available', async t => {
    const { requests, host } = await fixture(t, (request, response) => {
        response.setHeader('Content-Type', request.headers.accept)
        response.end('example data\n')
    })
    for (const args of [
        ['--entities', 'artifacts', '-f', 'csv'],
        ['--entities', 'artifacts'],
        ['--index', 'custom-inscriptions', '-f', 'atf']
    ]) {
        const result = await run(process.execPath, [cli, 'export', '--host', host, ...args], { timeout: 5000 })
        assert.equal(result.stdout, 'example data\n')
    }
    assert.deepEqual(requests, ['/artifacts', '/artifacts', '/custom-inscriptions'])
})

test('search ATF is unaffected and an empty result remains valid', async t => {
    const { requests, host } = await fixture(t, (request, response) => {
        response.setHeader('Content-Type', 'text/x-c-atf')
        response.end('')
    })
    const result = await run(process.execPath, [cli, 'search', '--host', host,
        '-q', 'example', '-f', 'atf'], { timeout: 5000 })
    assert.equal(result.stdout, '')
    assert.equal(requests.length, 1)
    assert.match(requests[0], /^\/search\?/)
})
