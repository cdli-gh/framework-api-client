const readline = require('readline')
const CDLI = require('./client')

function makeProgressBar (state, size = 50) {
    if (state.error) {
        return state.error
    }

    let message

    if (!state.current || !state.current.page) {
        message = ''
    } else if (!state.last || !state.last.page) {
        message = `page: ${state.current.page}`
    } else {
        const current = state.current.page
        const last = state.last.page
        const progress = Math.floor(size * current / last) || current > 0
        const bar = ('='.repeat(progress) + ' '.repeat(size - progress)).replace(/= /, '> ')

        message = `[${bar}] ${current}/${last}`
    }

    if (state.retry) {
        message += `, retry ${state.retry}`
    }

    return message
}

function logPageStates (pageStates) {
    const states = Object.entries(pageStates)
    const width = process.stdout.columns
    const doubleLineWidth = width - 23
    const singleLineWidth = doubleLineWidth - 32
    const progressMinWidth = 10

    return states
        .sort((a, b) => a[1].status - b[1].status)
        .flatMap(([name, state]) => {
            if (singleLineWidth >= progressMinWidth) {
                return name.padEnd(30, ' ') + ': ' + makeProgressBar(state, singleLineWidth)
            } else if (doubleLineWidth >= progressMinWidth) {
                return [name, makeProgressBar(state, doubleLineWidth)]
            }

            let line = name + ': ' + progress.replace(/^\[.+?\]/, '')
            if (line.length > width) {
                return line
            }

            const lines = []
            while (line.length > width) {
                lines.push(line.slice(0, width))
                line = line.slice(width)
            }

            return lines
        })
        .map(line => line.padEnd(width, ' ') + '\n')
        .slice(0, process.stdout.rows - 1)
}

function promisify (fn) {
    return (...args) => new Promise(resolve => fn(...args, resolve))
}

module.exports.getClient = async function (options) {
    const client = new CDLI.Client(options.host)

    const pageStates = {}
    let pageStatesHeight = 0
    client.on('entityStateChange', ({ label, ...state }) => {
        if (!pageStates[label]) {
            pageStates[label] = {}
        }

        Object.assign(pageStates[label], state)

        const log = logPageStates(pageStates)
        const cursor = pageStatesHeight ? `\u001b[${pageStatesHeight}F` : ''
        process.stderr.write(cursor + log.join(''))
        pageStatesHeight = log.length
    })

    if (options.auth) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const question = promisify(rl.question.bind(rl))
        const username = await question('username: ')
        const password = await question('password: ')
        const token = await question('2FA token: ')
        await client.login(username, password, token)
    }

    return client
}
