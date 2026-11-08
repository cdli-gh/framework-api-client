const fs = require('fs/promises')
const path = require('path')
const { createHash, randomBytes } = require('crypto')

async function save (name, state) {
    const temporary = name + '.' + randomBytes(8).toString('hex') + '.tmp'
    const file = await fs.open(temporary, 'wx', 0o600)
    try {
        await file.writeFile(JSON.stringify(state, null, 2) + '\n')
        await file.sync()
        await file.close()
        await fs.rename(temporary, name)
    } finally {
        await file.close()
        await fs.unlink(temporary).catch(error => {
            if (error.code !== 'ENOENT') throw error
        })
    }
}

async function backupOutput (file, output, size) {
    const name = output + '.recovery-' + randomBytes(8).toString('hex')
    const backup = await fs.open(name, 'wx', 0o600)
    try {
        const buffer = Buffer.alloc(64 * 1024)
        let position = 0
        while (position < size) {
            const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - position), position)
            if (!bytesRead) throw new Error('Output changed while creating recovery backup')
            let written = 0
            while (written < bytesRead) {
                const result = await backup.write(buffer, written, bytesRead - written, position + written)
                if (!result.bytesWritten) throw new Error('Could not write recovery backup')
                written += result.bytesWritten
            }
            position += bytesRead
        }
        await backup.sync()
    } finally {
        await backup.close()
    }
    return name
}

module.exports = async function (client, format, entities, fileName, options) {
    if ((options.resume && options.checkpoint) ||
        typeof (options.resume || options.checkpoint) !== 'string' ||
        !fileName || !Array.isArray(entities) || !entities.length ||
        entities.some(entity => typeof entity !== 'string' || !entity)) {
        throw new Error('Use either checkpoint or resume, with entities and an output file')
    }
    const name = path.resolve(options.resume || options.checkpoint)
    if (name === path.resolve(fileName)) {
        throw new Error('Checkpoint and output must be separate files')
    }
    const hash = createHash('sha256')
    let state
    if (options.resume) {
        state = JSON.parse(await fs.readFile(name, 'utf8'))
        if (!state || state.version !== 1 || state.host !== client.base || state.format !== format ||
            !fileName || state.output !== path.resolve(fileName) ||
            JSON.stringify(state.entities) !== JSON.stringify(entities) ||
            !Number.isSafeInteger(state.offset) || state.offset < 0 ||
            !Number.isInteger(state.entity) || state.entity < 0 || state.entity > entities.length ||
            typeof state.hasHeader !== 'boolean' ||
            typeof state.digest !== 'string' || !/^[a-f0-9]{64}$/.test(state.digest) ||
            (state.next !== null && (typeof state.next !== 'string' || !state.next)) ||
            (state.entity === entities.length && state.next !== null)) {
            throw new Error('Checkpoint does not match this export or is invalid')
        }
        if (state.next) client._validateUrl(state.next)
    } else {
        state = {
            version: 1,
            host: client.base,
            format,
            entities,
            output: path.resolve(fileName),
            offset: 0,
            digest: hash.copy().digest('hex'),
            entity: 0,
            next: client.base + entities[0],
            hasHeader: false
        }
    }
    let file
    let reservedCheckpoint = false
    let initialized = false
    try {
        if (!options.resume) {
            const checkpoint = await fs.open(name, 'wx', 0o600)
            await checkpoint.close()
            reservedCheckpoint = true
        } else if (await fs.realpath(name) === await fs.realpath(state.output)) {
            throw new Error('Checkpoint and output must be separate files')
        }
        file = await fs.open(state.output, options.resume ? 'r+' : 'wx', 0o600)
        const outputStat = await file.stat()
        const checkpointStat = await fs.stat(name)
        if (!outputStat.isFile() ||
            (outputStat.dev === checkpointStat.dev && outputStat.ino === checkpointStat.ino)) {
            throw new Error('Output must be a regular file separate from its checkpoint')
        }
        if (outputStat.size < state.offset) {
            throw new Error('Output file is shorter than the saved checkpoint')
        }
        if (options.resume) {
            const buffer = Buffer.alloc(64 * 1024)
            let position = 0
            while (position < state.offset) {
                const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, state.offset - position), position)
                if (!bytesRead) throw new Error('Output file is shorter than the saved checkpoint')
                hash.update(buffer.subarray(0, bytesRead))
                position += bytesRead
            }
            if (hash.copy().digest('hex') !== state.digest) {
                throw new Error('Output file has changed since the checkpoint was saved')
            }
        } else {
            await file.sync()
            await save(name, state)
        }
        initialized = true
        // The checkpoint is not authenticated. Preserve all existing bytes before
        // any destructive recovery, even when a supplied checkpoint is forged.
        if (options.resume && outputStat.size > state.offset) {
            const backup = await backupOutput(file, state.output, outputStat.size)
            client.trigger('recoveryBackup', { path: backup })
        }
        await file.truncate(state.offset)
        for (; state.entity < entities.length;) {
            const entity = entities[state.entity]
            client.trigger('entityStateChange', { label: entity, status: 0 })
            for await (const page of client._fetchPages(entity, format, entity, state)) {
                const buffer = Buffer.from(page.data)
                let written = 0
                while (written < buffer.length) {
                    const result = await file.write(buffer, written, buffer.length - written, state.offset + written)
                    if (!result.bytesWritten) throw new Error('Could not write export page')
                    written += result.bytesWritten
                }
                await file.sync()
                state.offset += buffer.length
                hash.update(buffer)
                state.digest = hash.copy().digest('hex')
                state.next = page.next
                state.hasHeader = Boolean(page.hasHeader)
                await save(name, state)
            }
            state.entity++
            state.next = state.entity < entities.length ? client.base + entities[state.entity] : null
            state.hasHeader = false
            await save(name, state)
        }
        return entities.map(() => ({ status: 'fulfilled', value: undefined }))
    } finally {
        if (file) await file.close()
        if (reservedCheckpoint && !initialized) {
            await fs.unlink(name)
            if (file) await fs.unlink(state.output)
        }
    }
}
