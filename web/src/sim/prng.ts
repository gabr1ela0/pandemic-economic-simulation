// Seedable PRNG (mulberry32) plus the random distributions used by the sim.
// Pure JS, deterministic for a given seed — replaces numpy's default_rng.

export class PRNG {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
    // Mulberry32 has a degenerate state at 0 — bump it.
    if (this.state === 0) this.state = 0x9e3779b9
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Float32Array of n uniform [0, 1) samples. */
  random(n: number): Float32Array {
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = this.next()
    return out
  }

  /** Float32Array of n uniform [low, high) samples. */
  uniform(low: number, high: number, n: number): Float32Array {
    const range = high - low
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = low + this.next() * range
    return out
  }

  /** Box-Muller: n samples from N(mean, std^2). */
  normal(mean: number, std: number, n: number): Float32Array {
    const out = new Float32Array(n)
    for (let i = 0; i < n; i += 2) {
      const u1 = Math.max(this.next(), 1e-10)
      const u2 = this.next()
      const r = Math.sqrt(-2 * Math.log(u1))
      const theta = 2 * Math.PI * u2
      out[i] = mean + std * r * Math.cos(theta)
      if (i + 1 < n) out[i + 1] = mean + std * r * Math.sin(theta)
    }
    return out
  }

  /** Sample k unique indices from 0..n-1 (without replacement). */
  choice(n: number, k: number): Int32Array {
    if (k <= 0) return new Int32Array(0)
    if (k >= n) {
      const out = new Int32Array(n)
      for (let i = 0; i < n; i++) out[i] = i
      return out
    }
    // Partial Fisher-Yates: O(k) draws against an O(n) pool.
    const pool = new Int32Array(n)
    for (let i = 0; i < n; i++) pool[i] = i
    const out = new Int32Array(k)
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(this.next() * (n - i))
      const tmp = pool[i]
      pool[i] = pool[j]
      pool[j] = tmp
      out[i] = pool[i]
    }
    return out
  }

  /** Sample with replacement from a pool of size n. */
  choiceWithReplacement(values: Int32Array | number[], k: number): Int32Array {
    const out = new Int32Array(k)
    const len = values.length
    for (let i = 0; i < k; i++) {
      out[i] = values[Math.floor(this.next() * len)]
    }
    return out
  }

  /** Random integers in [low, high). */
  integers(low: number, high: number, n: number): Int32Array {
    const range = high - low
    const out = new Int32Array(n)
    for (let i = 0; i < n; i++) out[i] = low + Math.floor(this.next() * range)
    return out
  }
}
