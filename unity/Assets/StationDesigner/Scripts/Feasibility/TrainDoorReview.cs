using System;
using System.Linq;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Metro.Feasibility {
    // QA scene only: play both imported clips, publishing the real transforms.
    public sealed class TrainDoorReview : MonoBehaviour {
        public GameObject imported; public AnimationClip plus,minus;
        Transform plusDoor,minusDoor; Vector3 plusClosed,minusClosed;
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void MetroTrainDoorFrame(int phase,float time,float plusMove,float minusMove);
#else
        static void MetroTrainDoorFrame(int phase,float time,float plusMove,float minusMove) { }
#endif
        void Start() {
            plusDoor=imported.GetComponentsInChildren<Transform>().Single(t=>t.name=="TypeADoor02");
            minusDoor=imported.GetComponentsInChildren<Transform>().Single(t=>t.name=="TypeADoor00");
            plus.SampleAnimation(imported,0); minus.SampleAnimation(imported,0);
            plusClosed=plusDoor.localPosition; minusClosed=minusDoor.localPosition;
        }
        void Update() {
            float cycle=Time.time % 6f; int phase=cycle<3 ? 0:1; float local=phase==0?cycle:cycle-3;
            float t=Mathf.Clamp01(local-.5f);
            if(phase==0) { minus.SampleAnimation(imported,0); plus.SampleAnimation(imported,t); }
            else { plus.SampleAnimation(imported,0); minus.SampleAnimation(imported,t); }
            MetroTrainDoorFrame(phase,t,Vector3.Distance(plusDoor.localPosition,plusClosed),Vector3.Distance(minusDoor.localPosition,minusClosed));
        }
    }
}
