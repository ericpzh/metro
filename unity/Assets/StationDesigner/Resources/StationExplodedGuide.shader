// Camera-facing dashed connector shader for the standalone exploded view (Plan 19 §4).
// Matches `ExplodedConnections` (`game/src/render/explodedConnections.ts`):
// `#8ed8ff`, 1.5 m dash, 1.0 m gap, 0.9 opacity, depthTest = true, depthWrite = false.
Shader "Metro/Station Exploded Guide"
{
    Properties
    {
        [MainColor] _BaseColor("Color", Color) = (0.5568628, 0.8470588, 1.0, 0.9)
        _DashSize("Dash Size", Float) = 1.5
        _GapSize("Gap Size", Float) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Transparent+50"
            "IgnoreProjector" = "True"
        }
        LOD 100

        Pass
        {
            Name "ExplodedGuide"
            Tags { "LightMode" = "UniversalForward" }

            Blend SrcAlpha OneMinusSrcAlpha
            ZTest LEqual
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex GuideVertex
            #pragma fragment GuideFragment

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                float _DashSize;
                float _GapSize;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings GuideVertex(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }

            half4 GuideFragment(Varyings input) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                float cycle = max(0.001, _DashSize + _GapSize);
                float phase = fmod(max(0.0, input.uv.x), cycle);
                clip(_DashSize - phase);
                return _BaseColor;
            }
            ENDHLSL
        }
    }
}
