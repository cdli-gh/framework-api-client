/* eslint-env node */
const assert = require('node:assert/strict')
const http = require('node:http')
const { test } = require('node:test')
const { Client } = require('../src')

async function server (t, respond) {
    const instance = http.createServer(respond)
    await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => instance.close(resolve)))
    return `http://127.0.0.1:${instance.address().port}/`
}

for (const kind of ['pagination', 'redirect']) {
    test(`cross-origin ${kind} cannot receive cookies or CSRF tokens`, async t => {
        const received = []
        const target = await server(t, (request, response) => {
            received.push(request.headers)
            response.end('unexpected')
        })
        const host = await server(t, (request, response) => {
            if (kind === 'redirect') {
                response.writeHead(302, { Location: target })
            } else {
                response.setHeader('Content-Type', 'text/x-c-atf')
                response.setHeader('Link', `<${target}>; rel="next"`)
            }
            response.end('page 1\n')
        })
        const client = new Client(host)
        client._cookies = { session: 'fake-session', csrfToken: 'fake-csrf' }
        await assert.rejects(async () => {
            for await (const page of client._fetchPages('inscriptions', 'atf')) {
                assert.equal(typeof page, 'string')
            }
        }, /export host/)
        assert.deepEqual(received, [])
    })
}

test('same-origin redirects and relative pagination remain supported', async t => {
    const requests = []
    const host = await server(t, (request, response) => {
        requests.push(request.url)
        assert.match(request.headers.cookie, /fake-session/)
        assert.equal(request.headers['x-csrf-token'], 'fake-csrf')
        if (request.url === '/inscriptions') {
            response.writeHead(302, { Location: '/pages/1' })
        } else {
            response.setHeader('Content-Type', 'text/x-c-atf')
            if (request.url === '/pages/1') response.setHeader('Link', '<2>; rel="next"')
        }
        response.end(request.url + '\n')
    })
    const client = new Client(host)
    client._cookies = { session: 'fake-session', csrfToken: 'fake-csrf' }
    let output = ''
    for await (const page of client._fetchPages('inscriptions', 'atf')) output += page
    assert.equal(output, '/pages/1\n/pages/2\n')
    assert.deepEqual(requests, ['/inscriptions', '/pages/1', '/pages/2'])
})

test('login cannot forward credentials to another origin through redirects', async t => {
    const received = []
    const target = await server(t, (request, response) => {
        received.push(request.url)
        response.end()
    })
    const host = await server(t, (request, response) => {
        response.writeHead(307, { Location: target })
        response.end()
    })
    const client = new Client(host)
    client._cookies = { csrfToken: 'fake-csrf' }
    await assert.rejects(client.login('fake-user', 'fake-password'), /export host/)
    assert.deepEqual(received, [])
})

test('redirect loops stop after the configured bound', async t => {
    let requests = 0
    const host = await server(t, (request, response) => {
        requests++
        response.writeHead(302, { Location: '/loop' })
        response.end()
    })
    const client = new Client(host)
    await assert.rejects(client._request(host), /Too many redirects/)
    assert.equal(requests, 21)
})

test('URL validation rejects protocol downgrades and embedded credentials', () => {
    const client = new Client('https://example.com/')
    for (const url of ['http://example.com/page', 'https://user:password@example.com/page',
        'https://example.com:8443/page', 'file:///tmp/example', '//attacker.example/page']) {
        assert.throws(() => client._validateUrl(url), /export host/)
    }
})

test('login still follows same-origin redirects and submits the 2FA token', async t => {
    const requests = []
    const bodies = []
    const host = await server(t, async (request, response) => {
        requests.push(`${request.method} ${request.url}`)
        if (request.method === 'POST') {
            let body = ''
            for await (const chunk of request) body += chunk
            bodies.push(body)
        }
        if (request.url === '/login' && request.method === 'GET') {
            response.setHeader('Set-Cookie', 'csrfToken=fake-csrf; Path=/')
        } else if (request.url === '/login') {
            response.writeHead(302, { Location: '/two-factor', 'Set-Cookie': 'session=fake-session; Path=/' })
        } else if (request.method === 'POST') {
            response.writeHead(302, { Location: '/account' })
        }
        response.end('ok')
    })
    const client = new Client(host)
    await client.login('fake-user', 'fake-password', '123456')
    assert.deepEqual(requests, ['GET /login', 'POST /login', 'GET /two-factor', 'POST /two-factor'])
    assert.match(bodies[0], /fake-user/)
    assert.match(bodies[0], /fake-password/)
    assert.match(bodies[1], /123456/)
    assert.equal(client._cookies.session, 'fake-session')
})
