

prompt:
I’m optimizing a pure TypeScript/Node SBE library and want you to aggressively critique a proposed optimization strategy before I invest engineering time.

Context:
- Library: SBE runtime + codegen (flyweight over ArrayBuffer/DataView).
- Constraint: MUST stay pure JS/TS (no native addons, no Rust/C++).
- Goal: only pursue changes with strong ROI (no tiny gains for big effort).
- Current benchmark profile (rough):
  - DataView ring-buffer 4x uint32: ~190–200M ops/sec
  - TypedArray ring-buffer 4x uint32: ~108–126M ops/sec
  - DataView rotating 4x uint32: ~16–18M ops/sec
  - DataView ring mixed (2x uint32 + 2x int64 BigInt): ~35–72M ops/sec
- Node versions tested: 22.x and 25.x.
- Known pattern: monomorphic paths are much faster than polymorphic ones.

Proposed strategy to validate/challenge:
1) Ingestion normalization: convert rotating-buffer inputs into a preallocated ring/arena before decode.
2) Generate specialized hot-path decoders (fixed fields only, little-endian only, branch-minimized) in addition to full-feature decoders.
3) Enforce monomorphic dispatch end-to-end (template routing outside hot decode handlers).
4) Optional batch decode API for same-schema messages to reduce per-message overhead.
5) Skip micro-tweaks unless expected uplift is meaningful.

Your task:
A) Tell me if this strategy is technically sound for V8/JIT realities (IC stability, hidden classes, deopts, inlining, bounds-check elimination, Maglev/Turbofan/Turboshaft behavior).
B) Identify wrong assumptions or likely dead ends.
C) For each item (1–5), score:
   - Expected upside (low/med/high + rough % range),
   - Implementation complexity,
   - Risk to correctness/maintainability,
   - Confidence level.
D) Propose a better alternative plan if you disagree.
E) Give a strict ROI gating framework:
   - Minimum gain threshold to continue,
   - Timebox per experiment,
   - kill-switch criteria.
F) Provide a concrete experiment matrix (A/B tests) with exactly what to measure:
   - throughput, p99/p999 latency,
   - warmup behavior,
   - deopt counts/reasons,
   - variance controls.
G) Include a “what not to do” section (optimizations that look good but usually fail in V8).

Output format:
1) Verdict (solid / partially solid / flawed)
2) Assumptions audit
3) Per-item scorecard (table)
4) Recommended 2-week execution plan
5) Stop criteria
6) Red flags / anti-patterns

Be blunt. If an idea is likely to yield <15% in real workloads, call it out directly.


gemini:

This is a sophisticated strategy, but it contains one significant "performance trap" that could negate your gains, and it misses the single biggest bottleneck in your mixed-type benchmarks: BigInt allocation overhead.

At 200M ops/sec, you are effectively competing with the CPU's branch predictor and the V8 inlining budget. Every single instruction, including the function prologue, matters.

1. Verdict: Partially Solid
Your strategy is partially solid. Items 2, 3, and 4 are world-class optimizations for V8. Item 1 is a likely regression. Item 5 is the correct mindset.

2. Assumptions Audit
The BigInt Trap: Your mixed-decoder throughput (35–72M) isn't slow because of polymorphism alone; it's slow because view.getBigUint64() allocates a heap object. At 200M ops/sec, you cannot afford a heap allocation per field.
Data Locality vs. Copying: You assume "normalizing" to a ring buffer helps. In V8, the cost of a memcpy (even a small one) is almost always higher than the cost of the JIT calculating a dynamic offset base + variable_offset, provided that variable_offset is a Smi (small integer).
DataView vs. TypedArray: You noted DataView is faster. This is correct for Node 22+ because of Turboshaft’s DataView lowering, which treats DataView methods as direct memory intrinsics, often bypassing the bounds checks that TypedArray still struggles to elide in complex loops.
3. Per-Item Scorecard
Item	Expected Upside	Complexity	Risk	Confidence
1. Ingestion Normalization	Negative (-10% to -30%)	High	Med	High
2. Specialized Hot-Decoders	High (20–40%)	High	Low	High
3. Monomorphic Dispatch	Critical (2x–5x)	Med	High	High
4. Batch Decode API	Med (15–25%)	Low	Low	Med
5. Skip Micro-tweaks	N/A (Focus only)	Low	Low	High
Why Item 1 Fails: Moving data from a "rotating" buffer to a "ring" buffer involves buffer.set() or a loop. V8 is already extremely good at accessing any part of an ArrayBuffer. Unless your "rotating" inputs are hundreds of tiny, disconnected Buffer objects (causing GC pressure), copying them is just adding "work" to the CPU for no JIT benefit.

4. Recommended 2-Week Execution Plan
Week 1: The "Allocation & Dispatch" Phase
Days 1–3: The BigInt "Dword Split" (The 100M+ Target).
Hypothesis: Decoding BigInts as two uint32 values and only creating the BigInt lazily (or never) will double mixed-path throughput.
Change: Modify codegen to provide getFieldLow() and getFieldHigh() returning standard Numbers. Provide getFieldBigInt() as a separate getter.
Days 4–5: Monomorphic Routing.
Change: Ensure the user-facing API doesn't use switch(msgType) { case ... } inside the hot loop. Generate a Dispatcher that uses an array of functions (lookup table) where each function is strictly monomorphic to one message class.
Week 2: The "Inlining & Bounds" Phase
Days 6–8: De-Flyweight / Method Flattening.
Hypothesis: Replacing decoder.field() getters with a flat decodeTo(buffer, offset, target) function will stay under the Turbofan inlining budget (usually ~600 nodes).
Change: Generated code should look like a sequence of view.getUint32(offset + K, true) calls with no internal helper functions.
Days 9–10: Batch API & Loop Unrolling.
Change: Add decodeBatch(buffer, offsets[], results[]). Use a hard-coded loop of 4 or 8 decodes to help Turboshaft's vectorizer and reduce branch overhead.
5. ROI Gating & Stop Criteria
Minimum Gain Threshold: 15%. If a change yields 5–8%, discard it. The maintainability cost of specialized codegen is too high for single-digit gains.
Timebox: 48 hours per experiment. If you aren't seeing the numbers in top-tier (Turboshaft) by then, your hypothesis about the JIT's behavior is likely wrong.
Kill-Switch: If a "performance" change causes a Soft Deopt (visible via --trace-deopt), kill it immediately.
6. Red Flags / Anti-Patterns (The "What Not To Do")
Don't use Proxy: It destroys the optimization of the "Flyweight" pattern. It is the single fastest way to drop from 200M to 2M ops/sec.
Don't use Object.defineProperty in a loop: It prevents the creation of a stable Hidden Class (Map).
Don't try to "cache" DataView methods: (e.g., const getU32 = view.getUint32;). Modern V8 needs to see the call as view.getUint32(...) to apply its intrinsic "Magic" (Turboshaft lowering).
Don't use Rest parameters (...args) or arguments: These trigger "Arguments Adaptation" in the V8 prologue, which is a significant overhead at 200M ops.
7. Benchmarking Matrix (A/B Protocol)
Diagnostics Flags:

--trace-opt --trace-deopt: Look for your hot functions. If you see "Deoptimizing... reason: wrong map," you have a polymorphism problem.
--prof: Use this to see if v8::internal::Runtime_BigInt64 is taking up 40% of your time.
Measurement Points:

Warmup: 1,000,000 iterations before timing.
Throughput: Ops/sec (higher is better).
Stability: Run the test 10 times. If variance is > 3%, the JIT is "wavering" (likely due to polymorphic ICs).
Target Code Shape (The Goal for Rank 2 Specialized Decoders):

typescript
 Show full code block 
// Target: Turboshaft-friendly flat decoder
export function decodeSmallMessage_LE(view: DataView, off: number, out: any) {
  // Constant offsets allow Turboshaft to fold the bounds checks
  out.f1 = view.getUint32(off + 0, true); 
  out.f2 = view.getUint32(off + 4, true);
  // BigInt optimization: split if possible
  out.f3_low = view.getUint32(off + 8, true);
  out.f3_high = view.getUint32(off + 12, true);
}
Generated by Gemini 3 Flash Preview



qwen:

### 1) Verdict
**Partially solid.** Items 2, 3, and 4 are aligned with modern V8 optimization pathways and will yield measurable ROI. Item 1 is a likely dead end in pure JS and will cost more than it saves. Item 5 is correct but trivial. The real bottleneck you're avoiding is **BigInt heap allocation + GC interference** and **hidden allocation in your flyweight wrappers**, not decode routing.

---

### 2) Assumptions Audit
| Assumption | V8 Reality | Verdict |
|------------|------------|---------|
| `DataView` ring-buffer outperforms `TypedArray` for mixed access | ✅ True in V8 12+. `DataView` intrinsics have faster bounds-check elimination (BCE) and LE flag hoisting. | Keep |
| Rotating buffer is slower due to decode logic | ⚠️ Partially. Rotating patterns usually break BCE and cause IC churn because offsets aren't provably linear. Copying won't fix this; linear math will. | Fix logic, not buffer |
| Monomorphic dispatch guarantees peak throughput | ✅ Correct. Megamorphic ICs (>3 cached shapes) force V8 to fallback to generic stubs, killing inlining. | Enforce |
| BigInt mixed path variance (35–72M) is decode overhead | ❌ False. BigInt forces heap allocation, disables register optimization, and triggers GC pauses. Variance is GC/deopt jitter. | Workaround required |
| Batch decode reduces per-message overhead | ⚠️ Only if function call + wrapper allocation dominates. At ~200M ops/sec, you're already near V8's intrinsic call ceiling. Gains will be modest. | Profile first |

---

### 3) Per-Item Scorecard

| # | Strategy Item | Expected Upside | Implementation Complexity | Risk to Correctness/Maintainability | Confidence |
|---|---------------|-----------------|---------------------------|-------------------------------------|------------|
| 1 | Ingestion normalization (copy to prealloc ring) | **Low (0–8%)** or **Negative** | Medium | High (adds copy bugs, obscures zero-copy semantics) | High (it's a net loss in JS) |
| 2 | Specialized hot-path codegen (fixed offsets, LE, branch-min) | **High (40–120%)** | Low-Medium | Low (dual-path maintenance, but standard) | Very High |
| 3 | Enforce monomorphic dispatch (template routing outside hot path) | **Medium-High (15–35%)** | Medium | Medium (routing map must stay megamorphic-safe) | High |
| 4 | Optional batch decode API | **Medium (10–25%)** | Low | Low (pure additive) | Medium |
| 5 | Skip micro-tweaks unless meaningful uplift | **N/A (Principle)** | None | None | Very High |

**Blunt take:** Drop #1. It moves the bottleneck from decode to `Uint8Array.set()`/byte-copy loops, which JS engines are notoriously bad at. Fix #2 and #3 first. Attack BigInt separately.

---

### 4) Recommended 2-Week Execution Plan

| Day | Focus | Deliverable | V8 Flags/Checks |
|-----|-------|-------------|-----------------|
| 1–2 | Codegen specialization (#2) | Hardcoded offset decoder factory. LE-only, no runtime branching, `const` offsets. | `--turbofan --maglev --trace-opt` (verify no bailouts) |
| 3–4 | Monomorphic routing (#3) | Schema ID → decoder lookup via plain object or fixed array. No dynamic keys, no `switch` in hot path. | `--trace-ic --print-ic` (ensure 1-state caches) |
| 5–6 | BigInt bypass & mixed path fix | Split `int64` into `hi/lo uint32` or use `Number` if range-safe. Measure GC pressure. | `--trace-gc --print-gc` (check allocation rate) |
| 7–8 | Batch API (#4) | `decodeBatch(schemaId, bufferArray, outArray)` loop. Compare per-msg overhead. | Same as #2, track `--no-concurrent-recompilation` for stable baseline |
| 9–10 | Variance reduction & p99 hardening | Pin hot variables, eliminate dynamic property access, pool flyweight instances if wrapping. | `--turbo-loop-peeling` (default on), verify stable ICs |
| 11–12 | Benchmark harness hardening | Warmup isolation, GC pause accounting, OS jitter control. | External: `perf stat`, `taskset` |

---

### 5) ROI Gating Framework

| Metric | Threshold | Kill-Switch Condition |
|--------|-----------|------------------------|
| Throughput uplift | **≥20%** sustained over baseline | <15% gain after 2 iterations |
| p99/p999 latency | **≤25% reduction** vs baseline | Variance >8% across 5 runs |
| Deopt rate | **≤2%** of total calls | >5% deopts or new megamorphic ICs |
| Memory/GC | **≤10%** increase in live bytes | Forced GC frequency increases >30% |
| Complexity cap | **≤150 LOC** per optimization | >150 LOC or requires polyfills |
| Timebox | **3 days** per experiment | Extend max to 5 days if 80% done |

**Rule:** If an experiment doesn't hit ≥15% sustained uplift after 3 days, merge to a feature branch, archive, and move on. V8 jitter makes <15% statistically indistinguishable from noise in Node.

---

### 6) Concrete Experiment Matrix

| Test | A (Baseline) | B (Variant) | Metrics to Capture |
|------|--------------|-------------|-------------------|
| T1 | Generic dynamic decoder | Specialized codegen (#2) | ops/sec, `--trace-opt` lines compiled, `--trace-deopt` reasons |
| T2 | Dynamic routing in hot path | External template dispatch (#3) | `--trace-ic` state transitions, p99 latency variance |
| T3 | Mixed `int64` via `BigInt` | Split `hi/lo uint32` + manual combine | GC pause ms, allocation rate, throughput floor |
| T4 | Single-message decode | Batch decode 100 msgs (#4) | Per-msg overhead (ns), loop hoisting evidence, p999 |
| T5 | Raw `DataView` | `DataView` + `subarray` + constant offsets | BCE elimination, bounds-check stub hits |

**Measurement Protocol:**
- Warmup: 2M ops, discard.
- Steady state: 10M–50M ops, record 50th/95th/99th/999th percentile.
- Variance control: `taskset -c 0,1`, `export NODE_OPTIONS="--no-concurrent-recompilation --no-compilation-cache"` for deterministic profiling, then revert for final numbers.
- Deopt counting: `node --trace-deopt 2>&1 | grep "deoptimize" | wc -l`
- IC stability: `node --trace-ic 2>&1 | grep "megamorphic" | wc -l` (target: 0)

---

### 7) Red Flags / Anti-Patterns (What NOT to Do)

| Pattern | Why It Fails in V8 | Fix |
|---------|-------------------|-----|
| Byte-copy normalization (#1) | JS lacks fast `memcpy`. Loops trigger Maglev bailouts; `subarray` doesn't copy anyway. | Use logical offset math + `subarray`. |
| `try/catch` around hot decode | Disables TurboFan optimizations entirely, forces deopt. | Validate schema at init, not runtime. |
| `Map`/`Set` in decode path | Hash table lookups + megamorphic ICs destroy inline cache stability. | Use plain object `{}` or flat array `[decoder0, decoder1]`. |
| Manual bitwise hacks (`x >> 0`, `|0`) | V8 already optimizes type inference; forces deopt if misused. | Rely on `const` + TypeScript types + `--turbofan`. |
| Dynamic `new DataView(buf)` per msg | Hidden class churn + allocation. | Preallocate 1–2 `DataView`s, reuse via `.buffer` swap or flyweight. |
| BigInt for networking timestamps/IDs | Heap alloc, non-register type, GC triggers, BCE disabled. | Split to dual-uint32 or use `Number` if 2^53 safe. |
| Overusing `Object.assign`/spread in output | Forces hidden class transitions per field. | Direct assignment to preallocated output shape. |
| Chasing `<5%` micro-gains | V8's random baseline jitter + OS scheduler noise dwarfs gains. | Focus on allocation, IC state, and BCE. |

**Final blunt directive:** Your 190–200M ops/sec baseline is already at the ceiling of what pure JS `DataView` intrinsics can do for fixed uint32 reads. Pushing higher requires **eliminating BigInt**, **hardcoding offsets**, and **killing IC polymorphism**. Anything else is engineering theater. Run the matrix, enforce the 20% gate, and ship.



chatgpt:
## 1) Verdict

**Partially solid, with one likely trap.** Your core thesis is right: V8 still rewards stable shapes, monomorphic ICs, and aggressively specialized hot code paths; Maglev now sits between Sparkplug and TurboFan, and V8’s JS backend has been moving away from Sea of Nodes toward Turboshaft, so “feed the optimizer simple, predictable code” is still the game. But **item 1 is the weak link**: V8 already heavily optimizes `DataView` via inlining and specialization, and the historical “TypedArray is faster” rule is no longer a safe assumption. On your own numbers, a copy-then-decode normalization step could easily turn into a net loss unless it removes a genuinely expensive polymorphic/rotating access pattern. ([V8][1])

## 2) Assumptions audit

Your strongest assumption is that **monomorphism end-to-end matters**. That one is well aligned with V8 reality: ICs cache seen shapes/kinds, and V8 explicitly treats monomorphic access as the fast path while polymorphism adds checks and costs. Hidden classes/maps are real, and field access can be optimized aggressively when the shape stays stable. ([V8][2])

Your weakest assumption is that **normalizing rotating buffers into a ring/arena is automatically a win**. If that means copying bytes before decode, you are trading decode cost for memory traffic and copy cost; that only pays off when the decode path is so branchy or deopt-prone that the copy is amortized away. I would not touch this first. That is an inference from your benchmark profile plus V8’s speculative optimization model, not a guaranteed engine win. ([V8][3])

Your `TypedArray` intuition needs a reset. V8’s `DataView` was specifically reworked so TurboFan could inline it and make it competitive with, and sometimes faster than, equivalent `TypedArray` wrappers. So “move away from `DataView`” is not a good default optimization thesis in 2026 V8 unless your measurements prove it on your exact access pattern. ([V8][4])

Your batch API idea is reasonable, but only for bursts of the **same schema**. Batch APIs often help by reducing per-call overhead and enabling hotter, more optimizable loops, but they can also worsen tail latency and increase API complexity. Treat it as a throughput lever, not a universal fix. That is an inference from V8’s inlining/speculation model and the fact that V8’s own optimizers profit from predictable call sites. ([V8][1])

## 3) Per-item scorecard

| Item                                                                                |                                                                                                                       Expected upside |  Complexity | Correctness / maintainability risk | Confidence | Blunt read                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------: | ----------: | ---------------------------------: | ---------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1) Normalize rotating input into preallocated ring/arena before decode              |                                                          **Low–medium**: **0–10%** often; can be **negative** if you copy per message | Medium–high |                               High | Low–medium | Only do this if the rotating input is demonstrably poisoning the hot path. Copying bytes just to “make V8 happy” is usually not a good trade. |
| 2) Generate specialized hot-path decoders (fixed fields, LE-only, branch-minimized) |                                     **High**: **15–50%+** on the hot path; potentially more if you currently have branchy mixed cases | Medium–high |                             Medium |       High | This is the best lever in your list. It matches how V8 wants to optimize code.                                                                |
| 3) Enforce monomorphic dispatch end-to-end                                          |                                                                    **High**: **10–40%** depending on how polymorphic things are today |  Low–medium |                         Low–medium |       High | This is probably the cheapest meaningful win. Keep routing outside the decoder and keep shapes stable.                                        |
| 4) Optional batch decode API for same-schema messages                               | **Medium**: **10–25%** throughput, sometimes less; can improve p99 if it reduces call overhead, or worsen it if batches are too large |      Medium |                             Medium |     Medium | Good secondary lever, not first-line. Useful only when the workload already arrives in bursts.                                                |
| 5) Skip micro-tweaks unless uplift is meaningful                                    |                                                                                      **Not an optimization**; it is a discipline rule |         Low |                                Low |       High | Correct. This should be policy, not an experiment.                                                                                            |

## 4) Recommended 2-week execution plan

**Week 1: prove the shape of the win.** First, lock a baseline on Node 22 and Node 25 separately, because they ship materially different V8s: Node 22 uses V8 12.4, while Node 25 uses V8 14.1. Then test only the highest-probability changes: monomorphic dispatch, specialized decoders, and BigInt split-paths. Do not touch copy-based normalization yet unless the first-pass results show the rotating-input case is still catastrophically slower. ([Node.js][5])

**Week 2: validate throughput versus tail.** Add batching only after you know the best single-message path. Then run the same schemas through batch sizes that reflect your real traffic, not arbitrary microbench sizes. Keep an eye on warmup, because Maglev exists specifically to improve the “good enough, fast enough” middle tier, which means warmup behavior can change even when steady-state throughput barely moves. ([V8][6])

The best practical order is: **(3) monomorphic routing → (2) specialized decoder → split BigInt path → (4) batch API → only then reconsider (1)**. I would not spend the first week on normalization-by-copy. ([V8][2])

## 5) Stop criteria

Continue only if a change clears **all three** of these:

1. **Representative end-to-end throughput improves by at least 15%**, not just a microbench.
2. **p99 does not regress by more than 5%** unless the feature is explicitly throughput-only.
3. **Deopt pressure drops or stays flat** on the hot paths you care about. If the optimization creates a new deopt reason or a new polymorphic site, it is probably not worth it. ([V8][3])

Kill an experiment if it fails to show a stable signal after **3 independent runs per Node version**, or if the implementation starts requiring extra code paths that users will have to understand forever. If a microbenchmark wins but the real workload stays under **15%**, drop it. That is the right bar for your library. ([V8][1])

## 6) Red flags / anti-patterns

Do **not** assume `TypedArray` is the faster substrate just because it feels lower-level; V8’s `DataView` path was specifically optimized and can now match or exceed equivalent wrapper code. ([V8][4])

Do **not** add polymorphic option bags, shape-changing objects, or “clever” runtime switches inside the hot decode loop. V8’s ICs reward monomorphic sites and punish polymorphism. ([V8][2])

Do **not** make copy-based normalization your default first move. Copying every message to make decoding easier often just moves the bottleneck from JIT behavior to memory bandwidth. That is the sort of change that looks architectural but usually fails ROI in JavaScript. ([V8][3])

Do **not** optimize only steady-state throughput and ignore warmup. Maglev exists because V8 cares about getting good code quickly, not just peak code eventually. ([V8][6])

Do **not** let the implementation sprawl into many per-schema permutations unless you can prove the extra complexity buys real throughput. Specialization is good; combinatorial explosion is not. ([V8][7])

## Concrete experiment matrix

| Test | Change                                        | Measure                                                                                  | Success bar                                                     | Kill condition                           |
| ---- | --------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| A0   | Baseline                                      | Throughput, p99, p999, warmup curve, deopt counts/reasons, IC state transitions, GC time | Reference only                                                  | N/A                                      |
| A1   | Monomorphic routing only                      | Same metrics                                                                             | ≥15% end-to-end gain or clear deopt reduction                   | No stable gain after 3 runs              |
| A2   | Specialized fixed-field LE decoder only       | Same metrics                                                                             | ≥15% gain on hot schema, no p99 regression >5%                  | Complex code with <10% gain              |
| A3   | Split BigInt-heavy path from pure-uint32 path | Same metrics                                                                             | Clear gain on mixed schema, especially if BigInt path dominates | No gain on mixed workload                |
| A4   | Batch API, batch sizes 8 / 32 / 128           | Throughput, p99, p999, time-to-steady-state                                              | Throughput gain with acceptable tail latency                    | Tail gets worse or batches don’t help    |
| A5   | A1 + A2                                       | Same metrics                                                                             | Should be your most likely “real” win                           | If combo is not better than either alone |
| A6   | A1 + A2 + A3                                  | Same metrics                                                                             | Best-case hot path                                              | If code growth is high for <15% gain     |
| A7   | A1 + A2 + A3 + A4                             | Same metrics                                                                             | Only if you have bursty same-schema traffic                     | If p999 worsens materially               |

Use the same input corpus, same schema mix, same message sizes, same CPU governor, same core pinning, and run each configuration on **Node 22 and Node 25 separately**. For each run, record first-call behavior, 10-second warmup, then steady-state for at least 30 seconds. Include `--trace-deopt`-style diagnostics where available so you can attribute regressions to deopts rather than guessing. ([Node.js][5])

The main conclusion: **invest in specialization and monomorphism first; treat normalization-by-copy as a last resort; do not migrate away from `DataView` blindly.** That is the highest-ROI path for your constraints. ([V8][4])

[1]: https://v8.dev/blog/maglev?utm_source=chatgpt.com "Maglev - V8's Fastest Optimizing JIT"
[2]: https://v8.dev/blog/elements-kinds?utm_source=chatgpt.com "Elements kinds in V8"
[3]: https://v8.dev/blog/wasm-speculative-optimizations?utm_source=chatgpt.com "Speculative Optimizations for WebAssembly using Deopts ..."
[4]: https://v8.dev/blog/dataview "Improving DataView performance in V8 · V8"
[5]: https://nodejs.org/en/download/archive/v22 "Node.js — Run JavaScript Everywhere"
[6]: https://v8.dev/blog/maglev "Maglev - V8’s Fastest Optimizing JIT · V8"
[7]: https://v8.dev/blog/system-analyzer?utm_source=chatgpt.com "Indicium: V8 runtime tracer tool"
