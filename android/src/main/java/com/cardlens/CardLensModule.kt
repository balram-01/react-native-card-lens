package com.cardlens

import com.facebook.react.bridge.ReactApplicationContext

class CardLensModule(reactContext: ReactApplicationContext) :
  NativeCardLensSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeCardLensSpec.NAME
  }
}
