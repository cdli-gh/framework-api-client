const readline = require('readline')
const CDLI = require('./client')

function promisify (fn) {
    return (...args) => new Promise(resolve => fn(...args, resolve))
}

module.exports.getClient = async function (options) {
    const client = new CDLI.Client(options.host)
    client.on('log', msg => process.stderr.write(msg))

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
