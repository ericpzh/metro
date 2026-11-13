using System;
using System.Collections.Generic;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// One animated passenger view. The simulation owns identity, position and state;
    /// this class only maps the published movement state to the cleared rig's clips
    /// (<c>passenger-adult.glb</c>: Idle, Walk, Board) and keeps a stable phase so a
    /// paused or repeated tick samples the same pose.
    /// </summary>
    sealed class PassengerActor : IDisposable {
        /// <summary>Metres covered by one full walk cycle (two steps).</summary>
        public const float WalkCycleMetres = 1.44f;
        /// <summary>Rig height in metres; the promoted cleared stand-in is 1.70 m.</summary>
        public const float RigHeight = 1.70f;

        readonly GameObject root;
        readonly Transform model;
        readonly Dictionary<string, AnimationClip> clips = new Dictionary<string, AnimationClip>(StringComparer.Ordinal);
        readonly float height;
        AnimationClip current;
        float phase;
        float heading;
        Vector3 previous;
        bool hasPrevious;

        public GameObject GameObject => root;

        public PassengerActor(string name, GameObject prefab, AnimationClip[] source, Vector3 position, Transform parent) {
            if (!prefab) throw new ArgumentNullException(nameof(prefab));
            root = UnityEngine.Object.Instantiate(prefab, position, Quaternion.identity, parent);
            root.name = name;
            var basis = root.transform.Find("Unity basis");
            model = basis && basis.childCount > 0 ? basis.GetChild(0) : root.transform;
            foreach (var clip in source ?? Array.Empty<AnimationClip>()) {
                if (clip && !clips.ContainsKey(clip.name)) clips.Add(clip.name, clip);
            }
            height = RigHeight;
            previous = position;
            Bind("Idle");
        }

        public void SetVisible(bool visible) {
            if (root) root.SetActive(visible);
        }

        /// <summary>
        /// Move the view to `position` and choose its clip: queued stands, walking cycles,
        /// boarding plays the door transition once. `walking` is false while the agent is
        /// held at a server, `boarding` once it reaches the platform stop.
        /// </summary>
        public void Update(Vector3 position, bool queued, bool boarding, bool dead) {
            if (!root || dead) return;
            var delta = position - previous;
            float travelled = new Vector2(delta.x, delta.z).magnitude;
            if (travelled > 1e-4f) {
                heading = Mathf.Atan2(delta.x, delta.z) * Mathf.Rad2Deg;
                phase += travelled / WalkCycleMetres * 2f; // one clip cycle is two steps
                previous = position;
                hasPrevious = true;
            }
            root.transform.position = position;
            if (hasPrevious || travelled > 0f) root.transform.rotation = Quaternion.Euler(0, heading, 0);
            if (boarding) Bind("Board");
            else if (queued || travelled <= 1e-4f) Bind("Idle");
            else Bind("Walk");
            Sample(position);
        }

        void Bind(string clip) {
            if (current && current.name == clip) return;
            if (!clips.TryGetValue(clip, out var next)) return;
            current = next;
            phase = 0f;
        }

        void Sample(Vector3 position) {
            if (!current || !model) return;
            float time;
            switch (current.name) {
                case "Walk": time = current.length <= 0f ? 0f : Mathf.Repeat(phase * .5f, 1f) * current.length; break;
                case "Board": time = Mathf.Min(1f, Mathf.Repeat(phase * .25f, 1f)) * current.length; break;
                default: time = 0f; break;
            }
            current.SampleAnimation(model.gameObject, time);
            root.transform.position = new Vector3(position.x, position.y, position.z);
        }

        public float Height => height;

        public void Dispose() {
            if (root) UnityEngine.Object.Destroy(root);
        }
    }
}
