// Section-only counterpart of the procedural station's URP Lit materials.
Shader "Metro/Station Section Lit"
{
    Properties
    {
        [MainTexture] _BaseMap("Base Map", 2D) = "white" {}
        [MainColor] _BaseColor("Base Color", Color) = (1,1,1,1)
        _Cutoff("Alpha Cutoff", Float) = 0.5
        _Smoothness("Smoothness", Float) = 0.5
        _Metallic("Metallic", Float) = 0
        _MetallicGlossMap("Metallic Map", 2D) = "white" {}
        _SpecColor("Specular Color", Color) = (0.2,0.2,0.2,1)
        _SpecGlossMap("Specular Map", 2D) = "white" {}
        _BumpScale("Normal Scale", Float) = 1
        [Normal] _BumpMap("Normal Map", 2D) = "bump" {}
        _OcclusionStrength("Occlusion Strength", Float) = 1
        _OcclusionMap("Occlusion Map", 2D) = "white" {}
        [HDR] _EmissionColor("Emission", Color) = (0,0,0,0)
        _EmissionMap("Emission Map", 2D) = "white" {}
        [HideInInspector] _Surface("Surface", Float) = 0
        [HideInInspector] _Blend("Blend", Float) = 0
        [HideInInspector] _Cull("Cull", Float) = 2
        [HideInInspector] _SrcBlend("Source Blend", Float) = 1
        [HideInInspector] _DstBlend("Destination Blend", Float) = 0
        [HideInInspector] _SrcBlendAlpha("Source Alpha Blend", Float) = 1
        [HideInInspector] _DstBlendAlpha("Destination Alpha Blend", Float) = 0
        [HideInInspector] _ZWrite("Depth Write", Float) = 1
        [HideInInspector] _ZTest("Depth Test", Float) = 4
        [HideInInspector] _AlphaToMask("Alpha To Coverage", Float) = 0
        [HideInInspector] _SectionPlane("Section Plane", Vector) = (0,0,0,0)
        [HideInInspector] _SectionClip("Section Clip", Float) = 0
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Opaque" }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForwardOnly" }
            Blend [_SrcBlend] [_DstBlend], [_SrcBlendAlpha] [_DstBlendAlpha]
            ZWrite [_ZWrite]
            ZTest [_ZTest]
            Cull [_Cull]
            AlphaToMask [_AlphaToMask]

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex LitPassVertex
            #pragma fragment SectionLitFragment
            #pragma multi_compile _ _NORMALMAP
            #pragma multi_compile_fragment _ _ALPHATEST_ON
            #pragma multi_compile_fragment _ _SURFACE_TYPE_TRANSPARENT
            #pragma multi_compile_fragment _ _ALPHAPREMULTIPLY_ON _ALPHAMODULATE_ON
            #pragma multi_compile_fragment _ _EMISSION
            #pragma multi_compile_fragment _ _ENVIRONMENTREFLECTIONS_OFF
            #pragma multi_compile_fragment _ _SPECULARHIGHLIGHTS_OFF
            #pragma multi_compile_fragment _ _METALLICSPECGLOSSMAP
            #pragma multi_compile_fragment _ _SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A
            #pragma multi_compile_fragment _ _SPECULAR_SETUP
            #pragma multi_compile_fragment _ _OCCLUSIONMAP
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Fog.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/Shaders/LitInput.hlsl"
            #ifndef REQUIRES_WORLD_SPACE_POS_INTERPOLATOR
                #define REQUIRES_WORLD_SPACE_POS_INTERPOLATOR
            #endif
            #define LitPassFragment StationUrpLitFragment
            #include "Packages/com.unity.render-pipelines.universal/Shaders/LitForwardPass.hlsl"
            #undef LitPassFragment
            #include "StationSectionClip.hlsl"

            half4 SectionLitFragment(Varyings input) : SV_Target
            {
                ClipStationSection(input.positionWS);
                half4 color;
                StationUrpLitFragment(input, color);
                return color;
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }
            ZWrite On
            Cull [_Cull]
            ColorMask R

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex SectionDepthVertex
            #pragma fragment SectionDepthFragment
            #pragma multi_compile_fragment _ _ALPHATEST_ON
            #pragma multi_compile_instancing
            #include "StationSectionDepth.hlsl"
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormalsOnly"
            Tags { "LightMode" = "DepthNormalsOnly" }
            ZWrite On
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex SectionDepthVertex
            #pragma fragment SectionDepthFragment
            #pragma multi_compile_fragment _ _ALPHATEST_ON
            #pragma multi_compile_instancing
            #define STATION_SECTION_DEPTH_NORMALS
            #include "StationSectionDepth.hlsl"
            ENDHLSL
        }
    }
}
