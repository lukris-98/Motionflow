# MotionFlow Rust Engine (`motionflow_rust`)

Crate Rust siap-compile untuk mengakselerasi perhitungan **Keyframe / Cubic Bezier**, **Mat4 3D Transform**, dan **Stereo PCM Audio Mixing** baik melalui **WebAssembly (WASM)** di WebView maupun **Android JNI (`.so`)**.

> Catatan: Container cloud build AI Studio tidak menyertakan `rustc`/`cargo`/Android NDK, sehingga aplikasi Android menggunakan implementasi fallback JS/WebGL + Kotlin `MediaCodec` secara default, dan otomatis mengaktifkan akselerasi WASM begitu file `motionflow_rust.wasm` dikompilasi dan ditempatkan di `app/src/main/assets/www/wasm/motionflow_rust.wasm`.

## 1. Compile ke WebAssembly (untuk WebView)
```bash
rustup target add wasm32-unknown-unknown
cd rust-engine
cargo build --target wasm32-unknown-unknown --release
mkdir -p ../app/src/main/assets/www/wasm
cp target/wasm32-unknown-unknown/release/motionflow_rust.wasm ../app/src/main/assets/www/wasm/
```

## 2. Compile ke Android Native `.so` (opsional via `cargo-ndk`)
```bash
cargo install cargo-ndk
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cd rust-engine
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -o ../app/src/main/jniLibs build --release --features android-jni
```
Lalu rebuild APK dengan `gradle :app:assembleDebug`.
