using System;
using System.Collections;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// Immutable paged sequence of station records (<see cref="StationCellRecord"/> or
    /// <see cref="StationModuleRecord"/>). Each leaf page holds a small array of records
    /// and keeps a stable <c>pageId</c> across in-place replacements, removals and tail
    /// appends, so a local edit copies only the touched leaf page(s) and the compact
    /// page spine while sharing every untouched page and record with prior revisions.
    /// </summary>
    public sealed class StationRecordPages<T> : IReadOnlyList<T> where T : class {
        public const int DefaultPageSize = 64;
        public const int MaxPageSize = 128;

        public static readonly StationRecordPages<T> Empty =
            new StationRecordPages<T>(Array.Empty<T[]>(), Array.Empty<int>(), 0);

        readonly T[][] pages;
        readonly int[] prefixCounts;
        readonly int count;

        StationRecordPages(T[][] pages, int[] prefixCounts, int count) {
            this.pages = pages;
            this.prefixCounts = prefixCounts;
            this.count = count;
        }

        public int Count => count;
        public int PageCount => pages.Length;

        public T this[int index] {
            get {
                if ((uint)index >= (uint)count) throw new ArgumentOutOfRangeException(nameof(index));
                int pageIndex = FindPageForIndex(index);
                return pages[pageIndex][index - prefixCounts[pageIndex]];
            }
        }

        public ReadOnlySpan<T> PageSpan(int pageId) =>
            (uint)pageId < (uint)pages.Length ? pages[pageId] : ReadOnlySpan<T>.Empty;

        internal T[] RawPage(int pageId) => pages[pageId];

        int FindPageForIndex(int index) {
            int lo = 0;
            int hi = prefixCounts.Length - 1;
            int best = 0;
            while (lo <= hi) {
                int mid = (lo + hi) >> 1;
                if (prefixCounts[mid] <= index) {
                    best = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            return best;
        }

        public static StationRecordPages<T> FromArray(T[] items, out int[] pageIds) {
            if (items == null || items.Length == 0) {
                pageIds = Array.Empty<int>();
                return Empty;
            }
            int total = items.Length;
            int pageCount = (total + DefaultPageSize - 1) / DefaultPageSize;
            var builtPages = new T[pageCount][];
            var prefixes = new int[pageCount];
            pageIds = new int[total];
            int offset = 0;
            for (int p = 0; p < pageCount; p++) {
                prefixes[p] = offset;
                int len = Math.Min(DefaultPageSize, total - offset);
                var page = new T[len];
                Array.Copy(items, offset, page, 0, len);
                for (int j = 0; j < len; j++) pageIds[offset + j] = p;
                builtPages[p] = page;
                offset += len;
            }
            return new StationRecordPages<T>(builtPages, prefixes, total);
        }

        public static StationRecordPages<T> FromReadOnlyList(IReadOnlyList<T> items, out int[] pageIds) {
            if (items is StationRecordPages<T> existing) {
                pageIds = existing.BuildPageIds();
                return existing;
            }
            if (items == null || items.Count == 0) {
                pageIds = Array.Empty<int>();
                return Empty;
            }
            int total = items.Count;
            int pageCount = (total + DefaultPageSize - 1) / DefaultPageSize;
            var builtPages = new T[pageCount][];
            var prefixes = new int[pageCount];
            pageIds = new int[total];
            int offset = 0;
            for (int p = 0; p < pageCount; p++) {
                prefixes[p] = offset;
                int len = Math.Min(DefaultPageSize, total - offset);
                var page = new T[len];
                for (int j = 0; j < len; j++) {
                    page[j] = items[offset + j];
                    pageIds[offset + j] = p;
                }
                builtPages[p] = page;
                offset += len;
            }
            return new StationRecordPages<T>(builtPages, prefixes, total);
        }

        int[] BuildPageIds() {
            if (count == 0) return Array.Empty<int>();
            var ids = new int[count];
            int cursor = 0;
            for (int p = 0; p < pages.Length; p++) {
                int len = pages[p].Length;
                for (int j = 0; j < len; j++) ids[cursor++] = p;
            }
            return ids;
        }

        public Builder ToBuilder() => new Builder(this);

        public Enumerator GetEnumerator() => new Enumerator(pages);
        IEnumerator<T> IEnumerable<T>.GetEnumerator() => new Enumerator(pages);
        IEnumerator IEnumerable.GetEnumerator() => new Enumerator(pages);

        public struct Enumerator : IEnumerator<T> {
            readonly T[][] pages;
            int pageIndex;
            int itemIndex;
            T current;

            internal Enumerator(T[][] pages) {
                this.pages = pages;
                pageIndex = 0;
                itemIndex = -1;
                current = null;
            }

            public T Current => current;
            object IEnumerator.Current => current;

            public bool MoveNext() {
                while (pageIndex < pages.Length) {
                    var page = pages[pageIndex];
                    int next = itemIndex + 1;
                    if (next < page.Length) {
                        itemIndex = next;
                        current = page[next];
                        return true;
                    }
                    pageIndex++;
                    itemIndex = -1;
                }
                current = null;
                return false;
            }

            public void Reset() {
                pageIndex = 0;
                itemIndex = -1;
                current = null;
            }

            public void Dispose() { }
        }

        /// <summary>
        /// Copy-on-write batch mutator over one <see cref="StationRecordPages{T}"/>.
        /// Untouched pages retain their exact backing array instances.
        /// </summary>
        public sealed class Builder {
            readonly T[][] sourcePages;
            List<T[]> workingPages;
            HashSet<int> ownedPages;
            int clonedRecords;

            internal Builder(StationRecordPages<T> source) {
                sourcePages = source.pages;
            }

            public int ClonedRecordCount => clonedRecords;

            void EnsureWorking() {
                if (workingPages != null) return;
                workingPages = new List<T[]>(sourcePages.Length + 2);
                for (int i = 0; i < sourcePages.Length; i++) workingPages.Add(sourcePages[i]);
                ownedPages = new HashSet<int>();
            }

            public bool ReplaceInPage(int pageId, Predicate<T> match, T replacement) {
                EnsureWorking();
                if ((uint)pageId >= (uint)workingPages.Count) return false;
                var page = workingPages[pageId];
                int at = -1;
                for (int i = 0; i < page.Length; i++) {
                    if (match(page[i])) { at = i; break; }
                }
                if (at < 0) return false;
                if (ReferenceEquals(page[at], replacement)) return true;
                if (ownedPages.Add(pageId)) {
                    var copy = new T[page.Length];
                    Array.Copy(page, copy, page.Length);
                    clonedRecords += page.Length;
                    page = copy;
                    workingPages[pageId] = page;
                }
                page[at] = replacement;
                return true;
            }

            public bool RemoveFromPage(int pageId, Predicate<T> match) {
                EnsureWorking();
                if ((uint)pageId >= (uint)workingPages.Count) return false;
                var page = workingPages[pageId];
                int at = -1;
                for (int i = 0; i < page.Length; i++) {
                    if (match(page[i])) { at = i; break; }
                }
                if (at < 0) return false;
                if (page.Length == 1) {
                    workingPages[pageId] = Array.Empty<T>();
                    ownedPages.Add(pageId);
                    return true;
                }
                var shrunk = new T[page.Length - 1];
                if (at > 0) Array.Copy(page, 0, shrunk, 0, at);
                if (at < page.Length - 1) Array.Copy(page, at + 1, shrunk, at, page.Length - 1 - at);
                clonedRecords += shrunk.Length;
                workingPages[pageId] = shrunk;
                ownedPages.Add(pageId);
                return true;
            }

            public int Append(T item) {
                EnsureWorking();
                while (workingPages.Count > 0 && workingPages[workingPages.Count - 1].Length == 0) {
                    ownedPages.Remove(workingPages.Count - 1);
                    workingPages.RemoveAt(workingPages.Count - 1);
                }
                if (workingPages.Count > 0) {
                    int lastId = workingPages.Count - 1;
                    var last = workingPages[lastId];
                    if (last.Length < MaxPageSize) {
                        var grown = new T[last.Length + 1];
                        Array.Copy(last, grown, last.Length);
                        grown[last.Length] = item;
                        clonedRecords += last.Length;
                        workingPages[lastId] = grown;
                        ownedPages.Add(lastId);
                        return lastId;
                    }
                }
                int newPageId = workingPages.Count;
                workingPages.Add(new[] { item });
                ownedPages.Add(newPageId);
                return newPageId;
            }

            public StationRecordPages<T> Build(StationRecordPages<T> unchangedFallback) {
                if (workingPages == null) return unchangedFallback;
                while (workingPages.Count > 0 && workingPages[workingPages.Count - 1].Length == 0) {
                    workingPages.RemoveAt(workingPages.Count - 1);
                }
                if (workingPages.Count == 0) return Empty;
                int pageCount = workingPages.Count;
                var finalPages = workingPages.ToArray();
                var prefixes = new int[pageCount];
                int running = 0;
                for (int p = 0; p < pageCount; p++) {
                    prefixes[p] = running;
                    running += finalPages[p].Length;
                }
                if (running == 0) return Empty;
                return new StationRecordPages<T>(finalPages, prefixes, running);
            }
        }
    }
}
