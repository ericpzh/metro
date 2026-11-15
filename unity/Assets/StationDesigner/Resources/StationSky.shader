// Procedural-cloud skybox shader for Hide UI presentation mode, ported from
// `game/src/render/scene/systems/SkySystem.ts` + Three.js `WebGLBackground`.
// Loaded from `Resources/StationSky` so WebGL and Standalone shader stripping
// never drop the background pass.
Shader "Metro/Station Sky"
{
    Properties
    {
        [NoScaleOffset] _SkyMap("Sky Cubemap", Cube) = "" {}
        _Intensity("Intensity", Range(0.0, 2.0)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "Queue" = "Background"
            "RenderType" = "Background"
            "RenderPipeline" = "UniversalPipeline"
            "PreviewType" = "Skybox"
        }

        Pass
        {
            Name "StationSky"
            Cull Off
            ZWrite Off
            ZTest LEqual

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex SkyVertex
            #pragma fragment SkyFragment

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float _Intensity;
            CBUFFER_END

            TEXTURECUBE(_SkyMap);
            SAMPLER(sampler_SkyMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 directionWS : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings SkyVertex(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.directionWS = input.positionOS.xyz;
                return output;
            }

            half4 SkyFragment(Varyings input) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                half3 sky = SAMPLE_TEXTURECUBE(_SkyMap, sampler_SkyMap, input.directionWS).rgb;
                return half4(sky * (half)_Intensity, 1.0h);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
