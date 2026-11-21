// WebGL 2 / OpenGL ES 3.0 compatible AMD FidelityFX Super Resolution 1.0
// (EASU + RCAS) fragment shader, ported from `game/src/render/shaders/fsr-easu.glsl`
// and `fsr-rcas.glsl` (MIT license). Used on platforms where URP's built-in
// `FSRUtils.IsSupported()` (`graphicsShaderLevel >= 45`) is false, such as WebGL 2.
// Loaded from `Resources/StationFsr1` so build shader stripping retains both passes.
Shader "Metro/Station FSR 1"
{
    Properties
    {
        _MainTex("Source", 2D) = "black" {}
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
        }

        ZTest Always
        ZWrite Off
        Cull Off

        // Pass 0: EASU (Edge-Adaptive Spatial Upsampling)
        Pass
        {
            Name "StationFsrEasu"

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex FsrVert
            #pragma fragment FsrEasuFrag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);
            float4 _FsrInputSize;  // xy = width, height; zw = 1/width, 1/height
            float4 _FsrOutputSize; // xy = width, height; zw = 1/width, 1/height

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            Varyings FsrVert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }

            float3 FsrEasuCF(float2 p)
            {
                float2 halfTexel = _FsrInputSize.zw * 0.5;
                return SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, clamp(p, halfTexel, 1.0 - halfTexel)).rgb;
            }

            void FsrEasuCon(
                out float4 con0,
                out float4 con1,
                out float4 con2,
                out float4 con3,
                float2 inputSizeInPixels,
                float2 outputSizeInPixels)
            {
                con0 = float4(
                    inputSizeInPixels.x / outputSizeInPixels.x,
                    inputSizeInPixels.y / outputSizeInPixels.y,
                    0.5 * inputSizeInPixels.x / outputSizeInPixels.x - 0.5,
                    0.5 * inputSizeInPixels.y / outputSizeInPixels.y - 0.5
                );
                con1 = float4(1.0, 1.0, 1.0, -1.0) / inputSizeInPixels.xyxy;
                con2 = float4(-1.0, 2.0, 1.0, 2.0) / inputSizeInPixels.xyxy;
                con3 = float4(0.0, 4.0, 0.0, 0.0) / inputSizeInPixels.xyxy;
            }

            void FsrEasuTapF(
                inout float3 aC,
                inout float aW,
                float2 off,
                float2 dir,
                float2 len,
                float lob,
                float clp,
                float3 c)
            {
                float2 v = float2(dot(off, dir), dot(off, float2(-dir.y, dir.x)));
                v *= len;
                float d2 = min(dot(v, v), clp);
                float wB = 0.4 * d2 - 1.0;
                float wA = lob * d2 - 1.0;
                wB *= wB;
                wA *= wA;
                wB = 1.5625 * wB - 0.5625;
                float w = wB * wA;
                aC += c * w;
                aW += w;
            }

            void FsrEasuSetF(
                inout float2 dir,
                inout float len,
                float w,
                float lA, float lB, float lC, float lD, float lE)
            {
                float lenX = max(abs(lD - lC), abs(lC - lB));
                float dirX = lD - lB;
                dir.x += dirX * w;
                lenX = saturate(abs(dirX) / max(lenX, 1e-5));
                lenX *= lenX;
                len += lenX * w;

                float lenY = max(abs(lE - lC), abs(lC - lA));
                float dirY = lE - lA;
                dir.y += dirY * w;
                lenY = saturate(abs(dirY) / max(lenY, 1e-5));
                lenY *= lenY;
                len += lenY * w;
            }

            float3 FsrEasuF(float2 ip, float4 con0, float4 con1, float4 con2, float4 con3)
            {
                float2 pp = ip * con0.xy + con0.zw;
                float2 fp = floor(pp);
                pp -= fp;

                float2 p0 = fp * con1.xy + con1.zw;
                float2 p1 = p0 + con2.xy;
                float2 p2 = p0 + con2.zw;
                float2 p3 = p0 + con3.xy;

                float4 off = float4(-0.5, 0.5, -0.5, 0.5) * con1.xxyy;
                float3 bC = FsrEasuCF(p0 + off.xw); float bL = bC.g + 0.5 * (bC.r + bC.b);
                float3 cC = FsrEasuCF(p0 + off.yw); float cL = cC.g + 0.5 * (cC.r + cC.b);
                float3 iC = FsrEasuCF(p1 + off.xw); float iL = iC.g + 0.5 * (iC.r + iC.b);
                float3 jC = FsrEasuCF(p1 + off.yw); float jL = jC.g + 0.5 * (jC.r + jC.b);
                float3 fC = FsrEasuCF(p1 + off.yz); float fL = fC.g + 0.5 * (fC.r + fC.b);
                float3 eC = FsrEasuCF(p1 + off.xz); float eL = eC.g + 0.5 * (eC.r + eC.b);
                float3 kC = FsrEasuCF(p2 + off.xw); float kL = kC.g + 0.5 * (kC.r + kC.b);
                float3 lC = FsrEasuCF(p2 + off.yw); float lL = lC.g + 0.5 * (lC.r + lC.b);
                float3 hC = FsrEasuCF(p2 + off.yz); float hL = hC.g + 0.5 * (hC.r + hC.b);
                float3 gC = FsrEasuCF(p2 + off.xz); float gL = gC.g + 0.5 * (gC.r + gC.b);
                float3 oC = FsrEasuCF(p3 + off.yz); float oL = oC.g + 0.5 * (oC.r + oC.b);
                float3 nC = FsrEasuCF(p3 + off.xz); float nL = nC.g + 0.5 * (nC.r + nC.b);

                float2 dir = float2(0.0, 0.0);
                float len = 0.0;

                FsrEasuSetF(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
                FsrEasuSetF(dir, len,        pp.x  * (1.0 - pp.y), cL, fL, gL, hL, kL);
                FsrEasuSetF(dir, len, (1.0 - pp.x) *        pp.y , fL, iL, jL, kL, nL);
                FsrEasuSetF(dir, len,        pp.x  *        pp.y , gL, jL, kL, lL, oL);

                float2 dir2 = dir * dir;
                float dirR = dir2.x + dir2.y;
                bool zro = dirR < (1.0 / 32768.0);
                dirR = rsqrt(max(dirR, 1.0 / 32768.0));
                dirR = zro ? 1.0 : dirR;
                dir.x = zro ? 1.0 : dir.x;
                dir *= dirR;

                len = len * 0.5;
                len *= len;
                float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
                float2 len2 = float2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
                float lob = 0.5 - 0.29 * len;
                float clp = 1.0 / lob;

                float3 min4 = min(min(fC, gC), min(jC, kC));
                float3 max4 = max(max(fC, gC), max(jC, kC));
                float3 aC = float3(0.0, 0.0, 0.0);
                float aW = 0.0;
                FsrEasuTapF(aC, aW, float2( 0.0, -1.0) - pp, dir, len2, lob, clp, bC);
                FsrEasuTapF(aC, aW, float2( 1.0, -1.0) - pp, dir, len2, lob, clp, cC);
                FsrEasuTapF(aC, aW, float2(-1.0,  1.0) - pp, dir, len2, lob, clp, iC);
                FsrEasuTapF(aC, aW, float2( 0.0,  1.0) - pp, dir, len2, lob, clp, jC);
                FsrEasuTapF(aC, aW, float2( 0.0,  0.0) - pp, dir, len2, lob, clp, fC);
                FsrEasuTapF(aC, aW, float2(-1.0,  0.0) - pp, dir, len2, lob, clp, eC);
                FsrEasuTapF(aC, aW, float2( 1.0,  1.0) - pp, dir, len2, lob, clp, kC);
                FsrEasuTapF(aC, aW, float2( 2.0,  1.0) - pp, dir, len2, lob, clp, lC);
                FsrEasuTapF(aC, aW, float2( 2.0,  0.0) - pp, dir, len2, lob, clp, hC);
                FsrEasuTapF(aC, aW, float2( 1.0,  0.0) - pp, dir, len2, lob, clp, gC);
                FsrEasuTapF(aC, aW, float2( 1.0,  2.0) - pp, dir, len2, lob, clp, oC);
                FsrEasuTapF(aC, aW, float2( 0.0,  2.0) - pp, dir, len2, lob, clp, nC);

                return min(max4, max(min4, aC / max(aW, 1e-5)));
            }

            half4 FsrEasuFrag(Varyings input) : SV_Target
            {
                float4 con0, con1, con2, con3;
                FsrEasuCon(con0, con1, con2, con3, _FsrInputSize.xy, _FsrOutputSize.xy);
                float3 col = FsrEasuF(input.uv * _FsrOutputSize.xy, con0, con1, con2, con3);
                return half4(col, 1.0h);
            }
            ENDHLSL
        }

        // Pass 1: RCAS (Robust Contrast-Adaptive Sharpening)
        Pass
        {
            Name "StationFsrRcas"

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex FsrVert
            #pragma fragment FsrRcasFrag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            #define FSR_RCAS_LIMIT (0.25 - (1.0 / 16.0))

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);
            float4 _FsrOutputSize; // xy = width, height; zw = 1/width, 1/height
            float _FsrSharpness;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            Varyings FsrVert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }

            float3 FsrRcasLoadF(float2 p)
            {
                float2 halfTexel = _FsrOutputSize.zw * 0.5;
                return SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, clamp(p * _FsrOutputSize.zw, halfTexel, 1.0 - halfTexel)).rgb;
            }

            float3 FsrRcasF(float2 ip, float con)
            {
                float3 b = FsrRcasLoadF(ip + float2( 0.0, -1.0));
                float3 d = FsrRcasLoadF(ip + float2(-1.0,  0.0));
                float3 e = FsrRcasLoadF(ip);
                float3 f = FsrRcasLoadF(ip + float2( 1.0,  0.0));
                float3 h = FsrRcasLoadF(ip + float2( 0.0,  1.0));

                float3 mn4 = min(b, min(f, h));
                float3 mx4 = max(b, max(f, h));

                float2 peakC = float2(1.0, -4.0);
                float3 hitMin = mn4 / max(4.0 * mx4, float3(1e-5, 1e-5, 1e-5));
                float3 hitMax = (peakC.x - mx4) / min(4.0 * mn4 + peakC.y, float3(-1e-5, -1e-5, -1e-5));
                float3 lobeRGB = max(-hitMin, hitMax);
                float lobe = max(-FSR_RCAS_LIMIT, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * con;

                return saturate((lobe * (b + d + h + f) + e) / (4.0 * lobe + 1.0));
            }

            half4 FsrRcasFrag(Varyings input) : SV_Target
            {
                float con = exp2(-_FsrSharpness);
                float3 col = FsrRcasF(input.uv * _FsrOutputSize.xy, con);
                return half4(col, 1.0h);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
