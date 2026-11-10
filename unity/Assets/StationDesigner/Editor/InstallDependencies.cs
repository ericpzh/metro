using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;

namespace Metro.Editor {
    public static class InstallDependencies {
        static AddAndRemoveRequest request;
        static double deadline;
        public static void Run() {
            request = Client.AddAndRemove(new[] { "com.unity.test-framework@1.8.0", "com.unity.nuget.newtonsoft-json@3.2.1" }, new string[0]);
            deadline = EditorApplication.timeSinceStartup + 600;
            EditorApplication.update += Poll;
        }
        static void Poll() {
            if (!request.IsCompleted && EditorApplication.timeSinceStartup < deadline) return;
            EditorApplication.update -= Poll;
            if (!request.IsCompleted) { Debug.LogError("Package resolution timed out"); EditorApplication.Exit(1); return; }
            if (request.Status != StatusCode.Success) { Debug.LogError(request.Error.message); EditorApplication.Exit(1); return; }
            foreach (var package in request.Result) Debug.Log("Resolved " + package.name + "@" + package.version);
            EditorApplication.Exit(0);
        }
    }
}
