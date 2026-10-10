import * as THREE from 'three'
import { PieceBuilder, slab, plate, placeLocal } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'
import { CHECKOUT_HEIGHT } from '../../../sim/constants.ts'

/** White convenience-store checkout with a stocked impulse display (§5.7). */
export class CheckoutModel extends PieceBuilder {
  readonly kind = 'checkout'
  build(mod: Extract<Module, { type: 'checkout' }>): THREE.Group {
    const g = new THREE.Group(), mats = this.ctx.mats
    slab(g, mats.darkSteel, 0, 0, 0.055, 0.92, 0.72, 0.11).name = 'checkout-plinth'
    slab(g, mats.white, 0, 0.02, 0.515, 0.92, 0.68, 0.83).name = 'checkout-cabinet'
    slab(g, mats.white, 0, -0.015, 0.96, 0.98, 0.79, 0.06).name = 'checkout-worktop'
    // Split white fascia flanks a recessed four-tier merchandise rack.
    for (const x of [-0.33, 0.33]) {
      slab(g, mats.white, x, -0.348, 0.53, 0.25, 0.045, 0.8).name = 'checkout-fascia'
      slab(g, mats.psu, x, -0.375, 0.18, 0.25, 0.012, 0.065)
    }
    slab(g, mats.darkSteel, 0, -0.35, 0.5, 0.36, 0.035, 0.78).name = 'display-back'
    for (const x of [-0.2, 0.2]) slab(g, mats.white, x, -0.395, 0.51, 0.028, 0.19, 0.84)
    for (let row = 0; row < 4; row++) {
      const z = 0.18 + row * 0.185
      slab(g, mats.white, 0, -0.405, z, 0.38, 0.18, 0.022).name = 'display-shelf'
      slab(g, mats.psu, 0, -0.492, z + 0.015, 0.38, 0.012, 0.03)
    }
    // Batch colourful packages and white labels into two draw calls.
    const stock = new THREE.InstancedMesh(new THREE.BoxGeometry(0.066, 0.075, 0.12), mats.shelfGoods, 16)
    const labels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.047, 0.004, 0.05), mats.white, 16)
    const matrix = new THREE.Matrix4(), colours = [0x41a85d, 0xf6cd41, 0x58b9ce, 0xd85145]
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      const i = row * 4 + col, x = -0.135 + col * 0.09, z = 0.251 + row * 0.185
      stock.setMatrixAt(i, matrix.makeTranslation(x, -0.42, z))
      stock.setColorAt(i, new THREE.Color(colours[(col + row) % colours.length]))
      labels.setMatrixAt(i, matrix.makeTranslation(x, -0.46, z))
    }
    stock.name = 'checkout-stock'; labels.name = 'checkout-stock-labels'
    g.add(stock, labels)
    // Cash drawer and tall POS screen face the cashier behind the counter.
    slab(g, mats.rubber, 0.08, 0.04, 1.025, 0.38, 0.29, 0.07).name = 'cash-drawer'
    slab(g, mats.steel, 0.08, 0.19, 1.03, 0.2, 0.008, 0.018)
    slab(g, mats.darkSteel, 0.08, -0.035, 1.15, 0.045, 0.045, 0.2)
    const pos = new THREE.Group()
    pos.position.set(0.08, -0.035, CHECKOUT_HEIGHT - 0.16)
    pos.rotation.x = -0.15
    slab(pos, mats.white, 0, 0, 0, 0.4, 0.055, 0.26).name = 'pos-housing'
    plate(pos, mats.desktopScreen, 0.345, 0.205, 0, 0.029, 0, Math.PI).name = 'pos-screen'
    slab(pos, mats.rubber, 0, -0.032, 0, 0.3, 0.01, 0.19).name = 'customer-display-housing'
    plate(pos, mats.desktopScreen, 0.275, 0.165, 0, -0.038, 0, 0).name = 'customer-display'
    g.add(pos)
    slab(g, mats.rubber, 0.08, 0.16, 1.071, 0.24, 0.08, 0.022).name = 'pos-keyboard'
    slab(g, mats.white, -0.33, 0.03, 1.075, 0.18, 0.23, 0.17).name = 'receipt-printer'
    slab(g, mats.rubber, -0.33, 0.149, 1.11, 0.13, 0.008, 0.02)
    slab(g, mats.white, -0.33, 0.175, 1.095, 0.095, 0.055, 0.005).name = 'receipt'
    slab(g, mats.rubber, 0.33, 0.03, 1.015, 0.14, 0.16, 0.045).name = 'barcode-scanner'
    slab(g, mats.green, 0.33, 0.03, 1.04, 0.1, 0.1, 0.006)
    slab(g, mats.darkSteel, -0.25, -0.245, 1.075, 0.105, 0.055, 0.17).name = 'payment-reader'
    plate(g, mats.desktopScreen, 0.08, 0.12, -0.25, -0.274, 1.08, 0)
    return placeLocal(g, mod)
  }
}
