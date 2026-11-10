using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;

namespace Metro.AssetExample
{
    public static class InstallGltf
    {
        private static AddRequest request;
        private static double deadline;

        public static void Run()
        {
            request = Client.Add("com.unity.cloud.gltfast@6.19.0");
            deadline = EditorApplication.timeSinceStartup + 600;
            EditorApplication.update += Poll;
        }

        private static void Poll()
        {
            if (!request.IsCompleted && EditorApplication.timeSinceStartup < deadline)
                return;

            EditorApplication.update -= Poll;
            if (request.IsCompleted && request.Status == StatusCode.Success)
            {
                Debug.Log($"Resolved {request.Result.packageId}");
                EditorApplication.Exit(0);
                return;
            }

            Debug.LogError(request.Error?.message ?? "glTFast package resolution timed out");
            EditorApplication.Exit(1);
        }
    }
}
