import { describe, it, expect } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { createLinguini } from '../src';
import { deepMerge, setNestedValues } from '../src/utils';

function buildLargeNamespace(size: number): Record<string, { text: string; detail: { description: string } }> {
  const ns: Record<string, { text: string; detail: { description: string } }> = {};
  for (let i = 0; i < size; i++) {
    ns[`rc_${i}`] = {
      text: `Machine reason code ${i}: Scheduled inspection and calibration check #${i}`,
      detail: {
        description: `Detailed diagnostic explanation for machine reason code ${i} across line stations A-Z.`,
      },
    };
  }
  return ns;
}

describe('React Linguini Benchmarks', () => {
  it('1. Re-render isolation at scale (200 namespace components + 200 partial row components)', async () => {
    const bigReasons = buildLargeNamespace(500);
    const loader = async (_lang: string, ns: string, options?: { keyPrefixes?: string[] }) => {
      if (ns === 'reasons') {
        const out: Record<string, any> = {};
        for (const p of options?.keyPrefixes || []) {
          out[p] = bigReasons[p];
        }
        return out;
      }
      return { heading: `Heading for ${ns}` };
    };

    const app = createLinguini({
      supportedLanguages: ['en'],
      defaultLanguage: 'en',
      namespaces: {
        reasons: { partial: true, partialMergeStrategy: 'subtree' },
      },
      loader,
    });

    const nsARenderCounts = new Array<number>(100).fill(0);
    const nsBRenderCounts = new Array<number>(100).fill(0);
    const rowRenderCounts = new Array<number>(200).fill(0);
    const initialTFns = new Map<string, unknown>();
    let tIdentityChanges = 0;

    const NsItem = ({ ns, idx, counts }: { ns: string; idx: number; counts: number[] }) => {
      counts[idx]++;
      const { t, ready } = app.useTranslation(ns);
      const id = `${ns}:${idx}`;
      if (ready) {
        if (!initialTFns.has(id)) initialTFns.set(id, t);
        else if (initialTFns.get(id) !== t) tIdentityChanges++;
      }
      return <span>{ready ? t('heading') : ''}</span>;
    };

    const ReasonRow = ({ idx }: { idx: number }) => {
      rowRenderCounts[idx]++;
      const prefix = `rc_${idx}`;
      const { t, ready } = app.useTranslation('reasons', { keyPrefix: prefix });
      if (ready) {
        if (!initialTFns.has(prefix)) initialTFns.set(prefix, t);
        else if (initialTFns.get(prefix) !== t) tIdentityChanges++;
      }
      return <span>{ready ? t('text') : ''}</span>;
    };

    render(
      <app.LinguiniProvider>
        {Array.from({ length: 100 }, (_, i) => (
          <NsItem key={`a-${i}`} ns="nsA" idx={i} counts={nsARenderCounts} />
        ))}
        {Array.from({ length: 100 }, (_, i) => (
          <NsItem key={`b-${i}`} ns="nsB" idx={i} counts={nsBRenderCounts} />
        ))}
        {Array.from({ length: 200 }, (_, i) => (
          <ReasonRow key={`r-${i}`} idx={i} />
        ))}
      </app.LinguiniProvider>
    );

    await waitFor(() => {
      expect(app.store.getState().loadingStates.en?.nsA).toBe('loaded');
      expect(app.store.getState().loadingStates.en?.nsB).toBe('loaded');
      expect(app.store.getState().partialLoadingStates.en?.reasons?.rc_199).toBe('loaded');
    });

    const baselineA = [...nsARenderCounts];
    const baselineB = [...nsBRenderCounts];
    const baselineRows = [...rowRenderCounts];

    const t0 = performance.now();
    await act(async () => {
      await app.store.loadNamespace('en', 'nsC');
      await app.store.loadNamespace('en', 'reasons', { keyPrefix: 'rc_200' });
    });
    const elapsedMs = performance.now() - t0;

    const extraRendersA = nsARenderCounts.reduce((acc, v, i) => acc + (v - baselineA[i]), 0);
    const extraRendersB = nsBRenderCounts.reduce((acc, v, i) => acc + (v - baselineB[i]), 0);
    const extraRendersRows = rowRenderCounts.reduce((acc, v, i) => acc + (v - baselineRows[i]), 0);

    console.log(
      `[Bench 1 - Re-render Isolation] 400 mounted components | extra renders on unrelated loads: nsA=${extraRendersA}, nsB=${extraRendersB}, rows=${extraRendersRows} | t identity changes=${tIdentityChanges} | elapsed=${elapsedMs.toFixed(2)}ms`
    );

    expect(extraRendersA).toBe(0);
    expect(extraRendersB).toBe(0);
    expect(extraRendersRows).toBe(0);
    expect(tIdentityChanges).toBe(0);
  });

  it('2. Big namespace partial merge (~1 MB / 5,000 keys)', () => {
    const baseNs = buildLargeNamespace(5000);
    const payloadBytes = Buffer.byteLength(JSON.stringify(baseNs), 'utf8');

    const runMergeBench = (prefixCount: number) => {
      const rootPatch: Record<string, any> = {};
      const subtreeEntries: Record<string, any> = {};
      for (let i = 0; i < prefixCount; i++) {
        const key = `rc_${i}`;
        const updated = {
          text: `Updated reason ${i}`,
          detail: { description: `Updated detail ${i}` },
        };
        rootPatch[key] = updated;
        subtreeEntries[key] = updated;
      }

      const tRootStart = performance.now();
      const mergedRoot = deepMerge(baseNs, rootPatch);
      const rootMs = performance.now() - tRootStart;

      const tSubStart = performance.now();
      const mergedSubtree = setNestedValues(baseNs, subtreeEntries);
      const subtreeMs = performance.now() - tSubStart;

      // Untouched sibling references must be preserved identically
      expect(mergedRoot.rc_4999).toBe(baseNs.rc_4999);
      expect(mergedSubtree.rc_4999).toBe(baseNs.rc_4999);

      return { rootMs, subtreeMs };
    };

    const batch50 = runMergeBench(50);
    const batch200 = runMergeBench(200);

    console.log(
      `[Bench 2 - Big Namespace Merge] 5,000 keys (${(payloadBytes / 1024).toFixed(1)} KB) | 50 prefixes: root=${batch50.rootMs.toFixed(2)}ms, subtree=${batch50.subtreeMs.toFixed(2)}ms | 200 prefixes: root=${batch200.rootMs.toFixed(2)}ms, subtree=${batch200.subtreeMs.toFixed(2)}ms`
    );

    expect(batch200.rootMs).toBeLessThan(200);
    expect(batch200.subtreeMs).toBeLessThan(200);
  });

  it('3. Fallback load reduction across eager, onError, and onMissing (non-English user, 2,000-key namespace)', async () => {
    // @ts-ignore
    globalThis.navigator = { languages: ['fr-FR'] };
    const frDataset = buildLargeNamespace(2000);
    const enDataset = buildLargeNamespace(2000);

    const measureStrategy = async (strategy: 'eager' | 'onError' | 'onMissing') => {
      let loaderCalls = 0;
      let entriesFetched = 0;

      const inst = createLinguini({
        supportedLanguages: ['en', 'fr'],
        defaultLanguage: 'en',
        fallbackLoadStrategy: strategy,
        namespaces: {
          machinereasoncodes: { partial: true, partialMergeStrategy: 'subtree' },
        },
        loader: async (lang, _ns, options) => {
          loaderCalls++;
          const dataset = lang === 'fr' ? frDataset : enDataset;
          const out: Record<string, any> = {};
          for (const prefix of options?.keyPrefixes || []) {
            entriesFetched++;
            out[prefix] = dataset[prefix];
          }
          return out;
        },
      });

      const Table = () => (
        <>
          {Array.from({ length: 20 }, (_, i) => {
            const Row = () => {
              const { t, ready } = inst.useTranslation('machinereasoncodes', {
                keyPrefix: `rc_${i}`,
              });
              return <span>{ready ? t('text') : ''}</span>;
            };
            return <Row key={i} />;
          })}
        </>
      );

      const { unmount } = render(
        <inst.LinguiniProvider>
          <Table />
        </inst.LinguiniProvider>
      );

      await waitFor(() => {
        expect(inst.store.getState().partialLoadingStates.fr?.machinereasoncodes?.rc_19).toBe(
          'loaded'
        );
      });
      // Give microtasks/effects a tick to ensure eager fallback completes
      await new Promise((res) => setTimeout(res, 20));
      unmount();

      return { loaderCalls, entriesFetched };
    };

    const eager = await measureStrategy('eager');
    const onError = await measureStrategy('onError');
    const onMissing = await measureStrategy('onMissing');

    console.log(
      `[Bench 3 - Fallback Load Reduction] 20 partial rows (fr user) | eager: ${eager.loaderCalls} calls / ${eager.entriesFetched} entries | onError: ${onError.loaderCalls} calls / ${onError.entriesFetched} entries | onMissing: ${onMissing.loaderCalls} calls / ${onMissing.entriesFetched} entries`
    );

    expect(eager.loaderCalls).toBe(2);
    expect(onError.loaderCalls).toBe(1);
    expect(onMissing.loaderCalls).toBe(1);
    expect(onError.entriesFetched).toBe(eager.entriesFetched / 2);
    expect(onMissing.entriesFetched).toBe(eager.entriesFetched / 2);
  });

  it('4. Translation lookup throughput (50,000 lookups on 5,000-key nested namespace)', async () => {
    const bigData: Record<string, any> = {};
    for (let i = 0; i < 5000; i++) {
      bigData[`item_${i}`] = {
        plain: `Item label ${i}`,
        interpolated: `Item {name} #${i}`,
      };
    }

    const app = createLinguini({
      supportedLanguages: ['en'],
      defaultLanguage: 'en',
      loader: async () => bigData,
    });

    await app.store.loadNamespace('en', 'catalog');

    const iterations = 50_000;
    const t0 = performance.now();
    let checksum = 0;
    for (let i = 0; i < iterations; i++) {
      const idx = i % 5000;
      const mode = i & 3;
      if (mode === 0) {
        checksum += app.store.translate('catalog', `item_${idx}.plain`).length;
      } else if (mode === 1) {
        checksum += app.store.translate('catalog', `item_${idx}.interpolated`, { name: 'Alpha' }).length;
      } else if (mode === 2) {
        checksum += app.store.translate('catalog', `item_${idx}.plain`, 'Fallback').length;
      } else {
        checksum += app.store.translate('catalog', `missing_${idx}`, 'Default {v}', { v: idx }).length;
      }
    }
    const elapsedMs = performance.now() - t0;
    const opsPerSec = Math.round((iterations / elapsedMs) * 1000);

    console.log(
      `[Bench 4 - Lookup Throughput] ${iterations.toLocaleString()} lookups on 5,000 keys | ${elapsedMs.toFixed(2)}ms | ${opsPerSec.toLocaleString()} ops/sec`
    );

    expect(checksum).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(2000);
  });
});
