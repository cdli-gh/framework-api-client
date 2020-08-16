const listeners = Symbol('listeners')

module.exports = class Emitter {
    constructor () {
        this[listeners] = {}
    }

    on (name, listener) {
        if (name in this[listeners]) {
            this[listeners][name].push(listener)
        } else {
            this[listeners][name] = [listener]
        }
    }

    remove (name, listener) {
        if (!(name in this[listeners])) {
            return false
        }

        const index = this[listeners][name].indexOf(listener)

        if (index < 0) {
            return false
        }

        this[listeners][name].splice(index, 1)

        return true
    }

    trigger (name, data) {
        if (!(name in this[listeners])) {
            return
        }

        for (const listener of this[listeners][name]) {
            listener(data)
        }
    }
}
