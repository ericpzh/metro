import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadMsixIdentity,
  normalizeMsixVersion,
  renderAppxManifest,
} from '../../tools/unity-web/pack-windows-msix.mjs'

test('normalizeMsixVersion pads 3-part versions and rejects invalid components', () => {
  assert.equal(normalizeMsixVersion('1.2.3'), '1.2.3.0')
  assert.equal(normalizeMsixVersion('1.0.0.0'), '1.0.0.0')
  assert.throws(() => normalizeMsixVersion('1.0'), /Invalid MSIX version/)
  assert.throws(() => normalizeMsixVersion('1.0.70000.0'), /out of 0..65535/)
  assert.throws(() => normalizeMsixVersion('1.0.a.0'), /Invalid MSIX version component/)
})

test('loadMsixIdentity reads JSON config and lets options override version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metro-msix-id-'))
  try {
    const file = join(dir, 'identity.json')
    writeFileSync(
      file,
      JSON.stringify({
        name: 'Contoso.StationDesigner',
        publisher: 'CN=11111111-2222-3333-4444-555555555555',
        publisherDisplayName: 'Contoso & Co',
        version: '1.0.0.0',
      }),
      'utf8',
    )
    const id = loadMsixIdentity(dir, { identityPath: file, version: '1.2.3' })
    assert.equal(id.name, 'Contoso.StationDesigner')
    assert.equal(id.publisher, 'CN=11111111-2222-3333-4444-555555555555')
    assert.equal(id.publisherDisplayName, 'Contoso & Co')
    assert.equal(id.version, '1.2.3.0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('renderAppxManifest emits Store-compliant x64 full-trust manifest with XML escaping', () => {
  const xml = renderAppxManifest({
    name: 'Contoso.StationDesigner',
    publisher: 'CN=11111111-2222-3333-4444-555555555555',
    publisherDisplayName: 'Contoso & Co',
    displayName: 'Station Designer',
    description: 'Build & simulate metro stations.',
    version: '1.0.0.0',
  })
  assert.match(xml, /Name="Contoso\.StationDesigner"/)
  assert.match(xml, /Publisher="CN=11111111-2222-3333-4444-555555555555"/)
  assert.match(xml, /ProcessorArchitecture="x64"/)
  assert.match(xml, /<PublisherDisplayName>Contoso &amp; Co<\/PublisherDisplayName>/)
  assert.match(xml, /Description="Build &amp; simulate metro stations\."/)
  assert.match(xml, /Executable="MetroStation\.exe"/)
  assert.match(xml, /EntryPoint="Windows\.FullTrustApplication"/)
  assert.match(xml, /<rescap:Capability Name="runFullTrust" \/>/)
  assert.match(xml, /<Resource Language="en-US" \/>/)
  assert.match(xml, /<Resource Language="zh-CN" \/>/)
})
