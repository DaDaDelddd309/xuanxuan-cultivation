// ============================================================================
// rot.js RNG —— 从 ondras/rot.js v2.2.1 摘取
// ============================================================================
//
// 上游: https://github.com/ondras/rot.js
// 原文件: src/rng.ts
// 许可: BSD-3-Clause (Ondrej Zara)
//
// Copyright (c) 2012-now(), Ondrej Zara
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice,
//    this list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright notice,
//    this list of conditions and the following disclaimer in the documentation
//    and/or other materials provided with the distribution.
// 3. Neither the name of the copyright holder nor the names of its contributors
//    may be used to endorse or promote products derived from this software
//    without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.
//
// 算法本身: Alea, (C) 2010 Johannes Baagøe, MIT License
// https://en.wikipedia.org/wiki/MIT_License
//
// ============================================================================
//
// 与上游的唯一差异:
//   上游 `export default new RNG().setSeed(Date.now())` 导出单例。
//   本项目导出 class —— 单例的模块级 setSeed 是全局状态污染源，
//   多子种子并行时必须各自 new，不能共享一个实例。
//
// 引入理由(见 docs/ROGUELIKE-PLAN.md):
//   1. getState()/setState() —— RNG 状态可序列化，存档只存种子不存世界
//   2. clone()               —— 多子种子流并行，互不干扰
//   3. getWeightedValue()    —— 正确的加权抽取(节点类型分布)
//
// 不引入 rot.js 的 Display/FOV/Path/Scheduler —— 本作是节点图+实时动作,
// 与 ASCII 网格回合制架构冲突。

/** 2^-32 */
const FRAC = 2.3283064365386963e-10;

export class RNG {
  constructor(seed) {
    this._seed = 0;
    this._s0 = 0;
    this._s1 = 0;
    this._s2 = 0;
    this._c = 0;
    if (seed !== undefined) this.setSeed(seed);
  }

  getSeed() { return this._seed; }

  /**
   * Seed the number generator
   */
  setSeed(seed) {
    seed = (seed < 1 ? 1 / seed : seed);

    this._seed = seed;
    this._s0 = (seed >>> 0) * FRAC;

    seed = (seed * 69069 + 1) >>> 0;
    this._s1 = seed * FRAC;

    seed = (seed * 69069 + 1) >>> 0;
    this._s2 = seed * FRAC;

    this._c = 1;
    return this;
  }

  /**
   * @returns Pseudorandom value [0,1), uniformly distributed
   */
  getUniform() {
    const t = 2091639 * this._s0 + this._c * FRAC;
    this._s0 = this._s1;
    this._s1 = this._s2;
    this._c = t | 0;
    this._s2 = t - this._c;
    return this._s2;
  }

  /**
   * @returns Pseudorandom value [lowerBound, upperBound] inclusive
   */
  getUniformInt(lowerBound, upperBound) {
    const max = Math.max(lowerBound, upperBound);
    const min = Math.min(lowerBound, upperBound);
    return Math.floor(this.getUniform() * (max - min + 1)) + min;
  }

  /**
   * @param mean Mean value
   * @param stddev Standard deviation. ~95% of values lower than 2*stddev.
   */
  getNormal(mean = 0, stddev = 1) {
    let u, v, r;
    do {
      u = 2 * this.getUniform() - 1;
      v = 2 * this.getUniform() - 1;
      r = u * u + v * v;
    } while (r > 1 || r === 0);

    const gauss = u * Math.sqrt(-2 * Math.log(r) / r);
    return mean + gauss * stddev;
  }

  /** @returns Pseudorandom value [1,100] inclusive */
  getPercentage() { return 1 + Math.floor(this.getUniform() * 100); }

  /** @returns Randomly picked item, null when length=0 */
  getItem(array) {
    if (!array.length) return null;
    return array[Math.floor(this.getUniform() * array.length)];
  }

  /** @returns New array with randomized items */
  shuffle(array) {
    const result = [];
    const clone = array.slice();
    while (clone.length) {
      const index = clone.indexOf(this.getItem(clone));
      result.push(clone.splice(index, 1)[0]);
    }
    return result;
  }

  /**
   * Weighted pick. `data` maps key -> relative weight; weights need not sum to 100.
   * @returns the picked key
   */
  getWeightedValue(data) {
    let total = 0;
    for (const id in data) total += data[id];
    const random = this.getUniform() * total;

    let id, part = 0;
    for (id in data) {
      part += data[id];
      if (random < part) return id;
    }
    return id; // float safety net
  }

  /**
   * RNG state snapshot. Store alongside the seed for exact reproduction.
   */
  getState() { return [this._s0, this._s1, this._s2, this._c]; }

  /** Restore a state previously obtained via getState(). */
  setState(state) {
    this._s0 = state[0];
    this._s1 = state[1];
    this._s2 = state[2];
    this._c = state[3];
    return this;
  }

  /** Independent copy — consuming the clone must not advance the original. */
  clone() {
    return new RNG().setState(this.getState());
  }
}

export default RNG;