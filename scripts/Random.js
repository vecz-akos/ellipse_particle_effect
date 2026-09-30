// mulberry32, seeded through an xmur3 string hash. See "Seeded RNG" in
// docs/decisions.md for why this is hand-written rather than a package.
export default class Random {
    constructor(seed=Random.randomSeed()) {
        this.seed = String(seed)
        this.reset()
    }

    // Short, typeable, shareable — it ends up in the URL hash.
    static randomSeed() {
        return Math.random().toString(36).slice(2, 10)
    }

    static hash(str) {
        let h = 1779033703 ^ str.length
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
            h = h << 13 | h >>> 19
        }
        h = Math.imul(h ^ h >>> 16, 2246822507)
        h = Math.imul(h ^ h >>> 13, 3266489909)
        return (h ^ h >>> 16) >>> 0
    }

    // Restarts the stream from the seed, so the same seed replays the same run.
    reset() {
        this.state = Random.hash(this.seed)
    }

    next() {
        this.state = this.state + 0x6D2B79F5 | 0
        let t = Math.imul(this.state ^ this.state >>> 15, 1 | this.state)
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }

    between(min, max) {
        return min + this.next()*(max - min)
    }

    angle() {
        return this.next()*Math.PI*2
    }
}
