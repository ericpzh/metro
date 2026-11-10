using UnityEngine;
using UnityEngine.UI;
using System.Collections;
using System.Runtime.InteropServices;

namespace Metro {
    public class BootstrapCounter : MonoBehaviour {
        public Text label;
        int clicks;
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void MetroReady();
        [DllImport("__Internal")] static extern void MetroCount(int count);
        [DllImport("__Internal")] static extern void MetroTextChanged(string text);
#endif
        IEnumerator Start() {
            Refresh();
            yield return new WaitForEndOfFrame();
#if UNITY_WEBGL && !UNITY_EDITOR
            MetroReady();
#endif
        }
        public void Click() {
            clicks++;
            Refresh();
#if UNITY_WEBGL && !UNITY_EDITOR
            MetroCount(clicks);
#endif
        }
        public void InputChanged(string value) {
#if UNITY_WEBGL && !UNITY_EDITOR
            MetroTextChanged(value);
#endif
        }
        void Refresh() { if (label != null) label.text = "Station Designer  车站设计师\nClicks / 点击: " + clicks; }
    }
}
