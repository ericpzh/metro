#ifndef METRO_STATION_SECTION_CLIP
#define METRO_STATION_SECTION_CLIP

float4 _SectionPlane;
float _SectionClip;

void ClipStationSection(float3 positionWS)
{
    if (_SectionClip > 0.5)
        clip(-dot(_SectionPlane, float4(positionWS, 1.0)));
}

#endif
