// The station's finish shader — URP Lit's lighting for the cell surfaces, with the two
// inputs URP Lit ignores: the mesher's per-vertex ambient occlusion and the source's
// "no environment reflections" rule.
//
// Plan 13 §2. `game/src/render/materials.ts` builds every finish as a
// `MeshStandardMaterial` with `vertexColors: true`; `chunkMesher.ts` writes the source's
// AO into the vertex colour (walls 0.4–1, tops 0.45–1, the hard-coded bottoms 0.6).
// `StationCellView` uploads that same channel (`mesh.colors`), but URP/Lit never reads
// `COLOR`, so every surface rendered with no occlusion — the flat, white slabs in the
// playtest. This shader multiplies the albedo by the vertex colour and then runs URP's
// own `UniversalFragmentPBR`, so lighting, additional lights, shadows-off and fog behave
// exactly like the rest of the pipeline.
//
// Properties are the ones `StationFinishLibrary.CreateMaterial` writes, so a material
// built by the library is valid here without a second code path:
//   _BaseMap (sRGB, Repeat, 1 tile per metre), _BaseColor (white, or a painted tint),
//   _Smoothness (1 - roughness), _Metallic, _Cull (0 for the double-sided ceiling family).
//
// The source has no environment map and no tone mapping; `_ENVIRONMENTREFLECTIONS_OFF` is
// enabled on every finish material by the library so a metallic finish shows its direct
// highlight and not the Unity skybox. Glass (lift/PSD/balustrade) does not use this
// shader — see `StationGlass`.
Shader "Metro/Station Finish"
{
    Properties
    {
        [MainTexture] _BaseMap("Base Map", 2D) = "white" {}
        [MainColor] _BaseColor("Base Color", Color) = (1,1,1,1)
        _Smoothness("Smoothness", Range(0,1)) = 0.22
        _Metallic("Metallic", Range(0,1)) = 0
        [HideInInspector] _VertexColorWeight("Vertex Color Weight", Float) = 1
        [Enum(UnityEngine.Rendering.CullMode)] _Cull("Cull", Float) = 2
        [Toggle(_ALPHATEST_ON)] _AlphaClip("Alpha Clip", Float) = 0
        _Cutoff("Alpha Cutoff", Range(0,1)) = 0.5
        [HideInInspector] _Surface("__surface", Float) = 0
        [HideInInspector] _Blend("__blend", Float) = 0
        [HideInInspector] _SrcBlend("__src", Float) = 1
        [HideInInspector] _DstBlend("__dst", Float) = 0
        [HideInInspector] _ZWrite("__zw", Float) = 1
        [HideInInspector] _SectionPlane("Section Plane", Vector) = (0,0,0,0)
        [HideInInspector] _SectionClip("Section Clip", Float) = 0
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }
        LOD 300

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            Blend[_SrcBlend][_DstBlend]
            ZWrite[_ZWrite]
            Cull[_Cull]

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex StationFinishVertex
            #pragma fragment StationFinishFragment

            // Material keywords: the vertex colour is always on (it is the AO channel).
            // `multi_compile` (not `shader_feature`) because every finish material is
            // built at runtime, so no build-time material references these variants and
            // `shader_feature` would strip them out of the player.
            #pragma multi_compile_fragment _ _ALPHATEST_ON
            #pragma multi_compile_fragment _ _ENVIRONMENTREFLECTIONS_OFF

            // Universal Pipeline keywords. The station's rig is one key + one fill
            // directional and no shadow maps (the source sets `shadowMap.enabled = false`),
            // so the shadow keywords are deliberately absent: `GetMainLight` then returns
            // full attenuation and the variants are not compiled at all.
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #pragma multi_compile_fragment _ _LIGHT_COOKIES
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #pragma instancing_options renderinglayer

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "StationSectionClip.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half _Smoothness;
                half _Metallic;
                half _VertexColorWeight;
                half _Cutoff;
                half _Surface;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            // Ambient is passed explicitly by `StationRenderRig` instead of read from the
            // SH probe: the source's rig is exactly "ambient + hemisphere", so the shader
            // can evaluate it per pixel from three colours and needs no baked probe (a
            // build with no lightmaps is the normal case for this station).
            half4 _StationAmbient;
            half4 _StationHemiSky;
            half4 _StationHemiGround;

            half3 StationAmbientIrradiance(half3 normalWS)
            {
                half up = 0.5h * (normalWS.y + 1.0h);
                return _StationAmbient.rgb + lerp(_StationHemiGround.rgb, _StationHemiSky.rgb, up);
            }

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                half4 color : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half3 normalWS : TEXCOORD2;
                half4 color : COLOR;
                half fogFactor : TEXCOORD3;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings StationFinishVertex(Attributes input)
            {
                Varyings output = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);

                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normals = GetVertexNormalInputs(input.normalOS);

                output.positionCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.normalWS = normals.normalWS;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                output.color = input.color;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                return output;
            }

            half4 StationFinishFragment(Varyings input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);

                ClipStationSection(input.positionWS);
                half4 albedo = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv) * _BaseColor;
                // The mesher's AO, exactly as the source's `vertexColors: true` applies it.
                albedo.rgb *= lerp(1.0h, input.color.rgb, _VertexColorWeight);

                #if defined(_ALPHATEST_ON)
                    clip(albedo.a - _Cutoff);
                #endif

                SurfaceData surface = (SurfaceData)0;
                surface.albedo = albedo.rgb;
                surface.alpha = albedo.a;
                surface.metallic = _Metallic;
                surface.smoothness = _Smoothness;
                surface.occlusion = 1.0h;
                surface.normalTS = half3(0.0h, 0.0h, 1.0h);
                surface.specular = half3(0.0h, 0.0h, 0.0h);
                surface.clearCoatMask = 0.0h;
                surface.clearCoatSmoothness = 0.0h;

                InputData lighting = (InputData)0;
                lighting.positionWS = input.positionWS;
                lighting.normalWS = NormalizeNormalPerPixel(input.normalWS);
                lighting.viewDirectionWS = GetWorldSpaceNormalizeViewDir(input.positionWS);
                lighting.shadowCoord = 0.0;
                lighting.fogCoord = input.fogFactor;
                lighting.vertexLighting = half3(0.0h, 0.0h, 0.0h);
                lighting.bakedGI = StationAmbientIrradiance(lighting.normalWS);
                lighting.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS);
                lighting.shadowMask = half4(0.0h, 0.0h, 0.0h, 0.0h);

                half4 color = UniversalFragmentPBR(lighting, surface);
                color.rgb = MixFog(color.rgb, lighting.fogCoord);
                // Opaque surfaces write alpha 1; a ghosted (storey-cutaway) clone keeps
                // its alpha so the transparent blend reads. This is URP Lit's
                // `OutputAlpha`, driven by the `_Surface` the ghost palette writes.
                color.a = _Surface > 0.5h ? color.a : 1.0h;
                return color;
            }
            ENDHLSL
        }

        // The depth and depth-normal passes keep the finish surfaces inside the screen
        // space occlusion / depth consumers the PC renderer already runs.
        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }
            ZWrite On
            ColorMask R
            Cull[_Cull]

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex DepthVertex
            #pragma fragment DepthFragment
            #pragma shader_feature_local_fragment _ALPHATEST_ON
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "StationSectionClip.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half _Smoothness;
                half _Metallic;
                half _VertexColorWeight;
                half _Cutoff;
                half _Surface;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct DepthAttributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct DepthVaryings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            DepthVaryings DepthVertex(DepthAttributes input)
            {
                DepthVaryings output = (DepthVaryings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);
                output.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return output;
            }

            half4 DepthFragment(DepthVaryings input) : SV_Target
            {
                ClipStationSection(input.positionWS);
                #if defined(_ALPHATEST_ON)
                    half alpha = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv).a * _BaseColor.a;
                    clip(alpha - _Cutoff);
                #endif
                return 0;
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode" = "DepthNormals" }
            ZWrite On
            Cull[_Cull]

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex NormalsVertex
            #pragma fragment NormalsFragment
            #pragma shader_feature_local_fragment _ALPHATEST_ON
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "StationSectionClip.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half _Smoothness;
                half _Metallic;
                half _VertexColorWeight;
                half _Cutoff;
                half _Surface;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct NormalAttributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct NormalVaryings
            {
                float4 positionCS : SV_POSITION;
                float3 normalWS : TEXCOORD0;
                float2 uv : TEXCOORD1;
                float3 positionWS : TEXCOORD2;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            NormalVaryings NormalsVertex(NormalAttributes input)
            {
                NormalVaryings output = (NormalVaryings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);
                output.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return output;
            }

            half4 NormalsFragment(NormalVaryings input) : SV_Target
            {
                ClipStationSection(input.positionWS);
                #if defined(_ALPHATEST_ON)
                    half alpha = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv).a * _BaseColor.a;
                    clip(alpha - _Cutoff);
                #endif
                return half4(NormalizeNormalPerPixel(input.normalWS), 0.0);
            }
            ENDHLSL
        }
    }

    FallBack "Universal Render Pipeline/Lit"
}
