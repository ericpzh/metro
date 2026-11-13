using System;
using System.Collections.Generic;
using System.Linq;

namespace Metro.View {
    /// <summary>
    /// Formation selection key for the rolling stock: stock class, car count and
    /// power collection. The editor's formation menu offers 2, 3, 4, 6 and 8 cars
    /// for every stock class with either power, and Zoo Line 5 pins the special
    /// `L.6.third-rail` livery variant.
    /// </summary>
    public static class TrainFormations {
        public static readonly string[] Stocks = { "A", "B", "C", "D", "L" };
        public static readonly int[] CarCounts = { 2, 3, 4, 6, 8 };
        public static readonly string[] Powers = { "overhead", "third-rail" };

        /// <summary>The Zoo-specific promotion: Line 5's livery and 0.98 scale.</summary>
        public const string ZooSuffix = "@zoo";

        public static string Power(string value) {
            if (string.IsNullOrEmpty(value)) return "overhead";
            return value == "third-rail" || value == "thirdRail" || value == "third rail" ? "third-rail" : "overhead";
        }

        public static string Key(string stock, int cars, string power) =>
            $"{NormalizeStock(stock)}.{cars}.{Power(power)}";

        public static string ZooKey(string stock, int cars, string power) => Key(stock, cars, power) + ZooSuffix;

        public static string NormalizeStock(string stock) =>
            string.IsNullOrEmpty(stock) || Array.IndexOf(Stocks, stock.ToUpperInvariant()) < 0 ? "A" : stock.ToUpperInvariant();

        public static bool IsSupportedCars(int cars) => Array.IndexOf(CarCounts, cars) >= 0;

        /// <summary>Every formation the menu can request (50 keys).</summary>
        public static IEnumerable<string> All() {
            foreach (var stock in Stocks)
                foreach (var cars in CarCounts)
                    foreach (var power in Powers)
                        yield return Key(stock, cars, power);
        }

        public static bool TryParse(string key, out string stock, out int cars, out string power, out bool zoo) {
            stock = ""; cars = 0; power = ""; zoo = false;
            if (string.IsNullOrEmpty(key)) return false;
            var text = key;
            if (text.EndsWith(ZooSuffix, StringComparison.Ordinal)) { zoo = true; text = text.Substring(0, text.Length - ZooSuffix.Length); }
            var parts = text.Split('.');
            if (parts.Length != 3) return false;
            if (Array.IndexOf(Stocks, parts[0]) < 0) return false;
            if (!int.TryParse(parts[1], out cars) || !IsSupportedCars(cars)) return false;
            if (Array.IndexOf(Powers, parts[2]) < 0) return false;
            stock = parts[0]; power = parts[2];
            return true;
        }

        /// <summary>
        /// The selection key for a saved line, preferring the promoted livery variant
        /// for the same stock/cars/power when the catalogue carries it.
        /// </summary>
        public static string Select(string stock, int cars, string power, TrainCatalogue catalogue) {
            var key = Key(stock, cars, power);
            var zoo = ZooKey(stock, cars, power);
            if (catalogue != null && catalogue.Has(zoo)) return zoo;
            return key;
        }
    }
}
