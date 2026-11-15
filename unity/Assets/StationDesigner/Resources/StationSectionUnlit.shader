Shader "Metro/Station Section Unlit"
{
    Properties
    {
        [MainTexture] _BaseMap("Base Map", 2D) = "white" {}
        [MainColor] _BaseColor("Base Color", Color) = (1,1,1,1)
        _Cutoff("Alpha Cutoff", Float) = 0.5
        [HideInInspector] _Surface("Surface", Float) = 0
        [HideInInspector] _Cull("Cull", Float) = 2
        [HideInInspector] _SrcBlend("Source Blend", Float) = 1
        [HideInInspector] _DstBlend("Destination Blend", Float) = 0
        [HideInInspector] _ZWrite("Depth Write", Float) = 1
        [HideInInspector] _ZTest("Depth Test", Float) = 4
        [HideInInspector] _SectionPlane("Section Plane", Vector) = (0,0,0,0)
        [HideInInspector] _SectionClip("Section Clip", Float) = 0
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Opaque" }

        Pass
        {
            Name "Unlit"
            Tags { "LightMode" = "UniversalForwardOnly" }
            Cull [_Cull]
            Blend [_SrcBlend] [_DstBlend]
            ZWrite [_ZWrite]
            ZTest [_ZTest]

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex SectionDepthVertex
            #pragma fragment SectionUnlitFragment
            #pragma multi_compile_fragment _ _ALPHATEST_ON
            #pragma multi_compile_fragment _ _SURFACE_TYPE_TRANSPARENT
            #pragma multi_compile_instancing
            #include "StationSectionDepth.hlsl"

            half4 SectionUnlitFragment(SectionDepthVaryings input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                ClipStationSection(input.positionWS);
                half4 color = SampleAlbedoAlpha(input.uv, TEXTURE2D_ARGS(_BaseMap, sampler_BaseMap)) * _BaseColor;
                #if defined(_ALPHATEST_ON)
                    clip(color.a - _Cutoff);
                #endif
                #if !defined(_SURFACE_TYPE_TRANSPARENT)
                    color.a = 1.0h;
                #endif
                return color;
            }
            ENDHLSL
        }

        UsePass "Metro/Station Section Lit/DepthOnly"
        UsePass "Metro/Station Section Lit/DepthNormalsOnly"
    }
}
